import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useState, useEffect } from 'react';
import { filesystem } from '@xgenia/platform';
import * as os from 'os';
import * as path from 'path';

import { CloudService } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { projectFromDirectory } from '@xgenia-models/projectmodel.editor';
import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';
import * as Exporter from '@xgenia-utils/exporter';
import { compileProject } from '@xgenia-utils/compile';
import { saveProject } from '@xgenia-utils/compile/duplicateProject';
import { generateFunctionArtifact } from '@xgenia-utils/rgs/generateFunctionArtifact';
import { deployEdgeFunction } from '@xgenia-utils/rgs/deployEdgeFunction';
import { getRgsSettings, getSelectedGame } from '@xgenia-utils/rgs/rgsClient';

import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Select } from '@xgenia-core-ui/components/inputs/Select';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { TextType } from '@xgenia-core-ui/components/typography/Text/Text';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';

import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { NO_ENVIRONMENT_VALUE, RGS_ENVIRONMENT_VALUE } from '../../DeployPopup.constants';
import { useEnvironmentsAsOptions } from '../../DeployPopup.hooks';
import { useAuth } from '../../../../context/AuthContext';
import { ConnectionStore, ServiceName } from '../../../../services/ConnectionStore';
import { ConnectedServicesPanel } from '../../../panels/ConnectedServicesPanel/ConnectedServicesPanel';

// GitHub API constants
const GITHUB_API_BASE = 'https://api.github.com';

// Tokens are dynamically loaded from ConnectionStore (OAuth-based)
// No more hardcoded tokens!

// Import Vercel SDK - we'll create a simple wrapper for now since we can't install packages during runtime
// This would typically be: import { Vercel } from '@vercel/sdk';
// For now, we'll use a wrapper that provides the same interface
class VercelSDKWrapper {
  private bearerToken: string;
  private baseUrl = 'https://api.vercel.com';

  constructor(config: { bearerToken: string }) {
    this.bearerToken = config.bearerToken;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Vercel API Error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    // Handle empty responses (common for DELETE operations)
    const responseText = await response.text();
    if (!responseText) {
      return {}; // Return empty object for empty responses
    }

    try {
      return JSON.parse(responseText);
    } catch (error: any) {
      // If it's not valid JSON, return the text as is
      return { text: responseText };
    }
  }

  // Deployments API following official SDK pattern
  deployments = {
    createDeployment: async (data: {
      teamId?: string;
      slug?: string;
      requestBody: {
        name: string;
        project?: string;
        target?: string;
        gitSource: {
          type: string;
          repo: string;
          ref: string;
          org: string;
        };
        projectSettings?: {
          buildCommand?: string | null;
          devCommand?: string | null;
          framework?: string;
          commandForIgnoringBuildStep?: string;
          installCommand?: string | null;
          outputDirectory?: string | null;
        };
      };
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v13/deployments${queryString}`, {
        method: 'POST',
        body: JSON.stringify(data.requestBody),
      });
    },

    getDeployment: async (data: {
      idOrUrl: string;
      withGitRepoInfo?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.withGitRepoInfo) {
        params.append('withGitRepoInfo', data.withGitRepoInfo);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';
      return this.request(`/v13/deployments/${data.idOrUrl}${queryString}`);
    },

    listDeployments: async (data?: {
      limit?: number;
      since?: string;
      until?: string;
    }) => {
      const params = new URLSearchParams();
      if (data?.limit) params.append('limit', data.limit.toString());
      else params.append('limit', '100'); // Set default limit to 100
      if (data?.since) params.append('since', data.since);
      if (data?.until) params.append('until', data.until);
      const queryString = params.toString() ? `?${params.toString()}` : '';
      return this.request(`/v6/deployments${queryString}`);
    },

    deleteDeployment: async (data: {
      id: string;
    }) => {
      return this.request(`/v13/deployments/${data.id}`, {
        method: 'DELETE',
      });
    },
  };

  // Aliases API following official SDK pattern
  aliases = {
    assignAlias: async (data: {
      id: string;
      requestBody: {
        alias: string;
        redirect?: string | null;
      };
    }) => {
      return this.request(`/v2/deployments/${data.id}/aliases`, {
        method: 'POST',
        body: JSON.stringify(data.requestBody),
      });
    },
  };

  // Domains API for availability checking
  domains = {
    checkDomainStatus: async (domain: string) => {
      try {
        return this.request(`/v6/domains/${domain}/status`);
      } catch (error: any) {
        // If domain doesn't exist, it's available
        return { available: true };
      }
    },

    addDomainToProject: async (data: {
      projectName: string;
      domainName: string;
      teamId?: string;
      slug?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v9/projects/${data.projectName}/domains${queryString}`, {
        method: 'POST',
        body: JSON.stringify({
          name: data.domainName
        }),
      });
    },

    removeDomainFromProject: async (data: {
      projectName: string;
      domainName: string;
      teamId?: string;
      slug?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v9/projects/${data.projectName}/domains/${data.domainName}${queryString}`, {
        method: 'DELETE',
      });
    },

    getProjectDomains: async (data: {
      projectName: string;
      teamId?: string;
      slug?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v9/projects/${data.projectName}/domains${queryString}`);
    },
  };

  // Projects API for project management
  projects = {
    getProject: async (data: {
      idOrName: string;
      teamId?: string;
      slug?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';
      return this.request(`/v9/projects/${data.idOrName}${queryString}`);
    },
    deleteProject: async (data: {
      idOrName: string;
      teamId?: string;
      slug?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v1/projects/${data.idOrName}${queryString}`, {
        method: 'DELETE',
      });
    },

    updateProject: async (data: {
      idOrName: string;
      teamId?: string;
      slug?: string;
      requestBody: {
        name?: string;
      };
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v1/projects/${data.idOrName}${queryString}`, {
        method: 'PATCH',
        body: JSON.stringify(data.requestBody),
      });
    },
  };

  // Teams API for team management
  teams = {
    getTeams: async (data?: {
      limit?: number;
      since?: number;
      until?: number;
    }) => {
      const params = new URLSearchParams();
      if (data?.limit) params.append('limit', data.limit.toString());
      if (data?.since) params.append('since', data.since.toString());
      if (data?.until) params.append('until', data.until.toString());
      const queryString = params.toString() ? `?${params.toString()}` : '';
      return this.request(`/v2/teams${queryString}`);
    },
  };
}

interface GitHubFile {
  path: string;
  content: string;
  mode: string;
  type: string;
  encoding?: 'utf-8' | 'base64';
}

interface DeployedDomain {
  name: string;
  id: string;
  url: string;
  deployedAt: string;
  updatedAt?: string;
  deviceId?: string;
  accountId?: string;
}

export function XgeniaDeployTab() {
  const cloudService = useModernModel(CloudService.instance);
  const environmentOptions = useEnvironmentsAsOptions(cloudService);
  const { user } = useAuth();

  const [environmentId, setEnvironmentId] = useState(NO_ENVIRONMENT_VALUE);
  const [domainName, setDomainName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [showDeployedDomains, setShowDeployedDomains] = useState(false);
  const [deployedDomains, setDeployedDomains] = useState<DeployedDomain[]>([]);
  const [isLoadingDomains, setIsLoadingDomains] = useState(false);
  const [deletingDomains, setDeletingDomains] = useState<Set<string>>(new Set());
  const [renamingDomain, setRenamingDomain] = useState<string | null>(null);
  const [newDomainName, setNewDomainName] = useState('');
  const [domainError, setDomainError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Service connection tokens (loaded from ConnectionStore)
  const [vercelToken, setVercelToken] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [tokensLoaded, setTokensLoaded] = useState(false);

  // Load tokens from ConnectionStore on mount
  useEffect(() => {
    const loadTokens = async () => {
      const store = ConnectionStore.getInstance();
      await store.initialize();
      const vToken = await store.getToken('vercel');
      const gToken = await store.getToken('github');
      setVercelToken(vToken);
      setGithubToken(gToken);
      setTokensLoaded(true);
    };
    loadTokens();

    // Listen for connection changes
    const store = ConnectionStore.getInstance();
    const unsub = store.onChange(async () => {
      const vToken = await store.getToken('vercel');
      const gToken = await store.getToken('github');
      setVercelToken(vToken);
      setGithubToken(gToken);
    });
    return () => unsub();
  }, []);

  // Team info — falls back to XGENIA team when user has no personal Vercel account
  const teamInfo = { id: 'team_N25wk38vGG6CZAyu8JUhf1fe', slug: 'xgenia' };

  // Persistent device identifier to scope deployments to current local device only (fallback when no account)
  const [deviceId] = useState<string>(() => {
    try {
      const key = 'xgenia-device-id';
      let id = localStorage.getItem(key) || '';
      if (!id) {
        // Prefer Web Crypto UUID when available
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyCrypto: any = (typeof crypto !== 'undefined') ? crypto : undefined;
        if (anyCrypto && typeof anyCrypto.randomUUID === 'function') {
          id = anyCrypto.randomUUID();
        } else {
          id = `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
        }
        localStorage.setItem(key, id);
      }
      return id;
    } catch {
      return `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    }
  });

  // Resolve current account id (registered account) if logged in
  const currentAccountId: string | null = user?.id || null;

  // Initialize Vercel SDK with dynamic token
  const vercel = vercelToken ? new VercelSDKWrapper({
    bearerToken: vercelToken,
  }) : null;

  // Validate domain name
  function validateDomain(domain: string): boolean {
    const trimmedDomain = domain.trim();
    // Check if it's just the subdomain part (no .vercel.app)
    if (!trimmedDomain.includes('.')) {
      return trimmedDomain.length > 0 && /^[a-z0-9-]+$/.test(trimmedDomain);
    }
    // Check if it's the full domain ending with .vercel.app
    return trimmedDomain.endsWith('.vercel.app') && trimmedDomain.length > 11;
  }

  // Get the full domain name
  function getFullDomain(domain: string): string {
    const trimmedDomain = domain.trim();
    if (trimmedDomain.includes('.')) {
      return trimmedDomain; // Already full domain
    }
    return `${trimmedDomain}.vercel.app`; // Add .vercel.app suffix
  }

  // Check if domain is available using Vercel SDK
  async function checkDomainAvailability(domain: string): Promise<boolean> {
    const trimmed = domain.trim();
    // For .vercel.app, availability is effectively whether a project of that name exists in the team
    const projectName = trimmed.includes('.') ? trimmed.replace(/\.vercel\.app$/i, '') : trimmed;
    try {
      await vercel.projects.getProject({ idOrName: projectName, teamId: teamInfo.id, slug: teamInfo.slug });
      // Project exists in this team -> domain (default alias) is taken
      return false;
    } catch (error: any) {
      // If project not found (likely 404), consider available for our team
      return true;
    }
  }

  // Helper to decide if a stored domain belongs to the current owner (account preferred, device as fallback)
  function belongsToCurrentOwner(domain: any): boolean {
    if (currentAccountId) {
      return domain.accountId === currentAccountId || (!domain.accountId && domain.deviceId === deviceId);
    }
    return domain.deviceId === deviceId;
  }

  // Helper function to collect files for GitHub upload
  async function collectProjectFiles(tempDir: string): Promise<GitHubFile[]> {
    const files: GitHubFile[] = [];

    function isLikelyText(buffer: Buffer): boolean {
      if (!buffer || buffer.length === 0) return true;
      // Heuristic: reject if there are NUL bytes
      for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
        if (buffer[i] === 0) return false;
      }
      // Count printable and whitespace characters in a sample
      const sampleSize = Math.min(buffer.length, 2048);
      let printableCount = 0;
      for (let i = 0; i < sampleSize; i++) {
        const byte = buffer[i];
        // tab, LF, CR, FF
        const isWhitespace = byte === 9 || byte === 10 || byte === 13 || byte === 12;
        const isPrintable = byte >= 32 && byte <= 126; // basic ASCII range
        if (isWhitespace || isPrintable) printableCount++;
      }
      const ratio = printableCount / sampleSize;
      return ratio > 0.85;
    }

    // Read all files from the temporary deployment directory
    async function readDirectoryRecursively(dirPath: string, basePath = '') {
      const entries = await filesystem.listDirectory(dirPath);

      for (const entry of entries) {
        const fullPath = filesystem.join(dirPath, entry.name);
        const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          await readDirectoryRecursively(fullPath, relativePath);
        } else {
          try {
            const binary = await filesystem.readBinaryFile(fullPath);
            if (isLikelyText(binary)) {
              files.push({
                path: relativePath,
                content: binary.toString('utf-8'),
                mode: '100644',
                type: 'blob',
                encoding: 'utf-8',
              });
            } else {
              files.push({
                path: relativePath,
                content: binary.toString('base64'),
                mode: '100644',
                type: 'blob',
                encoding: 'base64',
              });
            }
          } catch (error: any) {
            console.warn(`Failed to read file ${fullPath}:`, error);
          }
        }
      }
    }

    await readDirectoryRecursively(tempDir);
    return files;
  }

  // Upload files to GitHub repository
  async function uploadToGitHub(files: GitHubFile[], repositoryName: string, isPrivateRepo: boolean): Promise<{ repoOwner: string; repoName: string }> {
    if (!githubToken) {
      throw new Error('GitHub is not connected. Please connect your GitHub account first.');
    }
    const headers = {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };

    // Create repository
    const createRepoResponse = await fetch(`${GITHUB_API_BASE}/user/repos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: repositoryName,
        description: `XGENIA project deployed at ${new Date().toISOString()}`,
        private: isPrivateRepo,
        auto_init: true
      })
    });

    if (!createRepoResponse.ok) {
      const errorData = await createRepoResponse.json();
      throw new Error(`Failed to create repository: ${errorData.message}`);
    }

    const repoData = await createRepoResponse.json();
    const repoOwner = repoData.owner.login;

    // Get the latest commit SHA
    const commitResponse = await fetch(`${GITHUB_API_BASE}/repos/${repoOwner}/${repositoryName}/commits/main`, {
      headers
    });

    if (!commitResponse.ok) {
      throw new Error('Failed to get latest commit');
    }

    const commitData = await commitResponse.json();
    const commitSha = commitData.sha;

    // Prepare tree items: create blobs for binary files and inline text files
    const treeItems: any[] = [];

    for (const file of files) {
      if (file.encoding === 'base64') {
        // Create a blob for binary content
        const blobResponse = await fetch(`${GITHUB_API_BASE}/repos/${repoOwner}/${repositoryName}/git/blobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            content: file.content,
            encoding: 'base64'
          })
        });
        if (!blobResponse.ok) {
          const errorData = await blobResponse.json().catch(() => ({}));
          throw new Error(`Failed to create blob for ${file.path}: ${errorData.message || blobResponse.statusText}`);
        }
        const blobData = await blobResponse.json();
        treeItems.push({ path: file.path, mode: file.mode, type: file.type, sha: blobData.sha });
      } else {
        // Inline text content directly in tree
        treeItems.push({ path: file.path, mode: file.mode, type: file.type, content: file.content });
      }
    }

    // Create tree with prepared items
    const treeResponse = await fetch(`${GITHUB_API_BASE}/repos/${repoOwner}/${repositoryName}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: commitSha,
        tree: treeItems
      })
    });

    if (!treeResponse.ok) {
      const errorData = await treeResponse.json();
      throw new Error(`Failed to create tree: ${errorData.message}`);
    }

    const treeData = await treeResponse.json();
    const treeSha = treeData.sha;

    // Create commit
    const newCommitResponse = await fetch(`${GITHUB_API_BASE}/repos/${repoOwner}/${repositoryName}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: 'Deploy XGENIA project',
        parents: [commitSha],
        tree: treeSha
      })
    });

    if (!newCommitResponse.ok) {
      const errorData = await newCommitResponse.json();
      throw new Error(`Failed to create commit: ${errorData.message}`);
    }

    const newCommitData = await newCommitResponse.json();
    const newCommitSha = newCommitData.sha;

    // Update main branch
    const updateRefResponse = await fetch(`${GITHUB_API_BASE}/repos/${repoOwner}/${repositoryName}/git/refs/heads/main`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sha: newCommitSha,
        force: true
      })
    });

    if (!updateRefResponse.ok) {
      const errorData = await updateRefResponse.json();
      throw new Error(`Failed to update main branch: ${errorData.message}`);
    }

    return { repoOwner, repoName: repositoryName };
  }

  // Deploy GitHub repository to Vercel using SDK
  async function deployToVercel(repoOwner: string, repoName: string, domainName: string): Promise<{ deploymentId: string; deploymentUrl: string; aliasUrl: string }> {
    try {
      console.log('Starting deployment with team info:', teamInfo);

      // Create a new deployment following the official SDK pattern
      const createResponse = await vercel.deployments.createDeployment({
        teamId: teamInfo.id, // Use teamInfo directly since it's always available
        slug: teamInfo.slug, // Use teamInfo directly since it's always available
        requestBody: {
          name: domainName, // Use original domain name instead of timestamped repo name
          project: domainName, // Use original domain name for project
          target: 'production',
          gitSource: {
            type: 'github',
            repo: repoName, // This is the timestamped GitHub repo name
            ref: 'main',
            org: 'freddy-xgenia', // GitHub org remains the same
          },
          projectSettings: {
            buildCommand: null, // Let Vercel auto-detect
            devCommand: null, // Let Vercel auto-detect
            framework: null, // Use null for "Other" framework as per Vercel docs
            commandForIgnoringBuildStep: '',
            installCommand: null, // Let Vercel auto-detect
            outputDirectory: null, // Let Vercel auto-detect
          },
        },
      });

      const deploymentId = createResponse.id;
      console.log(`✅ Deployment created successfully: ID ${deploymentId}, status: ${createResponse.status}`);

      // Monitor deployment status
      let deploymentStatus;
      let deploymentURL;
      let attempts = 0;
      const maxAttempts = 24; // Maximum 2 minutes of waiting (24 * 5 seconds)

      try {
        do {
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds between checks
          attempts++;

          console.log(`📊 Checking deployment status (attempt ${attempts}/${maxAttempts})`);

          const statusResponse = await vercel.deployments.getDeployment({
            idOrUrl: deploymentId,
            withGitRepoInfo: 'true',
          });

          deploymentStatus = statusResponse.status;
          deploymentURL = statusResponse.url;
          console.log(`📋 Status: ${deploymentStatus}, URL: ${deploymentURL}`);

          if (attempts >= maxAttempts) {
            throw new Error('Deployment timeout - taking longer than expected');
          }
        } while (
          deploymentStatus === 'BUILDING' ||
          deploymentStatus === 'INITIALIZING'
        );

        if (deploymentStatus !== 'READY') {
          throw new Error(`Deployment failed with status: ${deploymentStatus}`);
        }

        console.log(`✅ Deployment completed successfully. URL: ${deploymentURL}`);
      } catch (statusError) {
        console.error('❌ Error during status monitoring:', statusError);
        throw new Error(`Status monitoring failed: ${statusError.message}`);
      }

      // Use the auto-generated deployment URL
      const deploymentHttpsUrl = `https://${deploymentURL}`;

      return {
        deploymentId,
        deploymentUrl: deploymentHttpsUrl,
        aliasUrl: deploymentHttpsUrl // Use the same URL since no custom alias
      };
    } catch (error: any) {
      console.error('❌ Deployment process failed:', error);
      throw new Error(`Failed to deploy to Vercel: ${error.message}`);
    }
  }

  // Fetch and display previously deployed domains
  async function fetchDeployedDomains() {
    setIsLoadingDomains(true);
    try {
      // Get deployed domains from local storage
      const storedDomains = localStorage.getItem('xgenia-deployed-domains');
      const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];

      // Filter to current owner: account when available; fallback to device
      const scopedDomains = deployedDomainsData.filter((domain: any) => belongsToCurrentOwner(domain));

      // Ensure backward compatibility by adding missing timestamp fields
      const processedDomains = scopedDomains.map((domain: any) => ({
        ...domain,
        deployedAt: domain.deployedAt || new Date().toISOString(),
        updatedAt: domain.updatedAt || domain.deployedAt || new Date().toISOString()
      }));

      // Sort domains by creation date (newest first)
      const sortedDomains = processedDomains.sort((a: any, b: any) =>
        new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime()
      );

      setDeployedDomains(sortedDomains);
      setShowDeployedDomains(true);
    } catch (error: any) {
      console.error('Failed to fetch deployed domains from local storage:', error);
      ToastLayer.showError('Failed to load deployed domains');
    } finally {
      setIsLoadingDomains(false);
    }
  }

  // Save deployed domain to local storage
  function saveDeployedDomain(domainName: string, deploymentId: string, deploymentUrl: string) {
    try {
      const storedDomains = localStorage.getItem('xgenia-deployed-domains');
      const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];

      // Add new domain (avoid duplicates) scoped to current owner
      const existingIndex = deployedDomainsData.findIndex((d: any) =>
        d.name === domainName && (
          (currentAccountId ? d.accountId === currentAccountId : d.deviceId === deviceId)
        )
      );
      const currentTime = new Date().toISOString();
      const newDomain: DeployedDomain = {
        name: domainName,
        id: deploymentId,
        url: deploymentUrl,
        deployedAt: currentTime,
        updatedAt: currentTime,
        deviceId,
        accountId: currentAccountId || undefined,
      };

      if (existingIndex >= 0) {
        // Update existing domain but preserve original deployedAt timestamp
        const existingDomain = deployedDomainsData[existingIndex];
        newDomain.deployedAt = existingDomain.deployedAt || currentTime;
        newDomain.updatedAt = currentTime;
        deployedDomainsData[existingIndex] = newDomain;
      } else {
        // Add new domain
        deployedDomainsData.push(newDomain);
      }

      localStorage.setItem('xgenia-deployed-domains', JSON.stringify(deployedDomainsData));

      // Auto-refresh the domains list if it's currently being shown
      if (showDeployedDomains) {
        // Process domains with backward compatibility and owner scoping
        const scopedDomains = deployedDomainsData.filter((domain: any) => belongsToCurrentOwner(domain));
        const processedDomains = scopedDomains.map((domain: any) => ({
          ...domain,
          deployedAt: domain.deployedAt || new Date().toISOString(),
          updatedAt: domain.updatedAt || domain.deployedAt || new Date().toISOString()
        }));

        // Sort domains by creation date (newest first)
        const sortedDomains = processedDomains.sort((a: any, b: any) =>
          new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime()
        );

        setDeployedDomains(sortedDomains);
      }
    } catch (error: any) {
      console.error('Failed to save deployed domain to local storage:', error);
    }
  }

  // Update domain name in local storage after successful rename
  function updateDomainInStorage(oldName: string, newName: string, deploymentId: string, newUrl: string) {
    try {
      const storedDomains = localStorage.getItem('xgenia-deployed-domains');
      const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];

      const domainIndex = deployedDomainsData.findIndex((d: any) =>
        d.name === oldName && d.id === deploymentId && (
          (currentAccountId ? d.accountId === currentAccountId : d.deviceId === deviceId)
        )
      );
      if (domainIndex >= 0) {
        deployedDomainsData[domainIndex] = {
          ...deployedDomainsData[domainIndex],
          name: newName,
          updatedAt: new Date().toISOString(),
          url: newUrl,
          accountId: currentAccountId || deployedDomainsData[domainIndex].accountId,
        };
        localStorage.setItem('xgenia-deployed-domains', JSON.stringify(deployedDomainsData));

        // Update the UI state
        setDeployedDomains(prev => prev.map(domain =>
          domain.id === deploymentId && domain.name === oldName && (
            currentAccountId ? domain.accountId === currentAccountId || (!domain.accountId && domain.deviceId === deviceId) : domain.deviceId === deviceId
          )
            ? { ...domain, name: newName, updatedAt: new Date().toISOString(), url: newUrl, accountId: currentAccountId || domain.accountId }
            : domain
        ));
      }
    } catch (error: any) {
      console.error('Failed to update domain in storage:', error);
    }
  }

  // Rename domain functionality
  async function renameDomain(domainId: string, oldName: string, newName: string) {
    if (!newName.trim()) {
      ToastLayer.showError('Please enter a new domain name');
      return;
    }

    if (!validateDomain(newName.trim())) {
      ToastLayer.showError('Domain must contain only lowercase letters, numbers, and hyphens');
      return;
    }

    if (newName.trim() === oldName) {
      ToastLayer.showError('New domain name must be different from the current name');
      return;
    }

    const activityId = 'renaming-domain';
    setRenamingDomain(domainId);

    try {
      // Step 1: Check domain availability
      ToastLayer.showActivity('Step 1/5: Checking domain availability...', activityId);
      const isDomainAvailable = await checkDomainAvailability(newName.trim());

      if (!isDomainAvailable) {
        throw new Error('Domain name is already in use. Please choose a different name.');
      }

      // Step 2: Update Vercel project name
      ToastLayer.showActivity('Step 2/5: Updating Vercel project name...', activityId);

      await vercel.projects.updateProject({
        idOrName: oldName,
        teamId: teamInfo.id,
        slug: teamInfo.slug,
        requestBody: {
          name: newName.trim()
        }
      });

      // Step 3: Add new domain to the project
      ToastLayer.showActivity('Step 3/5: Adding new domain...', activityId);

      try {
        await vercel.domains.addDomainToProject({
          projectName: newName.trim(),
          domainName: `${newName.trim()}.vercel.app`,
          teamId: teamInfo.id,
          slug: teamInfo.slug
        });
        console.log(`Successfully added domain ${newName.trim()}.vercel.app to project`);
      } catch (addError) {
        console.warn('Failed to add new domain:', addError);
        // Try with the old project name as fallback
        try {
          await vercel.domains.addDomainToProject({
            projectName: oldName,
            domainName: `${newName.trim()}.vercel.app`,
            teamId: teamInfo.id,
            slug: teamInfo.slug
          });
          console.log(`Added domain ${newName.trim()}.vercel.app to project using old name`);
        } catch (fallbackError) {
          console.error('Failed to add domain with both project names:', fallbackError);
          throw new Error(`Failed to add new domain: ${addError.message}`);
        }
      }

      // Step 4: Remove old domain from the project (if it's different from new one)
      ToastLayer.showActivity('Step 4/5: Removing old domain...', activityId);

      try {
        // Try removing from the new project name first
        await vercel.domains.removeDomainFromProject({
          projectName: newName.trim(),
          domainName: `${oldName}.vercel.app`,
          teamId: teamInfo.id,
          slug: teamInfo.slug
        });
        console.log(`Successfully removed old domain ${oldName}.vercel.app from project`);
      } catch (removeError) {
        console.warn('Failed to remove old domain from new project, trying old project name:', removeError);
        // Try with the old project name
        try {
          await vercel.domains.removeDomainFromProject({
            projectName: oldName,
            domainName: `${oldName}.vercel.app`,
            teamId: teamInfo.id,
            slug: teamInfo.slug
          });
          console.log(`Removed old domain ${oldName}.vercel.app using old project name`);
        } catch (fallbackRemoveError) {
          console.warn('Could not remove old domain, it may have been automatically removed:', fallbackRemoveError);
          // This is not necessarily a fatal error
        }
      }

      // Step 5: Update local storage and UI
      ToastLayer.showActivity('Step 5/5: Updating local data...', activityId);

      const newUrl = `https://${newName.trim()}.vercel.app`;
      updateDomainInStorage(oldName, newName.trim(), domainId, newUrl);

      ToastLayer.hideActivity(activityId);
      ToastLayer.showSuccess(`Successfully renamed domain!\n• Old: ${oldName}.vercel.app\n• New: ${newName.trim()}.vercel.app\n\nThe new domain should be active within a few minutes.`);

    } catch (error: any) {
      ToastLayer.hideActivity(activityId);
      ToastLayer.showError(`Failed to rename domain: ${error.message}`);
      console.error('Domain rename error:', error);
    } finally {
      setRenamingDomain(null);
      setNewDomainName('');
    }
  }

  // Start rename process
  function startRenameDomain(domain: DeployedDomain) {
    setRenamingDomain(domain.id);
    setNewDomainName(domain.name);
  }

  // Cancel rename process
  function cancelRename() {
    setRenamingDomain(null);
    setNewDomainName('');
  }

  // Format timestamp for display
  function formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (error: any) {
      return 'Unknown';
    }
  }

  // Delete a specific domain/deployment
  async function deleteDomain(domainId: string, domainName: string) {
    setDeletingDomains(prev => new Set([...prev, domainId]));

    try {
      // Try to delete project from Vercel (this automatically deletes all associated deployments)
      await vercel.projects.deleteProject({
        idOrName: domainName,
        teamId: teamInfo.id,
        slug: teamInfo.slug
      });

      // Remove from local storage
      const storedDomains = localStorage.getItem('xgenia-deployed-domains');
      const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];
      const updatedDomains = deployedDomainsData.filter((d: any) => d.id !== domainId);
      localStorage.setItem('xgenia-deployed-domains', JSON.stringify(updatedDomains));

      // Remove from the UI list
      setDeployedDomains(prev => prev.filter(domain => domain.id !== domainId));

      ToastLayer.showSuccess(`Successfully deleted ${domainName}.vercel.app project from Vercel`);
    } catch (error: any) {
      console.error('Failed to delete project from Vercel:', error);

      // Check if it's a "not found" error (404) - if so, just remove from local storage
      if (error.message.includes('404') || error.message.includes('Not Found') || error.message.includes('not found')) {
        console.log('Project not found in Vercel, removing from local storage only');

        // Remove from local storage
        const storedDomains = localStorage.getItem('xgenia-deployed-domains');
        const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];
        const updatedDomains = deployedDomainsData.filter((d: any) => d.id !== domainId);
        localStorage.setItem('xgenia-deployed-domains', JSON.stringify(updatedDomains));

        // Remove from the UI list
        setDeployedDomains(prev => prev.filter(domain => domain.id !== domainId));

        ToastLayer.showSuccess(`Removed ${domainName}.vercel.app from list (project not found in Vercel)`);
      } else {
        // For other errors, show the actual error
        ToastLayer.showError(`Failed to delete ${domainName}.vercel.app: ${error.message}`);
      }
    } finally {
      setDeletingDomains(prev => {
        const newSet = new Set(prev);
        newSet.delete(domainId);
        return newSet;
      });
    }
  }

  // Deploy logic to XGENIA RGS and only the UI to Vercel (decoupled).
  async function deployToRgsAndVercel(activityId: string) {
    const rgs = getRgsSettings();
    const game = getSelectedGame();
    if (!rgs?.apiKey) {
      ToastLayer.hideActivity(activityId);
      ToastLayer.showError('Not connected to XGENIA RGS. Connect in the Maths RGS panel first.');
      return;
    }
    if (!game?.id) {
      ToastLayer.hideActivity(activityId);
      ToastLayer.showError('No target game selected. Choose a game in the Maths RGS panel first.');
      return;
    }

    // 1. Compile — produces the __<name>__ copy with cloud components + aggregators.
    ToastLayer.showActivity('Compiling project...', activityId);
    const { dir: compiledDir } = await compileProject(ProjectModel.instance);
    const copy: any = await new Promise((resolve, reject) => {
      projectFromDirectory(
        compiledDir,
        (p?: any) => (p ? resolve(p) : reject(new Error('Failed to load compiled project'))),
        { showUpgradeModal: false }
      );
    });

    // 2. Deploy each logic component as a per-game RGS edge function.
    ToastLayer.showActivity('Deploying logic to XGENIA RGS...', activityId);
    const urlByComponent: Record<string, string> = {};
    for (const comp of copy.components) {
      if (!String(comp.name).startsWith('/#__cloud__/__Component_')) continue;
      const artifact = generateFunctionArtifact(comp, copy);
      const { url } = await deployEdgeFunction(rgs.apiKey, game.id, artifact);
      urlByComponent[comp.name] = url;
    }

    // 3. Point each Aggregator node at its deployed function URL.
    for (const comp of copy.components) {
      for (const node of comp.graph.roots) {
        if (node.typename !== 'Aggregator') continue;
        const target = node.parameters?.targetComponent;
        const url = target ? urlByComponent[target] : undefined;
        if (url) node.parameters.url = url;
      }
    }
    await saveProject(copy, compiledDir);

    // 4. Vercel-deploy the COPY — UI only (build excludes /#__cloud__/ components).
    const tempDir = filesystem.join(os.tmpdir(), `xgenia-deploy-${Date.now()}`);
    await filesystem.makeDirectory(tempDir);
    try {
      ToastLayer.showActivity('Building UI bundle...', activityId);
      const compilation = createEditorCompilation(copy).addProjectBuildScripts();
      await compilation.deployToFolder(tempDir, { environment: undefined });

      const files = await collectProjectFiles(tempDir);
      if (files.length === 0) throw new Error('No files were generated during deployment');

      ToastLayer.showActivity('Preparing repository...', activityId);
      const repositoryName = `${domainName.trim()}-${Date.now()}`;
      const { repoOwner, repoName: actualRepoName } = await uploadToGitHub(files, repositoryName, isPrivate);

      ToastLayer.showActivity('Deploying to Vercel...', activityId);
      const { deploymentId, aliasUrl } = await deployToVercel(repoOwner, actualRepoName, domainName.trim());

      ToastLayer.hideActivity(activityId);
      const userFriendlyDomain = `${domainName.trim()}.vercel.app`;
      ToastLayer.showSuccess(`Deployed UI to Vercel and logic to XGENIA RGS!\nLive URL: ${userFriendlyDomain}`);
      setSuccessMessage(`Deployed to Vercel + XGENIA RGS. Live URL: ${userFriendlyDomain}`);
      saveDeployedDomain(domainName.trim(), deploymentId, aliasUrl);
      if (showDeployedDomains) await fetchDeployedDomains();

      try { filesystem.removeDirRecursive(tempDir); } catch (e) { /* ignore */ }
    } catch (err) {
      try { filesystem.removeDirRecursive(tempDir); } catch (e) { /* ignore */ }
      throw err;
    }
  }

  async function onDeployToVercelClicked() {
    if (!domainName.trim()) {
      ToastLayer.showError('Please enter a domain name');
      return;
    }

    if (!validateDomain(domainName.trim())) {
      ToastLayer.showError('Domain must contain only lowercase letters, numbers, and hyphens');
      return;
    }

    const activityId = 'deploying-to-vercel';
    setIsDeploying(true);
    setDomainError('');
    setSuccessMessage('');

    try {
      // Early: Check domain availability before any heavy work
      ToastLayer.showActivity('Checking domain availability...', activityId);
      const isDomainAvailableEarly = await checkDomainAvailability(domainName.trim());
      if (!isDomainAvailableEarly) {
        ToastLayer.hideActivity(activityId);
        setDomainError('Domain name is already in use on Vercel. Please choose a different name.');
        return;
      }

      // ── XGENIA RGS path ──────────────────────────────────────────────
      // Compile → deploy each logic component as a per-game RGS edge function →
      // point each Aggregator node at its deployed URL → Vercel-deploy ONLY the
      // UI (visual components + Aggregators). Logic and UI become decoupled,
      // talking over HTTPS REST.
      if (environmentId === RGS_ENVIRONMENT_VALUE) {
        await deployToRgsAndVercel(activityId);
        return;
      }

      // Step 1: Compile and prepare project
      ToastLayer.showActivity('Step 1/4: Compiling project...', activityId);

      // Create a temporary directory for deployment using os.tmpdir() approach
      const tempDir = filesystem.join(os.tmpdir(), `xgenia-deploy-${Date.now()}`);
      await filesystem.makeDirectory(tempDir);

      try {
        // Use the same compilation process as self-hosting
        const compilation = createEditorCompilation(ProjectModel.instance)
          .addProjectBuildScripts()
          .addBuildScript({
            async onPreBuild() {
              console.log('Pre-build started for Vercel deployment');
            },
            async onPostBuild({ status }) {
              if (status === 'success') {
                console.log('Build completed successfully');
              } else {
                console.error('Build failed');
              }
            }
          });

        const environment = cloudService.backend.items.find((x) => x.id === environmentId);

        // Deploy to temporary folder first
        await compilation.deployToFolder(tempDir, {
          environment
        });

        // Collect all files from the temporary directory
        const files = await collectProjectFiles(tempDir);

        if (files.length === 0) {
          throw new Error('No files were generated during deployment');
        }

        // Step 2: Preparing repository
        ToastLayer.showActivity('Step 2/4: Preparing repository...', activityId);
        const timestamp = Date.now();
        const repositoryName = `${domainName.trim()}-${timestamp}`;
        const { repoOwner, repoName: actualRepoName } = await uploadToGitHub(files, repositoryName, isPrivate);

        // Step 4: Deploy to Vercel and setup domain
        ToastLayer.showActivity('Step 4/4: Deploying to Vercel...', activityId);
        const { deploymentId, deploymentUrl, aliasUrl } = await deployToVercel(repoOwner, actualRepoName, domainName.trim());

        ToastLayer.hideActivity(activityId);
        const userFriendlyDomain = `${domainName.trim()}.vercel.app`;
        ToastLayer.showSuccess(`Successfully deployed to Vercel!\nLive URL: ${userFriendlyDomain}\n(Domain may take a few minutes to become active)`);
        setSuccessMessage(`Successfully deployed to Vercel. Live URL: ${userFriendlyDomain}`);

        // Save deployed domain to local storage
        saveDeployedDomain(domainName.trim(), deploymentId, aliasUrl);

        // Refresh the deployed domains list if it's currently visible
        if (showDeployedDomains) {
          await fetchDeployedDomains();
        }

        // Clean up temporary directory
        try {
          filesystem.removeDirRecursive(tempDir);
        } catch (cleanupError) {
          console.warn('Failed to clean up temporary directory:', cleanupError);
        }

      } catch (deployError) {
        // Clean up temporary directory on error
        try {
          filesystem.removeDirRecursive(tempDir);
        } catch (cleanupError) {
          console.warn('Failed to clean up temporary directory after error:', cleanupError);
        }
        throw deployError;
      }

    } catch (error: any) {
      ToastLayer.hideActivity(activityId);
      ToastLayer.showError(`Deployment failed: ${error.message}`);
      console.error('Deployment error:', error);
    } finally {
      setIsDeploying(false);
    }
    // Keep popup open so the confirmation message is visible
  }

  return (
    <>
      <PopupSection>
        <Text hasBottomSpacing textType={TextType.DefaultContrast}>
          Deploy your project to Vercel
        </Text>

        <TextInput
          label="Domain Name"
          value={domainName}
          onChange={(e) => { setDomainName(e.target.value); if (domainError) setDomainError(''); }}
          placeholder="my-project"
          suffix=".vercel.app"
          hasBottomSpacing
        />

        {domainError && (
          <Text style={{ marginTop: '8px', fontSize: '12px', color: '#f66' }}>
            {domainError}
          </Text>
        )}
        {successMessage && (
          <Text style={{ marginTop: '8px', fontSize: '12px', color: '#6f6' }}>
            {successMessage}
          </Text>
        )}

        {environmentOptions.length > 1 && (
          <Select
            options={environmentOptions}
            onChange={(value: string) => setEnvironmentId(value)}
            placeholder="No cloud services"
            value={environmentId}
            label="Connected cloud services"
            hasBottomSpacing
          />
        )}

        <PrimaryButton
          label={isDeploying ? "Deploying..." : "Deploy"}
          onClick={onDeployToVercelClicked}
          isDisabled={isDeploying || !domainName.trim()}
        />

        <div style={{ marginTop: '12px' }}>
          <PrimaryButton
            label={isLoadingDomains ? "Loading..." : "Show Deployed Domains"}
            onClick={fetchDeployedDomains}
            isDisabled={isLoadingDomains}
          />
        </div>

        {isDeploying && (
          <Text style={{ marginTop: '12px', fontSize: '12px', color: '#999' }}>
            This process may take 2-3 minutes to complete...
          </Text>
        )}

        {showDeployedDomains && (
          <div style={{ marginTop: '16px', padding: '12px', border: '1px solid #444', borderRadius: '4px', backgroundColor: '#272625' }}>
            <Text style={{ marginBottom: '8px', fontWeight: 'bold' }}>
              Previously Deployed Domains ({deployedDomains.length})
            </Text>
            {deployedDomains.length > 0 ? (
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {deployedDomains.map((domain, index) => (
                  <div key={domain.id || index} style={{
                    padding: '12px 0',
                    borderBottom: index < deployedDomains.length - 1 ? '1px solid #333' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    {/* Domain name and actions row */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      {renamingDomain === domain.id ? (
                        // Rename input mode
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                          <input
                            type="text"
                            value={newDomainName}
                            onChange={(e) => setNewDomainName(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                renameDomain(domain.id, domain.name, newDomainName);
                              } else if (e.key === 'Escape') {
                                cancelRename();
                              }
                            }}
                            placeholder="Enter new domain name"
                            style={{
                              flex: 1,
                              padding: '4px 8px',
                              fontSize: '14px',
                              backgroundColor: '#2a2a2a',
                              color: '#fff',
                              border: '1px solid #555',
                              borderRadius: '3px',
                              outline: 'none'
                            }}
                            autoFocus
                          />
                          <span style={{ fontSize: '14px', color: '#ccc' }}>.vercel.app</span>
                          <button
                            onClick={() => renameDomain(domain.id, domain.name, newDomainName)}
                            disabled={!newDomainName.trim() || newDomainName.trim() === domain.name}
                            style={{
                              padding: '4px 8px',
                              fontSize: '12px',
                              backgroundColor: (!newDomainName.trim() || newDomainName.trim() === domain.name) ? '#555' : '#28a745',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: (!newDomainName.trim() || newDomainName.trim() === domain.name) ? 'not-allowed' : 'pointer',
                              opacity: (!newDomainName.trim() || newDomainName.trim() === domain.name) ? 0.6 : 1
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelRename}
                            style={{
                              padding: '4px 8px',
                              fontSize: '12px',
                              backgroundColor: '#6c757d',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        // Normal display mode
                        <>
                          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              <a
                                href={`https://${domain.name}.vercel.app`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: '14px',
                                  color: '#4A9EFF',
                                  textDecoration: 'none',
                                  cursor: 'pointer',
                                  fontWeight: '500'
                                }}
                                onMouseEnter={(e) => (e.target as HTMLAnchorElement).style.textDecoration = 'underline'}
                                onMouseLeave={(e) => (e.target as HTMLAnchorElement).style.textDecoration = 'none'}
                              >
                                {domain.name}.vercel.app
                              </a>
                            </div>

                            {/* Timestamps */}
                            <div style={{
                              fontSize: '11px',
                              color: '#888',
                              marginTop: '4px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px'
                            }}>
                              <div>
                                <span style={{ color: '#aaa' }}>Created:</span> {formatTimestamp(domain.deployedAt)}
                              </div>
                              {domain.updatedAt && domain.updatedAt !== domain.deployedAt && (
                                <div>
                                  <span style={{ color: '#aaa' }}>Updated:</span> {formatTimestamp(domain.updatedAt)}
                                </div>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => startRenameDomain(domain)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '12px',
                                backgroundColor: '#007bff',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer'
                              }}
                              title="Rename domain"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => deleteDomain(domain.id, domain.name)}
                              disabled={deletingDomains.has(domain.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '12px',
                                backgroundColor: deletingDomains.has(domain.id) ? '#555' : '#dc3545',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: deletingDomains.has(domain.id) ? 'not-allowed' : 'pointer',
                                opacity: deletingDomains.has(domain.id) ? 0.6 : 1
                              }}
                            >
                              {deletingDomains.has(domain.id) ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Text style={{ fontSize: '14px', color: '#888' }}>
                No domains found
              </Text>
            )}
            <div style={{ marginTop: '8px' }}>
              <button
                onClick={() => setShowDeployedDomains(false)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  backgroundColor: '#333',
                  color: '#ccc',
                  border: '1px solid #555',
                  borderRadius: '3px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </PopupSection>
    </>
  );
}
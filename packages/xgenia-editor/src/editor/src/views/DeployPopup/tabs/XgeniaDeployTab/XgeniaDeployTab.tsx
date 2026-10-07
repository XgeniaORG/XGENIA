import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useState, useEffect, useReducer } from 'react';
import { filesystem } from '@xgenia/platform';
import * as os from 'os';

import { CloudService } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { projectFromDirectory } from '@xgenia-models/projectmodel.editor';
import { PublishState } from '@xgenia-models/publishstate';
import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';
import * as Exporter from '@xgenia-utils/exporter';
// Publishing no longer compiles or deploys logic: Math Components are compiled and
// deployed as backend components from the Maths RGS panel, so this tab only wires
// the frontend to their live endpoints (see deployToRgsAndVercel).
// compileProject / generateFunctionArtifact / createEdgeDeployment /
// deployEdgeFunction are therefore unused here now, and kept imported alongside the
// retained ComponentSetupDialog helpers so that flow is one edit away.
import { compileProject } from '@xgenia-utils/compile';
import { generateFunctionArtifact } from '@xgenia-utils/rgs/generateFunctionArtifact';
import { createEdgeDeployment, deployEdgeFunction, deleteEdgeDeployment } from '@xgenia-utils/rgs/deployEdgeFunction';
import { getRgsSettings, getActiveGame, isRgsConnected } from '@xgenia-utils/rgs/rgsClient';
import { isPreviewPickerAvailable, pickUiElementFromPreview } from '@xgenia-utils/rgs/pickUiElement';
import {
  CompleteTelemetryMapping,
  DeployTelemetryMapping,
  TELEMETRY_METADATA_KEY,
  UiNodeCandidate
} from '@xgenia-utils/rgs/telemetryMapping';
import { collectUiNodeCandidates, refForNodeId, storedTelemetryMapping } from '@xgenia-utils/rgs/uiNodeCandidates';
import {
  DOMAIN_NAME_REQUIRED,
  DOMAIN_NAME_RULE,
  domainUnavailableMessage,
  getFullDomain,
  validateDomain
} from '@xgenia-utils/publish/deployDomain';
import {
  DeployedDomain,
  RgsBackendRef,
  getDeviceId,
  readOwnedDomains,
  saveDeployedDomain as storeDeployedDomain
} from '@xgenia-utils/publish/deployedDomains';
import {
  deployCredentialError as credentialErrorFor,
  describeRegistration,
  describeWiring,
  loadDeployCredentials,
  publishGameToWeb,
  publishPreconditionError
} from '@xgenia-utils/publish/publishGame';
import {
  VercelSDKWrapper,
  XGENIA_VERCEL_TEAM,
  checkDomainAvailability,
  collectProjectFiles,
  deployToVercel,
  uploadFilesToVercel
} from '@xgenia-utils/publish/webDeploy';

import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Select } from '@xgenia-core-ui/components/inputs/Select';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { TextType } from '@xgenia-core-ui/components/typography/Text/Text';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';

import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';

import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { AppRegistry } from '@xgenia-models/app_registry';
import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { ContextMenu } from '@xgenia-core-ui/components/popups/ContextMenu';
import { MathsComplianceDocumentProvider } from '../../../documents/MathsComplianceDocument';
import { useDeployContext } from '../../DeployPopup.context';
import {
  ComponentSetupDialog,
  ComponentSetupChoice,
  ComponentSetupItem
} from '../../ComponentSetupDialog';
import { DeployTelemetryDialog } from '../../DeployTelemetryDialog';
import { NO_ENVIRONMENT_VALUE, RGS_ENVIRONMENT_VALUE } from '../../DeployPopup.constants';
import { useEnvironmentsAsOptions } from '../../DeployPopup.hooks';
import { useAuth } from '../../../../context/AuthContext';
import { ConnectionStore, ServiceName } from '../../../../services/ConnectionStore';
import { ConnectedServicesPanel } from '../../../panels/ConnectedServicesPanel/ConnectedServicesPanel';

// The publish pipeline itself — the GitHub/Vercel calls, the RGS wiring and the
// Deployed Games listing — lives in utils/publish (publishGameToWeb, webDeploy),
// shared with the AI's publish commands. This tab is its UI: the form, the
// toasts, the publish state and the Deployed Domains list.

// Deployment tokens (GitHub + Vercel) resolve through ConnectionStore, which falls
// back to the hardcoded shared team tokens baked into the source. See
// ConnectionStore.ts (HARDCODED_DEFAULT_TOKENS) — no per-user connection required.

/**
 * Port names in an example payload whose value is a JS number.
 *
 * The RGS side has no stored port types — it infers each port's type from the
 * `typeof` of its example value (see test.tsx `portTypeOf`), and only numeric
 * ports can be a bet or a win. Mirroring that rule here keeps the choices this
 * popup offers identical to the ones RGS Testing will show.
 */
function numericPortNames(example: Record<string, any> | undefined | null): string[] {
  if (!example || typeof example !== 'object') return [];
  return Object.keys(example).filter((key) => typeof example[key] === 'number');
}

/**
 * Last path segment of a component's name — "/Components/Keno Dynasty" →
 * "Keno Dynasty".
 *
 * Component names are folder paths, so the segments in front are where the user
 * filed it, not what it is called. Returns '' for a missing or all-slashes name,
 * which callers treat as "no name to use".
 */
function leafComponentName(componentName: string | undefined | null): string {
  const segments = String(componentName || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.length ? segments[segments.length - 1] : '';
}

export function XgeniaDeployTab() {
  const { closePopup } = useDeployContext();
  const cloudService = useModernModel(CloudService.instance);
  // Always offer "XGENIA RGS" here so the user can pick it and get a clear
  // "connect first" error when no operator key is set (see rgsError below).
  // Feeds only the commented-out picker below; kept so restoring it is a pure
  // uncomment.
  const environmentOptions = useEnvironmentsAsOptions(cloudService, { alwaysIncludeRgs: true });
  const { user } = useAuth();

  // ── PUBLISH TARGET — PINNED TO XGENIA RGS (2026-08-06) ────────────────
  //
  // This is not a preference. `onDeployToVercelClicked` branches on it, so it
  // chooses which of two publish routines runs:
  //
  //   RGS_ENVIRONMENT_VALUE → deployToRgsAndVercel: duplicate the project, swap
  //     every deployed Math Component instance for an Aggregator on its live
  //     /rgs-fn/<game>/<slug> endpoint, repoint stale ones, stamp `rgsgame`,
  //     then build. This is the only path that connects the published frontend
  //     to the backend components.
  //   anything else → the generic path, which bakes in a cloudService.backend
  //     environment and does NONE of that wiring.
  //
  // Now that Math Components ARE the backend — deployed from the Maths RGS panel,
  // living in game_edge_functions, already integrated — the second path can only
  // ever be the wrong answer for this tab, so the picker below is commented out
  // and this defaults to RGS.
  //
  // IT HAD TO DEFAULT HERE, not just be hidden. The old initial value was
  // NO_ENVIRONMENT_VALUE, so hiding the dropdown on its own would have sent every
  // Publish down the generic path: no Aggregator swap, no `rgsgame` stamp, and a
  // published game whose maths silently runs in the player's browser while the
  // deployed endpoints sit there uncalled. That failure is invisible — the build
  // succeeds and the page loads.
  //
  // Note the two paths are already mutually exclusive: deployToRgsAndVercel calls
  // deployToFolder with `environment: undefined` and skips the built-in cloud
  // -function pass outright, so picking a cloud service and picking RGS never did
  // anything together. Choosing RGS always meant ignoring the cloud service.
  //
  // COST OF THIS, stated plainly: a project can no longer be published without an
  // RGS operator key and a selected game — the Deploy button below stays disabled
  // until both exist. To publish a frontend-only project again, or to target a
  // cloudService.backend environment, uncomment the picker and restore
  // NO_ENVIRONMENT_VALUE here.
  const [environmentId, setEnvironmentId] = useState(RGS_ENVIRONMENT_VALUE);

  // ── XGENIA RGS backend target ──────────────────────────────────────────
  // Which RGS game this frontend belongs to. Read from the Maths RGS panel, never
  // picked here: a project's Math Components are deployed as backend components of
  // ONE game, so that game is a fact about the project, not a publish-time choice.
  // Offering a dropdown could only let the two disagree — publishing "to game B"
  // while every endpoint baked into the build belongs to game A.
  //
  // Read at render, like rgsConnected below — never held in state. The popup is
  // alwaysMounted, so a copy taken at mount kept showing the first game ever
  // selected after the panel had switched to another one. Opening the popup
  // re-renders this tab; while it is open, `rgs.gameSelected` (effect below)
  // forces the re-render.
  const [, rerenderOnGameSelected] = useReducer((n: number) => n + 1, 0);
  const rgsGame = getActiveGame();
  const rgsSelected = environmentId === RGS_ENVIRONMENT_VALUE;
  const rgsConnected = isRgsConnected();
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

  // ── Post-compile component setup card ─────────────────────────────────
  // Holds the pending "name your components / map bet + win" prompt. The deploy
  // routine parks on the promise stored here while the user fills the card in.
  const [setupRequest, setSetupRequest] = useState<{
    items: ComponentSetupItem[];
    resolve: (choices: Record<string, ComponentSetupChoice> | null) => void;
  } | null>(null);

  /** Show the setup card and resolve with the user's choices, or null if cancelled. */
  function requestComponentSetup(items: ComponentSetupItem[]) {
    return new Promise<Record<string, ComponentSetupChoice> | null>((resolve) => {
      setSetupRequest({ items, resolve });
    });
  }

  /**
   * Reveal in the editor the component a compiled logic component came from.
   *
   * Deliberately targets the OPEN project, never the compiled copy: the copy's
   * cloud components are flattened and machine-named (useless for recognising
   * anything), and loading it would replace what the user is looking at. The
   * source component is the one they recognise, it is still open, and compile
   * left it untouched — so this is a pure navigation, no project swap.
   *
   * Node ids match because the copy is a byte-for-byte duplicate, so the exact
   * nodes that became the edge function can be highlighted — ALL of them. A
   * component's logic is routinely several roots, and each root a subtree, so
   * highlighting one node would misrepresent what is being deployed.
   */
  function showSourceComponent(item: ComponentSetupItem): boolean {
    try {
      const project: any = ProjectModel.instance;
      const comp = project?.getComponentWithName?.(item.sourceComponentName);
      if (!comp) return false;
      const switchTo = NodeGraphContextTmp?.switchToComponent;
      if (typeof switchTo !== 'function') return false;

      // Switch first with no `node` — passing one would single-select it and
      // pan to it, which revealNodes is about to override anyway.
      switchTo(comp, { pushHistory: true });
      NodeGraphContextTmp.nodeGraph?.revealNodes?.(item.logicNodeIds);
      return true;
    } catch (e) {
      console.warn('[Deploy] Could not reveal source component:', e);
      return false;
    }
  }

  // ── Pre-deploy telemetry form ─────────────────────────────────────────
  // Holds the pending "which UI element is the bet / the win / the bet button"
  // prompt. onDeployToVercelClicked parks on the promise stored here until the
  // user presses OK (a mapping) or Cancel (null), and nothing is built before
  // that.
  const [telemetryRequest, setTelemetryRequest] = useState<{
    initial: DeployTelemetryMapping | null;
    candidates: UiNodeCandidate[];
    resolve: (mapping: CompleteTelemetryMapping | null) => void;
  } | null>(null);

  /**
   * Show the telemetry form and resolve with the mapping, or null if cancelled.
   * It opens pre-filled with the last publish's answer (storedTelemetryMapping).
   */
  function requestTelemetryMapping(): Promise<CompleteTelemetryMapping | null> {
    const project: any = ProjectModel.instance;
    return new Promise<CompleteTelemetryMapping | null>((resolve) => {
      setTelemetryRequest({
        initial: storedTelemetryMapping(project),
        candidates: collectUiNodeCandidates(project),
        resolve
      });
    });
  }

  // Service connection tokens (loaded from ConnectionStore)
  const [vercelToken, setVercelToken] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [tokensLoaded, setTokensLoaded] = useState(false);
  // Why the shared deploy tokens are missing, when they are. Held so every entry
  // point can say the actual reason ("not connected to XGENIA RGS") instead of
  // failing later on a null token — which is what produced the two useless
  // errors this replaced: "Project compilation error" on publish, and
  // "Cannot read properties of null (reading 'projects')" on delete.
  const [tokenError, setTokenError] = useState<string>('');

  // Load tokens from ConnectionStore on mount
  useEffect(() => {
    const loadTokens = async () => {
      // Ensures the shared deploy tokens from RGS are installed on
      // window.__XGENIA_DEFAULT_TOKENS__ before reading them (see
      // loadDeployCredentials — the AI's publish loads them the same way).
      const credentials = await loadDeployCredentials();
      setTokenError(credentials.tokenError);
      setVercelToken(credentials.vercelToken);
      setGithubToken(credentials.githubToken);
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

  // Follow the Maths RGS panel's game selection. Every write of it emits
  // `rgs.gameSelected` (see rgsClient.setActiveGame), so a game chosen while this
  // popup is open is reflected here rather than leaving a stale name on screen.
  //
  // No games list is fetched any more: without a picker there is nothing to
  // populate, and the selection already carries the id, slug and name that
  // publishing needs.
  useEffect(() => {
    EventDispatcher.instance.on('rgs.gameSelected', rerenderOnGameSelected, rerenderOnGameSelected);
    return () => { EventDispatcher.instance.off(rerenderOnGameSelected); };
  }, []);

  // The Vercel team the deploy token can use (VercelSDKWrapper.team): the shared
  // token's own team when it cannot see XGENIA_VERCEL_TEAM (2026-10-05: 403 on
  // every call). XGENIA_VERCEL_TEAM until the token has been asked.
  const [teamInfo, setTeamInfo] = useState(XGENIA_VERCEL_TEAM);

  // Persistent device identifier to scope deployments to current local device only (fallback when no account)
  const [deviceId] = useState<string>(() => getDeviceId());

  // Resolve current account id (registered account) if logged in
  const currentAccountId: string | null = user?.id || null;
  // Whose Deployed Domains these are (see utils/publish/deployedDomains).
  const domainOwner = { accountId: currentAccountId, deviceId };

  // Initialize Vercel SDK with dynamic token
  const vercel = vercelToken ? new VercelSDKWrapper({
    bearerToken: vercelToken,
  }) : null;

  useEffect(() => {
    if (!vercelToken) return;
    let live = true;
    new VercelSDKWrapper({ bearerToken: vercelToken }).team().then((team) => { if (live) setTeamInfo(team); });
    return () => { live = false; };
  }, [vercelToken]);

  /**
   * Are the deploy credentials actually here?
   *
   * `vercel` is null whenever the Vercel token is missing, and every call below
   * is `vercel.<something>` — see utils/publish/publishGame deployCredentialError
   * for what that used to look like to the user.
   *
   * @returns an error message, or '' when the credentials are present.
   */
  function deployCredentialError(): string {
    return credentialErrorFor({ tokensLoaded, vercelToken, githubToken, tokenError });
  }

  // Name rules, availability, the GitHub upload and the Vercel deploy are plain
  // functions in utils/publish (deployDomain, webDeploy), shared with the AI's
  // publish commands.

  // Fetch and display previously deployed domains
  async function fetchDeployedDomains() {
    setIsLoadingDomains(true);
    try {
      // From local storage: the current owner's, newest first (readOwnedDomains).
      setDeployedDomains(readOwnedDomains(domainOwner));
      setShowDeployedDomains(true);
    } catch (error: any) {
      console.error('Failed to fetch deployed domains from local storage:', error);
      ToastLayer.showError('Failed to load deployed domains');
    } finally {
      setIsLoadingDomains(false);
    }
  }

  // Save deployed domain to local storage
  function saveDeployedDomain(
    domainName: string,
    deploymentId: string,
    deploymentUrl: string,
    rgsBackend?: RgsBackendRef
  ) {
    storeDeployedDomain(domainOwner, domainName, deploymentId, deploymentUrl, rgsBackend);

    // Auto-refresh the domains list if it's currently being shown
    if (showDeployedDomains) {
      try {
        setDeployedDomains(readOwnedDomains(domainOwner));
      } catch (error: any) {
        console.error('Failed to save deployed domain to local storage:', error);
      }
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
      ToastLayer.showError(DOMAIN_NAME_RULE);
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
      const availability = await checkDomainAvailability(vercel, newName.trim());

      if (!availability.available) {
        throw new Error(
          availability.reason === 'taken-elsewhere'
            ? `${newName.trim()}.vercel.app is already taken by another Vercel account. Please choose a different name.`
            : 'Domain name is already in use. Please choose a different name.'
        );
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
  /**
   * Open the Compliance view on this deployed game, in the editor's main area.
   *
   * The subject is the GAME as published under this domain: the whole uploaded
   * source XGENIA RGS holds for it (registered at publish time — see
   * registerDeployedGame) and every maths component that source calls. Only the
   * domain's name travels — it is the slug the game was listed under — and the
   * platform builds everything else from the source it holds. The popup closes
   * because the document opens behind it.
   */
  function openCompliance(domain: DeployedDomain) {
    const apiKey = getRgsSettings()?.apiKey;
    if (!apiKey) {
      ToastLayer.showError(
        'Connect to XGENIA RGS in the Maths RGS panel first — compliance documents are generated and stored there.'
      );
      return;
    }
    const host = (domain.url || getFullDomain(domain.name)).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    AppRegistry.instance.openDocument(MathsComplianceDocumentProvider.ID, {
      apiKey,
      deployedGame: { slug: domain.name, name: domain.name, domain: host, url: domain.url }
    });
    closePopup?.();
  }

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

  /** Drop one domain from the stored list and from the list on screen. */
  function forgetDomain(domainId: string) {
    const storedDomains = localStorage.getItem('xgenia-deployed-domains');
    const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];
    const updatedDomains = deployedDomainsData.filter((d: any) => d.id !== domainId);
    localStorage.setItem('xgenia-deployed-domains', JSON.stringify(updatedDomains));
    setDeployedDomains(prev => prev.filter(domain => domain.id !== domainId));
  }

  /** "v3 (Keno Dynasty)" — how a backend version is named in messages. */
  function backendLabel(b: RgsBackendRef): string {
    const version = b.version ? `v${b.version}` : 'version';
    return b.gameName ? `${version} (${b.gameName})` : version;
  }

  /**
   * Delete the RGS Server Version(s) behind a Vercel deployment.
   *
   * Deleting the Vercel project only removes the UI half of a published game:
   * its logic lives in RGS edge functions, which stay live and callable on their
   * public `/rgs-fn/<game>/<slug>` endpoints with nothing left pointing at them.
   * So the domain's recorded versions go too — the cascade on
   * game_function_deployments takes their component functions with them.
   *
   * Never throws. By the time this runs the Vercel project is already gone, so a
   * backend that won't delete cannot be allowed to fail the whole operation —
   * it has to be reported instead, with the version named so it can be removed
   * by hand from the Maths RGS panel.
   */
  async function deleteRgsBackends(
    domain: DeployedDomain
  ): Promise<{ ok: boolean; message: string; keepRecord: boolean }> {
    const backends = domain.rgsBackends || [];
    // Nothing linked: an older record, or a deploy to a plain cloud service.
    if (backends.length === 0) return { ok: true, message: '', keepRecord: false };

    const apiKey = getRgsSettings()?.apiKey;
    if (!apiKey) {
      return {
        ok: false,
        keepRecord: true,
        message:
          ` Its XGENIA RGS backend (${backends.map(backendLabel).join(', ')}) was NOT deleted — not connected to` +
          ` XGENIA RGS. Connect in the Maths RGS panel and delete again.`
      };
    }

    const failures: string[] = [];
    for (const backend of backends) {
      try {
        await deleteEdgeDeployment(apiKey, backend.deploymentId, backend.gameId);
      } catch (e: any) {
        const message = String(e?.message || e);
        // Already gone server-side (deleted from the RGS studio, or a previous
        // attempt that got this far) is the outcome we wanted, not a failure.
        if (/not found/i.test(message)) continue;
        console.error(`Failed to delete RGS deployment ${backend.deploymentId}:`, e);
        failures.push(`${backendLabel(backend)}: ${message}`);
      }
    }

    if (failures.length > 0) {
      return {
        ok: false,
        keepRecord: true,
        message:
          ` Its XGENIA RGS backend could not be deleted (${failures.join('; ')}).` +
          ` Delete it from the Maths RGS panel — the domain stays listed so you can retry.`
      };
    }
    const deleted = backends.map(backendLabel).join(', ');
    return {
      ok: true,
      keepRecord: false,
      message: ` XGENIA RGS backend deleted too (${deleted}).`
    };
  }

  // Delete a specific domain/deployment — frontend (Vercel project) AND the RGS
  // backend it was published with, so a deleted game leaves nothing running.
  // Vercel goes first: if it fails, the backend is deliberately left alone
  // rather than pulling the logic out from under a frontend that is still live.
  async function deleteDomain(domain: DeployedDomain) {
    const { id: domainId, name: domainName } = domain;

    // Without a Vercel token there is no client to call, and the record must stay
    // listed: dropping it here would strand a live project with nothing pointing
    // at it, which is the same reason a failed Vercel delete keeps the record.
    const credentialError = deployCredentialError();
    if (credentialError) {
      ToastLayer.showError(`Cannot delete ${domainName}.vercel.app. ${credentialError}`);
      return;
    }

    setDeletingDomains(prev => new Set([...prev, domainId]));

    try {
      // Try to delete project from Vercel (this automatically deletes all associated deployments)
      await vercel.projects.deleteProject({
        idOrName: domainName,
        teamId: teamInfo.id,
        slug: teamInfo.slug
      });

      const backend = await deleteRgsBackends(domain);
      if (!backend.keepRecord) forgetDomain(domainId);

      const summary = `Successfully deleted ${domainName}.vercel.app project from Vercel.${backend.message}`;
      if (backend.ok) ToastLayer.showSuccess(summary);
      else ToastLayer.showError(summary);
    } catch (error: any) {
      console.error('Failed to delete project from Vercel:', error);

      // Check if it's a "not found" error (404) - if so, just remove from local storage
      if (error.message.includes('404') || error.message.includes('Not Found') || error.message.includes('not found')) {
        console.log('Project not found in Vercel, removing from local storage only');

        // The frontend is already gone, but its backend may not be — this is the
        // last chance to take it with the record, so still try.
        const backend = await deleteRgsBackends(domain);
        if (!backend.keepRecord) forgetDomain(domainId);

        const summary = `Removed ${domainName}.vercel.app from list (project not found in Vercel).${backend.message}`;
        if (backend.ok) ToastLayer.showSuccess(summary);
        else ToastLayer.showError(summary);
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

  /**
   * Publish to XGENIA RGS + Vercel.
   *
   * The routine itself is publishGameToWeb (utils/publish/publishGame) — copy,
   * wire the Math Components to their live endpoints, stamp the game and the
   * telemetry, build, push, deploy, list on Deployed Games — shared with the AI's
   * publish commands. This is its narration: the activity toast, the heads-up
   * toasts, the success message, the publish state and the domains list.
   */
  async function deployToRgsAndVercel(activityId: string, telemetry: CompleteTelemetryMapping) {
    const rgs = getRgsSettings();
    // Which RGS game this frontend belongs to: the Maths RGS panel's selection,
    // never a choice made here (see publishPreconditionError).
    const game = getActiveGame();
    const precondition = publishPreconditionError(rgs, game);
    if (precondition) {
      // Early return: this bypasses onDeployToVercelClicked's outer catch, so the
      // publish state has to be closed here or the Publish button spins forever.
      PublishState.fail(precondition);
      ToastLayer.hideActivity(activityId);
      ToastLayer.showError(precondition);
      return;
    }

    const result = await publishGameToWeb({
      project: ProjectModel.instance,
      domainName: domainName.trim(),
      telemetry,
      isPrivate,
      rgs,
      game,
      tokens: { github: githubToken, vercel: vercelToken },
      onProgress: (step) => ToastLayer.showActivity(step, activityId),
      onWarning: (message) => ToastLayer.showError(message),
      onLive: async ({ liveUrl, deploymentId, wiring }) => {
        // The one point where the live URL is known.
        PublishState.succeed(liveUrl);
        ToastLayer.hideActivity(activityId);
        const userFriendlyDomain = liveUrl.replace(/^https?:\/\//, '');
        const wiringText = describeWiring(wiring, game.name);
        ToastLayer.showSuccess(`Deployed to Vercel — ${wiringText}.\nLive URL: ${userFriendlyDomain}`);
        setSuccessMessage(`Deployed to Vercel (${wiringText}). Live URL: ${userFriendlyDomain}`);

        // No RGS backend reference is recorded any more: this publish did not
        // create a Server Version, and the ones it calls are managed in the Maths
        // RGS panel and may be shared by several frontends. Deleting this domain
        // must not delete them — deleteRgsBackends already no-ops on a record with
        // none, and records written by the old flow keep their links.
        saveDeployedDomain(domainName.trim(), deploymentId, liveUrl);
        if (showDeployedDomains) await fetchDeployedDomains();
      }
    });

    // Listed on XGENIA RGS → Deployed Games, or why not. Never a failed publish:
    // the site is live by now.
    ToastLayer.hideActivity(activityId);
    const listing = describeRegistration(result.registered, result.name);
    if (result.registered.ok) ToastLayer.showSuccess(listing);
    else ToastLayer.showError(listing);
  }

  async function onDeployToVercelClicked() {
    if (!domainName.trim()) {
      ToastLayer.showError(DOMAIN_NAME_REQUIRED);
      return;
    }

    if (!validateDomain(domainName.trim())) {
      ToastLayer.showError(DOMAIN_NAME_RULE);
      return;
    }

    // Before any heavy work: a missing token cannot be recovered from mid-publish,
    // and failing here costs the user nothing. Failing later costs a compile, an
    // RGS deploy and a repo — and reports it as "Project compilation error".
    const credentialError = deployCredentialError();
    if (credentialError) {
      setDomainError(credentialError);
      ToastLayer.showError(credentialError);
      return;
    }

    // Before the workflow starts: which UI element is the bet input, which shows
    // the win, which button places the bet. XGENIA RGS needs this to follow the
    // rounds of the deployed game, and the person who built the UI is the one
    // who knows. Cancel here costs nothing — no compile, no repo, no publish
    // state has been opened yet.
    const telemetry = await requestTelemetryMapping();
    if (!telemetry) return;
    // Remember the answer on the project, so the next publish opens pre-filled.
    try {
      (ProjectModel.instance as any)?.setMetaData?.(TELEMETRY_METADATA_KEY, telemetry);
    } catch (e) {
      console.warn('[Deploy] Could not store the telemetry mapping on the project:', e);
    }

    const activityId = 'deploying-to-vercel';
    PublishState.begin();
    setIsDeploying(true);
    setDomainError('');
    setSuccessMessage('');

    try {
      // Early: Check domain availability before any heavy work
      ToastLayer.showActivity('Checking domain availability...', activityId);
      const availability = await checkDomainAvailability(vercel, domainName.trim());
      if (!availability.available) {
        ToastLayer.hideActivity(activityId);
        // Same family as the two RGS guards below: an early return inside this try
        // never reaches the outer catch, so the publish state has to be closed here
        // or the Publish button spins forever on a refused name.
        const unavailableMessage = domainUnavailableMessage(domainName.trim(), availability.reason);
        PublishState.fail(unavailableMessage);
        setDomainError(unavailableMessage);
        return;
      }

      // ── XGENIA RGS path ──────────────────────────────────────────────
      // Compile → deploy each logic component as a per-game RGS edge function →
      // point each Aggregator node at its deployed URL → Vercel-deploy ONLY the
      // UI (visual components + Aggregators). Logic and UI become decoupled,
      // talking over HTTPS REST.
      if (environmentId === RGS_ENVIRONMENT_VALUE) {
        await deployToRgsAndVercel(activityId, telemetry);
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

        // Upload the build straight to Vercel (uploadFilesToVercel) — no GitHub
        // repository any more (2026-10-05: the shared GitHub token had gone bad).
        const fileRefs = await uploadFilesToVercel(vercel, files, (step) => ToastLayer.showActivity(step, activityId));

        // Step 4: Deploy to Vercel and setup domain
        ToastLayer.showActivity('Step 4/4: Deploying to Vercel...', activityId);
        const { deploymentId, deploymentUrl, aliasUrl } = await deployToVercel(vercel, { files: fileRefs }, domainName.trim());
        PublishState.succeed(aliasUrl);

        ToastLayer.hideActivity(activityId);
        const userFriendlyDomain = aliasUrl.replace(/^https?:\/\//, '');
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
      PublishState.fail(error?.message || String(error));
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

        {/* Connect GitHub + Vercel — both are required to publish the UI. */}
        <ConnectedServicesPanel filterFor="deploy" compact />

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

        {/* Connected cloud services — COMMENTED OUT (2026-08-06), deliberately kept
            rather than deleted.

            There is nothing left for it to choose. The backend of an XGENIA project
            is now its Math Components, deployed to a game from the Maths RGS panel;
            by the time anyone opens this popup they are already deployed, already
            integrated, and the publish routine only has to point the frontend at
            them. This dropdown's other options — "No cloud service" and any
            cloudService.backend environment — all route to a publish that skips that
            wiring entirely, so every one of them was a way to ship a broken game.

            The target is pinned to XGENIA RGS at the `environmentId` useState above;
            read the note there before touching either. Restoring this is a pure
            uncomment PLUS putting NO_ENVIRONMENT_VALUE back as the initial value —
            uncommenting alone leaves the dropdown showing "XGENIA RGS" preselected,
            which is harmless, but restoring the initial value without uncommenting
            is the silent-breakage case.

            The cloud-service picker still exists on the other two deploy tabs
            (DeployToFolderTab, DeployToStakeTab), so the feature is not gone from
            the editor — only from the path that publishes to XGENIA RGS. */}
        {/*
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
        */}

        {/* XGENIA RGS. There is no "Target game" picker here any more: the game is
            wherever the project's Math Components were deployed, which is chosen
            once in the Maths RGS panel. Publishing reads that, so it can never
            build a frontend for game B out of endpoints belonging to game A. Shown
            read-only so it is still obvious what is about to be published. */}
        {rgsSelected && !rgsConnected && (
          <Text style={{ marginBottom: '12px', fontSize: '12px', color: '#f66' }}>
            Not connected to XGENIA RGS. Connect in the Maths RGS panel first.
          </Text>
        )}

        {rgsSelected && rgsConnected && (
          rgsGame ? (
            <Text style={{ marginBottom: '12px', fontSize: '12px', color: '#999' }}>
              Backend: <span style={{ color: '#ddd' }}>{rgsGame.name || rgsGame.slug}</span> — the game
              its Math Components are deployed to. Change it in the Maths RGS panel.
            </Text>
          ) : (
            <Text style={{ marginBottom: '12px', fontSize: '12px', color: '#f66' }}>
              No game selected. Select one in the Maths RGS panel first.
            </Text>
          )
        )}

        <PrimaryButton
          label={isDeploying ? "Deploying..." : "Deploy"}
          onClick={onDeployToVercelClicked}
          isDisabled={
            isDeploying ||
            !domainName.trim() ||
            (rgsSelected && (!rgsConnected || !rgsGame?.id))
          }
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
                              {/* Link the URL Vercel actually assigned (domain.url),
                                  never a guessed "<name>.vercel.app" — that alias
                                  may belong to a different Vercel account. */}
                              <a
                                href={domain.url || `https://${domain.name}.vercel.app`}
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
                                {(domain.url || `https://${domain.name}.vercel.app`).replace(/^https?:\/\//, '')}
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
                              {/* Delete removes the linked RGS Server Version(s)
                                  as well, so name them here — that is not
                                  something to discover from the toast after the
                                  fact. */}
                              {(domain.rgsBackends || []).length > 0 && (
                                <div>
                                  <span style={{ color: '#aaa' }}>RGS backend:</span>{' '}
                                  {(domain.rgsBackends || []).map(backendLabel).join(', ')}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Rename / Compliance / Delete sit in a three-dot menu:
                              three labelled buttons beside the URL and its
                              timestamps do not fit a 400px popup. */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                            {deletingDomains.has(domain.id) && (
                              <span style={{ fontSize: '11px', color: '#888' }}>Deleting...</span>
                            )}
                            <ContextMenu
                              size={IconSize.Tiny}
                              menuItems={[
                                {
                                  label: 'Rename',
                                  icon: IconName.Pencil,
                                  isDisabled: deletingDomains.has(domain.id),
                                  onClick: () => startRenameDomain(domain)
                                },
                                {
                                  label: 'Compliance',
                                  icon: IconName.File,
                                  tooltip: isRgsConnected()
                                    ? 'Compliance documents for this deployed game — generated on XGENIA RGS from its whole uploaded source'
                                    : 'Connect to XGENIA RGS in the Maths RGS panel first',
                                  isDisabled: !isRgsConnected() || deletingDomains.has(domain.id),
                                  onClick: () => openCompliance(domain)
                                },
                                'divider',
                                {
                                  label: 'Delete',
                                  icon: IconName.Trash,
                                  isDangerous: true,
                                  isDisabled: deletingDomains.has(domain.id),
                                  onClick: () => deleteDomain(domain)
                                }
                              ]}
                            />
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

      {/* Pre-deploy telemetry form — see requestTelemetryMapping. Portalled to
          document.body by the dialog itself, so it is centred over the editor
          rather than squeezed into this 400px popup. */}
      {telemetryRequest && (
        <DeployTelemetryDialog
          initial={telemetryRequest.initial}
          candidates={telemetryRequest.candidates}
          canPickFromPreview={isPreviewPickerAvailable()}
          pickFromPreview={pickUiElementFromPreview}
          resolveNodeId={(nodeId, pickedFrom) => refForNodeId(nodeId, pickedFrom)}
          onConfirm={(mapping) => {
            const { resolve } = telemetryRequest;
            setTelemetryRequest(null);
            resolve(mapping);
          }}
          onCancel={() => {
            const { resolve } = telemetryRequest;
            setTelemetryRequest(null);
            resolve(null);
          }}
        />
      )}

      {/* Post-compile setup card — REPLACED.
          Belonged to the compile-and-deploy publish flow: it asked the user to name
          each extracted logic component and map its bet/win ports. Publishing no
          longer compiles or deploys anything, so nothing sets `setupRequest`.
          Commented out with the flow itself; a Math Component is named by the user
          in the component tree, and its bet/win mapping is set on the platform.

      {setupRequest && (
        <ComponentSetupDialog
          items={setupRequest.items}
          onShowComponent={showSourceComponent}
          onConfirm={(choices) => {
            const { resolve } = setupRequest;
            setSetupRequest(null);
            resolve(choices);
          }}
          onCancel={() => {
            const { resolve } = setupRequest;
            setSetupRequest(null);
            resolve(null);
          }}
        />
      )}
      */}
    </>
  );
}
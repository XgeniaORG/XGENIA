import React, { useState, useEffect, useReducer } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { PublishState } from '@xgenia-models/publishstate';
// Publishing does not compile or deploy logic itself: changed Math Components are
// deployed as backend components first (deployChangedMathsComponents), and the
// frontend is wired to their live endpoints (publishGameToWeb).
import { deleteEdgeDeployment } from '@xgenia-utils/rgs/deployEdgeFunction';
import { getRgsSettings, getActiveGame, isRgsConnected } from '@xgenia-utils/rgs/rgsClient';
import { isPreviewPickerAvailable, pickUiElementFromPreview } from '@xgenia-utils/rgs/pickUiElement';
import {
  CompleteTelemetryMapping,
  DeployTelemetryMapping,
  isCompleteMapping,
  TELEMETRY_METADATA_KEY,
  UiNodeCandidate
} from '@xgenia-utils/rgs/telemetryMapping';
import { deployChangedMathsComponents } from '@xgenia-utils/publish/deployChangedMaths';
import { autoSlug } from '@xgenia-utils/rgs/rgsRelease';
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
  PublishedVia,
  RgsBackendRef,
  getDeviceId,
  mergePublishedSites,
  readOwnedDomains,
  saveDeployedDomain as storeDeployedDomain
} from '@xgenia-utils/publish/deployedDomains';
import {
  checkPublishDomain,
  describeRegistration,
  describeWiring,
  publishGameToWeb,
  publishPreconditionError,
  resolvePublishRoute,
  vercelFor
} from '@xgenia-utils/publish/publishGame';
import { PublishRoute } from '@xgenia-utils/publish/publishRoute';
import { siteDomain, WebPublishError } from '@xgenia-utils/publish/webPublishClient';
import { XGENIA_VERCEL_TEAM, checkDomainAvailability } from '@xgenia-utils/publish/webDeploy';

import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { TextType } from '@xgenia-core-ui/components/typography/Text/Text';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';

import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';

import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { AppRegistry } from '@xgenia-models/app_registry';
import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { ContextMenu } from '@xgenia-core-ui/components/popups/ContextMenu';
import { MathsComplianceDocumentProvider } from '../../../documents/MathsComplianceDocument';
import { useDeployContext } from '../../DeployPopup.context';
import { DeployTelemetryDialog } from '../../DeployTelemetryDialog';
import { useAuth } from '../../../../context/AuthContext';
import { ConnectionStore } from '../../../../services/ConnectionStore';
import { RgsCertifyPanel, RgsReleaseSetup } from '../../ReleaseSetup/ReleaseSetup';

// The publish pipeline itself — the GitHub/Vercel calls, the RGS wiring and the
// Deployed Games listing — lives in utils/publish (publishGameToWeb, webDeploy),
// shared with the AI's publish commands. This tab is its UI: the form, the
// toasts, the publish state and the Deployed Domains list.

// Publishing goes through XGENIA RGS /web-publish (2026-11-03): the platform holds
// the Vercel token and the studio's operator key is the only credential here, so
// this tab never loads a token. Only on a platform that predates /web-publish does
// resolvePublishRoute fall back to the shared token (with a console warning).

/**
 * A site in the list that an older editor published with the shared Vercel token.
 * XGENIA RGS did not publish it, so it does not own it and will not touch it.
 */
const OLDER_EDITOR_SITE = (name: string, verb: 'rename' | 'delete') =>
  `${name}.vercel.app was published by an older version of XGENIA, so it cannot be ${verb === 'delete' ? 'deleted' : 'renamed'} from here. ` +
  `Ask the XGENIA team to ${verb === 'delete' ? 'take it down' : 'move it'}, or publish again under a new name.`;

export function XgeniaDeployTab() {
  const { closePopup } = useDeployContext();
  const { user } = useAuth();

  // ── XGENIA RGS backend target ──────────────────────────────────────────
  // Which RGS game this frontend belongs to: the project's game, chosen once in
  // RgsReleaseSetup below (or by the AI). A project's Math Components are deployed
  // as backend components of ONE game, so the game is a fact about the project.
  //
  // Read at render, like rgsConnected below — never held in state. The popup is
  // alwaysMounted, so a copy taken at mount kept showing the first game ever
  // selected after another one was chosen. Opening the popup re-renders this tab;
  // while it is open, `rgs.gameSelected` (effect below) forces the re-render.
  const [, rerenderOnGameSelected] = useReducer((n: number) => n + 1, 0);
  const rgsGame = getActiveGame();
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

  // How Publish reaches Vercel (resolvePublishRoute): through XGENIA RGS
  // /web-publish with the operator key and NO token in the editor, or — only on a
  // platform that predates it — the old shared Vercel token.
  const [route, setRoute] = useState<PublishRoute | null>(null);
  const [routeLoaded, setRouteLoaded] = useState(false);
  // Why there is no route, when there is none. Held so every entry point can say
  // the actual reason ("not connected to XGENIA RGS") instead of failing later on
  // a missing credential — which is what produced the two useless errors this
  // replaced: "Project compilation error" on publish, and "Cannot read properties
  // of null (reading 'projects')" on delete.
  const [routeError, setRouteError] = useState<string>('');

  // Re-run after a sign-in in this popup, and when the stored key is restored at
  // startup (`rgs.connected`): the route is decided with the operator key.
  const reloadCredentials = React.useCallback(async () => {
    const resolved = await resolvePublishRoute();
    setRoute(resolved.route);
    setRouteError(resolved.error);
    setRouteLoaded(true);
  }, []);

  useEffect(() => {
    void reloadCredentials();

    // A Vercel account connected by hand only matters to the old token path;
    // re-deciding is cheap (the web-publish answer is cached).
    const store = ConnectionStore.getInstance();
    const unsub = store.onChange(() => { void reloadCredentials(); });
    const group = {};
    EventDispatcher.instance.on('rgs.connected', () => { void reloadCredentials(); }, group);
    return () => { unsub(); EventDispatcher.instance.off(group); };
  }, []);

  // Follow the game selection. Every write of it emits `rgs.gameSelected` (see
  // rgsClient.setActiveGame), so a game chosen while this popup is open — here or
  // by the AI — is reflected rather than leaving a stale name on screen.
  //
  // No games list is fetched any more: without a picker there is nothing to
  // populate, and the selection already carries the id, slug and name that
  // publishing needs.
  useEffect(() => {
    EventDispatcher.instance.on('rgs.gameSelected', rerenderOnGameSelected, rerenderOnGameSelected);
    return () => { EventDispatcher.instance.off(rerenderOnGameSelected); };
  }, []);

  // The site name starts as the game's slug — one less thing to invent before the
  // first publish. Only fills an empty field; a name the user typed is theirs.
  useEffect(() => {
    if (!domainName.trim() && rgsGame?.slug) setDomainName(autoSlug(rgsGame.slug));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rgsGame?.slug]);

  // The bet / win / bet-button mapping is asked once per project: a publish with
  // a complete saved mapping uses it. This link asks again.
  const [askTelemetryAgain, setAskTelemetryAgain] = useState(false);

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

  // The Vercel client exists ONLY on the old token route; on XGENIA RGS there is
  // no token in this editor to build one from.
  const vercel = route?.kind === 'token' ? vercelFor(route) : null;

  useEffect(() => {
    if (route?.kind !== 'token') return;
    let live = true;
    vercelFor(route)!.team().then((team) => { if (live) setTeamInfo(team); });
    return () => { live = false; };
  }, [route]);

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
    if (!routeLoaded) return 'Still loading deploy credentials — try again in a moment.';
    return route ? '' : routeError || 'Not connected to XGENIA RGS.';
  }

  // Name rules, availability, the GitHub upload and the Vercel deploy are plain
  // functions in utils/publish (deployDomain, webDeploy), shared with the AI's
  // publish commands.

  // Fetch and display previously deployed domains
  async function fetchDeployedDomains() {
    setIsLoadingDomains(true);
    try {
      // From local storage: the current owner's, newest first (readOwnedDomains).
      const local = readOwnedDomains(domainOwner);
      if (route?.kind === 'rgs') {
        // XGENIA RGS knows every site this STUDIO published (from any machine);
        // local records it does not know are older-editor publishes, kept listed.
        try {
          setDeployedDomains(mergePublishedSites(await route.client.list(), local));
        } catch (error: any) {
          setDeployedDomains(local);
          ToastLayer.showError(`Could not load this studio's sites from XGENIA RGS: ${error?.message || error}`);
        }
      } else {
        setDeployedDomains(local);
      }
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
    rgsBackend?: RgsBackendRef,
    via?: PublishedVia
  ) {
    storeDeployedDomain(domainOwner, domainName, deploymentId, deploymentUrl, rgsBackend, via);

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
  function updateDomainInStorage(oldName: string, newName: string, deploymentId: string, newUrl: string, via?: PublishedVia) {
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
          ...(via ? { project: via.project, site: via.site } : {}),
        };
        localStorage.setItem('xgenia-deployed-domains', JSON.stringify(deployedDomainsData));

        // Update the UI state
        setDeployedDomains(prev => prev.map(domain =>
          domain.id === deploymentId && domain.name === oldName && (
            currentAccountId ? domain.accountId === currentAccountId || (!domain.accountId && domain.deviceId === deviceId) : domain.deviceId === deviceId
          )
            ? { ...domain, name: newName, updatedAt: new Date().toISOString(), url: newUrl, accountId: currentAccountId || domain.accountId, ...(via ? { project: via.project, site: via.site } : {}) }
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

    // A site published through XGENIA RGS is renamed BY the platform, which owns
    // its Vercel project on the studio's behalf and refuses a name it does not own.
    const record = deployedDomains.find((d) => d.id === domainId && d.name === oldName);
    if (route?.kind === 'rgs' || record?.project) {
      if (!record?.project) {
        ToastLayer.showError(OLDER_EDITOR_SITE(oldName, 'rename'));
        return;
      }
      if (route?.kind !== 'rgs') {
        ToastLayer.showError(`Cannot rename ${oldName}.vercel.app. ${deployCredentialError() || 'XGENIA RGS web publishing is unavailable right now.'}`);
        return;
      }
      setRenamingDomain(domainId);
      try {
        ToastLayer.showActivity('Renaming through XGENIA RGS...', activityId);
        const renamed = await route.client.rename(record.project, newName.trim());
        updateDomainInStorage(oldName, renamed.project, domainId, renamed.live_url, { project: renamed.project, site: renamed.site });
        ToastLayer.hideActivity(activityId);
        ToastLayer.showSuccess(`Renamed ${oldName}.vercel.app to ${renamed.domain}.${renamed.warnings?.length ? `\n${renamed.warnings.join('\n')}` : ''}`);
      } catch (error: any) {
        ToastLayer.hideActivity(activityId);
        ToastLayer.showError(`Failed to rename domain: ${error?.message || error}`);
      } finally {
        setRenamingDomain(null);
        setNewDomainName('');
      }
      return;
    }

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
        'Sign in to XGENIA RGS above first — compliance documents are generated and stored there.'
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
    // On XGENIA RGS the studio prefix is fixed: the name to edit is the site part.
    setNewDomainName(domain.site || domain.name);
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
  function forgetDomain(domainId: string, project?: string) {
    // A site published through XGENIA RGS may have several local records (one per
    // machine/deployment id); they all go with the project.
    const gone = (d: any) => d.id === domainId || (!!project && d.project === project);
    const storedDomains = localStorage.getItem('xgenia-deployed-domains');
    const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];
    const updatedDomains = deployedDomainsData.filter((d: any) => !gone(d));
    localStorage.setItem('xgenia-deployed-domains', JSON.stringify(updatedDomains));
    setDeployedDomains(prev => prev.filter(domain => !gone(domain)));
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
   * by hand (the domain stays listed for a retry, or the XRGS back office).
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
          ` Its XGENIA RGS backend (${backends.map(backendLabel).join(', ')}) was NOT deleted — not signed in to` +
          ` XGENIA RGS. Sign in above and delete again.`
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
          ` The domain stays listed so you can retry, or delete the version in XGENIA RGS (the game's Versions).`
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

    // Published through XGENIA RGS: the platform deletes its project, and only
    // one this studio owns. A record WITHOUT a project was published by an older
    // editor with the shared token; the platform did not publish it and will not
    // delete it, and this editor no longer holds a token that could.
    if (route?.kind === 'rgs' || domain.project) {
      if (!domain.project) {
        ToastLayer.showError(OLDER_EDITOR_SITE(domainName, 'delete'));
        return;
      }
      if (route?.kind !== 'rgs') {
        ToastLayer.showError(`Cannot delete ${domainName}.vercel.app. ${deployCredentialError() || 'XGENIA RGS web publishing is unavailable right now.'}`);
        return;
      }
      setDeletingDomains(prev => new Set([...prev, domainId]));
      try {
        let gone = 'deleted';
        try {
          await route.client.remove(domain.project);
        } catch (error: any) {
          // Not a site of this studio's on the platform any more (deleted from
          // another machine, or from the back office): the frontend is gone.
          if (!(error instanceof WebPublishError && error.status === 404)) throw error;
          gone = 'already gone';
        }
        const backend = await deleteRgsBackends(domain);
        if (!backend.keepRecord) forgetDomain(domainId, domain.project);
        const summary = `${domainName}.vercel.app ${gone === 'deleted' ? 'deleted' : 'was already gone; removed from the list'}.${backend.message}`;
        if (backend.ok) ToastLayer.showSuccess(summary);
        else ToastLayer.showError(summary);
      } catch (error: any) {
        ToastLayer.showError(`Failed to delete ${domainName}.vercel.app: ${error?.message || error}`);
      } finally {
        setDeletingDomains(prev => {
          const next = new Set(prev);
          next.delete(domainId);
          return next;
        });
      }
      return;
    }

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
    // Which RGS game this frontend belongs to: the project's game, chosen in
    // RgsReleaseSetup (see publishPreconditionError).
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

    // Deploy the maths first, so Publish is one button. Skipping it shipped the
    // game with its maths running in the player's browser. Only changed
    // components are deployed; a game whose maths already matches costs one
    // comparison.
    try {
      const maths = await deployChangedMathsComponents({
        onProgress: (step) => ToastLayer.showActivity(`Maths: ${step}`, activityId)
      });
      maths.warnings.forEach((w) => ToastLayer.showError(w));
      // New maths has a new fingerprint: a certificate for the old maths no
      // longer lets this game take real money. Say so at the moment it happens.
      if (maths.deployed.length > 0) {
        ToastLayer.showSuccess(
          `${maths.message} Playable with play money now. Real money needs this maths verified: see Going live with real money below.`
        );
      }
    } catch (e: any) {
      throw new Error(`Deploying the maths failed: ${e?.message || e}`);
    }

    const result = await publishGameToWeb({
      project: ProjectModel.instance,
      domainName: domainName.trim(),
      telemetry,
      isPrivate,
      rgs,
      game,
      route: route ?? undefined,
      onProgress: (step) => ToastLayer.showActivity(step, activityId),
      onWarning: (message) => ToastLayer.showError(message),
      onLive: async ({ liveUrl, deploymentId, wiring, project, site, viaRgs }) => {
        // The one point where the live URL is known.
        PublishState.succeed(liveUrl);
        ToastLayer.hideActivity(activityId);
        const userFriendlyDomain = liveUrl.replace(/^https?:\/\//, '');
        const wiringText = describeWiring(wiring, game.name);
        ToastLayer.showSuccess(`Published — ${wiringText}.\nLink: ${userFriendlyDomain}`);
        setSuccessMessage(`Published (${wiringText}). Link: ${userFriendlyDomain}`);

        // No RGS backend reference is recorded any more: the Server Versions this
        // publish calls belong to the game and may be shared by several frontends.
        // Deleting this domain must not delete them — deleteRgsBackends already
        // no-ops on a record with none, and records written by the old flow keep
        // their links.
        saveDeployedDomain(viaRgs ? project : domainName.trim(), deploymentId, liveUrl, undefined, viaRgs ? { project, site } : undefined);
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
    if (credentialError || !route) {
      setDomainError(credentialError);
      ToastLayer.showError(credentialError);
      return;
    }
    const publishRoute = route;

    // Before the workflow starts: which UI element is the bet input, which shows
    // the win, which button places the bet. XGENIA RGS needs this to follow the
    // rounds of the deployed game, and the person who built the UI is the one
    // who knows. Cancel here costs nothing — no compile, no repo, no publish
    // state has been opened yet.
    const saved = storedTelemetryMapping(ProjectModel.instance as any);
    const telemetry = !askTelemetryAgain && isCompleteMapping(saved) ? saved : await requestTelemetryMapping();
    if (!telemetry) return;
    setAskTelemetryAgain(false);
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
      // On XGENIA RGS the platform answers, including "your own earlier publish"
      // (available, republish) and "another studio's" (refused, with why).
      const availability = await checkPublishDomain(publishRoute, domainName.trim());
      if (!availability.available) {
        ToastLayer.hideActivity(activityId);
        // Same family as the precondition guard in deployToRgsAndVercel: an early
        // return inside this try never reaches the outer catch, so the publish state
        // has to be closed here or the Publish button spins forever on a refused name.
        const unavailableMessage = availability.message || domainUnavailableMessage(domainName.trim(), availability.reason);
        PublishState.fail(unavailableMessage);
        setDomainError(unavailableMessage);
        return;
      }

      // Deploy changed maths, wire the frontend to its live endpoints, publish.
      await deployToRgsAndVercel(activityId, telemetry);
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
          Publish your game
        </Text>

        {/* Sign in and choose the game right here. GitHub/Vercel are not the
            studio's to connect: XGENIA RGS provides the hosting. */}
        <RgsReleaseSetup
          projectName={String((ProjectModel.instance as any)?.name || '')}
          onChanged={() => { rerenderOnGameSelected(); void reloadCredentials(); }}
        />

        {rgsConnected && rgsGame?.id && (<>
        <TextInput
          label="Link name"
          value={domainName}
          onChange={(e) => { setDomainName(e.target.value); if (domainError) setDomainError(''); }}
          placeholder="my-project"
          prefix={route?.kind === 'rgs' ? `${route.info.prefix}-` : undefined}
          suffix={`.${siteDomain(route?.kind === 'rgs' ? route.info : null)}`}
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

        <PrimaryButton
          label={isDeploying ? 'Publishing…' : 'Publish'}
          onClick={onDeployToVercelClicked}
          isDisabled={isDeploying || !domainName.trim() || !rgsConnected || !rgsGame?.id}
        />
        {isCompleteMapping(storedTelemetryMapping(ProjectModel.instance as any)) && (
          <Text style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>
            Uses this project&rsquo;s saved bet / win mapping.{' '}
            <span
              style={{ color: '#67DE92', cursor: 'pointer' }}
              onClick={() => setAskTelemetryAgain(true)}
            >
              {askTelemetryAgain ? 'You will be asked on Publish.' : 'Change it'}
            </span>
          </Text>
        )}

        <RgsCertifyPanel />
        </>)}

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
                          <span style={{ fontSize: '14px', color: '#ccc' }}>.{siteDomain(route?.kind === 'rgs' ? route.info : null)}</span>
                          <button
                            onClick={() => renameDomain(domain.id, domain.name, newDomainName)}
                            disabled={!newDomainName.trim() || newDomainName.trim() === (domain.site || domain.name)}
                            style={{
                              padding: '4px 8px',
                              fontSize: '12px',
                              backgroundColor: (!newDomainName.trim() || newDomainName.trim() === (domain.site || domain.name)) ? '#555' : '#28a745',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: (!newDomainName.trim() || newDomainName.trim() === (domain.site || domain.name)) ? 'not-allowed' : 'pointer',
                              opacity: (!newDomainName.trim() || newDomainName.trim() === (domain.site || domain.name)) ? 0.6 : 1
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
                                    : 'Sign in to XGENIA RGS above first',
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
    </>
  );
}
// "Deployed" — what the platform is actually serving, and nothing else.
//
// A read-only mirror of the selected Server Version's components, read from
// `game_edge_functions`. Not the project tree: a component sitting in the tree
// undeployed does not appear here, and a component deleted from the tree but
// still live does. That is the point of the tab — it answers "what will a player
// hit?", which the working copy cannot.
//
// Read-only throughout, deliberately. These rows describe code running on RGS;
// editing them in place would either be a lie (changing a local graph that is not
// what is deployed) or a live edit of production maths with no undo. Authoring
// happens in Local, and Deploy is how a change gets here.
//
// Three things a row does:
//   * click — opens the graph AS DEPLOYED, in the read-only node-graph view. This
//     is the component's stored `project_json`, the graph its author wrote, not
//     the flattened script that executes.
//   * drag  — drops a BACKEND component: an Aggregator already pointed at this
//     component's live `/rgs-fn/<game>/<slug>` endpoint. Dragging the same
//     component out of Local drops the local instance instead, whose maths runs
//     in the browser. That difference is why both tabs exist.
//   * ⋯ → Simulate — measures this component's RTP / hit frequency / volatility.
//     The rounds run on RGS, against the row `rgs-fn` serves; see
//     @xgenia-utils/rgs/simulateComponent.
//   * ⋯ → Compliance — the submission packs for this build: the ten catalogue
//     documents, their prerequisites and their PDFs. Also produced on RGS, which
//     is the only place that holds the deployed source's hash, the operator's
//     registered details and the recorded play they cite; see
//     @xgenia-utils/rgs/complianceDocs.
//
// Both remote actions are offered HERE and nowhere else (Simulate 2026-08-06,
// Compliance 2026-08-26), for one reason: they describe a DEPLOYED artifact. A
// local component has no hash a laboratory could certify and no rounds anyone
// has played, so neither question has an answer for one.
//
// Simulate learned that the hard way: it used to sit on the Local tree's
// three-dot menu, where it compiled the working copy in the renderer and
// reported an RTP for a script that had never been near the platform — a figure
// indistinguishable, on screen, from a measurement of the live maths. To
// simulate or document something you are still authoring, deploy it first: that
// is a deliberate step, not a missing feature.

import React, { useState } from 'react';

import { AppRegistry } from '@xgenia-models/app_registry';
import { ComponentModel } from '@xgenia-models/componentmodel';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { DeployedComponent } from '@xgenia-utils/rgs/mathsComponentStatus';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { ListItem, ListItemVariant } from '@xgenia-core-ui/components/layout/ListItem';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { ContextMenu } from '@xgenia-core-ui/components/popups/ContextMenu';
import { Section, SectionVariant } from '@xgenia-core-ui/components/sidebar/Section';
import { Label } from '@xgenia-core-ui/components/typography/Label';

import { ComponentDiffDocumentProvider } from '../../../documents/ComponentDiffDocument';
import { EditorDocumentProvider } from '../../../documents/EditorDocument';
import { MathsComplianceDocumentProvider } from '../../../documents/MathsComplianceDocument';
import { MathsSimulateDocumentProvider } from '../../../documents/MathsSimulateDocument';
import PopupLayer from '../../../popuplayer';

export interface MathsDeployedSectionProps {
  deployed: DeployedComponent[];
  /** "v3 · simple-adder" — which Server Version these came from. */
  versionLabel?: string | null;
  /** False when there is no game / Server Version selected yet. */
  isReady: boolean;
  error?: string | null;
  /**
   * Operator key — Simulate and Compliance both need it, because the rounds run
   * and the documents are generated and stored on the platform.
   */
  apiKey?: string;
  /**
   * The Server Version these rows came from. Both remote actions name it: it is
   * the build being measured or documented, it scopes the call to a game this
   * key owns, and for Compliance it is also what identifies the game — so
   * neither action needs a game selected separately.
   */
  deploymentId?: string;
  version?: number;
  gameName?: string;
}

/**
 * A ComponentModel for a deployed component's stored graph.
 *
 * Built from `project_json` rather than from the local component of the same
 * name, even when one exists: the local one may have been edited since, and this
 * tab must describe what is DEPLOYED. Null when the row predates project_json,
 * where there is no graph to show or derive ports from.
 *
 * `ComponentModel.fromJSON` fires the global Model.* events, which the project
 * treats as edits and saves on — same guard the Version Control panel uses.
 */
function modelForDeployed(entry: DeployedComponent): ComponentModel | null {
  if (!entry.component) return null;
  ProjectModel.setSaveOnModelChange(false);
  try {
    return ComponentModel.fromJSON(entry.component);
  } finally {
    ProjectModel.setSaveOnModelChange(true);
  }
}

export function MathsDeployedSection({
  deployed,
  versionLabel,
  isReady,
  error,
  apiKey,
  deploymentId,
  version,
  gameName
}: MathsDeployedSectionProps) {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  /**
   * Open the Simulate view on this component, in the editor's main area.
   *
   * Only the component's IDENTITY and port contract are handed over — the slug
   * plus the payload/response examples. The script is never fetched: the platform
   * compiles its own stored copy for every chunk of the run, so there is nothing
   * here for a stale local copy to disagree with.
   */
  function simulate(entry: DeployedComponent) {
    if (!apiKey || !deploymentId) {
      setRowError('Not connected to a Server Version — select a game and version above, then try again.');
      return;
    }

    setRowError(null);
    AppRegistry.instance.openDocument(MathsSimulateDocumentProvider.ID, {
      apiKey,
      deploymentId,
      version,
      gameName,
      fn: {
        function_slug: entry.slug,
        function_name: entry.functionName,
        payload_example: entry.payloadExample,
        response_example: entry.responseExample,
        // The mapping this component was DEPLOYED with; the view defaults its
        // Bet/Win pickers to these rather than guessing.
        bet_input_port: entry.betInputPort,
        win_output_port: entry.winOutputPort
      }
    });
  }

  /**
   * Open the Compliance view on this component, in the editor's main area.
   *
   * Only the component's identity travels: its slug, plus the Server Version.
   * That pair is the whole address the platform needs — the version names the
   * game and the build, the slug names the component within it — which is why
   * this view has nothing to select. Everything a document actually contains
   * (the deployed source and its hash, the operator's registered details, the
   * market rules, the recorded play) is read on the platform, from the row
   * `rgs-fn` serves.
   */
  function compliance(entry: DeployedComponent) {
    if (!apiKey || !deploymentId) {
      setRowError('Not connected to a Server Version — select a game and version above, then try again.');
      return;
    }

    setRowError(null);
    AppRegistry.instance.openDocument(MathsComplianceDocumentProvider.ID, {
      apiKey,
      deploymentId,
      version,
      gameName,
      fn: {
        function_slug: entry.slug,
        function_name: entry.functionName
      }
    });
  }

  function openGraph(entry: DeployedComponent) {
    // Clicking the open row again closes the preview and returns to the editor.
    if (openSlug === entry.slug) {
      AppRegistry.instance.openDocument(EditorDocumentProvider.ID);
      setOpenSlug(null);
      return;
    }

    const model = modelForDeployed(entry);
    if (!model) {
      setRowError(
        `${entry.functionName} was deployed before graphs were stored, so there is nothing to preview. ` +
          'Deploy it once from Local to record one.'
      );
      return;
    }

    setRowError(null);
    AppRegistry.instance.openDocument(ComponentDiffDocumentProvider.ID, {
      component: model,
      title: `${entry.functionName} — as deployed${versionLabel ? ` (${versionLabel})` : ''}`
    });
    setOpenSlug(entry.slug);
  }

  /**
   * Drag out a backend component.
   *
   * `mathsEndpointUrl` is what turns the drop into an Aggregator on this
   * endpoint; `mathsBackendOnly` says the drag came from this tab, so a row with
   * no endpoint is refused rather than quietly dropping a local instance (see
   * DragItem in nodegrapheditor.drag).
   *
   * The ComponentModel rides along only so the drop can read the port contract
   * off it — the node that lands is an Aggregator, not this component.
   */
  function startDrag(entry: DeployedComponent) {
    const model = modelForDeployed(entry);
    if (!model) {
      setRowError(
        `${entry.functionName} has no stored graph, so its ports cannot be read. ` +
          'Deploy it once from Local, then drag it.'
      );
      return;
    }

    PopupLayer.instance.startDragging({
      label: entry.functionName,
      type: 'component',
      component: model,
      mathsEndpointUrl: entry.url,
      mathsBackendOnly: true
    });
  }

  if (error) {
    return (
      <Section hasGutter variant={SectionVariant.PanelShy}>
        <Label>{error}</Label>
      </Section>
    );
  }

  if (!isReady) {
    return (
      <Section hasGutter variant={SectionVariant.PanelShy}>
        <Label>Select a game and a Server Version to see what is deployed.</Label>
      </Section>
    );
  }

  if (deployed.length === 0) {
    return (
      <Section hasGutter variant={SectionVariant.PanelShy}>
        <Label>Nothing deployed in this version yet. Author in Local, then Deploy.</Label>
      </Section>
    );
  }

  const rows = deployed.slice().sort((a, b) => a.functionName.localeCompare(b.functionName));

  return (
    <VStack>
      <Section hasGutter variant={SectionVariant.PanelShy}>
        <Label>
          {rows.length} live component{rows.length === 1 ? '' : 's'}
          {versionLabel ? ` · ${versionLabel}` : ''} · read-only
        </Label>
      </Section>

      {rowError && (
        <Section hasGutter variant={SectionVariant.PanelShy}>
          <Label>{rowError}</Label>
        </Section>
      )}

      {rows.map((entry) => (
        <div
          key={entry.slug}
          title={`${entry.slug} — drag in to call it on RGS`}
          style={{ display: 'flex', alignItems: 'center' }}
          // Same press-then-move gesture the components tree uses; PopupLayer's
          // drag layer is what the node graph listens to, not HTML5 drag events.
          onMouseDown={(ev) => {
            if (ev.button !== 0) return;
            const start = { x: ev.clientX, y: ev.clientY };
            const move = (e: MouseEvent) => {
              if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) < 4) return;
              cleanup();
              startDrag(entry);
            };
            const cleanup = () => {
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', cleanup);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', cleanup);
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <ListItem
              text={entry.functionName}
              icon={IconName.CloudUpload}
              variant={ListItemVariant.Default}
              isActive={openSlug === entry.slug}
              onClick={() => openGraph(entry)}
            />
          </div>
          {/* The menu must not start a drag: a press here is a click on the row's
              actions, and the mousedown handler above is on the shared parent. */}
          <div
            style={{ flexShrink: 0, paddingRight: '4px' }}
            onMouseDown={(ev) => ev.stopPropagation()}
          >
            <ContextMenu
              size={IconSize.Tiny}
              menuItems={[
                {
                  label: 'Simulate',
                  icon: IconName.Play,
                  onClick: () => simulate(entry)
                },
                {
                  label: 'Compliance',
                  icon: IconName.File,
                  onClick: () => compliance(entry)
                }
              ]}
            />
          </div>
        </div>
      ))}
    </VStack>
  );
}

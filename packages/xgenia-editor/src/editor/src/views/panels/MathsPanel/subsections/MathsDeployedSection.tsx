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
// Two things a row does:
//   * click — opens the graph AS DEPLOYED, in the read-only node-graph view. This
//     is the component's stored `project_json`, the graph its author wrote, not
//     the flattened script that executes.
//   * drag  — drops a BACKEND component: an Aggregator already pointed at this
//     component's live `/rgs-fn/<game>/<slug>` endpoint. Dragging the same
//     component out of Local drops the local instance instead, whose maths runs
//     in the browser. That difference is why both tabs exist.

import React, { useState } from 'react';

import { AppRegistry } from '@xgenia-models/app_registry';
import { ComponentModel } from '@xgenia-models/componentmodel';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { DeployedComponent } from '@xgenia-utils/rgs/mathsComponentStatus';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { ListItem, ListItemVariant } from '@xgenia-core-ui/components/layout/ListItem';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Section, SectionVariant } from '@xgenia-core-ui/components/sidebar/Section';
import { Label } from '@xgenia-core-ui/components/typography/Label';

import { ComponentDiffDocumentProvider } from '../../../documents/ComponentDiffDocument';
import { EditorDocumentProvider } from '../../../documents/EditorDocument';
import PopupLayer from '../../../popuplayer';

export interface MathsDeployedSectionProps {
  deployed: DeployedComponent[];
  /** "v3 · simple-adder" — which Server Version these came from. */
  versionLabel?: string | null;
  /** False when there is no game / Server Version selected yet. */
  isReady: boolean;
  error?: string | null;
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

export function MathsDeployedSection({ deployed, versionLabel, isReady, error }: MathsDeployedSectionProps) {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

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
          <ListItem
            text={entry.functionName}
            icon={IconName.CloudUpload}
            variant={ListItemVariant.Default}
            isActive={openSlug === entry.slug}
            onClick={() => openGraph(entry)}
          />
        </div>
      ))}
    </VStack>
  );
}

// "Changed" — the Maths Components panel's working-copy view.
//
// Source Control's Changes list, for Math Components: every component whose graph
// differs from the version deployed in the selected Server Version, plus the ones
// added since and the ones deployed but no longer in the tree. What is NOT here
// is the point of it — a component that matches its deployment has nothing to say
// and does not appear.
//
// Two things a row does:
//   * click  — opens the same side-by-side graph diff the Version Control panel
//     opens for a git change, deployed on one side and local on the other.
//   * drag   — drops the LOCAL component instance, edits included, whose maths
//     runs in the browser. Dragging the same component from Deployed drops an
//     Aggregator calling the deployed version instead. That is the whole
//     distinction between the two lists: this one gives you what you are working
//     on, that one gives you what is live.

import React, { useState } from 'react';

import { FeedbackType } from '@xgenia-constants/FeedbackType';
import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import { AppRegistry } from '@xgenia-models/app_registry';
import { ComponentModel } from '@xgenia-models/componentmodel';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { MathsComponentStatus, MathsStatus } from '@xgenia-utils/rgs/mathsComponentStatus';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { ListItem, ListItemVariant } from '@xgenia-core-ui/components/layout/ListItem';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Section, SectionVariant } from '@xgenia-core-ui/components/sidebar/Section';
import { Label } from '@xgenia-core-ui/components/typography/Label';

import { ComponentDiffDocumentProvider } from '../../../documents/ComponentDiffDocument';
import { EditorDocumentProvider } from '../../../documents/EditorDocument';
import PopupLayer from '../../../popuplayer';

export interface MathsChangedSectionProps {
  status: MathsStatus;
  /** False when there is no game / Server Version to compare against yet. */
  isReady: boolean;
  /** Shown in place of the list when the panel could not read the platform. */
  error?: string | null;
}

/** git's status letters, and what each one means against the platform. */
function iconFor(entry: MathsComponentStatus): { icon: IconName; iconVariant?: FeedbackType; hint: string } {
  switch (entry.kind) {
    case 'added':
      return { icon: IconName.Plus, iconVariant: FeedbackType.Success, hint: 'Not deployed yet' };
    case 'deleted':
      return {
        icon: IconName.Minus,
        iconVariant: FeedbackType.Danger,
        hint: 'Deployed, but gone from the project — still live on RGS'
      };
    case 'modified':
    default:
      return {
        icon: IconName.DotsThreeHorizontal,
        iconVariant: FeedbackType.Notice,
        // A component deployed before graphs were stored cannot be compared, so it
        // is listed rather than assumed to match. Deploying once fixes it for good.
        hint: entry.comparable
          ? 'Deployed, with local edits'
          : 'Deployed without a stored graph — deploy once to record one'
      };
  }
}

export function MathsChangedSection({ status, isReady, error }: MathsChangedSectionProps) {
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  /**
   * Show one component's changes as an annotated graph.
   *
   * `diffProject` already built exactly what ComponentDiffDocument renders — the
   * component's nodes and connections carrying 'Created' / 'Changed' / 'Deleted'
   * and their previous values — so this only has to turn that JSON into a model
   * and open it.
   */
  function openDiff(entry: MathsComponentStatus) {
    if (openSlug === entry.slug) {
      AppRegistry.instance.openDocument(EditorDocumentProvider.ID);
      setOpenSlug(null);
      return;
    }

    const annotated = status.annotatedBySlug.get(entry.slug);
    if (!annotated) {
      // Nothing to draw a before-and-after from: added (no "before"), or deployed
      // without a stored graph. Show the side that does exist — the local
      // component, or for a deleted one the graph still held on the platform.
      if (entry.componentName) {
        openComponent(entry);
      } else {
        openDeployedSnapshot(entry);
      }
      return;
    }

    // ComponentModel.fromJSON fires the global Model.* events, which the project
    // treats as edits and saves on — and a save re-runs the diff that produced
    // this very object. Same guard the Version Control panel's DiffList uses.
    ProjectModel.setSaveOnModelChange(false);
    const componentModel = ComponentModel.fromJSON(annotated);
    ProjectModel.setSaveOnModelChange(true);

    AppRegistry.instance.openDocument(ComponentDiffDocumentProvider.ID, {
      component: componentModel,
      title: `${entry.displayName} — deployed vs local`
    });
    setOpenSlug(entry.slug);
  }

  /**
   * A deleted row has no local component left, but the platform still holds the
   * graph it was deployed from — which is exactly what someone asking "what did I
   * delete?" wants to see. Read-only, from the status we already fetched.
   */
  function openDeployedSnapshot(entry: MathsComponentStatus) {
    const componentJson = status.deployedBySlug.get(entry.slug)?.component;
    if (!componentJson) return;

    ProjectModel.setSaveOnModelChange(false);
    const componentModel = ComponentModel.fromJSON(componentJson);
    ProjectModel.setSaveOnModelChange(true);

    AppRegistry.instance.openDocument(ComponentDiffDocumentProvider.ID, {
      component: componentModel,
      title: `${entry.displayName} — as deployed`
    });
    setOpenSlug(entry.slug);
  }

  /** Fallback for rows with nothing to diff: just open the component's graph. */
  function openComponent(entry: MathsComponentStatus) {
    const component = entry.componentName
      ? ProjectModel.instance?.getComponentWithName?.(entry.componentName)
      : null;
    if (!component) return;
    AppRegistry.instance.openDocument(EditorDocumentProvider.ID);
    NodeGraphContextTmp?.switchToComponent?.(component, { pushHistory: true });
  }

  /**
   * Drag a local component into a graph.
   *
   * No `mathsEndpointUrl` on the payload, deliberately: that field is what turns a
   * drop into an Aggregator calling RGS, and this list is the working copy. What
   * drops here is the component itself, running the edits that made it appear in
   * this list in the first place.
   */
  function startDrag(entry: MathsComponentStatus) {
    if (!entry.componentName) return; // deleted: nothing local left to drag
    const component = ProjectModel.instance?.getComponentWithName?.(entry.componentName);
    if (!component) return;

    PopupLayer.instance.startDragging({
      label: entry.displayName,
      type: 'component',
      component
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
        <Label>Select a game and a Server Version to see what has changed.</Label>
      </Section>
    );
  }

  if (status.changed.length === 0) {
    return (
      <Section hasGutter variant={SectionVariant.PanelShy}>
        <Label>No changes — every component matches what is deployed.</Label>
      </Section>
    );
  }

  return (
    <VStack>
      {status.changed.map((entry) => {
        const { icon, iconVariant, hint } = iconFor(entry);
        return (
          <div
            key={entry.slug}
            title={`${hint} · ${entry.slug}`}
            // Same gesture the components tree uses: press, move, and the drag
            // begins. onMouseMove rather than HTML5 drag events because
            // PopupLayer's drag layer is what the node graph listens to.
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
              text={entry.displayName}
              icon={icon}
              iconVariant={iconVariant}
              variant={ListItemVariant.Default}
              isActive={openSlug === entry.slug}
              onClick={() => openDiff(entry)}
            />
          </div>
        );
      })}
    </VStack>
  );
}

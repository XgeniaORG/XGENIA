// "Changed" — what Local has that the platform does not.
//
// Source Control's Changes list, for Math Components: every component in LOCAL
// whose graph differs from the version deployed in the selected Server Version,
// plus the ones added since and the ones deployed but no longer in the tree. What
// is NOT here is the point of it — a component that matches its deployment has
// nothing to say and does not appear.
//
// Read-only, and deliberately NOT draggable. It is a report about two other
// tabs, not a third source of components: what it lists is Local's components, so
// dragging one from here would be an alias for dragging it from Local, and a
// second way to do the same thing is a way to get it wrong. Drag the local form
// from Local and the backend form from Deployed.
//
// Clicking a row opens the same side-by-side graph diff the Version Control panel
// opens for a git change — deployed on one side, local on the other.

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
      <Section hasGutter variant={SectionVariant.PanelShy}>
        <Label>
          {status.changed.length} change{status.changed.length === 1 ? '' : 's'} vs the deployed version ·
          preview only
        </Label>
      </Section>

      {status.changed.map((entry) => {
        const { icon, iconVariant, hint } = iconFor(entry);
        return (
          <ListItem
            key={entry.slug}
            text={entry.displayName}
            icon={icon}
            iconVariant={iconVariant}
            variant={ListItemVariant.Default}
            isActive={openSlug === entry.slug}
            onClick={() => openDiff(entry)}
            affix={
              <span style={{ fontSize: '10px', color: '#666', whiteSpace: 'nowrap' }} title={`${hint} · ${entry.slug}`}>
                {entry.kind === 'added' ? 'new' : entry.kind === 'deleted' ? 'removed' : 'edited'}
              </span>
            }
          />
        );
      })}
    </VStack>
  );
}

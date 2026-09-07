// "Commits" — the Maths Components panel's history view.
//
// Source Control's Commits list, for Math Components: one row per Deploy press
// into this Server Version, expandable to the components it pushed. Deliberately
// NOT draggable — a commit is a record of the past, and dropping a superseded
// version of a component into a live graph would be a way to ship yesterday's
// maths by accident. Dragging is what Deployed and Changed are for.
//
// The rows come from the platform (`list-component-commits`), which returns the
// entries without their bodies. Opening a component fetches that one snapshot
// (`download-component-commit`) and shows its graph read-only, so what a commit
// contained is inspectable without being loadable over the working copy.

import React, { useEffect, useState } from 'react';

import { FeedbackType } from '@xgenia-constants/FeedbackType';
import { AppRegistry } from '@xgenia-models/app_registry';
import { ComponentModel } from '@xgenia-models/componentmodel';
import { ProjectModel } from '@xgenia-models/projectmodel';
import {
  CommitChangeKind,
  CommitFileSummary,
  ComponentCommit,
  downloadComponentCommit,
  shortCommitId
} from '@xgenia-utils/rgs/componentCommits';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { ListItem, ListItemVariant } from '@xgenia-core-ui/components/layout/ListItem';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Section, SectionVariant } from '@xgenia-core-ui/components/sidebar/Section';
import { Label } from '@xgenia-core-ui/components/typography/Label';

import { ComponentDiffDocumentProvider } from '../../../documents/ComponentDiffDocument';

export interface MathsCommitsSectionProps {
  commits: ComponentCommit[];
  isLoading: boolean;
  error?: string | null;
  /** Needed to fetch a snapshot when a component inside a commit is opened. */
  apiKey?: string;
}

function iconFor(kind: CommitChangeKind): { icon: IconName; iconVariant: FeedbackType } {
  switch (kind) {
    case 'added':
      return { icon: IconName.Plus, iconVariant: FeedbackType.Success };
    case 'deleted':
      return { icon: IconName.Minus, iconVariant: FeedbackType.Danger };
    case 'modified':
    default:
      return { icon: IconName.DotsThreeHorizontal, iconVariant: FeedbackType.Notice };
  }
}

/** "2h ago" / "3d ago" — a commit list is read by recency, not by date. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function MathsCommitsSection({ commits, isLoading, error, apiKey }: MathsCommitsSectionProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openingSlug, setOpeningSlug] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // A history that changed under us (a deploy happened) should not keep rows
  // expanded that may no longer exist.
  useEffect(() => {
    setExpanded((prev) => new Set(Array.from(prev).filter((id) => commits.some((c) => c.id === id))));
  }, [commits]);

  function toggle(commitId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(commitId)) next.delete(commitId);
      else next.add(commitId);
      return next;
    });
  }

  /**
   * Show one component as it was at this commit.
   *
   * Read-only, and never merged into the project: ComponentDiffDocument renders a
   * graph without offering to load it, which is the right affordance for history.
   * The snapshot's own `project_json` holds the component under its authored name,
   * so what opens is the graph the author saw, not the flattened script.
   */
  async function openSnapshot(commit: ComponentCommit, file: CommitFileSummary) {
    if (!apiKey || file.change_kind === 'deleted') return;
    const key = `${commit.id}:${file.function_slug}`;
    setOpeningSlug(key);
    setOpenError(null);
    try {
      const { files } = await downloadComponentCommit(apiKey, commit.id, file.function_slug);
      const snapshot = files[0];
      const componentJson = (snapshot?.project_json?.components || [])[0];
      if (!componentJson) {
        setOpenError(`${file.function_name || file.function_slug} has no stored graph in this commit.`);
        return;
      }

      // Same guard the Version Control panel uses: building a ComponentModel fires
      // the global Model.* events, which the project treats as edits and saves on.
      ProjectModel.setSaveOnModelChange(false);
      const componentModel = ComponentModel.fromJSON(componentJson);
      ProjectModel.setSaveOnModelChange(true);

      AppRegistry.instance.openDocument(ComponentDiffDocumentProvider.ID, {
        component: componentModel,
        title: `${file.function_name || file.function_slug} — ${shortCommitId(commit.id)}`
      });
    } catch (e: any) {
      setOpenError(e?.message || 'Could not open that snapshot');
    } finally {
      setOpeningSlug(null);
    }
  }

  if (error) {
    return (
      <Section hasGutter variant={SectionVariant.PanelShy}>
        <Label>{error}</Label>
      </Section>
    );
  }

  if (isLoading && commits.length === 0) {
    return (
      <Section hasGutter variant={SectionVariant.PanelShy}>
        <Label>Loading history…</Label>
      </Section>
    );
  }

  if (commits.length === 0) {
    return (
      <Section hasGutter variant={SectionVariant.PanelShy}>
        <Label>No commits yet. Deploying records one.</Label>
      </Section>
    );
  }

  return (
    <VStack>
      {openError && (
        <Section hasGutter variant={SectionVariant.PanelShy}>
          <Label>{openError}</Label>
        </Section>
      )}
      {commits.map((commit) => {
        const isOpen = expanded.has(commit.id);
        const files = commit.files || [];
        return (
          <div key={commit.id}>
            <ListItem
              text={commit.message}
              icon={isOpen ? IconName.CaretDown : IconName.CaretRight}
              variant={ListItemVariant.Default}
              onClick={() => toggle(commit.id)}
              affix={
                <span style={{ fontSize: '10px', color: '#777', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {shortCommitId(commit.id)} · {relativeTime(commit.created_at)}
                </span>
              }
            />
            {isOpen && (
              <div style={{ paddingLeft: '18px' }}>
                {commit.author && (
                  <div style={{ fontSize: '10px', color: '#777', padding: '2px 0 4px 10px' }}>
                    by {commit.author}
                  </div>
                )}
                {files.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#777', padding: '2px 0 6px 10px' }}>
                    No components recorded.
                  </div>
                )}
                {files.map((file) => {
                  const { icon, iconVariant } = iconFor(file.change_kind);
                  const key = `${commit.id}:${file.function_slug}`;
                  return (
                    <ListItem
                      key={file.function_slug}
                      text={file.function_name || file.function_slug}
                      icon={icon}
                      iconVariant={iconVariant}
                      variant={ListItemVariant.Default}
                      isDisabled={file.change_kind === 'deleted'}
                      isActive={openingSlug === key}
                      onClick={() => openSnapshot(commit, file)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </VStack>
  );
}

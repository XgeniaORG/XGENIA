import React, { useCallback, useEffect, useState } from 'react';
import { MergeConflictItem, readBlob, readConflicts, settleConflict } from '@xgenia/git';
import { DiffType, Image, IImageDiff } from '@xgenia/git/src/core/models/diff-data';

import { PrimaryButton, PrimaryButtonSize, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { VStack, HStack } from '@xgenia-core-ui/components/layout/Stack';
import { Section } from '@xgenia-core-ui/components/sidebar/Section';
import { Label } from '@xgenia-core-ui/components/typography/Label';
import { Text, TextType } from '@xgenia-core-ui/components/typography/Text';

import { conflictPreviewFor } from '../../../../utils/extensions/conflictPreviews';
import { ImageDiffDialog } from '../../../documents/ComponentDiffDocument/ImageDiffDialog';
import { ConflictSide, conflictRows, settleAndReload } from './conflictListModel';

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp'
};

function toImage(buffer: Buffer, path: string): Image {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return new Image(buffer.toString('base64'), MEDIA_TYPES[ext] ?? 'application/octet-stream', buffer.length);
}

/** Mine = the file on disk, theirs = the blob recorded with the item. Either may be missing. */
async function loadImageDiff(repoDir: string, item: MergeConflictItem): Promise<IImageDiff> {
  const { promises: fs } = await import('fs');
  const nodePath = await import('path');
  let ours: Image | undefined;
  try {
    ours = toImage(await fs.readFile(nodePath.join(repoDir, item.path)), item.path);
  } catch {
    ours = undefined;
  }
  let theirs: Image | undefined;
  if (item.theirsBlob) {
    try {
      theirs = toImage(await readBlob(repoDir, item.theirsBlob), item.path);
    } catch {
      theirs = undefined;
    }
  }
  // The dialog shows "Previous" (mine) beside "Current" (theirs).
  return { kind: DiffType.Image, original: ours, modified: theirs };
}

/** The listed conflicts of a repository; reloads whenever `reloadKey` changes. */
export function useListedConflicts(repoDir: string | null | undefined, reloadKey?: unknown) {
  const [items, setItems] = useState<MergeConflictItem[]>([]);
  const reload = useCallback(async () => {
    setItems(repoDir ? await readConflicts(repoDir) : []);
  }, [repoDir]);
  useEffect(() => {
    reload();
  }, [reload, reloadKey]);
  return { items, setItems, reload };
}

export interface ConflictListProps {
  repoDir: string;
  items: MergeConflictItem[];
  onChange: (items: MergeConflictItem[]) => void;
}

export function ConflictList({ repoDir, items, onChange }: ConflictListProps) {
  const [imageDiff, setImageDiff] = useState<IImageDiff | null>(null);
  if (items.length === 0) return null;

  const settle = async (item: MergeConflictItem, side: ConflictSide) => {
    onChange(await settleAndReload(repoDir, item, side, { settle: settleConflict, read: readConflicts }));
  };

  return (
    <VStack>
      <Section hasVisibleOverflow hasGutter>
        <Label>Conflicts</Label>
        <Text textType={TextType.Shy}>Choose which version to keep. You can commit once all are settled.</Text>
      </Section>
      {conflictRows(items).map((row) => {
        const Preview = conflictPreviewFor(row.previewKind);
        return (
          <Section key={row.key} hasVisibleOverflow hasGutter>
            <Text hasBottomSpacing>{row.label}</Text>
            {Preview && <Preview item={row.item} repoDir={repoDir} />}
            {row.isImage && (
              <PrimaryButton
                label="Compare"
                size={PrimaryButtonSize.Small}
                variant={PrimaryButtonVariant.Muted}
                isGrowing
                onClick={async () => setImageDiff(await loadImageDiff(repoDir, row.item))}
              />
            )}
            <HStack hasSpacing={1}>
              {row.actions.map((a) => (
                <PrimaryButton
                  key={a.side}
                  label={a.label}
                  size={PrimaryButtonSize.Small}
                  isGrowing
                  onClick={() => settle(row.item, a.side)}
                />
              ))}
            </HStack>
          </Section>
        );
      })}
      {imageDiff && <ImageDiffDialog diff={imageDiff} onClose={() => setImageDiff(null)} />}
    </VStack>
  );
}

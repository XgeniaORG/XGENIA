import { ipcRenderer } from 'electron';
import React, { RefObject, useState } from 'react';

import { Keybindings } from '@xgenia-constants/Keybindings';
import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { MenuDialog, MenuDialogWidth } from '@xgenia-core-ui/components/popups/MenuDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';

export type OverflowLayout = 'vertical' | 'horizontal' | 'detachedPreview';

export interface OverflowMenuProps {
  documentLayout: string;
  setDocumentLayout: (l: OverflowLayout) => void;
  onImport: () => void;
  anchorRef: RefObject<HTMLDivElement>;
}

/**
 * The ⋯ button: everything that used to sit as its own icon in the bar (the three
 * workspace layouts, dev tools, design import) collapsed into one menu.
 *
 * `anchorRef` lands on this component's own wrapping div rather than on the button,
 * because FigmaImportDialog is anchored to the same element — the caller keeps the ref
 * so it can position the import dialog under the ⋯ button too.
 */
export function OverflowMenu({ documentLayout, setDocumentLayout, onImport, anchorRef }: OverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Layout-only inline style on the wrapper: Tooltip renders its trigger as a block,
  // which would knock the button off the bar's centre line. Task 8 creates no
  // OverflowMenu.module.scss, so there is nowhere else to put three layout rules.
  return (
    <div ref={anchorRef} style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
      <Tooltip content="More">
        <IconButton
          icon={IconName.DotsThreeHorizontal}
          variant={IconButtonVariant.Transparent}
          size={IconSize.Small}
          onClick={() => setIsOpen((open) => !open)}
        />
      </Tooltip>

      <MenuDialog
        title="Workspace"
        width={MenuDialogWidth.Medium}
        isVisible={isOpen}
        onClose={() => setIsOpen(false)}
        triggerRef={anchorRef}
        items={[
          {
            label: 'Split vertically',
            icon: IconName.VerticalSplit,
            isHighlighted: documentLayout === 'vertical',
            onClick: () => setDocumentLayout('vertical')
          },
          {
            label: 'Split horizontally',
            icon: IconName.HorizontalSplit,
            isHighlighted: documentLayout === 'horizontal',
            onClick: () => setDocumentLayout('horizontal')
          },
          {
            label: 'Detach preview',
            // MenuDialog's `endSlot` renders UNDER the label (it adds bottom spacing to
            // the label row), so it is a subtitle slot, not a right-aligned hint. Used
            // consistently on every item that has a shortcut, a stacked shortcut reads
            // as deliberate; used on one item only it reads as a layout bug.
            endSlot: Keybindings.DETACH_PREVIEW.label,
            icon: IconName.Cards,
            isHighlighted: documentLayout === 'detachedPreview',
            onClick: () => {
              setDocumentLayout('detachedPreview');
              ipcRenderer.send('viewer-focus');
            }
          },
          'divider',
          {
            label: 'Open dev tools',
            icon: IconName.Bug,
            endSlot: Keybindings.OPEN_DEVTOOLS.label,
            onClick: () => EventDispatcher.instance.emit('viewer-open-devtools')
          },
          {
            label: 'Import design (HTML / Figma)…',
            icon: IconName.ImportDown,
            onClick: onImport
          }
        ]}
      />
    </div>
  );
}

import React from 'react';

import { UndoQueue } from '@xgenia-models/undo-queue-model';

import { useModel } from '@xgenia-hooks/useModel';
import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { ExperimentalFlag } from '@xgenia-core-ui/components/sidebar/ExperimentalFlag';

export function UndoQueuePanel({}) {
  const undoQueue = useModel(UndoQueue.instance, ['undoHistoryChanged', 'undo', 'redo']);

  const historyLocation = undoQueue.getHistoryLocation();
  const history = [...undoQueue.getHistory()].reverse();

  return (
    <BasePanel title="History">
      <ExperimentalFlag />

      <Container hasXSpacing hasYSpacing direction={ContainerDirection.Vertical}>
        {history.map((item, index) => (
          <PrimaryButton key={index} label={item.label} isGrowing hasBottomSpacing />
        ))}
      </Container>
    </BasePanel>
  );
}

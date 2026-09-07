import React from 'react';

import { Section, SectionVariant } from '@xgenia-core-ui/components/sidebar/Section';

import { useVersionControlContext } from '../context';
import GitStashCard from './GitStashCard';

export function Stashes() {
  const { actions, fetch } = useVersionControlContext();

  const stashes = fetch.stashes;

  if (stashes.length === 0) {
    return null;
  }

  return (
    <Section title="Stashes" variant={SectionVariant.Panel} UNSAFE_style={{ flexGrow: 1 }}>
      {stashes.map((stash) => (
        <GitStashCard
          key={stash.sha}
          stash={stash}
          onApplyClick={() => actions.popStash(stash)}
          onDeleteClick={() => actions.dropStash(stash)}
        />
      ))}
    </Section>
  );
}

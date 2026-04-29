import type { SearchOptions } from '@algolia/client-search';
import algoliasearch from 'algoliasearch/lite';
import React, { useEffect, useRef, useState } from 'react';
import { platform } from '@xgenia/platform';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { PrimaryButton, PrimaryButtonSize } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { SearchInput } from '@xgenia-core-ui/components/inputs/SearchInput';
import Modal from '@xgenia-core-ui/components/layout/Modal/Modal';
import { Portal } from '@xgenia-core-ui/components/layout/Portal';
import { MenuDialog } from '@xgenia-core-ui/components/popups/MenuDialog';
import { Label, LabelSize } from '@xgenia-core-ui/components/typography/Label';
import { Text, TextType } from '@xgenia-core-ui/components/typography/Text';
import { Title, TitleSize } from '@xgenia-core-ui/components/typography/Title';

import css from './HelpCenter.module.scss';
import getDocsEndpoint from '@xgenia-utils/getDocsEndpoint';


export function HelpCenter() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [version] = useState(platform.getVersion().slice(0, 3));
  const [isDialogVisible, setIsDialogVisible] = useState(false);
  const [isSearchModalVisible, setIsSearchModalVisible] = useState(false);

  const searchClient = algoliasearch('D29X2LNM4J', '7984d5feef068e1161527316bb9a1a4d');

  const portalRoot = document.querySelector('.help-center-layer');
  const docsEndpoint = getDocsEndpoint();
  const discordInviteUrl = (process && process.env && process.env.XGENIA_DISCORD_URL) || 'https://discord.com/invite/n4P5zkpvFE';

  if (!portalRoot) return null;

  return (
    <Portal portalRoot={portalRoot}>
      <div className={css['Root']} ref={rootRef} onClick={() => setIsDialogVisible(true)}>
        <IconButton icon={IconName.QuestionFree} variant={IconButtonVariant.OpaqueOnHover} size={IconSize.Large} />
      </div>

      <Modal
        isVisible={isSearchModalVisible}
        onClose={() => setTimeout(() => setIsSearchModalVisible(false), 100)}
        title="Search Help Center"
      >
        <SearchView searchClient={searchClient} />
      </Modal>

      <MenuDialog
        triggerRef={rootRef}
        isVisible={isDialogVisible}
        onClose={() => setIsDialogVisible(false)}
        items={[
          {
            label: 'Quick search docs',
            icon: IconName.Search,
            onClick: () => {
              setIsSearchModalVisible(true);
            }
          },
          'divider',
          {
            label: 'Getting started',
            onClick: () => platform.openExternal(`${docsEndpoint}/docs/getting-started/overview`)
          },
          {
            label: 'Guides',
            onClick: () => platform.openExternal(`${docsEndpoint}/docs/learn`)
          },
          'divider',
          {
            label: 'Ask the community (Discord)',
            onClick: () => platform.openExternal(discordInviteUrl)
          },
          { label: 'Support forum', onClick: () => platform.openExternal(discordInviteUrl) },
          'divider',
          {
            label: 'Release notes',
            onClick: () => platform.openExternal(`${docsEndpoint}/whats-new/`)
          },
          { label: 'Contact support', onClick: () => platform.openExternal('mailto:support@xgenia.com') }
        ]}
      />
    </Portal>
  );
}

type SearchViewProps = { searchClient: ReturnType<typeof algoliasearch> };

function SearchView({ searchClient }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const index = searchClient.initIndex('docs_2-9');
    async function run() {
      if (!query) {
        setHits([]);
        return;
      }
      setIsSearching(true);
      try {
        const res = await index.search(query, {
          hitsPerPage: 10,
          attributesToRetrieve: ['url', 'hierarchy', 'content']
        } as SearchOptions);
        if (!cancelled) setHits(res.hits as any[]);
      } catch (e: any) {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }
    const t = setTimeout(run, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, searchClient]);

  return (
    <>
      <SearchInput value={query} onChange={(value) => setQuery(value)} isAutoFocus />

      {Boolean(query) && (
        <div className={css['ResultContainer']}>
          {hits.map((hit, i) => (
            <Hit key={hit.objectID || i} hit={hit} />
          ))}
          {!isSearching && hits.length === 0 && (
            <div className={css['SearchHit']}>
              <Text>No results found</Text>
            </div>
          )}
        </div>
      )}

      <div className={css['MessageContainer']}>
        <div className={css['Message']}>
          <Title hasBottomSpacing size={TitleSize.Large}>
            {query ? "Can't find what you're looking for?" : "Don't know what you're looking for?"}
          </Title>
          <Label>Browse our docs or reach out on Discord</Label>

          <div className={css['Buttons']}>
            <PrimaryButton label="Visit docs" href={getDocsEndpoint()} hasRightSpacing />
            <PrimaryButton label="Join our Discord" href={(process && process.env && process.env.XGENIA_DISCORD_URL) || 'https://discord.com/invite/n4P5zkpvFE'} />
          </div>
        </div>
      </div>
    </>
  );
}

type Hit = {
  url?: string;
  hierarchy?: {
    lvl0?: string;
    lvl1?: string;
    lvl2?: string;
    lvl3?: string;
    lvl4?: string;
    lvl5?: string;
    lvl6?: string;
  };
  content?: string;
  objectID?: string;
};

interface HitProps {
  hit: Hit;
}

function Hit({ hit }: HitProps) {
  return (
    <div className={css['SearchHit']}>
      <div className={css['HitTitle']}>
        <div>
          <Label size={LabelSize.Small} variant={TextType.Secondary} hasBottomSpacing>
            {hit.hierarchy.lvl1}
          </Label>
          <Title size={TitleSize.Large} hasBottomSpacing>
            {hit.hierarchy.lvl2}
            {!hit.hierarchy.lvl2 && hit.hierarchy.lvl1}
          </Title>
        </div>

        <PrimaryButton
          label="Read full docs"
          size={PrimaryButtonSize.Small}
          onClick={() => {
            platform.openExternal(hit.url);
          }}
        />
      </div>
      <Text>{hit.content}</Text>
    </div>
  );
}

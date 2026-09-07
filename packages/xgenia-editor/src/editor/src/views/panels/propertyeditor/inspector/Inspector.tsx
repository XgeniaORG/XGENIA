import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';

import { ScrollArea } from '@xgenia-core-ui/components/layout/ScrollArea';

import { VariantsEditor } from '../components/VariantStates';
import { VisualStates } from '../components/VisualStates';
import { Ports } from '../DataTypes/Ports';
import { ensureNodeTypeAdapter } from '../ensureNodeTypeAdapter';
import { ModelProxy } from '../models/modelProxy';

import { FilterBar } from './FilterBar';
import { InspectorHeader } from './InspectorHeader';
import {
  countRows,
  filterGroups,
  InspectorFilterMode,
  normalizeQuery
} from './model/inspectorFilter';
import {
  isGroupCollapsed,
  loadCollapsedGroups,
  saveCollapsedGroups,
  toggleGroup
} from './model/groupCollapse';
import { changedPortNames, describeGroups } from './model/portRowMeta';
import { ParamAuthors } from './paramAuthors';
import { PortGroup } from './PortGroup';
import { SignalsSection } from './SignalsSection';

import css from './Inspector.module.scss';

export interface InspectorProps {
  node: NodeGraphNode;
}

/**
 * The property inspector.
 *
 * React owns the list — header, search, the All/Changed filter, collapsible groups —
 * while `Ports` goes on building the port editors exactly as it always has. That split
 * is the whole design: the ~30 editor types and the rules that pick between them stay
 * in one place, and the surface around them stops being a full innerHTML rebuild on
 * every model event.
 */
export function Inspector({ node }: InspectorProps) {
  const [model] = useState(() => new ModelProxy({ model: node }));
  const [ports, setPorts] = useState<TSFixme>(null);

  /** Structural: the set of ports or their views changed. Rebuild the editors. */
  const [rebuildToken, setRebuildToken] = useState(0);
  /** Values only: rows are fine, their "is this still the default?" answer is not. */
  const [metaVersion, setMetaVersion] = useState(0);
  /** Authorship changed somewhere — repaint the AI glyphs. */
  const [, setAuthorVersion] = useState(0);

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<InspectorFilterMode>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsedGroups());
  const [isEditingVariant, setIsEditingVariant] = useState(false);

  const [rawGroups, setRawGroups] = useState<TSFixme[]>([]);

  const portsRef = useRef<TSFixme>(null);
  portsRef.current = ports;

  /** The element the legacy views' cross-row selectors resolve against. */
  const bodyRef = useRef<HTMLDivElement>(null);

  /**
   * Forces the next build to actually rebuild. `Ports` short-circuits on an unchanged
   * port hash, which is right for model events but wrong for the two changes the
   * hash cannot see: switching into variant editing and switching visual state both
   * change what `_getPorts()` returns through the proxy's mode, not through the ports.
   */
  const requestRebuild = useCallback(() => {
    if (portsRef.current) portsRef.current._portsHash = undefined;
    setRebuildToken((token) => token + 1);
  }, []);

  useEffect(() => {
    // Before the first read of the port list: a node whose ports are derived from
    // another part of the project gets a chance to refresh them.
    ensureNodeTypeAdapter(node);

    const instance = new Ports({
      model,
      headless: true,
      onChanged: () => setRebuildToken((token) => token + 1),
      onMetaChanged: () => setMetaVersion((version) => version + 1)
    });
    instance.initHeadless();
    setPorts(instance);

    return () => {
      instance.dispose();
    };
    // `node` is fixed for the life of this component — the panel is keyed on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  useEffect(() => {
    if (ports !== null && bodyRef.current !== null) ports.bindHostElement(bodyRef.current);
  }, [ports]);

  useEffect(() => ParamAuthors.subscribe(() => setAuthorVersion((version) => version + 1)), []);

  const [allPorts, setAllPorts] = useState<TSFixme[]>([]);

  useEffect(() => {
    if (ports === null) return;
    setRawGroups(ports.getViewGroupsFromPorts());
    // The port list, not just the views built from it: a popout group's ports have no
    // view of their own until the popup opens, and they still count as changed.
    setAllPorts(ports._getPorts());
  }, [ports, rebuildToken]);

  const described = useMemo(
    () => describeGroups(rawGroups, model, allPorts),
    // metaVersion is the dependency that matters here: the rows read `isDefault` and
    // `isConnected` live off the model, so a value change has to re-describe them
    // even though the view objects behind them are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawGroups, allPorts, model, metaVersion]
  );

  const counts = useMemo(() => countRows(described, query), [described, query]);
  const visibleGroups = useMemo(() => filterGroups(described, { mode, query }), [described, mode, query]);

  const changedNames = useMemo(() => changedPortNames(described, model), [described, model]);

  // The Changed filter with nothing left to show would strand the user on an empty
  // panel with no obvious way back.
  useEffect(() => {
    if (mode === 'changed' && counts.changed === 0) setMode('all');
  }, [mode, counts.changed]);

  const onToggleGroup = useCallback((groupName: string) => {
    setCollapsed((previous) => {
      const next = toggleGroup(previous, groupName);
      saveCollapsedGroups(next);
      return next;
    });
  }, []);

  const isSearching = normalizeQuery(query) !== '';
  const isFiltering = mode === 'changed';
  // A node whose ports all land in one unnamed bucket has nothing to group BY, so it
  // gets a plain list rather than a header wrapping the entire panel.
  const isSingleAnonymousGroup = described.length === 1 && described[0].name === 'Other';

  const hasAnyPorts = described.some((group) => group.rows.length > 0);

  return (
    <div className={css.Inspector} data-variant-edit={isEditingVariant || undefined}>
      {!isEditingVariant && (
        <InspectorHeader node={node} model={model} changedNames={changedNames} onChanged={requestRebuild} />
      )}

      <ScrollArea UNSAFE_style={{ flex: 1 }}>
        <div className={css.Body} ref={bodyRef}>
          {Boolean(node.type?.useVariants) && (
            <div className={css.Slot}>
              <VariantsEditor
                model={node}
                onEditVariant={() => {
                  model.setEditMode('variant');
                  setIsEditingVariant(true);
                  requestRebuild();
                }}
                onDoneEditingVariant={() => {
                  model.setEditMode('node');
                  setIsEditingVariant(false);
                  requestRebuild();
                }}
              />
            </div>
          )}

          {node.type?.visualStates !== undefined && ports !== null && (
            <div className={css.Slot}>
              <VisualStates
                model={model}
                portsView={ports}
                onVisualStateChanged={(state: TSFixme) => {
                  model.setVisualState(state.name);
                  requestRebuild();
                }}
              />
            </div>
          )}

          {hasAnyPorts && (
            <FilterBar
              query={query}
              onQueryChange={setQuery}
              mode={mode}
              onModeChange={setMode}
              counts={counts}
            />
          )}

          {!hasAnyPorts && ports !== null && (
            <p className={css.Empty}>This node has no editable properties.</p>
          )}

          {hasAnyPorts && visibleGroups.length === 0 && (
            <p className={css.Empty}>
              Nothing matches <strong>{query}</strong>.{' '}
              <button type="button" className={css.EmptyAction} onClick={() => setQuery('')}>
                Clear search
              </button>
            </p>
          )}

          {visibleGroups.map((group) => (
            <PortGroup
              key={group.name}
              group={group}
              node={node}
              hideHeader={isSingleAnonymousGroup}
              isCollapsed={
                !isSingleAnonymousGroup &&
                isGroupCollapsed(collapsed, group.name, { isSearching, isFiltering })
              }
              onToggle={isSingleAnonymousGroup ? undefined : () => onToggleGroup(group.name)}
            />
          ))}

          {!isSearching && !isFiltering && <SignalsSection model={model} node={node} />}

          {/*
            Kept, with its original global class name, because the enum editor toggles
            it by selector when a dropdown opens: it is what lets a dropdown on the
            last row be scrolled to instead of being clipped by the scroll container.
          */}
          <div
            className="property-drop-down-padding"
            style={{ position: 'relative', height: '200px', visibility: 'hidden', width: '100%', display: 'none' }}
          />
        </div>
      </ScrollArea>
    </div>
  );
}

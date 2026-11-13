// The web-plugin panel is a full-window layer. It is mounted inside LeftPanelCard, whose z-index makes a
// stacking context; rendered there, the node inspector (a later sibling layer) covered the plugin's right
// side. It must render straight into document.body.
//   npx tsx --test --test-force-exit packages/xgenia-editor/tests/entitlements/webPluginPanelLayer.test.tsx (the panel starts its entitlement retry timers)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="card" style="position:relative;z-index:10"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
const g = globalThis as any;
g.window = dom.window; g.document = dom.window.document; g.navigator = dom.window.navigator;
g.HTMLElement = dom.window.HTMLElement; g.sessionStorage = dom.window.sessionStorage; g.localStorage = dom.window.localStorage; g.Node = dom.window.Node; g.MutationObserver = dom.window.MutationObserver;
g.IS_REACT_ACT_ENVIRONMENT = true;

test('the panel renders into document.body, not inside the card that mounts it', async () => {
    const React = (await import('react')).default;
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { WebPluginPanel } = await import('../../src/editor/src/views/panels/WebPluginPanel/WebPluginPanel');
    const card = document.getElementById('card')!;
    const root = createRoot(card);
    await act(async () => { root.render(React.createElement(WebPluginPanel, { pluginId: 'character-studio' })); });
    assert.equal(card.childElementCount, 0, 'nothing is rendered inside the mounting card');
    const layer = [...document.body.children].find((el) => el.id !== 'card') as HTMLElement | undefined;
    assert.ok(layer, 'the panel layer is a direct child of body');
    assert.equal(layer!.style.position, 'fixed');
    await act(async () => { root.unmount(); });
    assert.equal(document.body.children.length, 1, 'unmounting removes the layer');
});

// (2026-10-16) The portal escapes PanelHost's `display: none`, so switching to another panel (or closing
// the card) left Character Studio over the whole editor. The layer follows PanelActiveContext instead.
test('the layer hides while its panel is off screen and comes back with the same frame', async () => {
    const React = (await import('react')).default;
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { WebPluginPanel } = await import('../../src/editor/src/views/panels/WebPluginPanel/WebPluginPanel');
    const { PanelActiveContext } = await import('../../src/editor/src/views/panels/panelActive');
    const card = document.getElementById('card')!;
    const root = createRoot(card);
    const render = (active: boolean) =>
        root.render(React.createElement(PanelActiveContext.Provider, { value: active }, React.createElement(WebPluginPanel, { pluginId: 'character-studio' })));
    const layer = () => [...document.body.children].find((el) => el.id !== 'card') as HTMLElement | undefined;

    await act(async () => { render(true); });
    const shown = layer();
    assert.ok(shown, 'the layer is mounted');
    assert.notEqual(shown!.style.display, 'none', 'visible while its panel is on screen');

    await act(async () => { render(false); });
    assert.equal(layer(), shown, 'still the same element: the plugin keeps its state while hidden');
    assert.equal(layer()!.style.display, 'none', 'hidden while another panel is on screen');

    await act(async () => { render(true); });
    assert.notEqual(layer()!.style.display, 'none', 'visible again when switched back');
    await act(async () => { root.unmount(); });
});

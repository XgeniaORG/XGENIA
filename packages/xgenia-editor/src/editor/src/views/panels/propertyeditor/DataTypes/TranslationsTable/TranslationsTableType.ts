import React from 'react';
import { createRoot } from 'react-dom/client';

import { TypeView } from '../../TypeView';
import { getEditType } from '../../utils';
import { TranslationsTable, TranslationsTableProps } from './TranslationsTable';
import { TranslationsTableProperty } from './TranslationsTableProperty';

/**
 * Property panel view for the Languages Dictionary's `translations-table` port.
 *
 * The property row is a single "Open Table" button (the same shape as the Script
 * property's Edit button); the table itself lives in a popout, so a dictionary of
 * any width has room without squeezing the panel.
 *
 * Edits are written to the parameter as they are typed, without undo entries —
 * one keystroke per undo step would bury everything else in the history. Closing
 * the popout registers ONE undo entry covering the whole editing session.
 */
export class TranslationsTableType extends TypeView {
  el: TSFixme;

  propertyDiv: HTMLDivElement;
  propertyRoot: ReturnType<typeof createRoot> | null = null;

  popoutDiv: HTMLDivElement;
  popoutRoot: ReturnType<typeof createRoot> | null = null;

  /** Parameter value when the popout was opened, for the single undo entry. */
  valueOnOpen: unknown;

  static fromPort(args: TSFixme): TSFixme {
    const view = new TranslationsTableType();

    const p = args.port;
    const parent = args.parent;

    view.port = p;
    view.displayName = p.displayName ? p.displayName : p.name;
    view.name = p.name;
    view.type = getEditType(p);
    view.group = p.group;
    view.parent = parent;
    view.value = parent.model.getParameter(p.name);
    view.default = p.default;
    view.tooltip = p.tooltip;
    view.isConnected = parent.model.isPortConnected(p.name, 'target');
    view.isDefault = parent.model.parameters[p.name] === undefined;

    return view;
  }

  dispose(): void {
    this.disposePopout();

    if (this.propertyRoot) {
      this.propertyRoot.unmount();
      this.propertyRoot = null;
    }
  }

  disposePopout(): void {
    if (this.popoutRoot) {
      this.popoutRoot.unmount();
      this.popoutRoot = null;
    }
  }

  render(): TSFixme {
    this.el = this.bindView($(`<div></div>`), this);
    super.render();

    this.propertyDiv = document.createElement('div');
    this.propertyRoot = createRoot(this.propertyDiv);
    this.propertyRoot.render(
      React.createElement(TranslationsTableProperty, {
        displayName: this.displayName || 'Dictionary',
        tooltip: this.tooltip,
        onClick: (event) => this.onOpenClicked(event.currentTarget, event)
      })
    );

    return this.propertyDiv;
  }

  onOpenClicked(el: EventTarget & HTMLElement, event: React.MouseEvent): void {
    // Without this the click keeps travelling to the popup layer, which reads it
    // as a click outside and closes the popout as soon as it opens.
    event.stopPropagation();

    this.parent.hidePopout();

    // The parameter is undefined until it is edited, in which case the port's
    // default (the starter table) is what the node is running with.
    const current = this.parent.model.getParameter(this.name);
    this.value = current === undefined ? this.default : current;
    this.valueOnOpen = current;

    this.popoutDiv = document.createElement('div');

    // The popup layer re-anchors a popout to its property row whenever the
    // content resizes. That is right until the user drags or resizes the table
    // themselves — from then on the panel must stay where they put it, and this
    // flag (read by the layer's resize observer on every callback) is how that is
    // turned off.
    const popoutArgs: TSFixme = {
      content: { el: [this.popoutDiv] },
      attachTo: $(el),
      position: 'left',
      disableDynamicPositioning: false,
      onClose: () => {
        if (this.value !== this.valueOnOpen) {
          this.parent.setParameterEx(this.name, this.value, this.valueOnOpen, false);
        }
        this.disposePopout();
      }
    };

    const props: TranslationsTableProps = {
      value: this.value,
      onChange: (value: string) => {
        this.value = value;
        this.isDefault = false;
        // No undo entry per keystroke — the session gets one on close.
        this.parent.setParameterEx(this.name, value, undefined, true);
      },
      onFreezePosition: () => {
        popoutArgs.disableDynamicPositioning = true;
      },
      onClose: () => this.parent.hidePopout()
    };

    this.popoutRoot = createRoot(this.popoutDiv);
    this.popoutRoot.render(React.createElement(TranslationsTable, props));

    this.parent.showPopout(popoutArgs);
  }
}

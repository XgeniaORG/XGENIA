import React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { NodeLibrary } from '@xgenia-models/nodelibrary';
import { StylesModel } from '@xgenia-models/StylesModel';
import { UndoQueue, UndoActionGroup } from '@xgenia-models/undo-queue-model';

import { EventDispatcher } from '../../../../../../shared/utils/EventDispatcher';
import TextStylePicker from '../../../TextStylePicker/TextStylePicker';
import { TypeView } from '../TypeView';
import { getEditType } from '../utils';

function firstType(type) {
    return NodeLibrary.nameForPortType(type);
}

export class TextStyleType extends TypeView {
    el: TSFixme;
    textStylePickerRoot: Root | null = null;
    textStylePickerDiv: HTMLDivElement | null = null;

    static fromPort(args) {
        const view = new TextStyleType();

        const p = args.port;
        const parent = args.parent;

        view.port = p;
        view.displayName = p.displayName ? p.displayName : p.name;
        view.name = p.name;
        view.type = getEditType(p);
        view.group = p.group;
        view.value = parent.model.getParameter(p.name);
        view.parent = parent;
        view.isConnected = parent.model.isPortConnected(p.name, 'target');
        view.isDefault = parent.model.parameters[p.name] === undefined;

        return view;
    }

    dispose() {
        TypeView.prototype.dispose.call(this);
        EventDispatcher.instance.off(this);

        if (this.textStylePickerRoot) {
            this.textStylePickerRoot.unmount();
            this.textStylePickerRoot = null;
        }
    }

    render() {
        this.el = this.bindView(this.parent.cloneTemplate(firstType(this.type)), this);
        TypeView.prototype.render.call(this);

        EventDispatcher.instance.on(
            'Model.stylesChanged',
            (event) => {
                if (event.args.type === 'text') {
                    this.resetToDefault();
                }
            },
            this
        );

        const props = {};

        this.$('input').on('focus', (e) => {
            e.stopPropagation();
        });

        this.$('input').on('click', (e) => {
            // Reset filter before opening
            const newProps = { ...props, filter: undefined };
            const newStyleProps = {};

            if (this.port.type.childPorts) {
                const prefix = this.port.type.childPortPrefix;
                for (const childPort of this.port.type.childPorts) {
                    const value = this.parent.model.getParameter(prefix + childPort);
                    if (value !== undefined) {
                        newStyleProps[childPort] = value;
                    }
                }
            }

            Object.assign(newProps, {
                newStyleProps,
                selectedStyle: this.getCurrentValue().value,
                onItemSelected: (name) => {
                    this.$('input').val(name);
                    this.$('input').trigger('change');
                    this.parent.hidePopout();
                },
                createNewStyle: (styleName, newStyle) => {
                    this.parent.hidePopout();

                    const prevValue = this.parent.model.parameters[this.name];
                    const portValuesToReset = {};

                    if (this.port.type.childPorts) {
                        const prefix = this.port.type.childPortPrefix;
                        for (const childPort of this.port.type.childPorts) {
                            const value = this.parent.model.parameters[prefix + childPort];
                            if (value !== undefined) {
                                portValuesToReset[prefix + childPort] = value;
                            }
                        }
                    }

                    const portsToReset = Object.keys(portValuesToReset);

                    const undoAction = new UndoActionGroup({ label: `create new text style: ${styleName}` });

                    undoAction.pushAndDo({
                        do: () => {
                            const stylesModel = new StylesModel();
                            stylesModel.setStyle('text', styleName, newStyle);
                            stylesModel.dispose();

                            this.parent.model.setParameter(this.name, styleName === '' ? undefined : styleName, { undo: false });

                            portsToReset.forEach((portName) => {
                                this.parent.model.setParameter(portName, undefined, { undo: false });
                            });

                            this.parent._portsHash = undefined;
                            this.parent.renderGroups();
                            this._valueUpdated();
                        },
                        undo: () => {
                            const stylesModel = new StylesModel();
                            stylesModel.deleteStyle('text', styleName);
                            stylesModel.dispose();

                            this.parent.model.setParameter(this.name, prevValue === '' ? undefined : prevValue, { undo: false });

                            portsToReset.forEach((portName) => {
                                this.parent.model.setParameter(portName, portValuesToReset[portName], { undo: false });
                            });

                            this.parent._portsHash = undefined;
                            this.parent.renderGroups();
                            this._valueUpdated();
                        }
                    });

                    UndoQueue.instance.push(undoAction);

                },
                inputValue: this.$('input').val(),
            });

            if (!this.textStylePickerDiv) {
                this.textStylePickerDiv = document.createElement('div');
                this.textStylePickerRoot = createRoot(this.textStylePickerDiv);
            }

            this.textStylePickerRoot.render(React.createElement(TextStylePicker, newProps));

            this.parent.showPopout({
                content: { el: $(this.textStylePickerDiv) },
                attachTo: this.el,
                position: 'right',
                onClose: () => {
                    if (this.textStylePickerRoot) {
                        this.textStylePickerRoot.unmount();
                        this.textStylePickerRoot = null;
                    }
                    this.textStylePickerDiv = null;
                }
            });

            e.stopPropagation();
        });

        this.$('input').on('keyup', (e) => {
            if (!this.textStylePickerDiv || !this.textStylePickerRoot) {
                return;
            }

            if (e.key === 'Enter') {
                this.parent.hidePopout();
            } else {
                const updatedProps = { ...props, filter: e.target.value };
                this.textStylePickerRoot.render(React.createElement(TextStylePicker, updatedProps));
            }
        });

        return this.el;
    }

    _valueUpdated() {
        const el = this.$('input');

        const current = this.getCurrentValue();
        el.val(current.value);
        this.isDefault = current.isDefault;

        if (this.parent.views && this.port.type.childPorts) {
            const prefix = this.port.type.childPortPrefix;
            for (const childPort of this.port.type.childPorts) {
                const portName = prefix + childPort;
                for (const portView of this.parent.views) {
                    if (portView.isDefault && portView.port && portView.port.name === portName) {
                        portView.resetToDefault && portView.resetToDefault();
                    }
                }
            }
        }
    }

    onPropertyChanged(scope, el) {
        this.parent.setParameter(scope.name, el.val() === '' ? undefined : el.val());
        el.blur();
        this._valueUpdated();
    }
}

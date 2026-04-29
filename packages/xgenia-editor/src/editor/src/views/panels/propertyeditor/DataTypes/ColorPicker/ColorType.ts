import React from 'react';
import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { EventDispatcher } from '../../../../../../../shared/utils/EventDispatcher';
import { TypeView } from '../../TypeView';
import { getEditType } from '../../utils';
import ColorPicker from './colorpicker';
import ColorStylePicker from './colorstylepicker';

// Note: this entire property can be re-created by events such as todo
// so the color picker can be left open, but now need a new callback to set
// values on the new property.
let colorPicker;

// When the property panel rerenders and recreates all PropertyEditors while the Color Picker is open,
// we need new callbacks to update the new DOM elements attached to the new view.
function bindColorPickerToView(view: ColorType) {
    const initialColor = view.getCurrentValue();

    colorPicker.setColor(ProjectModel.instance.resolveColor(initialColor.value));
    colorPicker.setColorChangedListener((color, commit) => {
        // commit is true when the value should be added to the undo queue
        view.parent.setParameterEx(view.name, color, initialColor.value, !commit);
        view.updateCurrentValue();
    });

    colorPicker._propertyName = view.name;
}

export class ColorType extends TypeView {
    propertyName: any;
    el: any;

    static fromPort(args: any) {
        const view = new ColorType();

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

        if (colorPicker) {
            colorPicker.dispose();
            colorPicker = null;
        }
    }
    onLaunchClicked(scope: any, el: any, evt: any) {
        this.propertyName = scope.name;

        if (!colorPicker) {
            colorPicker = new ColorPicker();
            colorPicker.render();
        }

        bindColorPickerToView(this);

        this.parent.showPopout({
            content: colorPicker,
            attachTo: el,
            position: 'right',
            onClose: () => {
                colorPicker && colorPicker.dispose();
                colorPicker = null;
            }
        });

        evt.stopPropagation();
    }
    render() {
        this.el = this.bindView(this.parent.cloneTemplate('color'), this);
        TypeView.prototype.render.call(this);

        this.updateCurrentValue();

        if (colorPicker && colorPicker._propertyName === this.name) {
            bindColorPickerToView(this);
        }

        let colorStylePickerDiv: HTMLDivElement;
        let colorStylePickerRoot: ReturnType<typeof createRoot>;
        let isShowingColorStylePicker = false;
        const props: any = {};

        EventDispatcher.instance.on(
            'Model.stylesChanged',
            (event) => {
                if (event.args.type === 'colors') {
                    this.updateCurrentValue();
                }
            },
            this
        );

        this.$('input').on('focus', (e: any) => {
            e.stopPropagation();
        });

        this.$('input').on('click', (e: any) => {
            delete props.filter; // delete filter in case the user opens/closes multiple times

            props.onItemSelected = (name: any) => {
                this.parent.setParameter(this.name, name);
                this.updateCurrentValue();
                this.parent.hidePopout();
            };

            const current = this.getCurrentValue();
            props.inputValue = current.value;

            colorStylePickerDiv = document.createElement('div');
            const root = createRoot(colorStylePickerDiv);
            root.render(React.createElement(ColorStylePicker, props));

            this.parent.showPopout({
                content: { el: $(colorStylePickerDiv) },
                attachTo: this.el,
                position: 'right',
                onClose: () => {
                    root.unmount();
                    isShowingColorStylePicker = false;
                }
            });

            isShowingColorStylePicker = true;

            e.stopPropagation(); // Stop propagation, otherwise the popup will close
        });

        this.$('input').on('keyup', (e: any) => {
            if (!isShowingColorStylePicker || !colorStylePickerRoot) {
                return;
            }
            if (e.key === 'Enter') {
                this.parent.hidePopout();
            } else {

                props.filter = e.target.value;
                colorStylePickerRoot.render(React.createElement(ColorStylePicker, props));
            }
        });

        return this.el;
    }
    updateCurrentValue() {
        const current = this.getCurrentValue();

        let stringColor = current.value;

        if (stringColor && stringColor[0] === '#') {
            // Only display the RGB part of a color in the input field.
            // If the color is in #RRGGBBAA format, strip away the alpha.
            const hasAlpha = stringColor.length === 9;
            stringColor = hasAlpha ? stringColor.slice(0, 7) : stringColor;
            stringColor = stringColor.toUpperCase();
        }

        this.$('#stringInput').val(stringColor);
        this.$('.color-thumbnail-content').css({
            'background-color': ProjectModel.instance.resolveColor(current.value)
        });
        this.isDefault = current.isDefault;
    }
    onStringInputChanged(scope: any, el: any) {
        let value = this.$('#stringInput').val().trim();
        if (value === '') value = undefined;

        const isHex = value !== undefined && /[0-9A-F]{6}$/i.test(value);
        if (isHex === true && value[0] !== '#') {
            value = '#' + value;
        }

        this.parent.setParameter(this.name, value);
        this.updateCurrentValue();
    }
    resetToDefault() {
        this.updateCurrentValue();
    }
}

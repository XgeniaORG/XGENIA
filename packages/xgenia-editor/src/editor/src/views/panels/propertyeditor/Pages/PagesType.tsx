import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { TypeView } from '../TypeView';
import { getEditType } from '../utils';
import { Pages } from './Pages';

export class PagesType extends TypeView {
    el: TSFixme;
    private reactRoot: Root | null = null; // Store the React root

    static fromPort(args) {
        const view = new PagesType();

        const p = args.port;
        const parent = args.parent;

        view.port = p;
        view.displayName = p.displayName ? p.displayName : p.name;
        view.name = p.name;
        view.type = getEditType(p);
        view.default = p.default;
        view.group = p.group;
        view.value = parent.model.getParameter(p.name);
        view.parent = parent;
        view.isConnected = parent.model.isPortConnected(p.name, 'target');
        view.isDefault = parent.model.parameters[p.name] === undefined;

        return view;
    }

    render() {
        const props = {
            value: this.value,
            router: this.parent.model.getParameter('name'),
            onChange: (value) => {
                const undoArgs = { undo: true, label: 'page settings', oldValue: this.value };
                this.value = value;
                this.parent.model.setParameter(this.name, value, undoArgs);
                this.isDefault = false;
            },
            onPageClicked: (page) => {
                const component = ProjectModel.instance.getComponentWithName(page.component);
                if (component === undefined) return;

                NodeGraphContextTmp.switchToComponent(component, { pushHistory: true });
            }
        };

        const div = document.createElement('div');
        this.el = $(div);

        // Ensure we create the React root only once
        if (!this.reactRoot) {
            this.reactRoot = createRoot(div);
        }

        // Render the component using React 18 API
        this.reactRoot.render(React.createElement(Pages, props));

        return this.el;
    }

    dispose() {
        // Unmount the React root properly when disposing
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        }
    }
}

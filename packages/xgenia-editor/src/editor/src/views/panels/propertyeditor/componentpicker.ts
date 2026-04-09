import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import _ from 'underscore';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { ComponentModel } from '@xgenia-models/componentmodel';
import { getComponentIconType, ComponentIconType } from '@xgenia-models/nodelibrary/ComponentIcon';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { isComponentModel_CloudRuntime } from '@xgenia-utils/NodeGraph';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { MenuDialog, MenuDialogProps, MenuDialogWidth } from '@xgenia-core-ui/components/popups/MenuDialog';
import { insertDividerBetweenAllItems } from '@xgenia-core-ui/components/popups/MenuDialog/MenuDialog.utils';

export type ComponentPickerOptions = {
  onItemSelected: (value: string) => void;
  components: string[];
  ignoreSheetName?: boolean;
};

type EntryItem = {
  icon: TSFixme;
  label: string;
  endSlot: TSFixme;
  fullPath: string;
  key: string;
};

type Entry = EntryItem | 'divider';

export class ComponentPicker {
  private onItemSelected: ComponentPickerOptions['onItemSelected'];
  private pathFilter: string;
  private reactMount: HTMLElement;
  private reactRoot: Root | null = null; // Store the React root
  private componentsToShow: ComponentPickerOptions['components'];
  private ignoreSheetName: boolean;

  constructor(args: ComponentPickerOptions) {
    this.onItemSelected = args.onItemSelected;
    this.componentsToShow = args.components;
    this.ignoreSheetName = !!args.ignoreSheetName;
  }

  parseItems(components: ComponentModel[]): readonly Entry[] {
    const parsedItems = [];

    for (const component of components) {
      if (
        this.pathFilter === undefined ||
        this.pathFilter === '' ||
        component.fullName.toLowerCase().indexOf(this.pathFilter) !== -1
      ) {
        const componentFolder = component.name.substring(0, component.name.length - component.localName.length);
        let folder = componentFolder !== '/' ? componentFolder : undefined;
        const iconType = getComponentIconType(component);

        if (folder) {
          folder = folder.replace('/#__cloud__', '');
        }

        if (folder === '/') {
          folder = undefined;
        }

        let icon: IconName;
        if (iconType === ComponentIconType.CloudFunction) {
          icon = IconName.CloudFunction;
        } else if (iconType === ComponentIconType.Page) {
          icon = IconName.File;
        } else {
          icon = IconName.Component;
        }

        parsedItems.push({
          icon,
          label: component.localName,
          endSlot: folder,
          fullPath: component.name,
          key: component.id || component.name
        });
      }
    }

    parsedItems.sort((a, b) => (a.fullPath > b.fullPath ? -1 : 1));

    return insertDividerBetweenAllItems(parsedItems);
  }

  setFilter(filter: string) {
    this.pathFilter = filter.toLowerCase();
    this.renderReact();
  }

  private setValue(item: EntryItem) {
    if (this.ignoreSheetName) {
      const withoutSheetName = item.fullPath.split('/').slice(2).join('/');
      this.onItemSelected(withoutSheetName);
    } else {
      this.onItemSelected(item.fullPath);
    }
  }

  private getAllComponents(): ComponentModel[] {
    const rootComponent = ProjectModel.instance.getRootComponent();
    const allComponents = ProjectModel.instance
      .getComponents()
      .filter((c) => c !== rootComponent && getComponentIconType(c) !== ComponentIconType.Page);

    const isShowingFrontend = NodeGraphContextTmp.active === 'frontend';

    return allComponents.filter((c) => {
      const isCloud = isComponentModel_CloudRuntime(c);
      if (isShowingFrontend) {
        return !isCloud;
      } else {
        return isCloud && getComponentIconType(c) !== ComponentIconType.CloudFunction;
      }
    });
  }

  private getComponentModelsFromNames(names: string[]) {
    return names.map((name) => ProjectModel.instance.getComponentWithName(name)).filter((c) => !!c);
  }

  renderReact() {
    const components = this.componentsToShow
      ? this.getComponentModelsFromNames(this.componentsToShow)
      : this.getAllComponents();

    const items = this.parseItems(components);

    const menuItems: MenuDialogProps['items'] = items.length
      ? items.map((item) => (item === 'divider' ? 'divider' : { ...item, onClick: () => this.setValue(item) }))
      : [{ label: 'No matching components' }];

    const props: MenuDialogProps = {
      isVisible: true,
      onClose: () => this.dispose(),
      items: menuItems,
      title: 'Choose component',
      triggerRef: { current: this.reactMount },
      renderDirection: 1,
      width: MenuDialogWidth.Medium
    };

    // Create root if it doesn’t exist
    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.reactMount);
    }

    // Render with the new React API
    this.reactRoot.render(React.createElement(MenuDialog, props));
  }

  render(target: HTMLElement) {
    this.reactMount = target;
    this.renderReact();
  }

  dispose() {
    if (this.reactRoot) {
      this.reactRoot.unmount(); // Correctly unmount React 18 root
      this.reactRoot = null;
    }
  }
}

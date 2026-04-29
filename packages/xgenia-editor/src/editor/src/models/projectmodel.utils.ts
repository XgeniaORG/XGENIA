import { ComponentModel } from '@xgenia-models/componentmodel';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { isComponentModel_BrowserRuntime } from '@xgenia-utils/NodeGraph';

export function getDefaultComponent(instance = ProjectModel.instance): ComponentModel {
  let component =
    instance.getComponentWithName('/Main') ||
    instance.getComponentWithName('/Start') ||
    instance.getComponentWithName('/Lesson');

  if (!component) {
    component = instance.getRootComponent();
  }

  if (!component) {
    component = instance.getComponents().find(isComponentModel_BrowserRuntime);
  }

  return component;
}

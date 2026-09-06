import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';

import { ProjectModel } from '../../../models/projectmodel';
import { ToastLayer } from '../../ToastLayer/ToastLayer';

/**
 * What double-clicking a node in the graph does to the inspector.
 *
 * A node type can nominate the port it wants focused (`type.nodeDoubleClickAction`),
 * which is how double-clicking a script node lands the caret in its code editor
 * rather than merely opening the panel.
 *
 * Reaching the control through `data-identifier` rather than through React is
 * deliberate: the port editors are the legacy views, the attribute is written by
 * `View.bindView` for every one of them, and the same selector is what the MCP probes
 * use. A React-side registry would be a second, drifting way to name the same input.
 */
function tryPropertyPanelInputInteraction(inputIdentifier: string) {
  const input = document.querySelector(
    `div[data-panel-id="PropertyEditor"] [data-identifier="${inputIdentifier}"]`
  ) as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | null;

  if (!input) return;

  setTimeout(() => {
    switch (input.nodeName) {
      case 'BUTTON': {
        input.click();

        // If the button opened a code editor, put the caret in it.
        const codeEditor = document.querySelector('.monaco-editor .inputarea') as HTMLTextAreaElement | null;
        if (codeEditor) codeEditor.focus();
        break;
      }

      case 'INPUT': {
        if ((input as HTMLInputElement).dataset.type === 'color') input.click();
        else input.focus();
        break;
      }

      default: {
        input.focus();
      }
    }

    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 1);
}

export function performNodeDoubleClick(node: NodeGraphNode) {
  if (!node) return;

  if (node.metadata?.AiAssistant) {
    const aiButton = document.querySelector<HTMLButtonElement>('button[data-test="ai-code-editor"]');
    if (aiButton) {
      setTimeout(() => {
        aiButton.click();
        const codeEditor = document.querySelector('.monaco-editor .inputarea') as HTMLTextAreaElement | null;
        // The editor may not have mounted yet; focusing nothing is better than throwing.
        codeEditor?.focus();
      }, 1);
    }
    return;
  }

  if (node.type.name === 'CloudFunction2') {
    const functionName = '/#__cloud__/' + node.parameters.function;
    const component = ProjectModel.instance.getComponentWithName(functionName);
    if (component) {
      NodeGraphContextTmp.switchToComponent(component, { pushHistory: true });
    } else {
      ToastLayer.showError('Could not find Cloud Function in project.');
    }
    return;
  }

  const action = node.type.nodeDoubleClickAction;
  if (!action) return;

  if (Array.isArray(action)) {
    action.forEach((entry) => tryPropertyPanelInputInteraction(entry.focusPort));
  } else {
    tryPropertyPanelInputInteraction(action.focusPort);
  }
}

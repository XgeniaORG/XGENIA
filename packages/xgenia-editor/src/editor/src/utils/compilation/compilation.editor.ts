import { ProjectModel } from '@xgenia-models/projectmodel';
import { Compilation, CompilationOptions, IFeedbackProvider } from '@xgenia-utils/compilation/compilation';

import { ToastLayer } from '../../views/ToastLayer/ToastLayer';

/**
 * Create a Compilation instance with Editor settings.
 *
 * @param project
 * @param options Optional overrides merged over the editor defaults.
 * @returns
 */
export function createEditorCompilation(project: ProjectModel, options?: Partial<CompilationOptions>) {
  const feedback: IFeedbackProvider = {
    showActivity: ToastLayer.showActivity,
    hideActivity: ToastLayer.hideActivity,
    showSuccess: ToastLayer.showSuccess,
    showError: ToastLayer.showError,
    showInteraction: ToastLayer.showInteraction
  };

  return new Compilation(project, feedback, {
    cloneProject: true,
    ...options
  });
}

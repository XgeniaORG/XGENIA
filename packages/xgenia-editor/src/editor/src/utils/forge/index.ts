import getDocsEndpoint from '@xgenia-utils/getDocsEndpoint';

import { HttpTemplateProvider } from './template/providers/http-template-provider';
import { XgeniaDocsTemplateProvider } from './template/providers/xgenia-docs-template-provider';
import { TemplateRegistry } from './template/template-registry';

// The order of the providers matters,
// when looking for a template it will take the first one that allows it.
const templateRegistry = new TemplateRegistry([
  new XgeniaDocsTemplateProvider(getDocsEndpoint),
  new HttpTemplateProvider()
]);

export { templateRegistry };

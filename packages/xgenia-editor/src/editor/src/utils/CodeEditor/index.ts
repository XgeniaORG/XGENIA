import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution';

import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

// The CSS contribution registers three languages — css, scss, less — each with its
// OWN defaults object, and all three validate as a complete stylesheet by default.
//
// We use two of them for two different shapes of content:
//   'css'  → the CSS Definition node's `style` port. A real stylesheet. Validation
//            is correct and useful there, so it stays ON.
//   'scss' → visual nodes' `styleCss` port. A DECLARATION LIST (plus optional
//            nested blocks). `background: red;` at the top level of a stylesheet is
//            a parse error, so the validator flagged every single property the user
//            typed — red squiggles on correct CSS. Nothing was wrong with the CSS;
//            the validator was applying the wrong grammar.
//
// scss is picked over css for styleCss because scss natively understands the `&`
// nesting that styleCss now supports, so bracket matching, folding and auto-indent
// behave correctly inside `&:hover { … }`. Validation is off for scss only, which
// leaves the CSS Definition node fully validated. styleCss is not left without
// feedback: the runtime reports per-declaration parse errors as editor warnings
// (see updateAdvancedStyle in react-component-node.js).
monaco.languages.css.scssDefaults.setOptions({
  ...monaco.languages.css.scssDefaults.options,
  validate: false
});

export * from './model';

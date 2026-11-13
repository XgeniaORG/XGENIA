import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBlockedConstructs } from '../../src/editor/src/utils/rgs/validateRgsScript';

// The editor's pre-flight mirrors XGENIA RGS's sandbox: the server refuses ANY `import` (2026-11-02),
// because `import/**/(…)` slipped past the old `import\s*\(`. A studio should hear that before deploying.
test('any import is flagged before deploy, however it is spelt', () => {
  for (const s of ['import("x")', 'import/**/("x")', 'import\n("x")', 'import x from "y"']) {
    assert.ok(findBlockedConstructs(s).some((c: any) => /import/.test(c.label)), s);
  }
});

test('ordinary words containing "import" are not', () => {
  for (const s of ['var important = 1;', 'var imported = 2; return { win: 0 };', '// reimport later']) {
    assert.ok(!findBlockedConstructs(s).some((c: any) => /import/.test(c.label)), s);
  }
});

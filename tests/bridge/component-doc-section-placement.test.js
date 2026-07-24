'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(
  path.resolve(__dirname, '../../packages/figma-bridge-plugin/code.js'),
  'utf8'
);

function extractFunction(src, name) {
  const needle = 'function ' + name + '(';
  const start = src.indexOf(needle);
  assert.ok(start !== -1, 'Could not locate function ' + name);
  let index = src.indexOf('{', start);
  assert.ok(index !== -1, 'Malformed function ' + name);
  let depth = 1;
  index++;
  while (index < src.length && depth > 0) {
    if (src[index] === '{') depth++;
    else if (src[index] === '}') depth--;
    index++;
  }
  assert.strictEqual(depth, 0, 'Unbalanced function ' + name);
  return src.slice(start, index);
}

const helpers = new Function(
  extractFunction(code, '_docPlanSpecSheetPlacement') +
  '\n' +
  extractFunction(code, '_docExpandedDocumentationSectionSize') +
  '\nreturn { _docPlanSpecSheetPlacement, _docExpandedDocumentationSectionSize };'
)();

const created = helpers._docPlanSpecSheetPlacement({
  sectionExists: false,
  target: { componentX: 100, componentY: 200, componentWidth: 300 },
});
assert.deepStrictEqual(created, {
  sectionX: 500,
  sectionY: 200,
  frameX: 80,
  frameY: 80,
  padding: 80,
  gap: 80,
  placement: 'new-section',
});

const appended = helpers._docPlanSpecSheetPlacement({
  sectionExists: true,
  currentSection: { x: 900, y: 200 },
  existingSheets: [
    { x: 80, y: 80, width: 1400, height: 1000 },
    { x: 1560, y: 80, width: 1400, height: 1200 },
  ],
});
assert.strictEqual(appended.sectionX, 900, 'existing Documentation section must not move');
assert.strictEqual(appended.sectionY, 200, 'existing Documentation section must not move');
assert.strictEqual(appended.frameX, 3040, 'new sheet must sit to the right of the rightmost sheet with an 80px gap');
assert.strictEqual(appended.frameY, 80, 'new sheet should align with the existing sheet row');
assert.strictEqual(appended.placement, 'append-right');

const replaced = helpers._docPlanSpecSheetPlacement({
  sectionExists: true,
  currentSection: { x: 900, y: 200 },
  replacement: { x: 1560, y: 80 },
  existingSheets: [{ x: 80, y: 80, width: 1400, height: 1000 }],
});
assert.strictEqual(replaced.frameX, 1560, 'same-component regeneration must preserve x');
assert.strictEqual(replaced.frameY, 80, 'same-component regeneration must preserve y');
assert.strictEqual(replaced.placement, 'replace-in-place');

const expanded = helpers._docExpandedDocumentationSectionSize(
  3040,
  1280,
  [
    { x: 80, y: 80, width: 1400, height: 1000 },
    { x: 3040, y: 80, width: 1400, height: 1500 },
  ],
  80
);
assert.deepStrictEqual(expanded, {
  width: 4520,
  height: 1660,
}, 'Documentation section must expand around all sheets with right/bottom padding');

const neverShrink = helpers._docExpandedDocumentationSectionSize(
  5000,
  2000,
  [{ x: 80, y: 80, width: 1400, height: 1000 }],
  80
);
assert.deepStrictEqual(neverShrink, {
  width: 5000,
  height: 2000,
}, 'regeneration must never collapse the Documentation section around one sheet');

assert.ok(
  code.includes("const _replacementPosition = _old ? { x: _old.x, y: _old.y } : null;") &&
  code.includes("_sheet.type === 'FRAME' && / · Spec$/.test(_sheet.name || '')") &&
  code.includes("_syncDocumentationSectionBounds(_docSec, _docPlacement.padding)"),
  'runtime must preserve replacement coordinates, inspect sibling sheets, and expand the section from all children'
);

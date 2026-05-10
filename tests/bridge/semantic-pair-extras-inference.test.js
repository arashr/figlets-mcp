'use strict';

// Tests for _inferSemPairExtras, the DS-agnostic pairing-companion helper
// that powers the Semantic Colors showcase's bg+fg+border+icon row rendering.
//
// The helper lives inside _buildShowcase in packages/figma-bridge-plugin/code.js.
// We extract its source, evaluate it in a sandbox, and exercise it directly
// against stub varByName maps. The helper is pure (reads varByName, returns
// strings) so this is sufficient.
//
// Fill is intentionally NOT inferred — the helper's `fillRef` is always ''.
// Explicit pair.fill is honored elsewhere (downstream call site), not here.
//
// Style mirrors tests/bridge/qa-binding-audit-policy.test.js (plain assert,
// fs.readFileSync, no test framework).

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const codePath = path.join(repoRoot, 'packages/figma-bridge-plugin/code.js');
const code = fs.readFileSync(codePath, 'utf8');

// ── Source extraction ────────────────────────────────────────────────────────

function extractFunction(src, name) {
  const needle = 'function ' + name + '(';
  const start = src.indexOf(needle);
  assert.ok(start !== -1, 'Could not locate function ' + name + ' in code.js');
  let i = src.indexOf('{', start);
  assert.ok(i !== -1, 'Malformed function ' + name + ' (no opening brace)');
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.strictEqual(depth, 0, 'Unbalanced braces while extracting ' + name);
  return src.slice(start, i);
}

const inferSrc = extractFunction(code, '_inferSemPairExtras');
// eslint-disable-next-line no-new-func
const _inferSemPairExtras = new Function(inferSrc + '; return _inferSemPairExtras;')();
assert.strictEqual(typeof _inferSemPairExtras, 'function', 'extracted helper must be a function');

function makeVbn(names) {
  const out = {};
  for (let i = 0; i < names.length; i++) out[names[i]] = { name: names[i], resolvedType: 'COLOR' };
  return out;
}

function assertResult(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, label + ' — got ' + JSON.stringify(actual));
}

// ── Cases 1-22 ───────────────────────────────────────────────────────────────

// 1. Material 3 naming: surface → outline / icon resolve. Fill never inferred.
assertResult(
  _inferSemPairExtras(
    'color/surface/brand',
    'color/on-surface/brand',
    makeVbn(['color/outline/brand', 'color/icon/brand', 'color/fill/brand'])
  ),
  { borderRef: 'color/outline/brand', iconRef: 'color/icon/brand', fillRef: '' },
  '1. Material 3 naming with surface/outline/icon (fill not inferred)'
);

// 2. Role-based naming: bg → border / icon resolve. Fill never inferred.
assertResult(
  _inferSemPairExtras(
    'color/bg/danger',
    'color/text/danger',
    makeVbn(['color/border/danger', 'color/icon/danger', 'color/fill/danger'])
  ),
  { borderRef: 'color/border/danger', iconRef: 'color/icon/danger', fillRef: '' },
  '2. Role-based naming (fill never inferred)'
);

// 3. Stroke-only border namespace.
assertResult(
  _inferSemPairExtras(
    'color/bg/info',
    'color/text/info',
    makeVbn(['color/stroke/info'])
  ),
  { borderRef: 'color/stroke/info', iconRef: '', fillRef: '' },
  '3. Stroke-only border namespace'
);

// 4. Suffix-strip fallback (subtle): bg/brand-subtle → border/brand.
assertResult(
  _inferSemPairExtras(
    'color/bg/brand-subtle',
    'color/text/brand',
    makeVbn(['color/border/brand'])
  ),
  { borderRef: 'color/border/brand', iconRef: '', fillRef: '' },
  '4. Suffix-strip subtle on border'
);

// 5. Suffix-strip fallback (variant): surface/danger-variant → outline/danger.
assertResult(
  _inferSemPairExtras(
    'color/surface/danger-variant',
    '',
    makeVbn(['color/outline/danger'])
  ),
  { borderRef: 'color/outline/danger', iconRef: '', fillRef: '' },
  '5. Suffix-strip variant on outline'
);

// 6. Suffix-strip fallback (strong) on icon target.
assertResult(
  _inferSemPairExtras(
    'color/bg/warning-strong',
    '',
    makeVbn(['color/icon/warning'])
  ),
  { borderRef: '', iconRef: 'color/icon/warning', fillRef: '' },
  '6. Suffix-strip strong on icon'
);

// 7. Direct match wins over suffix-strip fallback.
assertResult(
  _inferSemPairExtras(
    'color/bg/brand-subtle',
    '',
    makeVbn(['color/border/brand-subtle', 'color/border/brand'])
  ),
  { borderRef: 'color/border/brand-subtle', iconRef: '', fillRef: '' },
  '7. Direct match preferred over stripped'
);

// 8. Fill never inferred even when the bg already IS a fill family.
assertResult(
  _inferSemPairExtras(
    'color/fill/danger',
    'color/text/on-danger',
    makeVbn(['color/fill/danger', 'color/border/danger', 'color/icon/danger'])
  ),
  { borderRef: 'color/border/danger', iconRef: 'color/icon/danger', fillRef: '' },
  '8. Border/icon still inferred from a fill bg; fill itself never inferred'
);

// 9. Icon via fg fallback when bg-side substitution fails.
assertResult(
  _inferSemPairExtras(
    'color/bg/x',
    'color/text/x',
    makeVbn(['color/icon/x'])
  ),
  { borderRef: '', iconRef: 'color/icon/x', fillRef: '' },
  '9. Icon found via fg-side fallback'
);

// 10. Empty DS — nothing resolves.
assertResult(
  _inferSemPairExtras('color/bg/whatever', 'color/text/whatever', makeVbn([])),
  { borderRef: '', iconRef: '', fillRef: '' },
  '10. Empty varByName'
);

// 11. Null / undefined / empty inputs — never throw, never return undefined.
assertResult(
  _inferSemPairExtras(null, null, makeVbn(['color/border/x'])),
  { borderRef: '', iconRef: '', fillRef: '' },
  '11a. null inputs'
);
assertResult(
  _inferSemPairExtras(undefined, undefined, makeVbn(['color/border/x'])),
  { borderRef: '', iconRef: '', fillRef: '' },
  '11b. undefined inputs'
);
assertResult(
  _inferSemPairExtras('', '', makeVbn(['color/border/x'])),
  { borderRef: '', iconRef: '', fillRef: '' },
  '11c. empty-string inputs'
);

// 12. Path with no family segment (defensive).
assertResult(
  _inferSemPairExtras(
    'color/red/500',
    'color/red/900',
    makeVbn(['color/border/red', 'color/icon/red'])
  ),
  { borderRef: '', iconRef: '', fillRef: '' },
  '12. No family segment — no inference'
);

// 13. Capitalization: family detection is case-insensitive on the SOURCE side.
assertResult(
  _inferSemPairExtras(
    'color/Bg/Danger',
    '',
    makeVbn(['color/border/Danger'])
  ),
  { borderRef: 'color/border/Danger', iconRef: '', fillRef: '' },
  '13. Case-insensitive family detection on source path'
);

// 14. Deep namespacing.
assertResult(
  _inferSemPairExtras(
    'tokens/colors/light/surface/brand',
    '',
    makeVbn(['tokens/colors/light/border/brand'])
  ),
  { borderRef: 'tokens/colors/light/border/brand', iconRef: '', fillRef: '' },
  '14. Deep namespace path'
);

// 15. Family segment at index 0 (no leading namespace).
assertResult(
  _inferSemPairExtras(
    'bg/danger',
    '',
    makeVbn(['border/danger'])
  ),
  { borderRef: 'border/danger', iconRef: '', fillRef: '' },
  '15. Family at index 0'
);

// 16. No fg given — icon falls back to bg-side only.
assertResult(
  _inferSemPairExtras(
    'color/bg/x',
    '',
    makeVbn(['color/icon/x'])
  ),
  { borderRef: '', iconRef: 'color/icon/x', fillRef: '' },
  '16a. Icon via bg side, fg empty'
);
assertResult(
  _inferSemPairExtras(
    'color/bg/x',
    null,
    makeVbn([])
  ),
  { borderRef: '', iconRef: '', fillRef: '' },
  '16b. Icon empty when neither side resolves'
);

// 17. Multiple fg-side icon namespaces (graphic instead of icon).
assertResult(
  _inferSemPairExtras(
    'color/bg/danger',
    'color/text/danger',
    makeVbn(['color/graphic/danger'])
  ),
  { borderRef: '', iconRef: 'color/graphic/danger', fillRef: '' },
  '17. Icon found via second target (graphic) on fg side'
);

// 18. Suffix-strip on the second border target (outline + brand-subtle).
assertResult(
  _inferSemPairExtras(
    'color/bg/brand-subtle',
    '',
    makeVbn(['color/outline/brand'])
  ),
  { borderRef: 'color/outline/brand', iconRef: '', fillRef: '' },
  '18. Suffix-strip on outline target'
);

// 19. Result keys are always present.
const r19 = _inferSemPairExtras(null, null, makeVbn([]));
assert.deepStrictEqual(
  Object.keys(r19).sort(),
  ['borderRef', 'fillRef', 'iconRef'],
  '19. Result always has the same three keys'
);

// 20. Helper does not mutate inputs (varByName or strings).
const vbn20 = makeVbn(['color/border/brand', 'color/icon/brand', 'color/fill/brand']);
const vbn20Snapshot = JSON.parse(JSON.stringify(vbn20));
const bg20 = 'color/bg/brand';
const fg20 = 'color/text/on-brand';
_inferSemPairExtras(bg20, fg20, vbn20);
assert.deepStrictEqual(vbn20, vbn20Snapshot, '20a. varByName not mutated');
assert.strictEqual(bg20, 'color/bg/brand', '20b. bgName string unchanged');
assert.strictEqual(fg20, 'color/text/on-brand', '20c. fgName string unchanged');

// 21. fillRef is ALWAYS '' regardless of whether `color/fill/<leaf>` exists.
assertResult(
  _inferSemPairExtras(
    'color/bg/danger',
    'color/text/danger',
    makeVbn(['color/fill/danger'])
  ),
  { borderRef: '', iconRef: '', fillRef: '' },
  '21. fillRef is always empty even when color/fill/<leaf> exists'
);

// 22. Target-side casing fallback: exact source match can still resolve
// target namespaces with consumer-specific capitalization.
assertResult(
  _inferSemPairExtras(
    'color/Bg/Danger',
    'color/Text/Danger',
    makeVbn(['color/Border/Danger', 'color/Icon/Danger'])
  ),
  { borderRef: 'color/Border/Danger', iconRef: 'color/Icon/Danger', fillRef: '' },
  '22. Case-insensitive lookup returns the actual target variable name'
);

// ── Integration assertions on the assembly source ────────────────────────────

// Pin that the config-pairs branch uses the explicit-wins pattern for border
// and icon. pair.fill goes through unchanged (helper does not infer fill).
assert.ok(
  code.includes('pair.border || _extras.borderRef') &&
    code.includes('pair.icon   || _extras.iconRef'),
  'Config-pairs assembly must short-circuit border/icon inference when explicitly set'
);

// Pin that pair.fill is still resolved directly (no inference layer for fill).
assert.ok(
  code.includes('const flInfo = _resolveSemRef(pair.fill);'),
  'Config-pairs assembly must resolve pair.fill directly (no fill inference)'
);

// Pin that the legacy non-config bg-row branch also calls the helper.
assert.ok(
  code.includes('_inferSemPairExtras(v.name, fgPairName || \'\', varByName)'),
  'Legacy non-config bg-row branch must call _inferSemPairExtras for symmetric coverage'
);

// Pin that the helper region introduces no Figma-mutation API calls.
const helperStart = code.indexOf('function _inferSemPairExtras');
const helperEnd = code.indexOf('if (_configSemanticPairs.length)', helperStart);
assert.ok(helperStart !== -1 && helperEnd !== -1, 'Could not locate helper region');
const helperRegion = code.slice(helperStart, helperEnd);
assert.ok(
  !/createVariable|setBoundVariable|setVariableScopes|figma\.root\.setPluginData/.test(helperRegion),
  'Inference helper region must not introduce any Figma-mutation API calls'
);

// Pin that the helper does not invent a fill inference path.
// The body must NOT contain a substitution call into 'fill' as a target;
// the only allowed mention of 'fill' is FAMILY_RE (matching it as a SOURCE
// family), the comment, and the always-empty fillRef literal.
const fillTargetCalls = helperRegion.match(/_tryWithSuffixStrip\([^,]+,\s*[A-Z_]+,\s*'fill'\s*\)/g);
assert.strictEqual(
  fillTargetCalls,
  null,
  'Helper must not call any substitution targeting "fill" as a destination role'
);

console.log('semantic-pair-extras-inference: 22 cases + 5 integration assertions passed.');

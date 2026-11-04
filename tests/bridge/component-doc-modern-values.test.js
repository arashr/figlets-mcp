const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const codePath = path.join(repoRoot, "packages/figma-bridge-plugin/code.js");
const code = fs.readFileSync(codePath, "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  assert.ok(start !== -1, "Could not locate function " + name + " in code.js");
  let i = src.indexOf("{", start);
  assert.ok(i !== -1, "Malformed function " + name + " (no opening brace)");
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  assert.strictEqual(depth, 0, "Unbalanced braces while extracting " + name);
  return src.slice(start, i);
}

const helpers = new Function(
  ["_docResolveVariableValue", "_docFormatNumber", "_docFormatResolvedVariableValue", "_docComparableVariableModeValue"].map(name => extractFunction(code, name)).join("\n")
  + "\nreturn { resolve: _docResolveVariableValue, format: _docFormatResolvedVariableValue, compare: _docComparableVariableModeValue };"
)();
const vars = {
  base: { id: 'base', name: 'color/base', resolvedType: 'COLOR', variableCollectionId: 'c', valuesByMode: { d: { r: 0, g: 0, b: 0 } } },
  opacity: { id: 'opacity', name: 'opacity/scrim', resolvedType: 'FLOAT', scopes: ['COLOR_OPACITY'], variableCollectionId: 'c', valuesByMode: { d: 32 } },
  inner: { id: 'inner', name: 'color/inner', resolvedType: 'COLOR', variableCollectionId: 'c', valuesByMode: { d: { color: { type: 'VARIABLE_ALIAS', id: 'base' }, opacity: { type: 'VARIABLE_ALIAS', id: 'opacity' } } } },
  outer: { id: 'outer', name: 'color/outer', resolvedType: 'COLOR', variableCollectionId: 'c', valuesByMode: { d: { color: { type: 'VARIABLE_ALIAS', id: 'inner' }, opacity: 16 } } },
  timing: { id: 'timing', resolvedType: 'TIMING', variableCollectionId: 'c', valuesByMode: { d: 0.2 } },
  ease: { id: 'ease', resolvedType: 'EASING', variableCollectionId: 'c', valuesByMode: { d: { type: 'LINEAR' }, r: { type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: 0.4 } } } },
};
const collections = { c: { defaultModeId: 'd', modes: [{ modeId: 'd', name: 'Default' }, { modeId: 'r', name: 'Reduced Motion' }] } };
const resolved = helpers.resolve('outer', 'd', vars, collections, []);
assert.deepStrictEqual(resolved.val, { r: 0, g: 0, b: 0, a: 0.16 });
assert.ok(resolved.references.some(ref => ref.path === 'color.opacity' && ref.id === 'opacity'));
assert.strictEqual(helpers.format('duration', helpers.resolve('timing', 'd', vars, collections, [])), '200 ms');
assert.strictEqual(helpers.format('opacity', helpers.resolve('opacity', 'd', vars, collections, [])), '32%');
assert.match(helpers.format('easing', helpers.resolve('ease', 'r', vars, collections, [])), /CUSTOM_SPRING.*0.4/);
assert.notStrictEqual(helpers.compare('ease', 'd', vars, 0, collections), helpers.compare('ease', 'r', vars, 0, collections));

const loadAliases = new Function('async ' + extractFunction(code, '_docLoadVariableAliases') + '\nreturn _docLoadVariableAliases;')();
module.exports = (async () => {
  const cache = {};
  const fetched = [];
  const remote = {
    root: { resolvedType: 'COLOR', valuesByMode: { d: { type: 'VARIABLE_ALIAS', id: 'inner' } } },
    inner: { resolvedType: 'COLOR', valuesByMode: { d: { color: { type: 'VARIABLE_ALIAS', id: 'base' }, opacity: { type: 'VARIABLE_ALIAS', id: 'opacity' } } } },
    base: vars.base,
    opacity: vars.opacity,
    cycle: { valuesByMode: { d: { type: 'VARIABLE_ALIAS', id: 'cycle' }, r: { type: 'VARIABLE_ALIAS', id: 'missing' } } },
  };
  const missing = await loadAliases(['root', 'cycle', 'root'], cache, async id => { fetched.push(id); return remote[id]; });
  assert.deepStrictEqual(missing, ['missing']);
  assert.strictEqual(fetched.filter(id => id === 'cycle').length, 1);
  assert.ok(cache.base && cache.opacity, 'Remote composed channel dependencies must be fetched');
  assert.deepStrictEqual(helpers.resolve('root', 'd', cache, collections, []).val, { r: 0, g: 0, b: 0, a: 0.32 });
  const source = extractFunction(code, '_resolveBindingRows');
  const rows = new Function('varById', '_variableContext', '_resolvedVariableValueSummary', source + '\nreturn _resolveBindingRows;')(vars, () => 'Context', () => '32%')([{ node: 'Card', property: 'opacity', varId: 'opacity' }]);
  assert.strictEqual(rows[0].variableId, 'opacity');
  assert.strictEqual(rows[0].variableType, 'FLOAT');
  assert.deepStrictEqual(rows[0].valuesByMode, { d: 32 });
  assert.ok(!code.slice(code.indexOf('function _updateDsTokens'), code.indexOf('function _docLoadVariableAliases')).includes('variableId: b.varId'), 'Component metadata must not enter token mutation branches');
})();

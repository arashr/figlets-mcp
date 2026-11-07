'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '../../packages/figma-bridge-plugin/code.js'), 'utf8');
function extract(name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const body = code.indexOf('{', start);
  let depth = 0;
  for (let i = body; i < code.length; i++) {
    if (code[i] === '{') depth++;
    if (code[i] === '}' && --depth === 0) return code.slice(start, i + 1);
  }
  throw new Error(name);
}
function node(name) {
  return { name, type: 'FRAME', children: [], width: 56, height: 64,
    appendChild(child) { if (child.parent) child.remove(); this.children.push(child); child.parent = this; },
    resize(width, height) { this.width = width; this.height = height; },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
  };
}
const variable = (id, name, type, value) => ({ id, name, resolvedType: type, variableCollectionId: 'p', valuesByMode: { d: value } });
const light = variable('light', 'color/neutral/50', 'COLOR', { r: 1, g: 1, b: 1, a: 1 });
const dark = variable('dark', 'color/neutral/950', 'COLOR', { r: 0, g: 0, b: 0, a: 1 });
const opacity = variable('opacity', 'opacity/40', 'FLOAT', 40);
const black = variable('black', 'color/scrim/black/40', 'COLOR', { color: { type: 'VARIABLE_ALIAS', id: 'dark' }, opacity: { type: 'VARIABLE_ALIAS', id: 'opacity' } });
const white = variable('white', 'color/scrim/white/20', 'COLOR', { r: 1, g: 1, b: 1, a: 0.2 });
const black4 = variable('black4', 'color/scrim/black/4', 'COLOR', { r: 0, g: 0, b: 0, a: 0.04 });
const opaque = variable('opaque', 'color/scrim/black/100', 'COLOR', { r: 0, g: 0, b: 0, a: 1 });
const broken = variable('broken', 'color/scrim/black/60', 'COLOR', { color: { type: 'VARIABLE_ALIAS', id: 'missing' }, opacity: 60 });
const warnings = [];
const page = node('Page');
const context = {
  _dsStruct_allVars: [light, dark, opacity, black, white, black4, opaque, broken],
  _dsStruct_allColls: [{ id: 'p', defaultModeId: 'd', modes: [{ modeId: 'd', name: 'Default' }] }],
  _scored: [light, dark].map(v => ({ name: v.name, v })),
  _RC: { surfaceDefault: { r: 1, g: 1, b: 1 }, outlineSubtle: {} }, _V: {}, _subColor: {}, _textColor: {},
  figma: { createFrame: () => node('Frame'), createSection() { throw new Error('fallback'); } },
  _f: name => node(name), _tDS: text => ({ ...node('Text'), characters: text }),
  _paint: (rgb, variable) => ({ color: rgb, boundVariables: variable ? { color: { type: 'VARIABLE_ALIAS', id: variable.id } } : {} }),
  _setMinWidth: (n, width) => { n.minWidth = width; }, _hex: () => '#000000',
  _pickNeutralTextForSwatch: () => ({ fg: {}, varRef: null, lc: 80, ratio: 8 }),
  _pickNeutralBackgroundForSwatchText: () => ({ bg: {}, varRef: null, lc: 80, ratio: 8 }),
  _contrastLabel: () => 'AAA', _warnShowcaseBinding: message => warnings.push(message),
  resolveVarValue: v => v.valuesByMode.d, _lum: rgb => rgb.r,
  _page: page, _sectionX: 2600, _SECTION_GAP: 100, _showcaseSectionPairs: [],
  _bgColor: {}, _makeShowcaseFrame: name => ({ ...node('Token Showcase — ' + name), width: 1200 }),
  _addToFrame: (child, parent) => parent.appendChild(child), _buildSectionHeader: () => node('Header'),
  _buildTable: () => node('Table'), _SCRIM_TABLE_DESC: '', _addTableDivider() {},
  _appendFill: (child, parent) => parent.appendChild(child),
  varByName: Object.fromEntries([black, white, black4, opaque, broken].map(v => [v.name, v])),
};
vm.createContext(context);
vm.runInContext(['_docResolveVariableValue', '_resolveShowcaseScrim', '_isShowcaseScrim', '_pickScrimBackground', '_buildPrimitiveContrastSwatch', '_buildPrimSwatchRow', '_placeShowcaseSection', 'groupByPath'].map(extract).join('\n'), context);
assert.strictEqual(context._resolveShowcaseScrim(black).a, 0.4, 'composed percentage alpha must resolve once');
assert.ok(context._isShowcaseScrim(black) && context._isShowcaseScrim(white) && context._isShowcaseScrim(opaque));
assert.ok(!context._isShowcaseScrim(light));
for (const [v, expectedBacking, expectedComposite] of [[black, light, 0.6], [white, dark, 0.2]]) {
  const row = context._buildPrimSwatchRow(v.name.split('/').slice(0, -1).join('/'), [v], true);
  const swatch = row.children[1].children[0];
  const container = swatch.children[1];
  assert.strictEqual(container.height, 64, 'retain ordinary swatch dimensions');
  assert.deepStrictEqual(Array.from(container.children, n => n.name), ['Neutral background', 'Scrim overlay']);
  assert.strictEqual(container.layoutMode, 'VERTICAL');
  assert.deepStrictEqual([container.paddingTop, container.paddingRight, container.paddingBottom, container.paddingLeft], [8, 8, 8, 8]);
  assert.strictEqual(container.children[0].layoutPositioning, 'ABSOLUTE', 'backplate fills the container behind the inset overlay');
  assert.strictEqual(container.children[1].width, 40);
  assert.strictEqual(container.children[1].height, 48);
  assert.strictEqual(container.children[1].cornerRadius, 4);
  assert.strictEqual(container.children[1].layoutSizingHorizontal, 'FILL');
  assert.strictEqual(container.children[1].layoutSizingVertical, 'FILL', 'inset follows the swatch as it resizes');
  const backingPaint = container.children[0].fills[0], overlayPaint = container.children[1].fills[0];
  assert.strictEqual(backingPaint.boundVariables.color.id, expectedBacking.id);
  assert.strictEqual(overlayPaint.boundVariables.color.id, v.id);
  assert.strictEqual(overlayPaint.opacity, undefined, 'do not multiply variable alpha with another opacity');
  const resolved = context._resolveShowcaseScrim(v);
  assert.ok(Math.abs(resolved.r * resolved.a + backingPaint.color.r * (1 - resolved.a) - expectedComposite) < 1e-9);
  assert.ok(!container.children.some(n => n.characters === 'AAA'), 'no contrast badges for scrims');
}
assert.strictEqual(context._buildPrimSwatchRow('Broken', [broken], true), null);
assert.ok(warnings.some(message => message.includes('unresolved')));
const scored = context._scored;
context._scored = [];
assert.strictEqual(context._buildPrimSwatchRow('No neutral', [black], true), null);
assert.ok(warnings.some(message => message.includes('contrasting neutral')));
context._scored = scored;
const ordinary = context._buildPrimSwatchRow('color/neutral', [light]);
assert.deepStrictEqual(Array.from(ordinary.children[1].children[0].children[1].children, n => n.name), ['Neutral on swatch', 'Swatch on neutral'], 'ordinary swatches keep both contrast halves');
const scrimStart = code.indexOf('      // Primitive scrims use the same table');
const scrimEnd = code.indexOf('      _appendFill(_primTable, _primitiveColorsFrame)', scrimStart);
context._primColls = [{ vars: [white, black, black4, opaque] }];
context._primTable = node('Primitives');
vm.runInContext('(function () {\n' + code.slice(scrimStart, scrimEnd) + '\n})()', context);
const groups = context._primTable.children;
assert.deepStrictEqual(Array.from(groups[0].children[1].children, n => n.children[0].characters), ['4', '40', '100'], 'opacity ordering must not be lexical');
assert.deepStrictEqual(Array.from(groups, n => n.children[0].characters), ['color/scrim/black', 'color/scrim/white']);
const primitiveBlock = code.slice(code.indexOf('const _colorVars = coll.vars.filter'), code.indexOf('const _rampMap = groupByPath(_colorVars)'));
context.coll = { vars: context._dsStruct_allVars };
const primitiveVars = vm.runInContext('(function () {' + primitiveBlock + '\nreturn _colorVars;})()', context);
assert.deepStrictEqual(Array.from(primitiveVars, v => v.id), ['light', 'dark'], 'ordinary ramps must exclude raw, composed, opaque, and unresolved scrim tokens');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '../../packages/figma-bridge-plugin/code.js'), 'utf8');
// Execute the complete renderer, including collection discovery, exclusion from
// ordinary ramps, section creation, and the final binding pass.
const start = code.indexOf('async function _buildShowcase(');
const end = code.indexOf('\nfunction _scopeForVariableName', start);
let serial = 0;
function node(type) {
  const result = {
    id: String(++serial), type, name: type, children: [], selection: [],
    width: 1200, height: 64, x: 0, y: 0, fills: [], strokes: [], boundVariables: {},
    appendChild(child) {
      child.remove(); this.children.push(child); child.parent = this;
    },
    remove() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    },
    resize(width, height) { this.width = width; this.height = height; },
    resizeWithoutConstraints(width, height) { this.resize(width, height); },
    setBoundVariable(property, variable) { this.boundVariables[property] = { type: 'VARIABLE_ALIAS', id: variable.id }; },
    async setTextStyleIdAsync(id) { this.textStyleId = id; },
  };
  return result;
}
const variable = (id, name, type, value) => ({ id, name, resolvedType: type, variableCollectionId: 'primitives', valuesByMode: { d: value } });
const variables = [
  variable('light', 'color/neutral/50', 'COLOR', { r: .96, g: .96, b: .96, a: 1 }),
  variable('dark', 'color/neutral/950', 'COLOR', { r: .07, g: .07, b: .07, a: 1 }),
  variable('opacity', 'opacity/40', 'FLOAT', 40),
  variable('black', 'color/scrim/black/40', 'COLOR', { color: { r: 0, g: 0, b: 0, a: 1 }, opacity: { type: 'VARIABLE_ALIAS', id: 'opacity' } }),
  variable('white', 'color/scrim/white/20', 'COLOR', { r: 1, g: 1, b: 1, a: .2 }),
  variable('font', 'font/sans', 'STRING', 'Inconsolata'),
];
const collections = [{ id: 'primitives', name: '1. Primitives', variableIds: variables.map(v => v.id), defaultModeId: 'd', modes: [{ modeId: 'd', name: 'Default' }] }];
const semanticVariables = [
  { ...variable('surface', 'color/surface/default', 'COLOR', { type: 'VARIABLE_ALIAS', id: 'light' }), variableCollectionId: 'semantics' },
  { ...variable('text', 'color/text/default', 'COLOR', { type: 'VARIABLE_ALIAS', id: 'dark' }), variableCollectionId: 'semantics' },
  { ...variable('overlay', 'color/overlay/scrim', 'COLOR', { type: 'VARIABLE_ALIAS', id: 'black' }), variableCollectionId: 'semantics' },
];
variables.push(...semanticVariables);
collections.push({ id: 'semantics', name: '2. Color', variableIds: semanticVariables.map(v => v.id), defaultModeId: 'd', modes: [{ modeId: 'd', name: 'Light' }] });

const root = node('DOCUMENT');
const figma = {
  root, currentPage: node('PAGE'),
  variables: {
    getLocalVariablesAsync: async () => variables,
    getLocalVariableCollectionsAsync: async () => collections,
    getVariableById: id => variables.find(v => v.id === id),
    setBoundVariableForPaint: (paint, property, v) => ({ ...paint, boundVariables: { [property]: { type: 'VARIABLE_ALIAS', id: v.id } } }),
  },
  getLocalTextStylesAsync: async () => [], getLocalEffectStylesAsync: async () => [],
  loadFontAsync: async () => {},
  createPage() { const page = node('PAGE'); root.appendChild(page); return page; },
  async setCurrentPageAsync(page) { this.currentPage = page; },
  viewport: { scrollAndZoomIntoView() {} },
};
for (const [method, type] of Object.entries({ createFrame: 'FRAME', createText: 'TEXT', createRectangle: 'RECTANGLE', createEllipse: 'ELLIPSE', createSection: 'SECTION' })) {
  figma[method] = () => { const result = node(type); figma.currentPage.appendChild(result); return result; };
}
const context = vm.createContext({ figma, setTimeout,
  _createDsBindingContext: async () => ({ pickFloatByValue: () => null, bindVar: () => false }),
  _runQaBindingAudit: async () => ({ failedCount: 0 }),
});
// Use the actual composed-value resolver, not a test replacement.
const resolverStart = code.indexOf('function _docResolveVariableValue(');
const resolverEnd = code.indexOf('\nfunction _docFormatResolvedVariableValue', resolverStart);
vm.runInContext(code.slice(resolverStart, resolverEnd) + '\n' + code.slice(start, end), context);
function descendants(parent) { return parent.children.flatMap(child => [child, ...descendants(child)]); }
module.exports = (async () => {
  for (let generation = 0; generation < 2; generation++) {
    const legacy = node('SECTION'); legacy.name = 'Token Showcase — Scrims'; figma.currentPage.appendChild(legacy);
    const result = await context._buildShowcase({ DS: { collections: { primitives: '1. Primitives' } } });
    assert.ok(!result.sections.includes('Scrims'), 'scrims must not create a separate section');
    assert.ok(!result.bindingWarnings.some(warning => /Cannot demonstrate/.test(warning)));
    const sections = figma.currentPage.children.filter(n => n.name.startsWith('Token Showcase'));
    assert.strictEqual(sections.filter(n => n.name.endsWith('Scrims')).length, 0, 'remove legacy separate scrim sections');
    const primitives = sections.find(n => n.name.endsWith('Primitive Colors'));
    assert.ok(primitives);
    const rows = descendants(primitives).filter(n => n.name === 'Table / Row / Primary Color Swatches 1.0.0');
    assert.deepStrictEqual(rows.slice(-2).map(n => n.children[0].characters), ['color/scrim/black', 'color/scrim/white']);
    assert.ok(rows.slice(0, -2).every(n => !/scrim/.test(n.children[0].characters)), 'all ordinary ramps must precede scrims');
    const overlays = descendants(primitives).filter(n => n.name === 'Scrim overlay');
    assert.deepStrictEqual(overlays.map(n => n.fills[0].boundVariables.color.id).sort(), ['black', 'white'], 'primitive swatches must exclude the semantic overlay alias');
    for (const overlay of overlays) {
      assert.strictEqual(overlay.parent.children.length, 2);
      const backing = overlay.parent.children[0];
      assert.strictEqual(backing.name, 'Neutral background');
      assert.strictEqual(backing.layoutPositioning, 'ABSOLUTE');
      assert.deepStrictEqual([overlay.parent.paddingTop, overlay.parent.paddingRight, overlay.parent.paddingBottom, overlay.parent.paddingLeft], [8, 8, 8, 8]);
      assert.strictEqual(overlay.layoutSizingHorizontal, 'FILL');
      assert.strictEqual(overlay.layoutSizingVertical, 'FILL');
      assert.strictEqual(backing.fills[0].boundVariables.color.id, overlay.fills[0].boundVariables.color.id === 'black' ? 'light' : 'dark');
      assert.strictEqual(overlay.fills[0].opacity, undefined);
    }
    for (const section of sections.filter(n => n !== primitives)) {
      assert.ok(!descendants(section).some(n => (n.fills || []).some(paint => ['black', 'white'].includes(paint.boundVariables?.color?.id))), 'scrims must not enter ordinary ramps');
    }
  }
})();

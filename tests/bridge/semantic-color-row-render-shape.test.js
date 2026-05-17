'use strict';

// Executable render-shape checks for the Semantic Colors Option A row builder.
// These do not run Figma, but they evaluate the row helper against a small
// Figma-like node stub so we can verify resolved extras become actual pair-box
// lines and preview-swatch treatment, not just source-level strings.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const codePath = path.join(repoRoot, 'packages/figma-bridge-plugin/code.js');
const code = fs.readFileSync(codePath, 'utf8');

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

function createNode(type, name) {
  return {
    type: type,
    name: name || type,
    children: [],
    fills: [],
    strokes: [],
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
    },
    resize(width, height) {
      this.width = width;
      this.height = height;
    }
  };
}

const rowHelpers = [
  '_buildSemColorRow',
  '_splitTokenLabel',
  '_buildSemPairLine',
  '_buildSemPreviewSwatch',
  '_buildSemIconGlyph'
].map(name => extractFunction(code, name)).join('\n');

const makeRow = new Function(
  'createNode',
  'const _RC = { outlineSubtle: { r: 0.8, g: 0.8, b: 0.8 }, surfaceDefault: { r: 1, g: 1, b: 1 } };\n' +
  'const _V = { outlineSubtle: { name: "color/outline/subtle" }, surfaceDefault: { name: "color/surface/default" }, text: { name: "color/text/default" }, textSub: { name: "color/text/subtle" } };\n' +
  'const _textColor = { r: 0, g: 0, b: 0 };\n' +
  'const _subColor = { r: 0.3, g: 0.3, b: 0.3 };\n' +
  'const _showcaseContrastAlgorithm = "apca";\n' +
  'const figma = {\n' +
  '  createFrame: function() { return createNode("FRAME", "Frame"); },\n' +
  '  createNodeFromSvg: function() { return { name: "SvgIcon", strokes: [{}], children: [{ name: "SvgPath", strokes: [{}], children: [] }] }; }\n' +
  '};\n' +
  'function _f(name, dir) { var node = createNode("FRAME", name); node.layoutMode = dir; return node; }\n' +
  'function _paint(rgb, varRef) { return { rgb: rgb, varRef: varRef || null }; }\n' +
  'function _tDS(str, size, color, semibold, v) { var node = createNode("TEXT", "Text"); node.characters = String(str); node.fontSize = size; node.color = color; node.semibold = !!semibold; node.varRef = v || null; return node; }\n' +
  'function _contrastRatio() { return 4.56; }\n' +
  'function _apcaLc() { return 78; }\n' +
  'function _buildBadge(ratio) { var node = createNode("FRAME", "Badge"); node.ratio = ratio; return node; }\n' +
  'function _bindNumericProp(node, prop, value, purpose) { node.boundNumeric = { prop: prop, value: value, purpose: purpose }; return true; }\n' +
  rowHelpers + '\n' +
  'return _buildSemColorRow;'
)(createNode);

function varRef(name) {
  return { name: name };
}

function rgb(r, g, b) {
  return { r: r, g: g, b: b };
}

function findByName(node, name, out) {
  out = out || [];
  if (node.name === name) out.push(node);
  if (node.children) {
    for (let i = 0; i < node.children.length; i++) findByName(node.children[i], name, out);
  }
  return out;
}

function textValues(node, out) {
  out = out || [];
  if (node.type === 'TEXT') out.push(node.characters);
  if (node.children) {
    for (let i = 0; i < node.children.length; i++) textValues(node.children[i], out);
  }
  return out;
}

const fullRow = makeRow(
  'bg/brand + text/brand',
  null,
  rgb(0.1, 0.2, 0.3),
  rgb(0.9, 0.9, 0.9),
  varRef('color/bg/brand'),
  {
    fgVar: varRef('color/text/brand'),
    roleNames: {
      bg: 'bg/brand',
      fg: 'text/brand',
      border: 'border/brand',
      icon: 'icon/brand',
      fill: 'fill/brand'
    },
    borderRGB: rgb(0.2, 0.3, 0.4),
    borderVar: varRef('color/border/brand'),
    iconRGB: rgb(0.5, 0.6, 0.7),
    iconVar: varRef('color/icon/brand'),
    fillRGB: rgb(0.8, 0.7, 0.6),
    fillVar: varRef('color/fill/brand')
  }
);

assert.deepStrictEqual(
  textValues(fullRow).filter(value => /^(BG|FG|BD|IC|FL)$/.test(value)),
  ['BG', 'FG', 'BD', 'IC', 'FL'],
  'full semantic row must render bg, fg, bd, ic, and fl pair lines'
);
assert.ok(textValues(fullRow).includes('border/brand'), 'border role name must render in the pair box');
assert.ok(textValues(fullRow).includes('icon/brand'), 'icon role name must render in the pair box');
assert.ok(textValues(fullRow).includes('fill/brand'), 'explicit fill role name must render in the pair box');

const fullPreview = findByName(fullRow, 'Preview Swatch')[0];
assert.ok(fullPreview, 'preview swatch must be present');
assert.strictEqual(
  fullPreview.strokes[0].varRef.name,
  'color/border/brand',
  'preview swatch must use the resolved border variable as its stroke'
);
assert.strictEqual(fullPreview.strokeWeight, 1, 'semantic preview border stroke should use the 1px border width');
assert.deepStrictEqual(
  fullPreview.boundNumeric,
  { prop: 'strokeWeight', value: 1, purpose: 'border' },
  'semantic preview border width should be bound through the border variable picker'
);
assert.strictEqual(findByName(fullPreview, 'Icon').length, 1, 'preview swatch must include the resolved icon glyph');
assert.strictEqual(
  findByName(fullPreview, 'Sample')[0].varRef.name,
  'color/text/brand',
  'preview sample text must bind to the foreground text semantic, not the icon semantic'
);
assert.strictEqual(
  findByName(fullPreview, 'Icon')[0].strokes[0].varRef.name,
  'color/icon/brand',
  'preview icon glyph must bind to the icon semantic'
);
assert.strictEqual(
  findByName(fullPreview, 'Icon')[0].children[0].strokes[0].varRef.name,
  'color/icon/brand',
  'preview icon child strokes must keep the icon semantic binding'
);
assert.strictEqual(findByName(fullPreview, 'DiagSide').length, 0, 'semantic row preview should not duplicate contrast diagnostics inside the swatch');
assert.strictEqual(findByName(fullRow, 'ContrastCell').length, 1, 'paired rows must render a real contrast column cell');
const contrastTexts = findByName(fullRow, 'ContrastCell')[0].children.filter(child => child.type === 'TEXT');
assert.deepStrictEqual(
  contrastTexts.map(node => node.characters),
  ['✓ Lc 78', '✓ 4.56:1'],
  'contrast cell must mark passing APCA and WCAG metrics'
);
assert.deepStrictEqual(
  contrastTexts.map(node => node.fontSize),
  [12, 12],
  'contrast values must use the same font size'
);
assert.deepStrictEqual(
  contrastTexts.map(node => node.color),
  [{ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }],
  'contrast values must use the same text color'
);
assert.strictEqual(findByName(fullRow, 'WcagCell').length, 1, 'paired rows must render the WCAG pill cell');

const plainRow = makeRow(
  'bg/plain + text/plain',
  null,
  rgb(1, 1, 1),
  rgb(0, 0, 0),
  varRef('color/bg/plain'),
  {
    fgVar: varRef('color/text/plain'),
    roleNames: { bg: 'bg/plain', fg: 'text/plain' }
  }
);

assert.deepStrictEqual(
  textValues(plainRow).filter(value => /^(BG|FG|BD|IC|FL)$/.test(value)),
  ['BG', 'FG'],
  'plain semantic row must not invent missing bd, ic, or fl lines'
);
const plainPreview = findByName(plainRow, 'Preview Swatch')[0];
assert.strictEqual(
  plainPreview.strokes[0].varRef.name,
  'color/outline/subtle',
  'plain preview swatch must keep the existing subtle-outline visual fallback'
);

console.log('semantic-color-row-render-shape: row builder extras render contract passed.');

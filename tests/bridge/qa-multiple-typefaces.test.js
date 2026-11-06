'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../packages/figma-bridge-plugin/code.js'), 'utf8');
const start = source.indexOf('async function _runQaBindingAudit(');
const end = source.indexOf('\nfunction ', start + 1);
module.exports = (async () => {
  const styles = [
    { id: 'body', name: 'type/body/md', fontName: { family: 'Inter', style: 'Regular' }, fontSize: 16 },
    { id: 'display', name: 'type/display/lg', fontName: { family: 'Space Grotesk', style: 'Regular' }, fontSize: 48 },
  ].map(style => ({ ...style, lineHeight: { unit: 'PIXELS', value: style.fontSize + 8 }, letterSpacing: { unit: 'PIXELS', value: 0 } }));
  const nodes = styles.map(style => ({ ...style, id: `node-${style.id}`, type: 'TEXT', textStyleId: '' }));
  const context = { figma: { root: { name: 'Test' }, currentPage: { name: 'Page', selection: nodes, children: nodes }, mixed: Symbol('mixed') },
    _createDsBindingContext: async () => ({ textStyles: styles, pickTypographyBinding: () => ({ kind: 'style', style: styles[0] }) }) };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const result = await context._runQaBindingAudit({});
  assert.deepStrictEqual(Array.from(result.violations, item => item.suggestion.id), ['body', 'display'], 'exact matches must distinguish two sans-serif families');
  assert.ok(result.violations.every(item => item.fixability === 'fixableNow'));
  nodes[1].fontName = { family: 'Arial', style: 'Regular' };
  const mismatch = await context._runQaBindingAudit({});
  assert.strictEqual(mismatch.violations[1].fixability, 'needsDesignerDecision', 'a family mismatch cannot be an exact automatic repair');
  assert.notStrictEqual(mismatch.violations[1].suggestion.confidence, 'high');
  nodes[1].fontName = styles[1].fontName;
  nodes.forEach((node, index) => { node.textStyleId = styles[index].id; });
  const bound = await context._runQaBindingAudit({});
  assert.strictEqual(bound.violationCount, 0, 'correctly styled mixed-family text is valid');
})();

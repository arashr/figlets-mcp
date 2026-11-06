'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../packages/figma-bridge-plugin/code.js'), 'utf8');
const start = source.indexOf('async function _runQaBindingAudit(');
const end = source.indexOf('\nfunction ', start + 1);
const auditSource = source.slice(start, end);
module.exports = (async () => {
  for (const pageScope of [false, true]) {
    const bindings = [];
    const token = { id: 'gap', name: 'space/component/lg', resolvedType: 'FLOAT' };
    const nested = { id: 'nested', type: 'FRAME', name: 'Nested', layoutMode: 'HORIZONTAL', itemSpacing: 16, children: [] };
    const off = { id: 'off', type: 'COMPONENT', name: 'State=Off', layoutMode: 'HORIZONTAL', itemSpacing: 16, children: [nested] };
    const on = { id: 'on', type: 'COMPONENT', name: 'State=On', layoutMode: 'HORIZONTAL', itemSpacing: 16, children: [] };
    const set = { id: 'set', type: 'COMPONENT_SET', name: 'Toggle', layoutMode: 'VERTICAL', itemSpacing: 16, cornerRadius: 5, paddingTop: 24, children: [off, on] };
    const nodes = [set, off, on, nested];
    const context = {
      figma: { currentPage: { name: 'Test', selection: pageScope ? [] : [set], children: [set] }, root: { name: 'Disposable' }, getNodeById: id => nodes.find(node => node.id === id) },
      _createDsBindingContext: async () => ({ textStyles: [], varById: { gap: token }, varByName: { [token.name]: token },
        pickFloatByValue: value => value === 16 ? token : null, pickFloatByNearest: () => null, resolveVarValue: () => 16,
        bindVar: (node, property) => bindings.push({ nodeId: node.id, property }) }),
    };
    vm.createContext(context);
    vm.runInContext(auditSource, context);
    const read = await context._runQaBindingAudit({});
    assert.deepStrictEqual(Array.from(read.violations, item => item.nodeId), ['off', 'nested', 'on']);
    assert.deepStrictEqual(Array.from(read.violations, item => item.issueNumber), [1, 2, 3]);
    assert.strictEqual(read.auditedNodeCount, 3);
    assert.strictEqual(bindings.length, 0);
    await context._runQaBindingAudit({ fix: true });
    assert.deepStrictEqual(bindings.map(item => item.nodeId), ['off', 'nested', 'on']);
    const stale = await context._runQaBindingAudit({ approvedSuggestions: [{ issueNumber: 1, nodeId: 'set', property: 'itemSpacing', rawValue: '16px', suggestion: { id: 'gap', name: token.name, kind: 'variable' } }] });
    assert.strictEqual(stale.fixedCount, 0);
    assert.strictEqual(stale.failedCount, 1);
    assert.ok(!bindings.some(item => item.nodeId === 'set'));

    // Auto spacing retains an inactive numeric itemSpacing in Figma's API.
    for (const mode of ['HORIZONTAL', 'VERTICAL']) {
      bindings.length = 0;
      off.layoutMode = mode;
      off.primaryAxisAlignItems = 'SPACE_BETWEEN';
      on.primaryAxisAlignItems = 'SPACE_BETWEEN';
      off.paddingTop = 16;
      const auto = await context._runQaBindingAudit({});
      assert.deepStrictEqual(Array.from(auto.violations, item => `${item.nodeId}/${item.property}`), ['off/paddingTop', 'nested/itemSpacing'], 'Auto skips only the inactive gap; padding and nested fixed gaps stay in scope');
      assert.deepStrictEqual(Array.from(auto.violations, item => item.issueNumber), [1, 2]);
      await context._runQaBindingAudit({ fix: true });
      assert.deepStrictEqual(bindings, [{ nodeId: 'off', property: 'paddingTop' }, { nodeId: 'nested', property: 'itemSpacing' }]);
      const staleAuto = await context._runQaBindingAudit({ approvedSuggestions: [{ issueNumber: 1, nodeId: 'off', property: 'itemSpacing', rawValue: '16px', suggestion: { id: 'gap', name: token.name, kind: 'variable' } }] });
      assert.strictEqual(staleAuto.fixedCount, 0, 'Old fixed-gap approval cannot bind an inactive Auto gap');
      assert.strictEqual(staleAuto.failedCount, 1);
      assert.strictEqual(off.itemSpacing, 16, 'Inspection must preserve the stored value');
    }
    off.primaryAxisAlignItems = 'MIN';
    on.primaryAxisAlignItems = 'MIN';
    const fixedAgain = await context._runQaBindingAudit({});
    assert.strictEqual(fixedAgain.violations.filter(item => item.property === 'itemSpacing').length, 3, 'Switching back to fixed spacing must restore gap findings');
  }
})();

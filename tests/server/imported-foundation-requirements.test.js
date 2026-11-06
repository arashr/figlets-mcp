'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { bootstrapDsFromSnapshot } = require('../../packages/figlets-mcp-server/src/utils/bootstrap-ds-from-figma');
const { ensureActiveDsConfig } = require('../../packages/figlets-mcp-server/src/utils/ensure-ds-config');
const { inspectDsTokenGapsFromConfigAndFigmaData: inspect } = require('../../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps');
const core = require('../../packages/figlets-core/src/ds-config');
const { handleUpdateDsPrimitives } = require('../../packages/figlets-mcp-server/src/tools/update-ds-primitives');
const { createBridgeHookFile, installBridgeHook, setBridgeHookRoute, readBridgeHookCapture } = require('../helpers/bridge-hook');
const categories = ['primitive-typography', 'primitive-shadow'];
module.exports = (async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-import-requirements-'));
  const configPath = path.join(dir, 'design-system.config.js');
  const hook = createBridgeHookFile(dir);
  const uninstall = installBridgeHook(hook);
  try {
    const snapshot = { collections: [{ id: 'p', name: '1. Primitives', modes: [{ modeId: 'd', name: 'Default' }], variableIds: ['w', 's'] }], variables: [
      { id: 'w', name: 'type/weight/regular', variableCollectionId: 'p', resolvedType: 'FLOAT', valuesByMode: { d: 450 } },
      { id: 's', name: 'shadow/custom/radius', variableCollectionId: 'p', resolvedType: 'FLOAT', valuesByMode: { d: 7 } },
    ] };
    const ds = bootstrapDsFromSnapshot(snapshot, { projectName: 'Imported' });
    const current = inspect(ds, snapshot, { categories });
    assert.strictEqual(current.summary.missingVariableCount, 0);
    const deleted = { ...snapshot, variables: [] };
    core.writeDsConfig(configPath, ds);
    ensureActiveDsConfig({ configPath, refreshGenerated: true, dataSource: { figmaData: deleted } });
    const refreshed = core.readDsConfig(configPath);
    const missing = inspect(refreshed, deleted, { categories, configPath });
    assert.deepStrictEqual(missing.tokenGaps.map(item => item.name).sort(), ['shadow/custom/radius', 'type/weight/regular']);
    assert.deepStrictEqual(missing.repairPlan.primitiveRepairPlan.applyInput.categories.sort(), categories.slice().sort());
    const repeat = inspect(refreshed, deleted, { categories });
    assert.strictEqual(repeat.summary.missingVariableCount, 2);
    assert.strictEqual(refreshed.figlets.foundationRequirements['primitive-typography'][0].value, 450);

    const capturePath = path.join(dir, 'capture.json');
    setBridgeHookRoute(hook, '/request-update-primitives', { capturePath, json: { result: { dryRun: true, report: {} } } });
    const preview = await handleUpdateDsPrimitives({ config_path: configPath, categories, create_missing: true, dry_run: true });
    assert.ok(!preview.error, preview.error);
    const captured = readBridgeHookCapture(capturePath);
    const payload = captured.body || captured;
    const entries = payload.DS.figlets.foundationPrimitiveEntries;
    assert.deepStrictEqual(entries['primitive-typography'], [{ name: 'type/weight/regular', type: 'FLOAT', value: 450 }]);
    assert.deepStrictEqual(entries['primitive-shadow'], [{ name: 'shadow/custom/radius', type: 'FLOAT', value: 7 }]);

    const source = fs.readFileSync(path.join(__dirname, '../../packages/figma-bridge-plugin/code.js'), 'utf8');
    const specs = source.slice(source.indexOf('var UPDATE_PRIMITIVE_SPECS ='), source.indexOf('function _primitiveShadowEntries'));
    const sandbox = { DS: payload.DS };
    vm.createContext(sandbox);
    vm.runInContext(specs + '; result = UPDATE_PRIMITIVE_SPECS["primitive-typography"](DS);', sandbox);
    assert.strictEqual(JSON.stringify(sandbox.result), JSON.stringify(entries['primitive-typography']));
    vm.runInContext('result = UPDATE_PRIMITIVE_SPECS["primitive-shadow"](DS);', sandbox);
    assert.strictEqual(JSON.stringify(sandbox.result), JSON.stringify(entries['primitive-shadow']));
    delete sandbox.DS.figlets.foundationPrimitiveEntries;
    assert.throws(() => vm.runInContext('UPDATE_PRIMITIVE_SPECS["primitive-typography"](DS)', sandbox), /must be prepared/);

    const broken = { ...snapshot, variables: [{ ...snapshot.variables[0], valuesByMode: { d: { type: 'VARIABLE_ALIAS', id: 'missing' } } }] };
    const findings = inspect(ds, broken, { categories });
    assert.strictEqual(findings.summary.brokenReferenceCount, 1);
    assert.strictEqual(findings.topFindings.brokenReferences[0].targetId, 'missing');
    assert.ok(findings.message.includes('unresolved variable reference'));

    const authored = { ...ds, figlets: { source: 'designer-intake' } };
    assert.ok(inspect(authored, deleted, { categories }).summary.missingVariableCount > 2, 'Explicit setup requirements remain enforced');
    const approved = { ...ds, figlets: { ...ds.figlets, foundationRequirementsApproved: true } };
    assert.ok(inspect(approved, deleted, { categories }).summary.missingVariableCount > 2, 'Approved setup retains full foundation coverage');
    core.writeDsConfig(configPath, approved);
    ensureActiveDsConfig({ configPath, refreshGenerated: true, dataSource: { figmaData: deleted } });
    assert.strictEqual(core.readDsConfig(configPath).figlets.foundationRequirementsApproved, true);

    const unknown = { ...ds, figlets: { source: 'figma-snapshot-bootstrap' } };
    assert.strictEqual(inspect(unknown, deleted, { categories }).summary.missingVariableCount, 0, 'Legacy imports must not promote unknown defaults');
    const multiMode = bootstrapDsFromSnapshot({ ...snapshot, variables: [{ ...snapshot.variables[0], valuesByMode: { d: 400, other: 500 } }] });
    const unresolvedPlan = inspect(multiMode, deleted, { categories: ['primitive-typography'] });
    assert.strictEqual(unresolvedPlan.summary.missingVariableCount, 1);
    assert.strictEqual(unresolvedPlan.repairPlan.primitiveRepairPlan, null, 'Unknown exact values must not produce an apply-ready primitive batch');
    assert.ok(unresolvedPlan.repairPlan.missingCapabilityNotes.some(note => note.kind === 'unresolved-foundation-values'));
    core.writeDsConfig(configPath, multiMode);
    const blocked = await handleUpdateDsPrimitives({ config_path: configPath, categories: ['primitive-typography'], dry_run: true });
    assert.ok(blocked.error.includes('exact mode values'), 'Never replace imported mode differences with a default');
  } finally { uninstall(); fs.rmSync(dir, { recursive: true, force: true }); }
})();

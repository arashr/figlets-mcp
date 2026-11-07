const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../../packages/figlets-core/src/ds-config');
const { handlePrepareDsConfig } = require('../../packages/figlets-mcp-server/src/tools/prepare-ds-config');
const { handlePlanDsFigmaOperations } = require('../../packages/figlets-mcp-server/src/tools/figma-operations');
const { ensureActiveDsConfig } = require('../../packages/figlets-mcp-server/src/utils/ensure-ds-config');

module.exports = (async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-motion-config-'));
  const configPath = path.join(dir, 'design-system.config.js');
  const snapshotPath = path.join(dir, 'figma-data.json');
  const original = {
    project: { name: 'Motion Config Test' }, grid: { base: 4 }, breakpoints: { modes: ['Desktop'], tier: 1 },
    typography: { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
    color: { scale: '50-950', algorithm: 'oklch', contrastAlgorithm: 'wcag', convention: 'role-based', brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }] },
    collections: { primitives: '1. Primitives', color: '2. Color', typography: '3. Typography', spacing: '4. Spacing', elevation: '5. Elevation' },
    figlets: { source: 'figma-snapshot-bootstrap' },
  };
  try {
    core.writeDsConfig(configPath, original);
    const before = fs.readFileSync(configPath, 'utf8');
    const preview = await handlePrepareDsConfig({ config_path: configPath, motion_profile: 'default' });
    assert.strictEqual(preview.phase, 'review_motion_profile');
    assert.strictEqual(preview.motion.collection, '6. Motion');
    assert.strictEqual(preview.motion.tokens.length, 8);
    assert.deepStrictEqual(preview.motion.modes, ['Default', 'Reduced Motion']);
    assert.strictEqual(fs.readFileSync(configPath, 'utf8'), before, 'motion preview must not write the config');
    assert.deepStrictEqual(fs.readdirSync(dir), ['design-system.config.js'], 'motion preview must not run the normal writing pipeline');
    assert.ok(preview.motion.accessibilityNote.includes('do not prove runtime accessibility'));
    assert.ok(!preview.motion.tokens.some(token => Object.values(token.values).some(value => value && value.type === 'CUSTOM_SPRING')));

    const edited = JSON.parse(JSON.stringify(preview.motion.profile));
    edited.durations['motion/duration/standard'].Default = 250;
    const stale = await handlePrepareDsConfig({ ...preview.saveInput, motion_profile: edited });
    assert.ok(stale.error.includes('changed'));
    assert.strictEqual(fs.readFileSync(configPath, 'utf8'), before);
    const revised = await handlePrepareDsConfig({ config_path: configPath, motion_profile: edited });
    const saved = await handlePrepareDsConfig(revised.saveInput);
    assert.strictEqual(saved.phase, 'motion_config_saved');
    assert.strictEqual(saved.figmaChanged, false);
    const persisted = JSON.parse(JSON.stringify(core.readDsConfig(configPath)));
    assert.deepStrictEqual(persisted.motion, edited);
    assert.deepStrictEqual({ ...persisted, motion: undefined, collections: original.collections }, { ...original, motion: undefined });
    assert.ok((await handlePrepareDsConfig(revised.saveInput)).error, 'saving the old preview twice must reject the changed config');
    const prepared = await handlePrepareDsConfig(saved.nextInput);
    assert.ok(!prepared.error, prepared.error);
    assert.strictEqual(prepared.readyToBuild, true);
    assert.strictEqual(prepared.motion.profile.durations['motion/duration/standard'].Default, 250);
    assert.strictEqual(prepared.motionPlanInput, undefined, 'included motion belongs to the normal setup call');
    assert.ok(prepared.setupApprovalPreview.collections.some(item => item.name === '6. Motion'));

    const snapshot = { capabilities: { variableResolvedTypes: ['TIMING', 'EASING'], atomicVariableValueBatches: true }, collections: Object.values(original.collections).map((name, index) => ({ id: `c${index}`, name, variableIds: [], modes: [{ name: 'Default', modeId: `m${index}` }] })), variables: [] };
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    const foundation = handlePlanDsFigmaOperations({ motion_config_path: configPath, figmaDataPath: snapshotPath });
    assert.strictEqual(foundation.phase, 'motion_foundation_setup');
    assert.deepStrictEqual(foundation.repairPlan.applyInput.operations, [{ kind: 'create_collection', name: '6. Motion', modes: ['Default', 'Reduced Motion'] }]);
    const motionCollection = { id: 'motion', name: '6. Motion', variableIds: [], modes: [{ name: 'Default', modeId: 'd' }] };
    snapshot.collections.push(motionCollection);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    const missingMode = handlePlanDsFigmaOperations({ ...foundation.continuation.input, figmaDataPath: snapshotPath });
    assert.strictEqual(missingMode.phase, 'motion_foundation_setup');
    assert.strictEqual(missingMode.repairPlan.applyInput.operations[0].kind, 'create_mode');
    assert.strictEqual(missingMode.repairPlan.applyInput.operations[0].modeName, 'Reduced Motion');
    motionCollection.modes.push({ name: 'Reduced Motion', modeId: 'r' });
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    const variables = handlePlanDsFigmaOperations({ motion_config_path: configPath, figmaDataPath: snapshotPath });
    assert.strictEqual(variables.phase, 'motion_variables');
    assert.strictEqual(variables.repairPlan.counts.ready, 8);
    const duration = variables.repairPlan.applyInput.operations.find(operation => operation.name === 'motion/duration/standard');
    assert.strictEqual(duration.modeValues[0].value, 0.25);
    assert.strictEqual(duration.modeValues[1].value, 0);
    snapshot.collections.push({ ...motionCollection, id: 'duplicate-motion' });
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    const duplicateCollections = handlePlanDsFigmaOperations({ motion_config_path: configPath, figmaDataPath: snapshotPath });
    assert.ok(duplicateCollections.error.includes('ambiguous'));
    assert.strictEqual(duplicateCollections.repairPlan, undefined, 'an exact name cannot disambiguate multiple target collection IDs');
    snapshot.collections.pop();

    snapshot.variables.push({ id: 'conflict', name: 'motion/duration/standard', variableCollectionId: 'motion', resolvedType: 'FLOAT', valuesByMode: { d: 250, r: 0 } });
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    assert.ok(handlePlanDsFigmaOperations({ motion_config_path: configPath, figmaDataPath: snapshotPath }).error.includes('not TIMING'));
    motionCollection.modes = [{ name: 'Default', modeId: 'd' }];
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    const conflictBeforeMode = handlePlanDsFigmaOperations({ motion_config_path: configPath, figmaDataPath: snapshotPath });
    assert.ok(conflictBeforeMode.error.includes('not TIMING'));
    assert.strictEqual(conflictBeforeMode.repairPlan, undefined, 'known token conflicts must block before proposing foundation mutation');
    snapshot.collections = snapshot.collections.filter(collection => collection.id !== 'motion');
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    const conflictBeforeCollection = handlePlanDsFigmaOperations({ motion_config_path: configPath, figmaDataPath: snapshotPath });
    assert.ok(conflictBeforeCollection.error.includes('outside'));
    assert.strictEqual(conflictBeforeCollection.repairPlan, undefined);
    snapshot.collections.push(motionCollection);
    snapshot.variables = [];
    const refresh = ensureActiveDsConfig({ configPath, refreshGenerated: true, dataSource: { figmaData: snapshot, meta: {} } });
    assert.ok(!refresh.error);
    assert.strictEqual(core.readDsConfig(configPath).motion.durations['motion/duration/standard'].Default, 250, 'sync bootstrap must preserve the approved profile');
    assert.strictEqual(core.readDsConfig(configPath).collections.motion, '6. Motion');
    core.writeDsConfig(configPath, { ...original, motion: edited });
    assert.strictEqual(core.motionProfilePreview(core.readDsConfig(configPath)).collection, '6. Motion');
    ensureActiveDsConfig({ configPath, refreshGenerated: true, dataSource: { figmaData: snapshot, meta: {} } });
    assert.strictEqual(core.readDsConfig(configPath).collections.motion, '6. Motion', 'sync must materialize and preserve the pre-sync implicit name');

    const invalid = core.defaultMotionProfile(); invalid.modes = ['Default'];
    assert.ok(core.normalizeMotionProfile(invalid).errors.length);
    const invalidDuration = core.defaultMotionProfile(); invalidDuration.durations['motion/duration/fast'].Default = -1;
    assert.ok(core.normalizeMotionProfile(invalidDuration).errors.length);
    assert.strictEqual(core.motionProfilePreview(original), null, 'ordinary configs must not receive motion defaults');
    const sparse = { primitives: '1. Primitives', spacing: '4. Spacing' };
    assert.strictEqual(core.motionCollectionName(sparse, [{ name: '5. Elevation' }, { name: '6. Motion' }]), '6. Motion', 'reuse the existing live collection even when bootstrap config omits elevation');
    assert.strictEqual(core.motionCollectionName(sparse, [{ name: '5. Elevation' }]), '6. Motion');
    assert.throws(() => core.motionCollectionName(sparse, [{ name: '6. Motion' }, { name: '7. Motion' }]), /Multiple motion/);
    core.writeDsConfig(configPath, { ...original, collections: sparse });
    const reusePreview = await handlePrepareDsConfig({ config_path: configPath, motion_profile: 'default' });
    assert.strictEqual(reusePreview.motion.collection, '6. Motion', 'the actual preview must inspect its sibling snapshot for existing motion collections');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();

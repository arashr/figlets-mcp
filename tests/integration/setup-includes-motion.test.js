'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { harness } = require('../helpers/figma-operations-harness');
const { freshMcpClient } = require('../helpers/mcp-client');
const core = require('../../packages/figlets-core/src/ds-config');
const { handlePrepareDsConfig } = require('../../packages/figlets-mcp-server/src/tools/prepare-ds-config');
const { handleApplyDsSetup } = require('../../packages/figlets-mcp-server/src/tools/apply-ds-setup');

module.exports = (async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-setup-motion-'));
  const configPath = path.join(dir, 'setup-test', 'design-system.config.js');
  fs.mkdirSync(path.dirname(configPath));
  fs.writeFileSync(path.join(dir, 'active-file.json'), JSON.stringify({ fileKey: 'setup-test' }));
  const snapshotPath = path.join(dir, 'figma-data.json');
  const previousUrl = process.env.FIGLETS_RECEIVER_URL;
  let bridge, scenario, routes, baseWrites, valueWrites;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        routes.push(req.url);
        let result;
        if (req.url === '/request-sync') {
          const snapshot = bridge.snapshot(scenario === 'file-switch' && baseWrites ? 'different-file' : 'setup-test');
          if (scenario === 'unsupported') snapshot.capabilities.variableResolvedTypes = ['FLOAT'];
          if (scenario === 'bad-readback' && valueWrites) snapshot.variables[0].valuesByMode.first = 123;
          fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
          result = { fileKey: snapshot.fileKey, dataPath: snapshotPath };
        } else if (req.url === '/request-ds-setup') {
          baseWrites++;
          const names = ['1. Primitives', '2. Color', '3. Typography', '4. Spacing', '5. Elevation'];
          if (scenario === 'config-change') {
            const ds = core.readDsConfig(configPath); ds.motion.durations['motion/duration/fast'].Default = 999; core.writeDsConfig(configPath, ds);
          }
          result = { result: { collections: names, skipped: [] } };
        } else if (req.url === '/request-figma-operations') {
          if (payload.atomicVariableBatch) valueWrites++;
          result = { result: await bridge.apply(payload) };
        } else throw Error('Unexpected route ' + req.url);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
      } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.FIGLETS_RECEIVER_URL = 'http://127.0.0.1:' + server.address().port;
  async function run(name, options = {}) {
    scenario = name; routes = []; baseWrites = 0; valueWrites = 0;
    bridge = harness({ empty: true, nativeNumbers: true, failMode: name === 'mode-failure', failWrite: name === 'value-failure', failWriteName: 'motion/easing/exit' });
    const ds = {
      project: { name: 'Unified setup' }, grid: { base: 4 }, breakpoints: { modes: ['Desktop'], tier: 1 },
      typography: { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
      collections: { primitives: '1. Primitives', color: '2. Color', typography: '3. Typography', spacing: '4. Spacing', elevation: '5. Elevation', ...(options.skip ? {} : { motion: '6. Motion' }) },
      color: { scale: '50-950', algorithm: 'oklch', contrastAlgorithm: 'wcag', brand: [{ name: 'primary', role: 'primary', hex: '#3366FF' }] },
      ...(options.skip ? {} : { motion: core.defaultMotionProfile() }),
    };
    core.writeDsConfig(configPath, ds);
    const preview = await handlePrepareDsConfig({ config_path: configPath, continue_with_contrast_warnings: true });
    assert.strictEqual(preview.readyToBuild, true);
    assert.strictEqual(preview.setupApprovalPreview.collections.some(item => item.name === '6. Motion'), !options.skip);
    if (name === 'wrong-type') {
      const collection = bridge.figma.variables.createVariableCollection('6. Motion');
      const variable = bridge.make('conflict', 'motion/duration/fast', 'FLOAT', { first: 100 });
      variable.variableCollectionId = collection.id; bridge.variables.push(variable);
    }
    return options.deferApply ? preview : handleApplyDsSetup({ config_path: configPath });
  }
  try {
    const skipped = await run('skip', { skip: true });
    assert.ok(!skipped.error, skipped.error);
    assert.deepStrictEqual(routes, ['/request-ds-setup'], 'skipping motion must retain the ordinary setup path');
    assert.strictEqual(skipped.motion, undefined);

    const built = await run('success');
    assert.ok(!built.error, built.error);
    assert.strictEqual(built.motionPending, false);
    assert.strictEqual(built.motion.complete, true);
    assert.strictEqual(built.motion.verification.tokenCount, 8);
    assert.strictEqual(built.nextStep, undefined, 'normal setup must not ask for a separate motion workflow');
    assert.strictEqual(built.collections.length, 6);
    assert.deepStrictEqual(bridge.collections[0].modes.map(mode => mode.name), ['Default', 'Reduced Motion']);
    assert.strictEqual(bridge.variables.filter(item => !item.removed).length, 8);
    assert.strictEqual(valueWrites, 1);
    assert.strictEqual(baseWrites, 1);
    const ids = bridge.variables.map(variable => variable.id);
    const beforeRetry = routes.length;
    const repeated = await handleApplyDsSetup({ config_path: configPath });
    assert.ok(!repeated.error, repeated.error);
    assert.strictEqual(repeated.motion.complete, true);
    assert.deepStrictEqual(bridge.variables.map(variable => variable.id), ids);
    assert.ok(!routes.slice(beforeRetry).includes('/request-figma-operations'), 'completed motion should not be rewritten on retry');

    const unrelated = bridge.figma.variables.createVariable('motion/custom/unrelated', bridge.collections[0], 'FLOAT');
    unrelated.setValueForMode(bridge.collections[0].modes[0].modeId, 42);
    const unrelatedBefore = JSON.stringify(unrelated.valuesByMode);
    const edited = core.readDsConfig(configPath);
    edited.motion.durations['motion/duration/fast'].Default = 150;
    core.writeDsConfig(configPath, edited);
    const updated = await handleApplyDsSetup({ config_path: configPath });
    assert.ok(!updated.error, updated.error);
    assert.strictEqual(updated.motion.complete, true);
    assert.deepStrictEqual(bridge.variables.slice(0, ids.length).map(variable => variable.id), ids);
    assert.strictEqual(JSON.stringify(unrelated.valuesByMode), unrelatedBefore, 'configured setup must not touch unrelated tokens');
    assert.strictEqual(bridge.variables.find(variable => variable.name === 'motion/duration/fast').valuesByMode.first, Math.fround(.15));

    await run('mcp', { deferApply: true });
    const client = await freshMcpClient({ FIGLETS_LOCAL_DIR: dir });
    try {
      await client.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'unified-setup', version: '1.0.0' } });
      fs.unlinkSync(configPath);
      const answers = {
        config_path: configPath, project_name: 'Unified setup', platform: 'Web', grid_base: 4,
        breakpoint_tier: '3-tier', semantic_color_grammar: 'intent/emphasis', contrast_standard: 'WCAG 2.2',
        theme_behavior: 'light + dark', color_scale: '50-950', brand_colors: [{ name: 'primary', hex: '#3366FF', role: 'primary' }],
        typography: { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
      };
      const missingMotion = await client.tool('create_ds_config_from_intake', answers);
      assert.strictEqual(missingMotion.configWritten, false);
      assert.ok(missingMotion.selectionPrompt);
      assert.strictEqual(fs.existsSync(configPath), false);
      const intake = await client.tool('create_ds_config_from_intake', { ...answers, motion_choice: 'include', motion_profile: 'default' });
      assert.strictEqual(intake.configWritten, true);
      assert.ok(intake.preview.motion);
      const preview = await client.tool('prepare_ds_config', { config_path: configPath, continue_with_contrast_warnings: true });
      assert.strictEqual(preview.setupApprovalPreview.collections.length, 6);
      assert.strictEqual(preview.motionPlanInput, undefined);
      const result = await client.tool('apply_ds_setup', { config_path: configPath });
      assert.strictEqual(result.motion.complete, true);
      assert.strictEqual(result.motionPending, false);
      assert.strictEqual(result.nextStep, undefined);
      assert.strictEqual(result.collections.length, 6);
      assert.strictEqual(baseWrites, 1);
      assert.strictEqual(valueWrites, 1, 'one registered setup call must complete the internal motion stages');
    } finally { await client.close(); }

    const conflict = await run('wrong-type');
    assert.ok(conflict.error.includes('not TIMING'));
    assert.strictEqual(baseWrites, 0, 'known motion conflicts must be checked before base mutation');

    const unsupported = await run('unsupported');
    assert.ok(unsupported.error.includes('TIMING'));
    assert.strictEqual(baseWrites, 0, 'unsupported motion capabilities must be detected before mutation');

    const modeFailure = await run('mode-failure');
    assert.ok(modeFailure.error);
    assert.strictEqual(modeFailure.partial, true);
    assert.strictEqual(modeFailure.motionPending, true);
    assert.strictEqual(valueWrites, 0, 'never continue to values after mode creation failure');

    const valueFailure = await run('value-failure');
    assert.ok(valueFailure.error);
    assert.strictEqual(valueFailure.motionPending, true);
    assert.strictEqual(valueFailure.motion.stages.at(-1).result.batchStatus, 'rolled_back');
    assert.strictEqual(bridge.variables.filter(item => !item.removed).length, 0);

    const badReadback = await run('bad-readback');
    assert.ok(badReadback.error.includes('approved value'));
    assert.strictEqual(badReadback.motionPending, true);
    assert.strictEqual(valueWrites, 1, 'failed readback must not retry in a loop');

    const changedFile = await run('file-switch');
    assert.ok(changedFile.error.includes('Figma file changed'));
    assert.strictEqual(valueWrites, 0);

    const changedConfig = await run('config-change');
    assert.ok(changedConfig.error.includes('config changed'));
    assert.strictEqual(valueWrites, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousUrl === undefined) delete process.env.FIGLETS_RECEIVER_URL; else process.env.FIGLETS_RECEIVER_URL = previousUrl;
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

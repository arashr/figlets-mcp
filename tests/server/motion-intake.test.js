'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../../packages/figlets-core/src/ds-config');
const { handlePrepareDsConfig } = require('../../packages/figlets-mcp-server/src/tools/prepare-ds-config');

module.exports = (async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-motion-intake-'));
  const configPath = path.join(dir, 'test-file', 'design-system.config.js');
  fs.mkdirSync(path.dirname(configPath));
  fs.writeFileSync(path.join(dir, 'active-file.json'), JSON.stringify({ fileKey: 'test-file' }));
  const previousLocal = process.env.FIGLETS_LOCAL_DIR;
  process.env.FIGLETS_LOCAL_DIR = dir;
  delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/utils/paths')];
  delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/tools/design-md-intake')];
  const { handleCreateDsConfigFromIntake } = require('../../packages/figlets-mcp-server/src/tools/design-md-intake');
  const answers = {
    config_path: configPath, project_name: 'Motion intake', platform: 'Web', grid_base: 4,
    breakpoint_tier: '3-tier', semantic_color_grammar: 'intent/emphasis', contrast_standard: 'WCAG 2.2',
    theme_behavior: 'light + dark', color_scale: '50-950', brand_colors: [{ name: 'primary', hex: '#3366FF', role: 'primary' }],
    typography: { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
  };
  try {
    const missing = handleCreateDsConfigFromIntake(answers);
    assert.strictEqual(missing.configWritten, false);
    assert.strictEqual(missing.readyForPrepare, false);
    assert.deepStrictEqual(missing.needsDesignerInput, ['motion choice (include motion or skip for now)']);
    assert.ok(missing.selectionPrompt.choices.some(choice => choice.input.motion_choice === 'skip'));
    assert.strictEqual(fs.existsSync(configPath), false, 'the config must not be saved before the motion question');

    const skipped = handleCreateDsConfigFromIntake({ ...answers, motion_choice: 'skip' });
    assert.strictEqual(skipped.configWritten, true);
    assert.strictEqual(core.readDsConfig(configPath).motion, undefined);
    assert.strictEqual(core.readDsConfig(configPath).collections.motion, undefined);
    assert.strictEqual(core.readDsConfig(configPath).figlets.motionChoice, 'skip');
    assert.strictEqual(handleCreateDsConfigFromIntake(answers).configWritten, true, 'do not ask again after a known skip');

    const included = handleCreateDsConfigFromIntake({ ...answers, motion_choice: 'include' });
    assert.strictEqual(included.configWritten, true);
    assert.strictEqual(included.preview.motion.collection, '6. Motion');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(core.readDsConfig(configPath).motion)), core.normalizeMotionProfile(core.defaultMotionProfile()).profile);
    const fullPreview = await handlePrepareDsConfig({ config_path: configPath, continue_with_contrast_warnings: true });
    assert.strictEqual(fullPreview.setupApprovalPreview.collections.length, 6);
    assert.strictEqual(fullPreview.motionPlanInput, undefined);

    const custom = core.defaultMotionProfile(); custom.durations['motion/duration/fast'].Default = 175;
    const customResult = handleCreateDsConfigFromIntake({ ...answers, motion_profile: custom, motion_collection: 'Transitions' });
    assert.strictEqual(customResult.configWritten, true, 'an explicit profile already answers the optional motion choice');
    assert.strictEqual(core.readDsConfig(configPath).motion.durations['motion/duration/fast'].Default, 175);
    assert.strictEqual(core.readDsConfig(configPath).collections.motion, 'Transitions');
    assert.strictEqual(handleCreateDsConfigFromIntake(answers).configWritten, true);
    assert.strictEqual(core.readDsConfig(configPath).motion.durations['motion/duration/fast'].Default, 175, 'reuse the approved profile instead of replacing it');

    const beforeInvalid = fs.readFileSync(configPath, 'utf8');
    const invalid = core.defaultMotionProfile(); invalid.modes = ['Default'];
    const rejected = handleCreateDsConfigFromIntake({ ...answers, motion_choice: 'include', motion_profile: invalid });
    assert.strictEqual(rejected.configWritten, false);
    assert.strictEqual(fs.readFileSync(configPath, 'utf8'), beforeInvalid);

    const omit = handleCreateDsConfigFromIntake({ ...answers, motion_choice: 'skip' });
    assert.strictEqual(omit.configWritten, true);
    assert.strictEqual(core.readDsConfig(configPath).motion, undefined);
    assert.strictEqual(core.readDsConfig(configPath).collections.motion, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (previousLocal === undefined) delete process.env.FIGLETS_LOCAL_DIR; else process.env.FIGLETS_LOCAL_DIR = previousLocal;
    delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/utils/paths')];
    delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/tools/design-md-intake')];
  }
})();

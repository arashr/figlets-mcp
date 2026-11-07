'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../../packages/figlets-core/src/ds-config');
const { buildSetupSnapshot } = require('../helpers/setup-snapshot');
const { freshMcpClient } = require('../helpers/mcp-client');
const { bootstrapDsFromSnapshot } = require('../../packages/figlets-mcp-server/src/utils/bootstrap-ds-from-figma');

const hex = row => '#' + row.slice(1, 4).map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
function seed(scale, convention = 'surface-based', algorithm = 'oklch') {
  return {
    project: { name: 'Scale and anchor' }, grid: { base: 4 }, breakpoints: { modes: ['Desktop'], tier: 1 },
    typography: { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
    color: { scale, convention, algorithm, contrastAlgorithm: 'apca', brand: [
      { name: 'primary', role: 'primary', hex: '#FFC850' },
      { name: 'secondary', role: 'secondary', hex: '#B52840' },
    ] },
  };
}

module.exports = (async () => {
  // All existing ranges retain their inventories. Templates, not explicit
  // assignments, translate to the requested range.
  for (const scale of Object.keys(core.COLOR_SCALES)) for (const convention of ['surface-based', 'role-based']) for (const algorithm of ['oklch', 'hsl']) for (const strategy of ['standard', 'contrast-harmonized']) {
    if (algorithm === 'hsl' && strategy === 'contrast-harmonized') continue;
    const input = seed(scale, convention, algorithm);
    input.color.rampStrategy = strategy;
    const generated = core.generateColorRamps(core.computeDsConfig(input).ds);
    const validated = core.validateSemanticPairs(generated.ds);
    assert.deepStrictEqual(generated.steps, core.COLOR_SCALES[scale]);
    assert.ok(generated.summary.includes(scale + ' scale'));
    const inventory = new Set();
    for (const ramp of generated.ds.color.ramps) {
      assert.deepStrictEqual(ramp.steps.map(row => row[0]), core.COLOR_SCALES[scale]);
      ramp.steps.forEach(row => inventory.add(ramp.folder + '/' + row[0]));
    }
    for (const anchor of generated.brandAnchors) {
      const ramp = generated.ds.color.ramps.find(item => item.folder === 'color/' + anchor.name);
      assert.strictEqual(hex(ramp.steps.find(row => row[0] === anchor.step)), anchor.hex);
      assert.ok(generated.summary.includes('step ' + anchor.step));
    }
    const anchor = generated.brandAnchors.find(item => item.name === 'primary');
    const pair = validated.ds.color.semantics.pairs.find(item => item.bg === (convention === 'surface-based' ? 'color/surface/brand' : 'color/bg/brand'));
    assert.strictEqual(pair.Light.bg, anchor.path);
    assert.strictEqual(pair.Dark.bg, anchor.path);
    assert.deepStrictEqual(validated.ds.color.ramps, generated.ds.color.ramps, 'semantic adaptation must not change primitives');
    assert.strictEqual(validated.referenceErrors.length, 0);
    for (const item of validated.ds.color.semantics.pairs) for (const mode of ['Light', 'Dark']) {
      if (item[mode]) for (const ref of Object.values(item[mode])) assert.ok(inventory.has(ref), 'semantic reference must exist: ' + ref);
    }
  }
  assert.throws(() => core.generateColorRamps(seed('unsupported')), /Unsupported color scale/);
  assert.throws(() => core.generateColorRamps({ ...seed('0-100'), color: { ...seed('0-100').color, steps: [50, 500, 950] } }), /conflict/);
  const small = core.generateColorRamps(core.computeDsConfig(seed('0-100')).ds);
  const explicit = { ...small.ds, color: { ...small.ds.color, semantics: { icons: false, pairs: [{ bg: 'color/surface/brand', text: 'color/on-surface/brand', Light: { bg: 'color/primary/60', text: 'color/neutral/0' } }] } } };
  assert.strictEqual(core.validateSemanticPairs(explicit).ds.color.semantics.pairs[0].Light.bg, 'color/primary/60', 'explicit designer mappings stay unchanged');
  explicit.color.semantics.pairs[0].Light.bg = 'color/primary/600';
  const invalidRef = core.validateSemanticPairs(explicit);
  assert.ok(invalidRef.referenceErrors.length, 'an out-of-range saved alias must not silently collapse to 100');
  assert.strictEqual(invalidRef.ds.color.semantics.pairs[0].Light.bg, 'color/primary/600');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-scale-anchor-'));
  const configPath = path.join(dir, 'file', 'design-system.config.js');
  fs.mkdirSync(path.dirname(configPath));
  fs.writeFileSync(path.join(dir, 'active-file.json'), JSON.stringify({ fileKey: 'file' }));
  const client = await freshMcpClient({ FIGLETS_LOCAL_DIR: dir });
  try {
    await client.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'brand-scale-regression', version: '1.0.0' } });
    const intake = await client.tool('create_ds_config_from_intake', {
      config_path: configPath, project_name: 'Requested 0-100', platform: 'Android', grid_base: 4, breakpoint_tier: '3-tier',
      semantic_color_grammar: 'paired context', contrast_standard: 'APCA', theme_behavior: 'light + dark', color_scale: '0 to 100',
      brand_colors: seed('0-100').color.brand, typography: { scalePreset: 'material3', families: { sans: 'Roboto', display: 'Impact', mono: 'Roboto Mono' } }, motion_choice: 'skip',
    });
    assert.strictEqual(intake.configWritten, true);
    assert.strictEqual(intake.preview.colorScale, '0-100');
    const prepared = await client.tool('prepare_ds_config', { config_path: configPath, continue_with_contrast_warnings: true });
    const ds = core.readDsConfig(configPath);
    assert.strictEqual(ds.color.scale, '0-100');
    assert.deepStrictEqual(prepared.setupApprovalPreview.colorSystem.steps, core.COLOR_SCALES['0-100']);
    const anchor = ds.color.brandAnchors.find(item => item.name === 'primary');
    assert.strictEqual(anchor.hex, '#FFC850');
    assert.strictEqual(ds.color.semantics.pairs.find(pair => pair.bg === 'color/surface/brand').Light.bg, anchor.path);
    const snapshot = await buildSetupSnapshot(ds);
    assert.ok(!snapshot.error, snapshot.error);
    const variables = snapshot.variables;
    const byId = new Map(variables.map(variable => [variable.id, variable]));
    assert.ok(variables.filter(variable => /^color\/[^/]+\/\d+$/.test(variable.name)).every(variable => Number(variable.name.split('/').at(-1)) <= 100));
    const brand = variables.find(variable => variable.name === 'color/surface/brand');
    for (const value of Object.values(brand.valuesByMode)) {
      const primitive = byId.get(value.id);
      assert.strictEqual(primitive.name, anchor.path);
      const rgb = Object.values(primitive.valuesByMode)[0];
      assert.deepStrictEqual([rgb.r, rgb.g, rgb.b].map(channel => Math.round(channel * 255)), [255, 200, 80]);
    }
    const imported = bootstrapDsFromSnapshot({ ...snapshot, fileName: 'Requested 0-100' });
    assert.strictEqual(imported.color.scale, '0-100');
    assert.strictEqual(imported.color.brand[0].hex, '#FFC850', 'readback must not infer the brand from a midpoint');
    assert.strictEqual(imported.color.brand[0].step, anchor.step);
    const repeated = await client.tool('prepare_ds_config', { config_path: configPath });
    assert.strictEqual(repeated.setupApprovalPreview.colorSystem.scale, '0-100');
    assert.strictEqual(core.readDsConfig(configPath).color.semantics.pairs.find(pair => pair.bg === 'color/surface/brand').Light.bg, anchor.path);
  } finally { await client.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})();

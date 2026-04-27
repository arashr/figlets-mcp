'use strict';

const assert = require('assert');
const {
  computeDsConfig,
  generateColorRamps,
  validateSemanticPairs,
  generatePrimitivesData,
} = require('../../packages/figlets-core/src/ds-config/index.js');

function makeDs(overrides) {
  var base = {
    grid:        { base: 8 },
    breakpoints: { modes: ['Mobile', 'Tablet', 'Desktop'], tier: 3 },
    typography:  { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
    color: {
      scale:      '50-950',
      brand:      [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }],
      convention: 'role-based',
    },
    naming:      { textStyle: 'type/{role}/{size}', fontFamily: 'font/{variant}' },
    collections: {
      primitives: '1. Primitives',
      color:      '2. Color',
      typography: '3. Typography',
      spacing:    '4. Spacing',
      elevation:  '5. Elevation',
    },
  };
  return overrides ? Object.assign(base, overrides) : base;
}

// ── computeDsConfig ──────────────────────────────────────────────────────────
{
  const { ds, computed } = computeDsConfig(makeDs());
  assert.ok(computed.includes('DS.primitives.spacing'), 'computed should include DS.primitives.spacing');
  assert.ok(computed.includes('DS.spacing'),            'computed should include DS.spacing');
  assert.ok(computed.includes('DS.typography.scale'),   'computed should include DS.typography.scale');
  assert.ok(ds.primitives.spacing.some(s => s[0] === 11), 'space/11 (touch target) must be present');
  assert.ok(ds.spacing.semantic['touch/min'],            'touch/min semantic token must exist');
  assert.strictEqual(ds.spacing.radius.md, 8,            'radius.md should be 8 for 8px base');
  assert.ok(ds.typography.scale['display/lg'],           'display/lg must be in scale');
}

// 4-tier breakpoints add Wide
{
  const ds4 = makeDs();
  ds4.breakpoints = { modes: ['Mobile', 'Tablet', 'Desktop', 'Wide'], tier: 4 };
  const { ds } = computeDsConfig(ds4);
  assert.strictEqual(ds.typography.scale['display/lg'].sizes.length, 4, '4-tier should produce 4-element sizes arrays');
}

// 4px base — spacing scale differs
{
  const ds4px = makeDs();
  ds4px.grid = { base: 4 };
  const { ds } = computeDsConfig(ds4px);
  assert.strictEqual(ds.spacing.radius.md, 4, 'radius.md should be 4 for 4px base');
  assert.ok(ds.primitives.spacing.some(s => s[0] === 0.5), 'space/0.5 should exist for 4px base');
}

// ── generateColorRamps ───────────────────────────────────────────────────────
{
  const ds0 = computeDsConfig(makeDs()).ds;
  const { ds, derivedColors } = generateColorRamps(ds0);
  assert.ok(ds.color.ramps && ds.color.ramps.length >= 6, 'Expected ≥ 6 ramps');
  assert.ok(ds.color.ramps.find(r => r.folder === 'color/cobalt'),  'Missing cobalt ramp');
  assert.ok(ds.color.ramps.find(r => r.folder === 'color/neutral'), 'Missing neutral ramp');
  assert.ok(ds.color.ramps.find(r => r.folder === 'color/red'),     'Missing red ramp');
  assert.ok(derivedColors.length > 0, 'Expected a derived secondary color');
  const cobalt = ds.color.ramps.find(r => r.folder === 'color/cobalt');
  assert.strictEqual(cobalt.steps.length, 11, 'cobalt ramp should have 11 steps (50-950)');
}

// custom steps override scale
{
  const ds0 = computeDsConfig(makeDs()).ds;
  ds0.color.steps = [50, 200, 500, 800, 950];
  const { ds } = generateColorRamps(ds0);
  const cobalt = ds.color.ramps.find(r => r.folder === 'color/cobalt');
  assert.strictEqual(cobalt.steps.length, 5, 'Custom steps should produce 5-step ramp');
}

// ── validateSemanticPairs ────────────────────────────────────────────────────
{
  let ds = computeDsConfig(makeDs()).ds;
  ds = generateColorRamps(ds).ds;
  const { ds: ds2, failCount, markdownTable, iconTable } = validateSemanticPairs(ds);
  assert.ok(markdownTable.includes('color/bg/default'), 'pairs table must include color/bg/default');
  assert.ok(iconTable.includes('color/icon/brand'),     'icon table must include color/icon/brand');
  assert.ok(ds2.color.semantics,                        'DS.color.semantics must be set');
  assert.ok(Array.isArray(ds2.color.semantics.pairs),   'semantics.pairs must be an array');
  assert.strictEqual(typeof failCount, 'number',         'failCount must be a number');
}

// ── generatePrimitivesData ───────────────────────────────────────────────────
{
  let ds = computeDsConfig(makeDs()).ds;
  ds = generateColorRamps(ds).ds;
  ds = validateSemanticPairs(ds).ds;
  const { colors, floats, strings, scrims, collectionName } = generatePrimitivesData(ds);
  assert.strictEqual(collectionName, '1. Primitives', 'Unexpected collectionName');
  assert.ok(colors.length >= 77, 'Expected ≥ 77 color vars (7 ramps × 11 steps)');
  assert.strictEqual(scrims.length, 10, 'Expected exactly 10 scrim vars');
  assert.ok(strings.length >= 2, 'Expected at least 2 font family strings');
  assert.ok(floats.find(f => f.name === 'shadow/1/offset-y'), 'Missing shadow/1/offset-y');
  assert.ok(floats.find(f => f.name === 'space/11'),          'Missing space/11 (touch target)');
  assert.ok(floats.find(f => f.name === 'type/weight/bold'),  'Missing type/weight/bold');
}

// ── handlePrepareDsConfig — missing config returns error ─────────────────────
{
  const { handlePrepareDsConfig } = require('../../packages/figlets-mcp-server/src/tools/prepare-ds-config.js');
  const result = handlePrepareDsConfig({ config_path: '/tmp/nonexistent-figlets-config-zz.js' });
  assert.ok(result.error, 'Expected error object for missing config');
}

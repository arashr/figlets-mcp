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

// algorithm switch — default is oklch, hsl is selectable, the brand color
// pins the 500 step exactly in both modes, and OKLCh keeps lights more chromatic
{
  const ds0 = computeDsConfig(makeDs()).ds;
  const { ds: dsDefault, summary: summaryDefault } = generateColorRamps(ds0);
  assert.ok(summaryDefault.includes('oklch'), 'Default summary should mention oklch algorithm');

  const ds1 = computeDsConfig(makeDs()).ds;
  ds1.color.algorithm = 'hsl';
  const { ds: dsHsl, summary: summaryHsl } = generateColorRamps(ds1);
  assert.ok(summaryHsl.includes('hsl'), 'HSL summary should mention hsl algorithm');

  // 500 step pins to brand exactly under both algorithms
  const brand = { r: 0x3b / 255, g: 0x82 / 255, b: 0xf6 / 255 };
  for (const ramps of [dsDefault.color.ramps, dsHsl.color.ramps]) {
    const cobalt = ramps.find(r => r.folder === 'color/cobalt');
    const five = cobalt.steps.find(s => s[0] === 500);
    assert.ok(Math.abs(five[1] - brand.r) < 1e-6, '500 step red channel must match brand');
    assert.ok(Math.abs(five[2] - brand.g) < 1e-6, '500 step green channel must match brand');
    assert.ok(Math.abs(five[3] - brand.b) < 1e-6, '500 step blue channel must match brand');
  }

  // OKLCh light tints should retain more chroma than HSL's heavy desaturation.
  // Compare step 200 of cobalt: max(R,G,B) - min(R,G,B) is a rough chroma proxy.
  function spread(stepRow) {
    const [, r, g, b] = stepRow;
    return Math.max(r, g, b) - Math.min(r, g, b);
  }
  const oklchStep = dsDefault.color.ramps.find(r => r.folder === 'color/cobalt').steps.find(s => s[0] === 200);
  const hslStep   = dsHsl.color.ramps    .find(r => r.folder === 'color/cobalt').steps.find(s => s[0] === 200);
  assert.ok(spread(oklchStep) > spread(hslStep),
    `OKLCh light tint should be more chromatic than HSL (oklch=${spread(oklchStep).toFixed(3)}, hsl=${spread(hslStep).toFixed(3)})`);

  // OKLCh neutral is intentionally achromatic; it must not inherit brand hue.
  const neutral = dsDefault.color.ramps.find(r => r.folder === 'color/neutral');
  for (const row of neutral.steps) {
    const [, r, g, b] = row;
    assert.ok(Math.abs(r - g) < 0.002, `neutral/${row[0]} red/green channels should match`);
    assert.ok(Math.abs(g - b) < 0.002, `neutral/${row[0]} green/blue channels should match`);
  }

  // OKLCh also emits a deliberately subtle neutral-variant ramp for surfaces.
  const neutralVariant = dsDefault.color.ramps.find(r => r.folder === 'color/neutral-variant');
  assert.ok(neutralVariant, 'Default OKLCh output should include neutral-variant ramp');
  for (const row of neutralVariant.steps) {
    const [, r, g, b] = row;
    assert.ok(spread(row) > 0.001, `neutral-variant/${row[0]} should carry a tiny hue`);
    assert.ok(spread(row) < 0.05, `neutral-variant/${row[0]} hue must stay subtle`);
  }

  // It can be disabled for strict monochrome systems.
  const dsMono = computeDsConfig(makeDs()).ds;
  dsMono.color.neutralVariant = false;
  const { ds: dsNoVariant } = generateColorRamps(dsMono);
  assert.ok(!dsNoVariant.color.ramps.find(r => r.folder === 'color/neutral-variant'),
    'neutralVariant=false should disable neutral-variant ramp');

  // Invalid algorithm throws a clear error
  const dsBad = computeDsConfig(makeDs()).ds;
  dsBad.color.algorithm = 'lch';
  assert.throws(
    () => generateColorRamps(dsBad),
    /algorithm/,
    'Unknown algorithm should throw'
  );
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

// neutral-variant backfills generated surface semantics without clobbering unrelated pairs
{
  let ds = computeDsConfig(makeDs({ color: {
    scale: '50-950',
    convention: 'surface-based',
    brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }],
    semantics: {
      pairs: [{
        bg: 'color/surface/variant',
        text: 'color/on-surface/default',
        Light: { bg: 'color/neutral/100', text: 'color/neutral/950' },
        Dark: { bg: 'color/neutral/900', text: 'color/neutral/50' },
      }]
    }
  }})).ds;
  ds = generateColorRamps(ds).ds;
  ds = validateSemanticPairs(ds).ds;
  const pair = ds.color.semantics.pairs.find(p => p.bg === 'color/surface/variant');
  assert.strictEqual(pair.Light.bg, 'color/neutral-variant/100', 'surface variant Light should backfill to neutral-variant');
  assert.strictEqual(pair.Dark.bg, 'color/neutral-variant/900', 'surface variant Dark should backfill to neutral-variant');
}

// generated surface success foreground backfills to a passing contrast value
{
  let ds = computeDsConfig(makeDs({ color: {
    scale: '100-900',
    convention: 'surface-based',
    brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }],
    semantics: {
      pairs: [{
        bg: 'color/surface/success',
        text: 'color/on-surface/success',
        Light: { bg: 'color/green/600', text: 'color/neutral/900' },
        Dark: { bg: 'color/green/500', text: 'color/neutral/950' },
      }]
    }
  }})).ds;
  ds = generateColorRamps(ds).ds;
  const result = validateSemanticPairs(ds);
  const pair = result.ds.color.semantics.pairs.find(p => p.bg === 'color/surface/success');
  assert.strictEqual(pair.Light.bg, 'color/green/700', 'surface success Light bg should darken when neutral/50 is unavailable');
  assert.strictEqual(pair.Light.text, 'color/neutral/100', 'surface success Light text should resolve to the lightest available neutral foreground');
  assert.strictEqual(result.failCount, 0, 'surface success backfill should clear the generated contrast failure');
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

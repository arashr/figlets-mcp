'use strict';

const assert = require('assert');
const { generateColorRamps } = require('../../packages/figlets-core/src/ds-config/generate-color-ramps');

function makeDs(brands) {
  return {
    grid:        { base: 8 },
    breakpoints: { modes: ['Mobile', 'Tablet', 'Desktop'], tier: 3 },
    typography:  { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
    color: {
      scale:     '100-900',
      algorithm: 'oklch',
      brand:     brands,
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
}

function anchorStepFor(name, ds) {
  const ramp = ds.color.ramps.find(r => r.folder === 'color/' + name);
  if (!ramp) throw new Error('ramp not found: ' + name);
  // anchorIdx = index where the brand hex lands (no interpolation applied)
  // We find it by running generateColorRamps and reading the summary
  return ramp;
}

// ── Test lime: L ≈ 0.74 → auto step 300 on 100-900 scale ────────────────────
{
  const { ds, summary } = generateColorRamps(makeDs([
    { name: 'lime', hex: '#88bf2e', role: 'primary' },
  ]));

  // The brand anchor line in the summary
  assert.ok(summary.includes('lime'), 'summary includes lime');
  assert.ok(summary.includes('step 300'), 'lime anchors at step 300');
  assert.ok(summary.includes('(auto)'), 'lime is flagged as auto');
}

// ── Test teal: L ≈ 0.49 → auto step 600 on 100-900 scale ────────────────────
{
  const { summary } = generateColorRamps(makeDs([
    { name: 'teal', hex: '#2f6b6b', role: 'primary' },
  ]));

  assert.ok(summary.includes('teal'), 'summary includes teal');
  assert.ok(summary.includes('step 600'), 'teal anchors at step 600');
  assert.ok(summary.includes('(auto)'), 'teal is flagged as auto');
}

// ── Test sand: L ≈ 0.59 → auto step 500 on 100-900 scale ────────────────────
{
  const { summary } = generateColorRamps(makeDs([
    { name: 'sand', hex: '#8d7971', role: 'primary' },
  ]));

  assert.ok(summary.includes('sand'), 'summary includes sand');
  assert.ok(summary.includes('step 500'), 'sand anchors at step 500');
  assert.ok(summary.includes('(auto)'), 'sand is flagged as auto');
}

// ── Test explicit override: step: 700 wins over auto ─────────────────────────
{
  const { summary } = generateColorRamps(makeDs([
    { name: 'lime', hex: '#88bf2e', role: 'primary', step: 700 },
  ]));

  assert.ok(summary.includes('step 700'), 'explicit step 700 is honored');
  assert.ok(summary.includes('(override)'), 'override is flagged correctly');
  assert.ok(!summary.includes('step 300'), 'auto step 300 is NOT used when override present');
}

console.log('brand-anchor: all assertions passed');

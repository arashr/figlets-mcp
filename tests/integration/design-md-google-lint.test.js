'use strict';

const assert = require('assert');

const { designMdIntake } = require('../../packages/figlets-core/src/ds-config/index.js');

// Representative DS exercising brand colors, multi-step ramps, semantic pairs,
// responsive typography + spacing, and radius scale.
const DS = {
  project: { name: 'Lint Reference DS', description: 'A representative system for compliance testing.' },
  color: {
    contrastAlgorithm: 'apca',
    ramps: [
      { folder: 'color/brand', steps: [
        [100, 0.92, 0.88, 0.98],
        [500, 0.4, 0.2, 0.8],
        [900, 0.12, 0.06, 0.24]
      ] },
      { folder: 'color/neutral', steps: [
        [100, 0.97, 0.97, 0.97],
        [500, 0.5, 0.5, 0.5],
        [900, 0.1, 0.1, 0.1]
      ] }
    ],
    brand: [
      { name: 'brand', hex: '#6633CC', role: 'primary', step: 500 },
      { name: 'neutral', hex: '#808080', role: 'neutral', step: 500 }
    ],
    semantics: {
      pairs: [
        {
          bg: 'color/surface/default',
          text: 'color/on-surface/default',
          Light: { bg: 'color/neutral/100', text: 'color/neutral/900' },
          Dark: { bg: 'color/neutral/900', text: 'color/neutral/100' }
        },
        {
          bg: 'color/surface/brand',
          text: 'color/on-surface/brand',
          Light: { bg: 'color/brand/500', text: 'color/brand/100' },
          Dark: { bg: 'color/brand/900', text: 'color/brand/100' }
        }
      ]
    }
  },
  typography: {
    scale: {
      'display/lg': { sizes: [40, 48, 56], lineHeights: [44, 52, 60], weight: 600, tracking: -0.5 },
      'body/md': { sizes: [16, 16, 16], lineHeights: [24, 24, 24], weight: 400, tracking: 0 },
      'label/sm': { sizes: [12, 12, 12], lineHeights: [16, 16, 16], weight: 500, tracking: 0.1 }
    },
    families: { sans: 'Public Sans', mono: 'JetBrains Mono' }
  },
  spacing: {
    semantic: { 'component/sm': [8, 8, 8], 'component/md': [12, 14, 16], 'component/lg': [16, 20, 24] },
    radius: { sm: 4, md: 8, lg: 16 },
    border: { default: 1 }
  },
  grid: { base: 8 }
};

module.exports = (async () => {
  let lint;
  try {
    ({ lint } = await import('@google/design.md/linter'));
  } catch (err) {
    // Dev dependency missing (offline / minimal install). Skip rather than fail.
    process.stderr.write('SKIP design-md-google-lint: ' + err.message + '\n');
    return;
  }

  const markdown = designMdIntake.dsConfigToDesignMd(DS);
  assert.ok(
    /colors:\n(?:  .+\n)*  primary: "#6633CC"/.test(markdown),
    'Brand role should emit a bare `primary` color even when the ramp/name is `brand`.'
  );
  assert.ok(
    markdown.includes('surface-brand-dark:'),
    'Dark-mode semantic pairs should be represented as standard component variants.'
  );
  assert.ok(
    markdown.includes('| Ramp | Steps | Range | Tokens |'),
    'Colors prose should include a detailed primitive ramp table.'
  );
  assert.ok(
    markdown.includes('| surface/brand | color/brand/500 (#6633CC) | color/brand/100 (#EBE0FA) | color/brand/900 (#1F0F3D) | color/brand/100 (#EBE0FA) |'),
    'Colors prose should include resolved Light/Dark semantic color aliases.'
  );
  const report = lint(markdown);

  assert.strictEqual(
    report.summary.errors,
    0,
    'Google linter reported errors: ' + JSON.stringify(report.findings.filter(f => f.severity === 'error'), null, 2)
  );

  // Section order must match the spec.
  const wantedOrder = ['Overview', 'Colors', 'Typography', 'Layout', 'Shapes', 'Components'];
  assert.deepStrictEqual(
    report.sections,
    wantedOrder,
    'Section order must match canonical DESIGN.md ordering. Got: ' + JSON.stringify(report.sections)
  );

  // Recommended-token coverage: bare `primary` should be present (no 'missing primary' warning).
  const missingPrimary = report.findings.find(f => f.message && /no .primary./i.test(f.message) && /defined/i.test(f.message));
  assert.ok(!missingPrimary, 'Bare `primary` brand color should be emitted: ' + (missingPrimary && missingPrimary.message));

  // Round-trip: parsing the exported markdown should reconstruct the DS via the
  // figlets-extended block, including fields that are not expressible in the
  // standard front matter (responsive size triples, mode-specific aliases,
  // contrast algorithm).
  const roundTrip = designMdIntake.designMdToDsConfig(markdown);
  assert.strictEqual(roundTrip.parsed.extended, true, 'Round-trip should detect the figlets-extended block.');
  assert.strictEqual(roundTrip.ds.color.contrastAlgorithm, 'apca', 'contrastAlgorithm must round-trip.');
  assert.strictEqual(roundTrip.ds.color.semantics.pairs.length, 2, 'Semantic pairs must round-trip.');
  assert.deepStrictEqual(
    roundTrip.ds.color.semantics.pairs[0].Dark,
    { bg: 'color/neutral/900', text: 'color/neutral/100' },
    'Dark-mode aliases must round-trip.'
  );
  assert.deepStrictEqual(
    roundTrip.ds.typography.scale['body/md'].sizes,
    [16, 16, 16],
    'Responsive size triples must round-trip.'
  );
  assert.deepStrictEqual(
    roundTrip.ds.spacing.semantic['component/md'],
    [12, 14, 16],
    'Responsive spacing triples must round-trip.'
  );
  assert.strictEqual(roundTrip.ds.spacing.border.default, 1, 'Border width must round-trip.');
})();

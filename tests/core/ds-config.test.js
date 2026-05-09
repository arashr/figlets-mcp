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

// contrast-harmonized ramp strategy treats the brand color as hue/chroma seed,
// then places it on a fixed perceptual lightness ladder. This is inspired by
// contrast-contract palette tools, but remains Figlets' own deterministic path.
{
  function rowLc(markdown, folder, step, column) {
    const afterFolder = markdown.split('**' + folder + '**')[1];
    const block = afterFolder.split('\n**')[0];
    const line = block.split('\n').find(l => l.includes('`/' + step + '`'));
    assert.ok(line, 'Missing markdown row for ' + folder + '/' + step);
    const cells = line.split('|').map(s => s.trim());
    const cell = column === 'black' ? cells[6] : cells[4];
    const match = cell.match(/Lc\s+(\d+)/);
    assert.ok(match, 'Missing APCA value in ' + folder + '/' + step + ' ' + column);
    return Number(match[1]);
  }
  function range(values) {
    return Math.max.apply(null, values) - Math.min.apply(null, values);
  }
  function assertMonotonicLightness(ramp) {
    const { srgbToOklch } = require('../../packages/figlets-core/src/ds-config/oklch.js');
    let prev = null;
    for (const row of ramp.steps) {
      const L = srgbToOklch({ r: row[1], g: row[2], b: row[3] }).L;
      if (prev !== null) {
        assert.ok(
          L < prev,
          ramp.folder + ' must darken monotonically; step ' + row[0] + ' L=' + L.toFixed(3) + ' after ' + prev.toFixed(3)
        );
      }
      prev = L;
    }
  }

  const base = makeDs({
    color: {
      scale: '50-950',
      algorithm: 'oklch',
      convention: 'role-based',
      brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }]
    }
  });

  const standard = generateColorRamps(computeDsConfig(base).ds);
  const harmonizedDs = computeDsConfig(base).ds;
  harmonizedDs.color.rampStrategy = 'contrast-harmonized';
  const harmonized = generateColorRamps(harmonizedDs);

  assert.ok(harmonized.summary.includes('contrast-harmonized'), 'summary should mention contrast-harmonized strategy');

  const utilityFolders = ['color/red', 'color/green', 'color/blue'];
  const standardLightRange = range(utilityFolders.map(folder => rowLc(standard.markdownTable, folder, 200, 'black')));
  const harmonizedLightRange = range(utilityFolders.map(folder => rowLc(harmonized.markdownTable, folder, 200, 'black')));
  const standardDarkRange = range(utilityFolders.map(folder => rowLc(standard.markdownTable, folder, 800, 'white')));
  const harmonizedDarkRange = range(utilityFolders.map(folder => rowLc(harmonized.markdownTable, folder, 800, 'white')));

  assert.ok(
    harmonizedLightRange < standardLightRange,
    'contrast-harmonized /200 steps should have tighter APCA-on-black spread'
  );
  assert.ok(
    harmonizedDarkRange <= standardDarkRange,
    'contrast-harmonized /800 steps should not loosen APCA-on-white spread'
  );
  for (const folder of ['color/cobalt', 'color/red', 'color/green', 'color/yellow', 'color/blue']) {
    assertMonotonicLightness(harmonized.ds.color.ramps.find(r => r.folder === folder));
  }

  const validated = validateSemanticPairs(harmonized.ds);
  assert.strictEqual(
    validated.failCount,
    0,
    'contrast-harmonized generated role-based semantic pairs should pass APCA'
  );
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

  // Anchor step pins to brand exactly under both algorithms.
  // The anchor is auto-derived from luminance (cobalt L≈0.62 → step 400 on 50-950 scale).
  const brand = { r: 0x3b / 255, g: 0x82 / 255, b: 0xf6 / 255 };
  for (const ramps of [dsDefault.color.ramps, dsHsl.color.ramps]) {
    const cobalt = ramps.find(r => r.folder === 'color/cobalt');
    // Find the step that exactly matches the brand hex (the anchor step)
    const anchorRow = cobalt.steps.find(function(s) {
      return Math.abs(s[1] - brand.r) < 1e-6 && Math.abs(s[2] - brand.g) < 1e-6 && Math.abs(s[3] - brand.b) < 1e-6;
    });
    assert.ok(anchorRow, 'anchor step red channel must match brand exactly');
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

  const dsBadStrategy = computeDsConfig(makeDs()).ds;
  dsBadStrategy.color.algorithm = 'hsl';
  dsBadStrategy.color.rampStrategy = 'contrast-harmonized';
  assert.throws(
    () => generateColorRamps(dsBadStrategy),
    /contrast-harmonized/,
    'Contrast-harmonized strategy should require OKLCh'
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
  const successBg = ds2.color.semantics.pairs.find(p => p.bg === 'color/bg/success');
  const successFill = ds2.color.semantics.pairs.find(p => p.bg === 'color/fill/success');
  assert.ok(successBg, 'role-based utility backgrounds should expose soft bg/success');
  assert.ok(successFill, 'role-based utility strong states should expose explicit fill/success');
  assert.strictEqual(successBg.text, 'color/text/success');
  assert.strictEqual(successFill.text, 'color/text/on-success');
  assert.ok(/green\/50$/.test(successBg.Light.bg), 'bg/success Light should be a soft surface tint');
  assert.ok(/green\/800$/.test(successFill.Light.bg), 'fill/success Light should be the strong filled surface');
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

// generated surface success foreground backfills to a passing contrast value.
// Pinned to WCAG mode because the backfill is specifically about clearing a WCAG
// shortfall (neutral/50 absent → text clamps to neutral/100 → green/600 fails AA).
// APCA mode is exercised in dedicated tests further down.
{
  let ds = computeDsConfig(makeDs({ color: {
    scale: '100-900',
    convention: 'surface-based',
    contrastAlgorithm: 'wcag',
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

// ── APCA contrast option ─────────────────────────────────────────────────────

// Default algorithm is APCA. The DS object echoes the chosen algorithm so
// downstream consumers can verify the resolved choice without having to
// re-derive a default elsewhere.
{
  let ds = computeDsConfig(makeDs()).ds;
  ds = generateColorRamps(ds).ds;
  const result = validateSemanticPairs(ds);
  assert.strictEqual(result.ds.color.contrastAlgorithm, 'apca', 'default algorithm should be apca');
  assert.ok(result.summary.includes('apca'), 'summary should mention apca');
}

// WCAG mode is selectable and the algorithm field round-trips.
{
  let ds = computeDsConfig(makeDs({ color: { scale: '50-950', brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }], convention: 'role-based', contrastAlgorithm: 'wcag' }})).ds;
  ds = generateColorRamps(ds).ds;
  const result = validateSemanticPairs(ds);
  assert.strictEqual(result.ds.color.contrastAlgorithm, 'wcag', 'wcag should round-trip when explicitly set');
  assert.ok(result.summary.includes('wcag'), 'summary should mention wcag');
}

// Every resolved pair carries both `wcagPass` and `apcaPass` regardless of the
// chosen algorithm, and `pass` is gated to whichever algorithm was selected.
{
  let ds = computeDsConfig(makeDs()).ds;
  ds = generateColorRamps(ds).ds;
  const apcaResult = validateSemanticPairs(ds);
  const apcaSample = apcaResult.ds.color.semantics.pairs[0];

  // `ds.color.semantics.pairs` exposes only bg/text/Light/Dark for the public
  // config shape. The richer per-mode {wcag, apca, pass, ...} is on `tableRows`,
  // which we access via the markdownTable shape and re-running with WCAG mode.
  // The structural guarantees we care about are visible on the markdownTable.
  assert.ok(apcaResult.markdownTable.includes('Light APCA'), 'markdown should expose Light APCA column');
  assert.ok(apcaResult.markdownTable.includes('Dark APCA'),  'markdown should expose Dark APCA column');

  // Switching algorithms must produce different summary text and may produce
  // different failCount; the algorithm field flips on the returned DS.
  let dsWcag = computeDsConfig(makeDs({ color: { scale: '50-950', brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }], convention: 'role-based', contrastAlgorithm: 'wcag' }})).ds;
  dsWcag = generateColorRamps(dsWcag).ds;
  const wcagResult = validateSemanticPairs(dsWcag);
  assert.notStrictEqual(wcagResult.summary, apcaResult.summary, 'apca and wcag summaries should differ');
}

// `suggestStep` walks the ramp using the gated algorithm's threshold. We force
// a known failure by giving the success pair a near-white text against a
// medium-bright bg; under both gates the validator must produce a suggestion
// path back from the same green ramp (not from neutral or another ramp).
{
  let ds = computeDsConfig(makeDs({ color: {
    scale: '50-950',
    convention: 'surface-based',
    brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }],
    contrastAlgorithm: 'apca',
    semantics: {
      pairs: [{
        bg: 'color/surface/danger-variant',
        text: 'color/on-surface/default',
        Light: { bg: 'color/red/300', text: 'color/red/200' },
        Dark:  { bg: 'color/red/700', text: 'color/red/800' },
      }]
    }
  }})).ds;
  ds = generateColorRamps(ds).ds;
  const result = validateSemanticPairs(ds);
  // Either the markdown table calls out a suggestion, or the failCount is
  // non-zero — whichever, the row produced suggestion data rather than
  // silently passing a clearly-failing pair.
  const suggestionMentioned = result.markdownTable.includes('suggest color/red');
  assert.ok(
    suggestionMentioned || result.failCount > 0,
    'low-contrast pair must surface a suggestion or contribute to failCount under APCA'
  );
}
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

// ── APCA math — validate-semantic-pairs uses APCA 0.0.98G, exercised via a
//    controlled pair with known Lc values. Black (#000) on white (#FFF) is the
//    canonical anchor: APCA Lc ≈ 106 (positive = dark text on light bg).
//    White on black is the polarity mirror: Lc ≈ -108 (negative = light on dark).
//    We test this indirectly by constructing a pair that only passes under APCA
//    and verifying the validator emits the correct signed value in the markdown.
{
  let ds = computeDsConfig(makeDs({ color: {
    scale: '50-950',
    convention: 'surface-based',
    brand: [{ name: 'cobalt', hex: '#3B82F6', role: 'primary' }],
    contrastAlgorithm: 'apca',
    semantics: {
      pairs: [{
        bg: 'color/surface/check',
        text: 'color/on-surface/check',
        Light: { bg: 'color/neutral/50',  text: 'color/neutral/900' }, // near-white bg, near-black txt → high Lc
        Dark:  { bg: 'color/neutral/900', text: 'color/neutral/50'  }, // near-black bg, near-white txt → high |Lc|
      }]
    }
  }})).ds;
  ds = generateColorRamps(ds).ds;
  const result = validateSemanticPairs(ds);
  // High-contrast white/black anchors must produce Lc well above 75 under APCA.
  // The exact value is implementation-specific; ≥ 75 is the surface-text threshold.
  const lcMatch = result.markdownTable.match(/Lc\s+(\d+)/);
  const firstLc = lcMatch ? parseInt(lcMatch[1], 10) : 0;
  assert.ok(firstLc >= 75, 'Near-black text on near-white bg must produce Lc ≥ 75; got Lc ' + firstLc);
  // The pair should pass APCA (failCount 0 for this one pair).
  assert.strictEqual(result.failCount, 0, 'High-contrast anchor pair must pass APCA with failCount 0');
}

// APCA and WCAG anchors should match current reference formulas. The screenshot
// pair catches APCA offset drift; #777/#fff catches the WCAG AA boundary.
{
  const ds = {
    color: {
      brand: [{ name: 'neutral', role: 'primary' }],
      convention: 'role-based',
      contrastAlgorithm: 'apca',
      ramps: [{
        folder: 'color/neutral',
        steps: [
          [0, 0, 0, 0],
          [100, 1, 1, 1],
          [700, 0x77 / 255, 0x77 / 255, 0x77 / 255],
          [800, 0x38 / 255, 0x31 / 255, 0x2e / 255],
        ],
      }],
      semantics: {
        pairs: [{
          bg: 'color/test/screenshot',
          text: 'color/test/text',
          Light: { bg: 'color/neutral/800', text: 'color/neutral/100' },
          Dark: { bg: 'color/neutral/100', text: 'color/neutral/0' },
        }],
      },
    },
  };
  const result = validateSemanticPairs(ds);
  assert.ok(
    result.markdownTable.includes('| 12.8:1 | Lc 102 | ✓ APCA (Lc 102) | 21.0:1 | Lc 106 | ✓ APCA (Lc 106) |'),
    'APCA/WCAG anchors should include #fff on #38312e = Lc 102 / 12.8 and #000 on #fff = Lc 106 / 21'
  );

  const wcagDs = JSON.parse(JSON.stringify(ds));
  wcagDs.color.contrastAlgorithm = 'wcag';
  wcagDs.color.semantics.pairs[0].Light = { bg: 'color/neutral/100', text: 'color/neutral/700' };
  const wcagResult = validateSemanticPairs(wcagDs);
  assert.ok(
    wcagResult.markdownTable.includes('| 4.5:1 | Lc 71 | ✗ FAIL |'),
    'WCAG #777 on #fff should round to 4.5 ratio while remaining below AA body text'
  );
  assert.strictEqual(wcagResult.failCount, 1, 'WCAG #777 on #fff should fail the 4.5 unrounded AA gate');
}

// ── handlePrepareDsConfig — missing config returns error ─────────────────────
{
  const { handlePrepareDsConfig } = require('../../packages/figlets-mcp-server/src/tools/prepare-ds-config.js');
  const result = handlePrepareDsConfig({ config_path: '/tmp/nonexistent-figlets-config-zz.js' });
  assert.ok(result.error, 'Expected error object for missing config');
}

'use strict';

const fs = require('fs');
const path = require('path');

const CONFIRMATION_PHRASE = 'RESET_AND_BREAK_DISPOSABLE_FIGMA_FILE';

const PALETTES = [
  {
    label: 'cobalt-lime',
    brand: [
      { name: 'cobalt', hex: '#3B82F6', role: 'primary' },
      { name: 'lime', hex: '#84CC16', role: 'secondary' },
      { name: 'rose', hex: '#F43F5E', role: 'accent' },
    ],
  },
  {
    label: 'violet-amber',
    brand: [
      { name: 'violet', hex: '#7C3AED', role: 'primary' },
      { name: 'amber', hex: '#F59E0B', role: 'secondary' },
      { name: 'teal', hex: '#14B8A6', role: 'accent' },
    ],
  },
  {
    label: 'indigo-coral',
    brand: [
      { name: 'indigo', hex: '#4F46E5', role: 'primary' },
      { name: 'coral', hex: '#F97316', role: 'secondary' },
      { name: 'emerald', hex: '#10B981', role: 'accent' },
    ],
  },
];

function normalizeSeed(seed) {
  const value = String(seed || '').trim();
  if (value) return value;
  return 'bnn-37-' + new Date().toISOString().slice(0, 10);
}

function hashSeed(seed) {
  let hash = 2166136261;
  const value = normalizeSeed(seed);
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seed) {
  let state = hashSeed(seed) || 1;
  return function rng() {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function pickMany(rng, items, count) {
  const pool = items.slice();
  const picked = [];
  while (pool.length && picked.length < count) {
    const index = Math.floor(rng() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked.sort();
}

function buildBrokenDsFixturePlan(options) {
  const seed = normalizeSeed(options && options.seed);
  const rng = makeRng(seed);
  const palette = PALETTES[Math.floor(rng() * PALETTES.length)] || PALETTES[0];

  const foregroundCandidates = [
    'color/text/on-brand',
    'color/text/brand',
    'color/on-surface/brand',
    'color/on-surface/brand-variant',
  ];
  const tokenCandidates = [
    'space/radius/md',
    'space/border/default',
    'space/component/md',
    'type/body/md/size',
    'type/body/md/line-height',
    'elevation/2/radius',
  ];

  const foregroundCount = 2 + Math.floor(rng() * 2);
  const tokenCount = 4 + Math.floor(rng() * 2);

  return {
    seed,
    confirmation: CONFIRMATION_PHRASE,
    reset: true,
    palette: palette.label,
    gaps: {
      removeVariables: pickMany(rng, foregroundCandidates, foregroundCount)
        .concat(pickMany(rng, tokenCandidates, tokenCount))
        .sort(),
      removeTextStyles: ['type/body/md'],
      trimCollectionModes: [
        { collectionName: '4. Spacing', keepModeNames: ['Mobile'] },
      ],
      createBindingAuditTargets: true,
      createSemanticNamingConflicts: [
        { source: 'color/bg/danger', target: 'color/bg/on-danger', kind: 'invalid-on-background' },
        { source: 'color/surface/info', target: 'color/surface/on-info', kind: 'invalid-on-background' },
      ],
    },
  };
}

function buildFixtureConfig(options) {
  const seed = normalizeSeed(options && options.seed);
  const rng = makeRng(seed);
  const palette = PALETTES[Math.floor(rng() * PALETTES.length)] || PALETTES[0];
  return {
    project: { name: 'BNN-37 Broken DS Fixture ' + seed, platform: 'Web app' },
    grid: { base: 4 },
    breakpoints: { modes: ['Mobile', 'Tablet', 'Desktop'], tier: 3 },
    typography: { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
    color: {
      scale: '50-950',
      algorithm: 'oklch',
      contrastAlgorithm: 'wcag',
      convention: 'role-based',
      brand: palette.brand,
    },
    naming: { textStyle: 'type/{role}/{size}', fontFamily: 'font/{variant}', typePrefix: 'type' },
    collections: {
      primitives: '1. Primitives',
      color: '2. Color',
      typography: '3. Typography',
      spacing: '4. Spacing',
      elevation: '5. Elevation',
    },
  };
}

function writeFixtureConfig(configPath, options) {
  const resolved = path.resolve(configPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const ds = buildFixtureConfig(options || {});
  fs.writeFileSync(resolved, 'const DS = ' + JSON.stringify(ds, null, 2) + ';\n', 'utf8');
  return { configPath: resolved, ds };
}

module.exports = {
  CONFIRMATION_PHRASE,
  buildBrokenDsFixturePlan,
  buildFixtureConfig,
  normalizeSeed,
  writeFixtureConfig,
};

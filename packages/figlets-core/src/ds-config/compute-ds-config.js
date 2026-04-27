'use strict';

/**
 * compute-ds-config.js
 * Computes DS.spacing (semantic + radius + border) and DS.typography.scale from presets.
 * Pure function — no file I/O. Takes a DS object, returns updated DS + metadata.
 *
 * @param {object} ds - The DS config object (from design-system.config.js)
 * @returns {{ ds, computed, needsClaude, preview }}
 */
function computeDsConfig(ds) {
  const DS     = Object.assign({}, ds);
  const base   = DS.grid?.base || 8;
  const modes  = DS.breakpoints?.modes || ['Mobile', 'Tablet', 'Desktop'];
  const tier   = DS.breakpoints?.tier  || 3;
  const preset = DS.typography?.scalePreset || 'material3';

  const computed    = [];
  const needsClaude = [];
  const preview     = [];

  // ── Spacing primitives (Collection 1) ──────────────────────────────────────
  const PRIM_SPACING_8 = [
    [0, 0], [1, 4], [2, 8], [3, 12], [4, 16], [5, 20], [6, 24],
    [8, 32], [10, 40], [11, 44], [12, 48], [16, 64], [20, 80], [24, 96],
    [32, 128], [40, 160], [48, 192], [64, 256],
  ];

  const PRIM_SPACING_4 = [
    [0, 0], [0.5, 2], [1, 4], [2, 8], [3, 12], [4, 16], [5, 20],
    [6, 24], [8, 32], [10, 40], [11, 44], [12, 48], [16, 64], [20, 80],
    [24, 96], [32, 128],
  ];

  const primSpacing = base === 4 ? PRIM_SPACING_4 : PRIM_SPACING_8;
  if (!DS.primitives) DS.primitives = {};
  DS.primitives.spacing = primSpacing;
  computed.push('DS.primitives.spacing');
  preview.push(`  DS.primitives.spacing — ${primSpacing.length} steps (${base}px base)`);

  // ── Semantic spacing (Collection 4) ────────────────────────────────────────
  const SEMANTIC_8 = {
    'component/xs':      [4,  4,   4  ],
    'component/sm':      [8,  8,   8  ],
    'component/md':      [12, 16,  16 ],
    'component/lg':      [16, 20,  24 ],
    'component/xl':      [20, 24,  32 ],
    'layout/xs':         [16, 24,  32 ],
    'layout/sm':         [24, 32,  48 ],
    'layout/md':         [32, 48,  64 ],
    'layout/lg':         [48, 64,  96 ],
    'layout/xl':         [64, 96,  128],
    'inset/default':     [16, 24,  32 ],
    'inset/wide':        [24, 48,  80 ],
    'inset/narrow':      [12, 16,  24 ],
    'stack/xs':          [4,  4,   4  ],
    'stack/sm':          [8,  8,   8  ],
    'stack/md':          [16, 16,  16 ],
    'stack/lg':          [24, 24,  32 ],
    'stack/xl':          [32, 40,  48 ],
    'touch/min':         [44, 44,  32 ],
    'touch/comfortable': [48, 48,  40 ],
  };

  const SEMANTIC_4 = {
    'component/xs':      [2,  2,   2  ],
    'component/sm':      [4,  4,   4  ],
    'component/md':      [8,  12,  12 ],
    'component/lg':      [12, 16,  20 ],
    'component/xl':      [16, 20,  24 ],
    'layout/xs':         [16, 24,  32 ],
    'layout/sm':         [24, 32,  48 ],
    'layout/md':         [32, 48,  64 ],
    'layout/lg':         [48, 64,  96 ],
    'layout/xl':         [64, 96,  128],
    'inset/default':     [16, 24,  32 ],
    'inset/wide':        [24, 48,  80 ],
    'inset/narrow':      [12, 16,  24 ],
    'stack/xs':          [4,  4,   4  ],
    'stack/sm':          [8,  8,   8  ],
    'stack/md':          [16, 16,  16 ],
    'stack/lg':          [24, 24,  32 ],
    'stack/xl':          [32, 40,  48 ],
    'touch/min':         [44, 44,  32 ],
    'touch/comfortable': [48, 48,  40 ],
  };

  function withWide(arr) {
    return tier >= 4 ? [...arr, arr[arr.length - 1]] : arr;
  }

  const semanticBase = base === 4 ? SEMANTIC_4 : SEMANTIC_8;
  const semantic = {};
  for (const [token, vals] of Object.entries(semanticBase)) {
    semantic[token] = withWide(vals);
  }

  const r = (m) => Math.round(base * m);

  DS.spacing = {
    semantic,
    radius: {
      none:  0,
      xs:    r(0.25),
      sm:    r(0.5),
      md:    r(1),
      lg:    r(1.5),
      xl:    r(2),
      '2xl': r(3),
      full:  9999,
    },
    border: { hairline: 0.5, default: 1, medium: 2, thick: 4 },
  };

  computed.push('DS.spacing');
  preview.push(`  DS.spacing — ${Object.keys(semantic).length} semantic tokens + radius + border`);

  // ── Typography scale ────────────────────────────────────────────────────────
  function flat(px, lh) {
    return { sizes: withWide([px, px, px]), lineHeights: withWide([lh, lh, lh]) };
  }

  const M3 = {
    'display/lg':  { ...flat(57, 64),  weight: 400, tracking: -0.02 },
    'display/md':  { ...flat(45, 52),  weight: 400, tracking:  0    },
    'display/sm':  { ...flat(36, 44),  weight: 400, tracking:  0    },
    'headline/lg': { ...flat(32, 40),  weight: 400, tracking:  0    },
    'headline/md': { ...flat(28, 36),  weight: 400, tracking:  0    },
    'headline/sm': { ...flat(24, 32),  weight: 400, tracking:  0    },
    'title/lg':    { ...flat(22, 28),  weight: 500, tracking:  0    },
    'title/md':    { ...flat(16, 24),  weight: 500, tracking:  0.02 },
    'title/sm':    { ...flat(14, 20),  weight: 500, tracking:  0.01 },
    'body/lg':     { ...flat(16, 24),  weight: 400, tracking:  0.02 },
    'body/md':     { ...flat(14, 20),  weight: 400, tracking:  0.02 },
    'body/sm':     { ...flat(12, 16),  weight: 400, tracking:  0.02 },
    'label/lg':    { ...flat(14, 20),  weight: 500, tracking:  0.01 },
    'label/md':    { ...flat(12, 16),  weight: 500, tracking:  0.02 },
    'label/sm':    { ...flat(11, 16),  weight: 500, tracking:  0.02 },
  };

  const PRESETS = {
    material3: M3,
    fluid: {
      ...M3,
      'display/lg': { sizes: withWide([45, 57, 72]), lineHeights: withWide([52, 64, 80]), weight: 400, tracking: -0.02 },
      'display/md': { sizes: withWide([36, 45, 60]), lineHeights: withWide([44, 52, 68]), weight: 400, tracking:  0    },
      'display/sm': { sizes: withWide([30, 36, 48]), lineHeights: withWide([38, 44, 56]), weight: 400, tracking:  0    },
    },
    compact: {
      ...M3,
      'display/lg': { sizes: withWide([36, 40, 45]), lineHeights: withWide([44, 48, 52]), weight: 400, tracking: -0.02 },
      'display/md': { sizes: withWide([28, 32, 36]), lineHeights: withWide([36, 40, 44]), weight: 400, tracking:  0    },
      'display/sm': { sizes: withWide([24, 28, 30]), lineHeights: withWide([32, 36, 38]), weight: 400, tracking:  0    },
      'headline/lg': { ...flat(24, 32), weight: 400, tracking: 0 },
      'headline/md': { ...flat(20, 28), weight: 400, tracking: 0 },
      'headline/sm': { ...flat(18, 24), weight: 400, tracking: 0 },
    },
  };

  if (preset === 'custom') {
    needsClaude.push('DS.typography.scale');
    preview.push(`  DS.typography.scale — ⚠ custom preset, needs Claude`);
  } else {
    const scale = PRESETS[preset];
    if (!scale) {
      needsClaude.push('DS.typography.scale');
      preview.push(`  DS.typography.scale — ⚠ unknown preset "${preset}", needs Claude`);
    } else {
      if (!DS.typography) DS.typography = {};
      DS.typography.scale = scale;
      computed.push('DS.typography.scale');
      preview.push(`  DS.typography.scale — ${Object.keys(scale).length} roles (${preset})`);
    }
  }

  // ── Derive DS.naming.typePrefix ────────────────────────────────────────────
  if (!DS.naming) DS.naming = {};
  DS.naming.typePrefix = (DS.naming.textStyle || 'type/{role}/{size}').split('/')[0];

  const header = `Computed for ${modes.join('/')} (${base}px base):`;
  return {
    ds: DS,
    computed,
    needsClaude,
    preview: [header, ...preview].join('\n'),
  };
}

module.exports = { computeDsConfig };

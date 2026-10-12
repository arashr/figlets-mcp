'use strict';

/**
 * generate-primitives-data.js
 * Produces a self-contained payload for Collection 1 (Primitives).
 * Pure function — no file I/O.
 *
 * @param {object} ds - DS config (must have DS.color.ramps, DS.primitives.spacing, DS.typography.scale)
 * @returns {{ collectionName, colors, floats, strings, scrims, summary }}
 */
function generatePrimitivesData(ds) {
  const DS = ds;

  if (!DS.color || !DS.color.ramps || !DS.color.ramps.length) {
    throw new Error('DS.color.ramps missing. Run generateColorRamps first.');
  }
  if (!DS.primitives || !DS.primitives.spacing) {
    throw new Error('DS.primitives.spacing missing. Run computeDsConfig first.');
  }

  function ch(c) { return Math.round(c * 255).toString(16).padStart(2, '0'); }
  function toHex({ r, g, b }) { return `#${ch(r)}${ch(g)}${ch(b)}`; }
  const sanitize = (s) => String(s).replace('.', '-');

  // ── Color ramps → hex ────────────────────────────────────────────────────────
  const colors = [];
  for (const ramp of DS.color.ramps) {
    for (const [step, r, g, b] of ramp.steps) {
      colors.push({ name: `${ramp.folder}/${step}`, hex: toHex({ r, g, b }) });
    }
  }

  function exactEndpointAlias(channel) {
    const target = channel === 'white' ? 1 : 0;
    const preferred = [];
    const other = [];
    for (const ramp of DS.color.ramps) {
      const bucket = ramp.folder === 'color/neutral' ? preferred : other;
      const steps = Array.isArray(ramp.steps) ? ramp.steps : [];
      const endpoints = steps.length > 1 ? [steps[0], steps[steps.length - 1]] : steps;
      for (const step of endpoints) {
        if (step && step[1] === target && step[2] === target && step[3] === target) {
          bucket.push(`${ramp.folder}/${step[0]}`);
        }
      }
    }
    return preferred[0] || other[0] || null;
  }

  const blackEndpoint = exactEndpointAlias('black');
  const whiteEndpoint = exactEndpointAlias('white');
  const scrimSpecs = [
    ['black', 4],
    ['black', 8],
    ['black', 12],
    ['black', 20],
    ['black', 40],
    ['black', 60],
    ['white', 8],
    ['white', 12],
    ['white', 16],
    ['white', 20],
  ];
  const scrims = scrimSpecs.map(([channel, percentage]) => {
    const raw = channel === 'white' ? { r: 1, g: 1, b: 1 } : { r: 0, g: 0, b: 0 };
    const endpoint = channel === 'white' ? whiteEndpoint : blackEndpoint;
    return {
      name: `color/scrim/${channel}/${percentage}`,
      r: raw.r,
      g: raw.g,
      b: raw.b,
      a: percentage / 100,
      color: endpoint ? { alias: endpoint } : raw,
      opacity: { alias: `opacity/${percentage}` },
    };
  });

  // ── Floats: shadow + type + spacing ─────────────────────────────────────────
  const floats = [];

  for (const value of [4, 8, 12, 16, 20, 40, 60]) {
    floats.push({ name: `opacity/${value}`, value, scopes: ['OPACITY', 'COLOR_OPACITY'] });
  }

  const SHADOWS = [
    { name: 'shadow/1/offset-y',       value: 1  },
    { name: 'shadow/1/radius',         value: 2  },
    { name: 'shadow/2/offset-y',       value: 4  },
    { name: 'shadow/2/radius',         value: 8  },
    { name: 'shadow/3/offset-y',       value: 8  },
    { name: 'shadow/3/radius',         value: 16 },
    { name: 'shadow/4/offset-y',       value: 12 },
    { name: 'shadow/4/radius',         value: 24 },
    { name: 'shadow/5/offset-y',       value: 16 },
    { name: 'shadow/5/radius',         value: 32 },
    { name: 'shadow/ambient/2/radius', value: 8  },
    { name: 'shadow/ambient/3/radius', value: 12 },
    { name: 'shadow/ambient/4/radius', value: 16 },
    { name: 'shadow/ambient/5/radius', value: 20 },
  ];
  for (const s of SHADOWS) floats.push(s);

  const _tp = (DS.naming && DS.naming.typePrefix) ? DS.naming.typePrefix : 'type';

  const TYPE_WEIGHTS = [
    { name: `${_tp}/weight/regular`,  value: 400 },
    { name: `${_tp}/weight/medium`,   value: 500 },
    { name: `${_tp}/weight/semibold`, value: 600 },
    { name: `${_tp}/weight/bold`,     value: 700 },
  ];

  const TYPE_LINE_HEIGHTS = [
    { name: `${_tp}/line-height/tight`,   value: 1.2  },
    { name: `${_tp}/line-height/snug`,    value: 1.35 },
    { name: `${_tp}/line-height/normal`,  value: 1.5  },
    { name: `${_tp}/line-height/relaxed`, value: 1.65 },
    { name: `${_tp}/line-height/loose`,   value: 1.8  },
  ];

  const TYPE_TRACKING = [
    { name: `${_tp}/tracking/tight`,   value: -0.02 },
    { name: `${_tp}/tracking/snug`,    value: -0.01 },
    { name: `${_tp}/tracking/normal`,  value:  0    },
    { name: `${_tp}/tracking/open`,    value:  0.01 },
    { name: `${_tp}/tracking/wide`,    value:  0.02 },
    { name: `${_tp}/tracking/wider`,   value:  0.05 },
    { name: `${_tp}/tracking/widest`,  value:  0.1  },
  ];

  const TYPE_SIZES = [
    { name: `${_tp}/size/2xs`, value: 10 },
    { name: `${_tp}/size/xs`,  value: 12 },
    { name: `${_tp}/size/sm`,  value: 14 },
    { name: `${_tp}/size/md`,  value: 16 },
    { name: `${_tp}/size/lg`,  value: 18 },
    { name: `${_tp}/size/xl`,  value: 20 },
    { name: `${_tp}/size/2xl`, value: 24 },
    { name: `${_tp}/size/3xl`, value: 30 },
    { name: `${_tp}/size/4xl`, value: 36 },
    { name: `${_tp}/size/5xl`, value: 48 },
    { name: `${_tp}/size/6xl`, value: 60 },
    { name: `${_tp}/size/7xl`, value: 72 },
  ];

  // Extend with any non-standard sizes from the typography scale
  if (DS.typography && DS.typography.scale) {
    const stdSizes    = new Set(TYPE_SIZES.map(t => t.value));
    const stdTracking = new Set(TYPE_TRACKING.map(t => t.value));
    const extraSizes    = new Set();
    const extraTracking = new Set();
    for (const { sizes, tracking } of Object.values(DS.typography.scale)) {
      for (const sz of (sizes || [])) if (!stdSizes.has(sz)) extraSizes.add(sz);
      if (typeof tracking === 'number' && !stdTracking.has(tracking)) extraTracking.add(tracking);
    }
    for (const sz of [...extraSizes].sort((a, b) => a - b)) {
      TYPE_SIZES.push({ name: `${_tp}/size/${sz}`, value: sz });
    }
    for (const tr of [...extraTracking].sort((a, b) => a - b)) {
      TYPE_TRACKING.push({ name: `${_tp}/tracking/${tr}`, value: tr });
    }
  }

  for (const t of TYPE_WEIGHTS)      floats.push(t);
  for (const t of TYPE_SIZES)        floats.push(t);
  for (const t of TYPE_LINE_HEIGHTS) floats.push(t);
  for (const t of TYPE_TRACKING)     floats.push(t);

  for (const [step, value] of DS.primitives.spacing) {
    floats.push({ name: `space/${sanitize(step)}`, value });
  }

  if (DS.spacing && DS.spacing.radius) {
    for (const key of Object.keys(DS.spacing.radius)) {
      floats.push({ name: `radius/${sanitize(key)}`, value: DS.spacing.radius[key] });
    }
  }

  if (DS.spacing && DS.spacing.border) {
    for (const key of Object.keys(DS.spacing.border)) {
      floats.push({ name: `border/width/${sanitize(key)}`, value: DS.spacing.border[key] });
    }
  }

  // ── Strings: font families ───────────────────────────────────────────────────
  const strings = [];
  const _ff = (DS.naming && DS.naming.fontFamily) ? DS.naming.fontFamily : 'font/{variant}';
  strings.push({ name: _ff.replace('{variant}', 'sans'), value: (DS.typography && DS.typography.families && DS.typography.families.sans) ? DS.typography.families.sans : 'Inter' });
  strings.push({ name: _ff.replace('{variant}', 'mono'), value: (DS.typography && DS.typography.families && DS.typography.families.mono) ? DS.typography.families.mono : 'JetBrains Mono' });
  if (DS.typography && DS.typography.families && DS.typography.families.serif) {
    strings.push({ name: _ff.replace('{variant}', 'serif'), value: DS.typography.families.serif });
  }

  return {
    collectionName: (DS.collections && DS.collections.primitives) ? DS.collections.primitives : '1. Primitives',
    colors,
    floats,
    strings,
    scrims,
    summary: `${colors.length} colors + ${floats.length} floats + ${strings.length} strings + ${scrims.length} scrims`,
  };
}

module.exports = { generatePrimitivesData };

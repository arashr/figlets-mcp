'use strict';

const { srgbToOklch, oklchToSrgbClipped } = require('./oklch');

/**
 * generate-color-ramps.js
 * Generates color ramps from DS.color.brand hex values, with WCAG + APCA analysis.
 * Pure function — no file I/O. Updates and returns DS object.
 *
 * @param {object} ds - DS config object (must have DS.color.brand and DS.color.scale)
 * @returns {{ ds, markdownTable, contrastAnnotations, derivedColors, summary }}
 */
function generateColorRamps(ds) {
  const DS = Object.assign({}, ds);
  DS.color = Object.assign({}, DS.color);

  if (!DS.color || !Array.isArray(DS.color.brand) || !DS.color.brand.length) {
    throw new Error('DS.color.brand is missing or empty. Add brand colors to config first.');
  }

  const scaleKey    = DS.color.scale || '50-950';
  const algorithm   = (DS.color.algorithm || 'oklch').toLowerCase();
  if (algorithm !== 'oklch' && algorithm !== 'hsl') {
    throw new Error(`DS.color.algorithm must be "oklch" or "hsl" (got "${DS.color.algorithm}")`);
  }
  const rampStrategy = (DS.color.rampStrategy || 'standard').toLowerCase();
  if (rampStrategy !== 'standard' && rampStrategy !== 'contrast-harmonized') {
    throw new Error(`DS.color.rampStrategy must be "standard" or "contrast-harmonized" (got "${DS.color.rampStrategy}")`);
  }
  if (rampStrategy === 'contrast-harmonized' && algorithm !== 'oklch') {
    throw new Error('DS.color.rampStrategy="contrast-harmonized" requires DS.color.algorithm="oklch".');
  }
  const brandColors = DS.color.brand.slice();

  // ── Scale steps ─────────────────────────────────────────────────────────────
  const SCALES = {
    '50-950':  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950],
    '100-900': [100, 200, 300, 400, 500, 600, 700, 800, 900],
    '0-1000':  [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
  };

  const steps = Array.isArray(DS.color.steps) ? DS.color.steps : (SCALES[scaleKey] || SCALES['50-950']);

  const midIdx = (() => {
    const exact = steps.indexOf(500);
    if (exact !== -1) return exact;
    return steps.reduce((best, v, i) =>
      Math.abs(v - 500) < Math.abs(steps[best] - 500) ? i : best, 0);
  })();

  // Returns { idx, step, isAuto }
  function brandAnchorIdx(brand) {
    if (brand.step != null) {
      const target = Number(brand.step);
      const exact = steps.indexOf(target);
      const idx = exact !== -1 ? exact : steps.reduce(function(best, v, i) {
        return Math.abs(v - target) < Math.abs(steps[best] - target) ? i : best;
      }, 0);
      return { idx: idx, step: steps[idx], isAuto: false };
    }
    // Derive anchor from OKLab L: light hex → low step number, dark hex → high step number
    const rgb = hexToRgb(brand.hex);
    const oklch = srgbToOklch(rgb);
    const L = oklch.L;
    const t = (OKLCH_LIGHT_TARGET - L) / (OKLCH_LIGHT_TARGET - OKLCH_DARK_TARGET);
    const clampedT = Math.max(0, Math.min(1, t));
    const targetStep = steps[0] + clampedT * (steps[steps.length - 1] - steps[0]);
    const idx = steps.reduce(function(best, v, i) {
      return Math.abs(v - targetStep) < Math.abs(steps[best] - targetStep) ? i : best;
    }, 0);
    return { idx: idx, step: steps[idx], isAuto: true };
  }

  // ── Color math ───────────────────────────────────────────────────────────────
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    if (h.length !== 6) throw new Error(`Invalid hex: ${hex}`);
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    };
  }

  function rgbToHex(r, g, b) {
    const ch = x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');
    return `#${ch(r)}${ch(g)}${ch(b)}`;
  }

  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    if (s === 0) return { r: l, g: l, b: l };
    const hue2 = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return { r: hue2(p, q, h + 1 / 3), g: hue2(p, q, h), b: hue2(p, q, h - 1 / 3) };
  }

  function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

  // ── Ramp generation ──────────────────────────────────────────────────────────
  const LIGHT_TARGET = 97;
  const DARK_TARGET  =  6;

  function generateRampHsl(baseHex, anchorIdx) {
    if (anchorIdx === undefined) anchorIdx = midIdx;
    const { r, g, b } = hexToRgb(baseHex);
    const { h, s, l } = rgbToHsl(r, g, b);
    return steps.map((step, i) => {
      if (i === anchorIdx) return { step, r, g, b };
      let newL, newS;
      if (i < anchorIdx) {
        const t = Math.pow((anchorIdx - i) / Math.max(1, anchorIdx), 0.75);
        newL = l + (LIGHT_TARGET - l) * t;
        newS = s * (1 - t * 0.85);
      } else {
        const t = Math.pow((i - anchorIdx) / Math.max(1, steps.length - 1 - anchorIdx), 0.8);
        newL = l + (DARK_TARGET - l) * t;
        newS = t < 0.55
          ? s * (1 + t * 0.18)
          : s * (1 + 0.55 * 0.18) * (1 - (t - 0.55) * 0.35);
      }
      const rgb = hslToRgb(h, clamp(newS), clamp(newL));
      return { step, ...rgb };
    });
  }

  // OKLCh ramp: perceptually uniform lightness, chroma held high.
  // Light/dark targets are in OKLab L (0..1). The chroma curves are gentler
  // than HSL's saturation crush, which is what keeps tints/shades vivid.
  const OKLCH_LIGHT_TARGET = 0.97;
  const OKLCH_DARK_TARGET  = 0.18;
  const OKLCH_NEUTRAL_MID  = 0.56;

  function generateRampOklch(baseHex, anchorIdx) {
    if (anchorIdx === undefined) anchorIdx = midIdx;
    const base = hexToRgb(baseHex);
    const { L: baseL, C: baseC, H } = srgbToOklch(base);
    return steps.map((step, i) => {
      if (i === anchorIdx) return { step, r: base.r, g: base.g, b: base.b };
      let newL, newC;
      if (i < anchorIdx) {
        const t = Math.pow((anchorIdx - i) / Math.max(1, anchorIdx), 0.8);
        newL = baseL + (OKLCH_LIGHT_TARGET - baseL) * t;
        newC = baseC * (1 - t * 0.55);
      } else {
        const t = Math.pow((i - anchorIdx) / Math.max(1, steps.length - 1 - anchorIdx), 0.9);
        newL = baseL + (OKLCH_DARK_TARGET - baseL) * t;
        newC = t < 0.5
          ? baseC * (1 + t * 0.15)
          : baseC * (1 + 0.5 * 0.15) * (1 - (t - 0.5) * 0.4);
      }
      const rgb = oklchToSrgbClipped(newL, Math.max(0, newC), H);
      return { step, ...rgb };
    });
  }

  function contrastChroma(baseC, i, anchorIdx) {
    const maxSide = Math.max(anchorIdx, steps.length - 1 - anchorIdx);
    const distance = Math.abs(i - anchorIdx) / Math.max(1, maxSide);
    const centerBoost = 1 + 0.08 * (1 - distance);
    const edgeTaper = 0.40 + 0.60 * (1 - Math.pow(distance, 1.25));
    return baseC * centerBoost * edgeTaper;
  }

  function contrastHarmonizedLightness(i) {
    const targets = [0.97, 0.93, 0.86, 0.78, 0.68, 0.56, 0.47, 0.39, 0.32, 0.25, 0.18];
    if (steps.length === targets.length) return targets[i];
    const pos = i / Math.max(1, steps.length - 1) * (targets.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(targets.length - 1, Math.ceil(pos));
    const t = pos - lo;
    return targets[lo] + (targets[hi] - targets[lo]) * t;
  }

  function generateRampOklchContrastHarmonized(baseHex, anchorIdx) {
    if (anchorIdx === undefined) anchorIdx = midIdx;
    const base = hexToRgb(baseHex);
    const { C: baseC, H } = srgbToOklch(base);
    const minLStep = 0.024;
    const out = steps.map((step, i) => {
      const C = Math.max(0, contrastChroma(baseC, i, anchorIdx));
      let L = contrastHarmonizedLightness(i);
      const rgb = oklchToSrgbClipped(L, C, H);
      return { step, L, C, ...rgb };
    });
    for (let i = anchorIdx - 1; i >= 0; i--) {
      if (out[i].L <= out[i + 1].L + minLStep) {
        out[i].L = Math.min(OKLCH_LIGHT_TARGET, out[i + 1].L + minLStep);
        const rgb = oklchToSrgbClipped(out[i].L, out[i].C, H);
        out[i].r = rgb.r; out[i].g = rgb.g; out[i].b = rgb.b;
      }
    }
    for (let i = anchorIdx + 1; i < out.length; i++) {
      if (out[i].L >= out[i - 1].L - minLStep) {
        out[i].L = Math.max(OKLCH_DARK_TARGET, out[i - 1].L - minLStep);
        const rgb = oklchToSrgbClipped(out[i].L, out[i].C, H);
        out[i].r = rgb.r; out[i].g = rgb.g; out[i].b = rgb.b;
      }
    }
    return out.map(function(row) {
      return { step: row.step, r: row.r, g: row.g, b: row.b };
    });
  }

  const generateRamp = algorithm === 'hsl'
    ? generateRampHsl
    : (rampStrategy === 'contrast-harmonized' ? generateRampOklchContrastHarmonized : generateRampOklch);

  function neutralVariantOptions() {
    const cfg = DS.color.neutralVariant;
    if (cfg === false || cfg === 'none') return { enabled: false };
    const obj = cfg && typeof cfg === 'object' ? cfg : {};
    let chroma = typeof obj.chroma === 'number' ? obj.chroma : 0.01;
    if (obj.chroma === 'soft') chroma = 0.014;
    if (obj.chroma === 'subtle') chroma = 0.01;
    if (obj.chroma === 'barely') chroma = 0.006;
    return {
      enabled: algorithm === 'oklch',
      source: obj.source || 'primary',
      chroma: Math.max(0, Math.min(chroma, 0.018))
    };
  }

  function neutralVariantSourceHex(options) {
    const source = options.source;
    if (source === 'secondary') {
      const secondary = brandColors.find(c => c.role === 'secondary') || null;
      if (secondary && secondary.hex && secondary.hex !== 'TBD') return secondary.hex;
    }
    const named = brandColors.find(c => c.name === source) || null;
    if (named && named.hex && named.hex !== 'TBD') return named.hex;
    return primaryHex;
  }

  function generateNeutralRampOklch() {
    return steps.map((step, i) => {
      let newL;
      if (i < midIdx) {
        const t = Math.pow((midIdx - i) / midIdx, 0.8);
        newL = OKLCH_NEUTRAL_MID + (OKLCH_LIGHT_TARGET - OKLCH_NEUTRAL_MID) * t;
      } else if (i > midIdx) {
        const t = Math.pow((i - midIdx) / (steps.length - 1 - midIdx), 0.9);
        newL = OKLCH_NEUTRAL_MID + (OKLCH_DARK_TARGET - OKLCH_NEUTRAL_MID) * t;
      } else {
        newL = OKLCH_NEUTRAL_MID;
      }
      const rgb = oklchToSrgbClipped(newL, 0, 0);
      return { step, ...rgb };
    });
  }

  function generateNeutralVariantRampOklch(sourceHex, chroma) {
    const source = hexToRgb(sourceHex);
    const { H } = srgbToOklch(source);
    const maxSide = Math.max(midIdx, steps.length - 1 - midIdx);
    return steps.map((step, i) => {
      let newL;
      if (i < midIdx) {
        const t = Math.pow((midIdx - i) / midIdx, 0.8);
        newL = OKLCH_NEUTRAL_MID + (OKLCH_LIGHT_TARGET - OKLCH_NEUTRAL_MID) * t;
      } else if (i > midIdx) {
        const t = Math.pow((i - midIdx) / (steps.length - 1 - midIdx), 0.9);
        newL = OKLCH_NEUTRAL_MID + (OKLCH_DARK_TARGET - OKLCH_NEUTRAL_MID) * t;
      } else {
        newL = OKLCH_NEUTRAL_MID;
      }

      const distance = Math.abs(i - midIdx) / maxSide;
      const taperedC = chroma * (1 - distance * 0.55);
      const rgb = oklchToSrgbClipped(newL, Math.max(0, taperedC), H);
      return { step, ...rgb };
    });
  }

  function generateNeutralRamp(primaryHex) {
    if (algorithm === 'oklch') return generateNeutralRampOklch();

    const { r, g, b } = hexToRgb(primaryHex);
    const { h, s } = rgbToHsl(r, g, b);
    const mid = hslToRgb(h, Math.min(s * 0.1, 8), 52);
    return generateRamp(rgbToHex(mid.r, mid.g, mid.b));
  }

  function deriveSecondary(primaryHex) {
    const { r, g, b } = hexToRgb(primaryHex);
    const { h, s, l } = rgbToHsl(r, g, b);
    const compH = (h + 150) % 360;
    const mid = hslToRgb(compH, s, l);
    return rgbToHex(mid.r, mid.g, mid.b);
  }

  const HUE_NAMES = [
    [15, 'red'], [45, 'orange'], [75, 'yellow'], [150, 'green'],
    [195, 'teal'], [255, 'blue'], [285, 'indigo'], [315, 'purple'],
    [345, 'pink'], [360, 'red'],
  ];
  const UTILITY_NAMES = new Set(['red', 'green', 'yellow', 'blue']);

  function hueToName(h) {
    for (const [max, name] of HUE_NAMES) { if (h < max) return name; }
    return 'red';
  }

  // ── WCAG contrast ────────────────────────────────────────────────────────────
  function linearize(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function luminance({ r, g, b }) {
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  }
  function wcagRatio(lum1, lum2) {
    const hi = Math.max(lum1, lum2), lo = Math.min(lum1, lum2);
    return (hi + 0.05) / (lo + 0.05);
  }

  const WHITE = { r: 1, g: 1, b: 1 };
  const BLACK = { r: 0, g: 0, b: 0 };
  const LUM_WHITE = luminance(WHITE);
  const LUM_BLACK = luminance(BLACK);

  // ── APCA ─────────────────────────────────────────────────────────────────────
  function apcaLum({ r, g, b }) {
    return 0.2126729 * Math.pow(r, 2.4) + 0.7151522 * Math.pow(g, 2.4) + 0.0721750 * Math.pow(b, 2.4);
  }
  function apcaLc(txt, bg) {
    const BC = 0.022, BE = 1.414;
    const Yt = apcaLum(txt), Yb = apcaLum(bg);
    const Yt2 = Yt < BC ? Yt + Math.pow(BC - Yt, BE) : Yt;
    const Yb2 = Yb < BC ? Yb + Math.pow(BC - Yb, BE) : Yb;
    let lc;
    if (Yb2 >= Yt2) lc = (Math.pow(Yb2, 0.56) - Math.pow(Yt2, 0.57)) * 1.14;
    else             lc = (Math.pow(Yb2, 0.65) - Math.pow(Yt2, 0.62)) * 1.14;
    if (Math.abs(lc) < 0.1) return 0;
    return Math.round(lc > 0 ? lc * 100 - 12.5 : lc * 100 + 12.5);
  }

  function usabilityLabel(vsWhite, vsBlack) {
    const parts = [];
    if (vsWhite >= 7)        parts.push('text on white (AAA) ✓');
    else if (vsWhite >= 4.5) parts.push('text on white (AA) ✓');
    else if (vsWhite >= 3)   parts.push('large text / icons on white');
    if (vsBlack >= 7)        parts.push('text on black (AAA) ✓');
    else if (vsBlack >= 4.5) parts.push('text on black (AA) ✓');
    else if (vsBlack >= 3)   parts.push('large text / icons on black');
    if (!parts.length) return 'decorative bg only';
    return parts.join('; ');
  }

  function checkRange(folder, stepsData) {
    const warnings = [];
    const first = stepsData[0], last = stepsData[stepsData.length - 1];
    const range = wcagRatio(luminance(first), luminance(last));
    if (range < 12) {
      warnings.push(`  ${folder}: low tonal range (lightest vs darkest = ${range.toFixed(1)}:1, recommend ≥ 12:1)`);
    }
    const mid = stepsData[midIdx];
    const midVsWhite = wcagRatio(LUM_WHITE, luminance(mid));
    const midVsBlack = wcagRatio(LUM_BLACK, luminance(mid));
    if (midVsWhite < 3 && midVsBlack < 3) {
      warnings.push(`  ${folder}/500: below 3:1 on both white and black — consider a different anchor hex`);
    }
    return warnings;
  }

  function analyzeRamp(folder, stepsData) {
    return stepsData.map(({ step, r, g, b }) => {
      const hex     = rgbToHex(r, g, b);
      const lum     = luminance({ r, g, b });
      const vsWhite = wcagRatio(LUM_WHITE, lum);
      const vsBlack = wcagRatio(LUM_BLACK, lum);
      const lcOnWhite = Math.abs(apcaLc({ r, g, b }, WHITE));
      const lcOnBlack = Math.abs(apcaLc({ r, g, b }, BLACK));
      return { step, hex, vsWhite, vsBlack, lcOnWhite, lcOnBlack, label: usabilityLabel(vsWhite, vsBlack) };
    });
  }

  const UTILITY_BASES = [
    { name: 'neutral', fn: 'neutral' },
    { name: 'red',    hex: '#EF4444' },
    { name: 'green',  hex: '#22C55E' },
    { name: 'yellow', hex: '#EAB308' },
    { name: 'blue',   hex: '#3B82F6' },
  ];

  // ── Build all ramps ───────────────────────────────────────────────────────────
  const primaryEntry = brandColors.find(c => c.role === 'primary') || brandColors[0];
  if (!primaryEntry || !primaryEntry.hex) {
    throw new Error('No primary brand color found in DS.color.brand');
  }

  const primaryHex  = primaryEntry.hex;
  const derivedColors = [];

  if (!brandColors.find(c => c.role === 'secondary')) {
    const compHex = deriveSecondary(primaryHex);
    const { r, g, b } = hexToRgb(compHex);
    const { h } = rgbToHsl(r, g, b);
    const candName = hueToName(h);
    const safeName = UTILITY_NAMES.has(candName) ? 'secondary' : candName;
    const entry = { name: safeName, hex: compHex, role: 'secondary', derived: true };
    brandColors.push(entry);
    derivedColors.push({ role: 'secondary', name: safeName, hex: compHex,
      note: `Split-complementary (+150° hue) from primary ${primaryHex}` });
  }

  const allRamps          = [];
  const allAnalysis       = [];
  const warnings          = [];
  const brandAnchorReport = [];

  for (const brand of brandColors) {
    if (!brand.hex || brand.hex === 'TBD') continue;
    const anchorInfo = brandAnchorIdx(brand);
    const stepsData  = generateRamp(brand.hex, anchorInfo.idx);
    const folder     = `color/${brand.name}`;
    allRamps.push({ folder, steps: stepsData.map(({ step, r, g, b }) => [step, r, g, b]) });
    allAnalysis.push({ folder, rows: analyzeRamp(folder, stepsData), rangeWarns: checkRange(folder, stepsData) });
    brandAnchorReport.push({ name: brand.name, hex: brand.hex, step: anchorInfo.step, isAuto: anchorInfo.isAuto });
  }

  for (const u of UTILITY_BASES) {
    const stepsData = u.fn === 'neutral' ? generateNeutralRamp(primaryHex) : generateRamp(u.hex);
    const folder    = `color/${u.name}`;
    allRamps.push({ folder, steps: stepsData.map(({ step, r, g, b }) => [step, r, g, b]) });
    allAnalysis.push({ folder, rows: analyzeRamp(folder, stepsData), rangeWarns: checkRange(folder, stepsData) });
  }

  const neutralVariant = neutralVariantOptions();
  if (neutralVariant.enabled) {
    const stepsData = generateNeutralVariantRampOklch(
      neutralVariantSourceHex(neutralVariant),
      neutralVariant.chroma
    );
    const folder = 'color/neutral-variant';
    allRamps.push({ folder, steps: stepsData.map(({ step, r, g, b }) => [step, r, g, b]) });
    allAnalysis.push({ folder, rows: analyzeRamp(folder, stepsData), rangeWarns: checkRange(folder, stepsData) });
  }

  for (const { rangeWarns } of allAnalysis) {
    if (rangeWarns.length) warnings.push(...rangeWarns);
  }

  // ── Format output ────────────────────────────────────────────────────────────
  const r2 = x => x.toFixed(1) + ':1';
  const lc = v => `Lc ${v}`;

  let markdownTable = '';
  for (const { folder, rows } of allAnalysis) {
    markdownTable += `\n**${folder}**\n`;
    markdownTable += `| Step | Hex | vs white | APCA white | vs black | APCA black | Usable for |\n`;
    markdownTable += `|---|---|---|---|---|---|---|\n`;
    for (const { step, hex, vsWhite, vsBlack, lcOnWhite, lcOnBlack, label } of rows) {
      markdownTable += `| \`/${step}\` | \`${hex}\` | ${r2(vsWhite)} | ${lc(lcOnWhite)} | ${r2(vsBlack)} | ${lc(lcOnBlack)} | ${label} |\n`;
    }
  }

  let contrastAnnotations = '';
  for (const { folder, rows } of allAnalysis) {
    contrastAnnotations += `\n${folder} — on white (#FFFFFF):\n`;
    for (const { step, vsWhite, lcOnWhite, label } of rows) {
      contrastAnnotations += `  /${step} → WCAG: ${r2(vsWhite)} | APCA: ~${lc(lcOnWhite)} | ${label}\n`;
    }
    contrastAnnotations += `\n${folder} — on black (#000000):\n`;
    for (const { step, vsBlack, lcOnBlack } of rows) {
      contrastAnnotations += `  /${step} → WCAG: ${r2(vsBlack)} | APCA: ~${lc(lcOnBlack)}\n`;
    }
  }

  DS.color.ramps = allRamps;

  const rampList = allRamps.map(r => `  ${r.folder} (${r.steps.length} steps)`).join('\n');
  const warnBlock = warnings.length
    ? `\n⚠️  Range warnings:\n${warnings.join('\n')}`
    : '';
  const derivedBlock = derivedColors.length
    ? `\nDerived colors (auto-generated — confirm or replace with your own hex):\n` +
      derivedColors.map(d => `  ${d.role}: ${d.name} ${d.hex} — ${d.note}`).join('\n')
    : '';

  const anchorBlock = brandAnchorReport.length
    ? `\nBrand anchors:\n` +
      brandAnchorReport.map(function(b) {
        const pad = b.name.length < 8 ? b.name + new Array(8 - b.name.length + 1).join(' ') : b.name;
        return `  ${pad}  ${b.hex}  → step ${b.step} (${b.isAuto ? 'auto' : 'override'})`;
      }).join('\n')
    : '';

  const strategyLabel = rampStrategy === 'contrast-harmonized'
    ? ', contrast-harmonized ramp strategy'
    : '';
  const summary =
    `Generated ${allRamps.length} ramps (${steps.length} steps each, ${scaleKey} scale, ${algorithm} algorithm${strategyLabel}):\n` +
    rampList + anchorBlock + derivedBlock + warnBlock;

  return { ds: DS, markdownTable, contrastAnnotations, derivedColors, summary };
}

module.exports = { generateColorRamps };

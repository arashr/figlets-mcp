'use strict';

/**
 * validate-semantic-pairs.js
 * Generates default semantic color pair mappings, computes WCAG 2.2 + APCA contrast for
 * every bg+text pair in Light and Dark mode, flags failures, and suggests fixes.
 * Pure function — no file I/O. Updates and returns DS object.
 *
 * @param {object} ds - DS config (must have DS.color.ramps and DS.color.brand)
 * @returns {{ ds, markdownTable, iconTable, failCount, summary }}
 */
function validateSemanticPairs(ds) {
  const DS = Object.assign({}, ds);
  DS.color = Object.assign({}, DS.color);

  if (!DS.color.ramps || !DS.color.ramps.length) {
    throw new Error('DS.color.ramps missing. Run generateColorRamps first.');
  }

  // Contrast algorithm gate. APCA is the default; WCAG remains a first-class
  // option for teams with formal WCAG 2.x compliance obligations. Both metrics
  // are *always computed and stored* on every row regardless of the choice;
  // only `pass`, `failCount`, and `suggestStep` honor the chosen algorithm.
  const algorithm = DS.color.contrastAlgorithm === 'wcag' ? 'wcag' : 'apca';
  DS.color.contrastAlgorithm = algorithm;

  const convention = DS.color.convention || 'role-based';
  const primaryEntry = (DS.color.brand || []).find(c => c.role === 'primary') || (DS.color.brand || [])[0];
  if (!primaryEntry) throw new Error('No primary brand color found in DS.color.brand.');
  const PRIMARY = primaryEntry.name;

  // ── Ramp lookup ──────────────────────────────────────────────────────────────
  const rampByName = {};
  const hexByPath  = {};

  for (const ramp of DS.color.ramps) {
    const name = ramp.folder.replace('color/', '');
    const sorted = ramp.steps.slice().sort((a, b) => a[0] - b[0]);
    rampByName[name] = sorted;
    for (const [step, r, g, b] of sorted) {
      hexByPath[`${name}/${step}`] = { r, g, b };
    }
  }

  function resolve(ref) {
    let [rampName, stepStr] = ref.split('/');
    if (rampName === 'primary') rampName = PRIMARY;
    const desiredStep = parseInt(stepStr, 10);
    const ramp = rampByName[rampName];
    if (!ramp) return null;
    const [actualStep, r, g, b] = ramp.reduce((best, entry) =>
      Math.abs(entry[0] - desiredStep) < Math.abs(best[0] - desiredStep) ? entry : best
    );
    const resolvedPath = `color/${rampName}/${actualStep}`;
    return { path: resolvedPath, rgb: { r, g, b }, clamped: actualStep !== desiredStep };
  }

  // ── Color math ───────────────────────────────────────────────────────────────
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
    return Math.round(lc > 0 ? lc * 100 - 2.7 : lc * 100 + 2.7);
  }

  // Score helpers — same signature `(txtRgb, bgRgb) => number`, higher is more legible.
  // WCAG returns the contrast ratio; APCA returns the absolute Lc.
  const wcagScorer = (txt, bg) => wcagRatio(luminance(bg), luminance(txt));
  const apcaScorer = (txt, bg) => Math.abs(apcaLc(txt, bg));

  // Generic ramp walker: pick the nearest existing step whose `scorer` against `bgRgb`
  // meets `threshold`. WCAG and APCA share the same walk, only the scorer + threshold change.
  function suggestStepFor(textRampRef, bgRgb, scorer, threshold) {
    let [rampName] = textRampRef.split('/');
    if (rampName === 'primary') rampName = PRIMARY;
    const ramp = rampByName[rampName];
    if (!ramp) return null;
    const passing = ramp
      .map(([step, r, g, b]) => ({ step, rgb: { r, g, b }, score: scorer({ r, g, b }, bgRgb) }))
      .filter(e => e.score >= threshold);
    if (!passing.length) return null;
    const currentStep = parseInt(textRampRef.split('/')[1], 10);
    passing.sort((a, b) => Math.abs(a.step - currentStep) - Math.abs(b.step - currentStep));
    const best = passing[0];
    // Always carry the WCAG ratio back so legacy callers + markdown still render `:1`.
    const ratio = wcagRatio(luminance(bgRgb), luminance(best.rgb));
    return { step: best.step, path: `color/${rampName}/${best.step}`, ratio, score: best.score };
  }

  // Back-compat shim — internal callers below still use suggestStep(ref, bg, minRatio)
  // for WCAG-only scoring (the surface/success backfill retry preserves old behavior).
  function suggestStep(textRampRef, bgRgb, minRatio) {
    return suggestStepFor(textRampRef, bgRgb, wcagScorer, minRatio);
  }

  // ── Preserve manually edited pairs on re-run ─────────────────────────────────
  const existingPairs = (DS.color.semantics && DS.color.semantics.pairs) ? DS.color.semantics.pairs : null;

  // ── Pair templates ────────────────────────────────────────────────────────────
  const NEUTRAL_VARIANT = rampByName['neutral-variant'] ? 'neutral-variant' : 'neutral';

  // `min` is the WCAG ratio gate (4.5 = AA body); `minLc` is the APCA Lc gate
  // (75 = APCA "Bronze" body ≥ 14px). Both metrics are computed on every row
  // regardless of which one gates pass/failCount; the row's `pass` switches based
  // on `DS.color.contrastAlgorithm`. `minLc: null` mirrors `min: null` for tokens
  // that are explicitly decorative (e.g. text/muted) — those are exempt under both.
  const ROLE_PAIRS = [
    { bg: 'color/bg/default',        text: 'color/text/default',    L: { bg: 'neutral/50',  text: 'neutral/950' }, D: { bg: 'neutral/950', text: 'neutral/50'  }, min: 4.5, minLc: 75 },
    { bg: 'color/bg/default',        text: 'color/text/subtle',     L: { bg: 'neutral/50',  text: 'neutral/700' }, D: { bg: 'neutral/950', text: 'neutral/300' }, min: 4.5, minLc: 75 },
    { bg: 'color/bg/default',        text: 'color/text/muted',      L: { bg: 'neutral/50',  text: 'neutral/500' }, D: { bg: 'neutral/950', text: 'neutral/500' }, min: null, minLc: null, note: 'decorative — may be sub-AA by design' },
    { bg: 'color/bg/subtle',         text: 'color/text/default',    L: { bg: 'neutral/100', text: 'neutral/950' }, D: { bg: 'neutral/900', text: 'neutral/50'  }, min: 4.5, minLc: 75 },
    { bg: 'color/bg/muted',          text: 'color/text/default',    L: { bg: 'neutral/200', text: 'neutral/950' }, D: { bg: 'neutral/800', text: 'neutral/50'  }, min: 4.5, minLc: 75 },
    { bg: 'color/bg/brand',          text: 'color/text/on-brand',   L: { bg: 'primary/600', text: 'neutral/50'  }, D: { bg: 'primary/500', text: 'neutral/950' }, min: 4.5, minLc: 75 },
    { bg: 'color/bg/brand-subtle',   text: 'color/text/brand',      L: { bg: 'primary/50',  text: 'primary/700' }, D: { bg: 'primary/950', text: 'primary/300' }, min: 4.5, minLc: 75 },
    { bg: 'color/bg/danger',         text: 'color/text/danger',     L: { bg: 'red/50',      text: 'red/800'     }, D: { bg: 'red/950',     text: 'red/100'     }, min: 4.5, minLc: 75 },
    { bg: 'color/fill/danger',       text: 'color/text/on-danger',  L: { bg: 'red/700',     text: 'neutral/50'  }, D: { bg: 'red/100',     text: 'neutral/950' }, min: 4.5, minLc: 75 },
    { bg: 'color/bg/success',        text: 'color/text/success',    L: { bg: 'green/50',    text: 'green/800'   }, D: { bg: 'green/950',   text: 'green/200'   }, min: 4.5, minLc: 75 },
    { bg: 'color/fill/success',      text: 'color/text/on-success', L: { bg: 'green/800',   text: 'neutral/50'  }, D: { bg: 'green/200',   text: 'neutral/950' }, min: 4.5, minLc: 75 },
    { bg: 'color/bg/warning',        text: 'color/text/warning',    L: { bg: 'yellow/50',   text: 'yellow/800'  }, D: { bg: 'yellow/950',  text: 'yellow/200'  }, min: 4.5, minLc: 75 },
    { bg: 'color/fill/warning',      text: 'color/text/on-warning', L: { bg: 'yellow/200',  text: 'neutral/950' }, D: { bg: 'yellow/200',  text: 'neutral/950' }, min: 4.5, minLc: 75, note: '⚠ yellow filled surfaces use dark text in both modes' },
    { bg: 'color/bg/info',           text: 'color/text/info',       L: { bg: 'blue/50',     text: 'blue/800'    }, D: { bg: 'blue/950',    text: 'blue/100'    }, min: 4.5, minLc: 75 },
    { bg: 'color/fill/info',         text: 'color/text/on-info',    L: { bg: 'blue/700',    text: 'neutral/50'  }, D: { bg: 'blue/100',    text: 'neutral/950' }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/default',   text: 'color/text/default',    L: { bg: 'neutral/50',  text: 'neutral/950' }, D: { bg: 'neutral/950', text: 'neutral/50'  }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/raised',    text: 'color/text/default',    L: { bg: 'neutral/100', text: 'neutral/950' }, D: { bg: 'neutral/900', text: 'neutral/50'  }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/overlay',   text: 'color/text/default',    L: { bg: 'neutral/100', text: 'neutral/950' }, D: { bg: 'neutral/800', text: 'neutral/50'  }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/sunken',    text: 'color/text/default',    L: { bg: 'neutral/100', text: 'neutral/950' }, D: { bg: 'neutral/800', text: 'neutral/50'  }, min: 4.5, minLc: 75 },
  ];

  const SURFACE_PAIRS = [
    { bg: 'color/surface/default',       text: 'color/on-surface/default',  L: { bg: 'neutral/50',  text: 'neutral/950' }, D: { bg: 'neutral/950', text: 'neutral/50'  }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/default',       text: 'color/on-surface/variant',  L: { bg: 'neutral/50',  text: 'neutral/700' }, D: { bg: 'neutral/950', text: 'neutral/300' }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/variant',       text: 'color/on-surface/variant',  L: { bg: `${NEUTRAL_VARIANT}/100`, text: 'neutral/950' }, D: { bg: `${NEUTRAL_VARIANT}/900`, text: 'neutral/50'  }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/brand',         text: 'color/on-surface/brand',    L: { bg: 'primary/500', text: 'neutral/900' }, D: { bg: 'primary/500', text: 'neutral/950' }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/brand-variant', text: 'color/on-surface/brand-variant', L: { bg: 'primary/50', text: 'primary/900' }, D: { bg: 'primary/950', text: 'primary/50' }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/danger',         text: 'color/on-surface/danger',   L: { bg: 'red/50',      text: 'red/800'     }, D: { bg: 'red/950',     text: 'red/100'     }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/danger-variant', text: 'color/on-surface/danger-variant', L: { bg: 'red/50', text: 'red/800' }, D: { bg: 'red/950', text: 'red/100' }, min: 4.5, minLc: 75 },
    { bg: 'color/fill/danger',            text: 'color/on-fill/danger',      L: { bg: 'red/700',     text: 'neutral/50'  }, D: { bg: 'red/100',     text: 'neutral/950' }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/success',        text: 'color/on-surface/success',  L: { bg: 'green/50',    text: 'green/800'   }, D: { bg: 'green/950',   text: 'green/200'   }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/success-variant', text: 'color/on-surface/success-variant', L: { bg: 'green/50', text: 'green/800' }, D: { bg: 'green/950', text: 'green/200' }, min: 4.5, minLc: 75 },
    { bg: 'color/fill/success',           text: 'color/on-fill/success',     L: { bg: 'green/800',   text: 'neutral/50'  }, D: { bg: 'green/200',   text: 'neutral/950' }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/warning',        text: 'color/on-surface/warning',  L: { bg: 'yellow/50',   text: 'yellow/800'  }, D: { bg: 'yellow/950',  text: 'yellow/200'  }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/warning-variant', text: 'color/on-surface/warning-variant', L: { bg: 'yellow/50', text: 'yellow/800' }, D: { bg: 'yellow/950', text: 'yellow/200' }, min: 4.5, minLc: 75 },
    { bg: 'color/fill/warning',           text: 'color/on-fill/warning',     L: { bg: 'yellow/200',  text: 'neutral/950' }, D: { bg: 'yellow/200',  text: 'neutral/950' }, min: 4.5, minLc: 75, note: '⚠ yellow filled surfaces use dark text in both modes' },
    { bg: 'color/surface/info',           text: 'color/on-surface/info',     L: { bg: 'blue/50',     text: 'blue/800'    }, D: { bg: 'blue/950',    text: 'blue/100'    }, min: 4.5, minLc: 75 },
    { bg: 'color/surface/info-variant',   text: 'color/on-surface/info-variant', L: { bg: 'blue/50', text: 'blue/800' }, D: { bg: 'blue/950', text: 'blue/100' }, min: 4.5, minLc: 75 },
    { bg: 'color/fill/info',              text: 'color/on-fill/info',        L: { bg: 'blue/700',    text: 'neutral/50'  }, D: { bg: 'blue/100',    text: 'neutral/950' }, min: 4.5, minLc: 75 },
  ];

  const ROLE_ICONS = [
    { token: 'color/icon/default', L: { icon: 'neutral/700', bg: 'neutral/50'  }, D: { icon: 'neutral/300', bg: 'neutral/950' } },
    { token: 'color/icon/subtle',  L: { icon: 'neutral/500', bg: 'neutral/50'  }, D: { icon: 'neutral/500', bg: 'neutral/950' } },
    { token: 'color/icon/brand',   L: { icon: 'primary/600', bg: 'neutral/50'  }, D: { icon: 'primary/400', bg: 'neutral/950' } },
    { token: 'color/icon/danger',  L: { icon: 'red/600',     bg: 'neutral/50'  }, D: { icon: 'red/400',     bg: 'neutral/950' } },
    { token: 'color/icon/success', L: { icon: 'green/600',   bg: 'neutral/50'  }, D: { icon: 'green/400',   bg: 'neutral/950' } },
    { token: 'color/icon/warning', L: { icon: 'yellow/700',  bg: 'neutral/50'  }, D: { icon: 'yellow/400',  bg: 'neutral/950' } },
    { token: 'color/icon/info',    L: { icon: 'blue/600',    bg: 'neutral/50'  }, D: { icon: 'blue/400',    bg: 'neutral/950' } },
    { token: 'color/icon/inverse', L: { icon: 'neutral/50',  bg: 'neutral/950' }, D: { icon: 'neutral/950', bg: 'neutral/50'  } },
    { token: 'color/icon/on-brand',   L: { icon: 'neutral/50',  bg: 'primary/900' }, D: { icon: 'neutral/950', bg: 'primary/50'  } },
    { token: 'color/icon/on-danger',  L: { icon: 'neutral/50',  bg: 'red/900'     }, D: { icon: 'neutral/950', bg: 'red/100'     } },
    { token: 'color/icon/on-success', L: { icon: 'neutral/50',  bg: 'green/900'   }, D: { icon: 'neutral/950', bg: 'green/100'   } },
    { token: 'color/icon/on-warning', L: { icon: 'neutral/950', bg: 'yellow/100'  }, D: { icon: 'neutral/950', bg: 'yellow/100'  } },
    { token: 'color/icon/on-info',    L: { icon: 'neutral/50',  bg: 'blue/900'    }, D: { icon: 'neutral/950', bg: 'blue/100'    } },
  ];

  const ROLE_UNPAIRED = [
    { token: 'color/text/disabled',  L: 'neutral/400', D: 'neutral/600', note: 'exempt — WCAG 1.4.3 disabled controls' },
    { token: 'color/border/default', L: 'neutral/200', D: 'neutral/800' },
    { token: 'color/border/subtle',  L: 'neutral/100', D: 'neutral/900' },
    { token: 'color/border/strong',  L: 'neutral/400', D: 'neutral/600' },
    { token: 'color/border/brand',   L: 'primary/700', D: 'primary/300' },
    { token: 'color/border/brand-subtle', L: 'primary/200', D: 'primary/800' },
    { token: 'color/border/danger',  L: 'red/200',     D: 'red/800'     },
    { token: 'color/border/success', L: 'green/200',   D: 'green/800'   },
    { token: 'color/border/warning', L: 'yellow/200',  D: 'yellow/800'  },
    { token: 'color/border/info',    L: 'blue/200',    D: 'blue/800'    },
    { token: 'color/border/focus',   L: 'primary/500', D: 'primary/400', note: '3:1 vs adjacent bg required' },
    { token: 'color/surface/default',L: 'neutral/50',  D: 'neutral/950' },
    { token: 'color/surface/raised', L: 'neutral/100', D: 'neutral/900' },
    { token: 'color/surface/overlay',L: 'neutral/100', D: 'neutral/800' },
    { token: 'color/surface/sunken', L: 'neutral/100', D: 'neutral/800' },
    { token: 'color/scrim/overlay',  L: 'color/scrim/black/40', D: 'color/scrim/black/60', scrim: true },
    { token: 'color/scrim/hover',    L: 'color/scrim/black/8',  D: 'color/scrim/white/8',  scrim: true },
    { token: 'color/scrim/pressed',  L: 'color/scrim/black/12', D: 'color/scrim/white/12', scrim: true },
    { token: 'color/scrim/disabled', L: 'color/scrim/black/20', D: 'color/scrim/black/20', scrim: true },
    { token: 'color/scrim/selected', L: 'color/scrim/black/12', D: 'color/scrim/white/16', scrim: true },
    { token: 'color/shadow/key',     L: 'color/scrim/black/20', D: 'color/scrim/white/20', scrim: true },
    { token: 'color/shadow/ambient', L: 'color/scrim/black/8',  D: 'color/scrim/white/8',  scrim: true },
  ];

  const SURFACE_UNPAIRED = [
    { token: 'color/on-surface/disabled', L: 'neutral/400', D: 'neutral/600', note: 'exempt — WCAG 1.4.3' },
    { token: 'color/outline/default',     L: 'neutral/300', D: 'neutral/700' },
    { token: 'color/outline/subtle',      L: `${NEUTRAL_VARIANT}/200`, D: `${NEUTRAL_VARIANT}/800` },
    { token: 'color/outline/strong',      L: 'neutral/500', D: 'neutral/500' },
    { token: 'color/outline/brand',       L: 'primary/500', D: 'primary/500' },
    { token: 'color/outline/focus',       L: 'primary/500', D: 'primary/400', note: '3:1 vs adjacent bg required' },
    { token: 'color/outline/danger',      L: 'red/500',     D: 'red/500'     },
    { token: 'color/overlay/scrim',       L: 'color/scrim/black/40', D: 'color/scrim/black/60', scrim: true },
    { token: 'color/state/hover',         L: 'color/scrim/black/8',  D: 'color/scrim/white/8',  scrim: true },
    { token: 'color/state/pressed',       L: 'color/scrim/black/12', D: 'color/scrim/white/12', scrim: true },
    { token: 'color/state/disabled',      L: 'color/scrim/black/20', D: 'color/scrim/black/20', scrim: true },
    { token: 'color/state/selected',      L: 'color/scrim/black/12', D: 'color/scrim/white/16', scrim: true },
    { token: 'color/shadow/key',          L: 'color/scrim/black/20', D: 'color/scrim/white/20', scrim: true },
    { token: 'color/shadow/ambient',      L: 'color/scrim/black/8',  D: 'color/scrim/white/8',  scrim: true },
  ];

  const pairTemplates     = convention === 'surface-based' ? SURFACE_PAIRS    : ROLE_PAIRS;
  const unpairedTemplates = convention === 'surface-based' ? SURFACE_UNPAIRED : ROLE_UNPAIRED;
  const existingSemantics = DS.color.semantics || {};
  const existingIcons = Array.isArray(existingSemantics.icons) ? existingSemantics.icons : null;
  const wantsIconSemantics = existingIcons ? existingIcons.length > 0 : existingSemantics.icons !== false;
  const contrastHarmonized = DS.color.rampStrategy === 'contrast-harmonized';

  function applyContrastHarmonizedPair(row) {
    const map = {
      'color/bg/default|color/text/subtle': {
        L: { bg: 'neutral/50', text: 'neutral/700' },
        D: { bg: 'neutral/950', text: 'neutral/100' },
      },
      'color/bg/muted|color/text/default': {
        L: { bg: 'neutral/100', text: 'neutral/950' },
        D: { bg: 'neutral/800', text: 'neutral/50' },
      },
      'color/bg/brand|color/text/on-brand': {
        L: { bg: 'primary/900', text: 'neutral/50' },
        D: { bg: 'primary/50', text: 'neutral/950' },
      },
      'color/bg/brand-subtle|color/text/brand': {
        L: { bg: 'primary/50', text: 'primary/900' },
        D: { bg: 'primary/950', text: 'primary/50' },
      },
      'color/bg/danger|color/text/danger': {
        L: { bg: 'red/50', text: 'red/900' },
        D: { bg: 'red/950', text: 'red/100' },
      },
      'color/fill/danger|color/text/on-danger': {
        L: { bg: 'red/900', text: 'neutral/50' },
        D: { bg: 'red/100', text: 'neutral/950' },
      },
      'color/bg/success|color/text/success': {
        L: { bg: 'green/50', text: 'green/900' },
        D: { bg: 'green/950', text: 'green/100' },
      },
      'color/fill/success|color/text/on-success': {
        L: { bg: 'green/900', text: 'neutral/50' },
        D: { bg: 'green/100', text: 'neutral/950' },
      },
      'color/bg/warning|color/text/warning': {
        L: { bg: 'yellow/50', text: 'yellow/900' },
        D: { bg: 'yellow/950', text: 'yellow/100' },
      },
      'color/fill/warning|color/text/on-warning': {
        L: { bg: 'yellow/100', text: 'neutral/950' },
        D: { bg: 'yellow/100', text: 'neutral/950' },
      },
      'color/bg/info|color/text/info': {
        L: { bg: 'blue/50', text: 'blue/900' },
        D: { bg: 'blue/950', text: 'blue/100' },
      },
      'color/fill/info|color/text/on-info': {
        L: { bg: 'blue/900', text: 'neutral/50' },
        D: { bg: 'blue/100', text: 'neutral/950' },
      },
      'color/surface/brand-variant|color/on-surface/brand-variant': {
        L: { bg: 'primary/50', text: 'primary/900' },
        D: { bg: 'primary/950', text: 'primary/50' },
      },
      'color/surface/danger-variant|color/on-surface/danger-variant': {
        L: { bg: 'red/50', text: 'red/900' },
        D: { bg: 'red/950', text: 'red/100' },
      },
      'color/surface/success-variant|color/on-surface/success-variant': {
        L: { bg: 'green/50', text: 'green/900' },
        D: { bg: 'green/950', text: 'green/100' },
      },
      'color/surface/warning-variant|color/on-surface/warning-variant': {
        L: { bg: 'yellow/50', text: 'yellow/900' },
        D: { bg: 'yellow/950', text: 'yellow/100' },
      },
      'color/surface/info-variant|color/on-surface/info-variant': {
        L: { bg: 'blue/50', text: 'blue/900' },
        D: { bg: 'blue/950', text: 'blue/100' },
      },
    };
    const override = map[row.bg + '|' + row.text];
    if (!override) return row;
    row.L = override.L;
    row.D = override.D;
    return row;
  }

  let sourceTemplates;
  if (existingPairs) {
    sourceTemplates = existingPairs.map(p => {
      const template = pairTemplates.find(t => t.bg === p.bg && t.text === p.text) || {};
      const row = {
        bg:    p.bg,
        text:  p.text,
        min:   template.min   === null ? null : (template.min   || 4.5),
        minLc: template.minLc === null ? null : (template.minLc || 75),
        note:  template.note,
        L: p.Light ? { bg: p.Light.bg.replace(/^color\//, ''), text: p.Light.text.replace(/^color\//, '') } : null,
        D: p.Dark  ? { bg: p.Dark.bg.replace(/^color\//, ''),  text: p.Dark.text.replace(/^color\//, '')  } : null,
      };
      if (NEUTRAL_VARIANT !== 'neutral' && p.bg === 'color/surface/variant' && p.text === 'color/on-surface/default') {
        if (row.L && row.L.bg === 'neutral/100') row.L.bg = `${NEUTRAL_VARIANT}/100`;
        if (row.D && row.D.bg === 'neutral/900') row.D.bg = `${NEUTRAL_VARIANT}/900`;
      }
      if (p.bg === 'color/surface/success' && p.text === 'color/on-surface/success') {
        if (row.L && row.L.bg === 'green/600' && row.L.text === 'neutral/900') row.L.text = 'neutral/50';
      }
      return contrastHarmonized ? applyContrastHarmonizedPair(row) : row;
    });
  } else {
    sourceTemplates = contrastHarmonized
      ? pairTemplates.map(function(t) {
        return applyContrastHarmonizedPair({
          bg: t.bg,
          text: t.text,
          min: t.min,
          minLc: t.minLc,
          note: t.note,
          L: { bg: t.L.bg, text: t.L.text },
          D: { bg: t.D.bg, text: t.D.text },
        });
      })
      : pairTemplates;
  }

  let failCount = 0;
  const resolvedPairs = [];
  const tableRows = [];

  // Algorithm-gated "did this pair pass?" decision. Returns the gated boolean
  // alongside the underlying wcag/apca pass values, so the row can store all three.
  function gatePass(ratio, lc, tmpl) {
    const wcagPass = tmpl.min   === null ? null : ratio        >= tmpl.min;
    const apcaPass = tmpl.minLc === null ? null : Math.abs(lc) >= tmpl.minLc;
    const pass     = algorithm === 'apca' ? apcaPass : wcagPass;
    return { wcagPass, apcaPass, pass };
  }

  for (const tmpl of sourceTemplates) {
    const row = { bg: tmpl.bg, text: tmpl.text, min: tmpl.min, minLc: tmpl.minLc, note: tmpl.note };

    for (const [mode, side] of [['Light', tmpl.L], ['Dark', tmpl.D]]) {
      if (!side) { row[mode] = undefined; continue; }
      let bgRes  = resolve(side.bg);
      let txtRes = resolve(side.text);

      if (!bgRes || !txtRes) {
        row[mode] = { bg: side.bg, text: side.text, error: 'ramp not found in DS.color.ramps' };
        continue;
      }

      let bgLum  = luminance(bgRes.rgb);
      const txtLum = luminance(txtRes.rgb);
      let ratio  = wcagRatio(bgLum, txtLum);
      let lc     = apcaLc(txtRes.rgb, bgRes.rgb); // signed; rendered as Math.abs in UI
      let { wcagPass, apcaPass, pass } = gatePass(ratio, lc, tmpl);

      // Surface-success Light retry — if the gated metric currently fails, walk
      // the green ramp to a darker step and re-evaluate. Works under both
      // algorithms because gatePass returns the gated `pass` for the new bg.
      if (
        pass === false &&
        mode === 'Light' &&
        tmpl.bg === 'color/surface/success' &&
        tmpl.text === 'color/on-surface/success'
      ) {
        const darkerSuccessBg = resolve('green/700');
        if (darkerSuccessBg) {
          const darkerBgLum = luminance(darkerSuccessBg.rgb);
          const darkerRatio = wcagRatio(darkerBgLum, txtLum);
          const darkerLc    = apcaLc(txtRes.rgb, darkerSuccessBg.rgb);
          const darkerGate  = gatePass(darkerRatio, darkerLc, tmpl);
          if (darkerGate.pass) {
            bgRes    = darkerSuccessBg;
            bgLum    = darkerBgLum;
            ratio    = darkerRatio;
            lc       = darkerLc;
            wcagPass = darkerGate.wcagPass;
            apcaPass = darkerGate.apcaPass;
            pass     = darkerGate.pass;
          }
        }
      }

      let suggestion = null;

      if (pass === false) {
        const scorer    = algorithm === 'apca' ? apcaScorer : wcagScorer;
        const threshold = algorithm === 'apca' ? tmpl.minLc : tmpl.min;
        suggestion = suggestStepFor(side.text, bgRes.rgb, scorer, threshold);
        if (!existingPairs && suggestion) {
          const adjusted = resolve(suggestion.path.replace(/^color\//, ''));
          if (adjusted) {
            txtRes = adjusted;
            const adjustedTxtLum = luminance(adjusted.rgb);
            ratio = wcagRatio(bgLum, adjustedTxtLum);
            lc = apcaLc(adjusted.rgb, bgRes.rgb);
            const adjustedGate = gatePass(ratio, lc, tmpl);
            wcagPass = adjustedGate.wcagPass;
            apcaPass = adjustedGate.apcaPass;
            pass = adjustedGate.pass;
            side.text = suggestion.path.replace(/^color\//, '');
          }
        }
        if (pass === false) failCount++;
      }

      const wcagLabel = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? '3:1' : 'fail';
      const apcaLabel = apcaPass === null ? 'exempt' : apcaPass ? 'pass' : 'fail';

      row[mode] = {
        bg: bgRes.path, text: txtRes.path,
        wcag: Math.round(ratio * 10) / 10,
        wcagLabel,
        wcagPass,
        apca: lc,                // signed — see plan blind-spot #2
        apcaLabel,
        apcaPass,
        pass,
        bgClamped: bgRes.clamped, txtClamped: txtRes.clamped,
        suggestion: pass === false && suggestion ? { path: suggestion.path, wcag: Math.round(suggestion.ratio * 10) / 10, score: suggestion.score } : null,
      };
    }

    resolvedPairs.push(row);
    tableRows.push(row);
  }

  const existingUnpairedMap = {};
  if (Array.isArray(existingSemantics.unpaired)) {
    for (const item of existingSemantics.unpaired) {
      if (item && item.token) existingUnpairedMap[item.token] = item;
    }
  }

  const resolvedUnpaired = unpairedTemplates.map(u => {
    const saved = existingUnpairedMap[u.token];
    if (saved && (saved.Light || saved.Dark)) {
      return { token: u.token, Light: saved.Light || null, Dark: saved.Dark || null, note: saved.note || u.note };
    }
    if (u.scrim) return { token: u.token, Light: u.L, Dark: u.D, note: u.note };
    const lRes = resolve(u.L), dRes = resolve(u.D);
    return {
      token: u.token,
      Light: lRes ? lRes.path : `color/${u.L}`,
      Dark:  dRes ? dRes.path : `color/${u.D}`,
      note:  u.note,
    };
  });
  for (const item of Object.values(existingUnpairedMap)) {
    if (item && item.token && !resolvedUnpaired.some(u => u.token === item.token)) {
      resolvedUnpaired.push(item);
    }
  }

  // Preserve manually edited icon values across re-runs (same pattern as existingPairs).
  const existingIconMap = {};
  if (existingIcons) {
    for (const ic of existingIcons) {
      existingIconMap[ic.token] = { Light: ic.Light, Dark: ic.Dark };
    }
  }

  // Icon contrast gates. WCAG icon minimum is 3:1 (graphical objects, WCAG 2.2 SC 1.4.11).
  // APCA icon minimum is Lc 60 (essential graphical info, "spot reading" tier).
  const iconScorer    = algorithm === 'apca' ? apcaScorer : wcagScorer;
  const iconThreshold = algorithm === 'apca' ? 60 : 3;

  const resolvedIcons = wantsIconSemantics ? ROLE_ICONS.map(ic => {
    // Prefer saved values from a previous run; fall back to template defaults.
    const saved = existingIconMap[ic.token];
    const lRef  = saved && saved.Light ? saved.Light.replace(/^color\//, '') : ic.L.icon;
    const dRef  = saved && saved.Dark  ? saved.Dark.replace(/^color\//, '')  : ic.D.icon;

    const lIcon = resolve(lRef), lBg = resolve(ic.L.bg);
    const dIcon = resolve(dRef), dBg = resolve(ic.D.bg);

    let lRatio = null, dRatio = null, lPass = null, dPass = null;
    if (lIcon && lBg) {
      lRatio = Math.round(wcagRatio(luminance(lBg.rgb), luminance(lIcon.rgb)) * 10) / 10;
      lPass  = iconScorer(lIcon.rgb, lBg.rgb) >= iconThreshold;
    }
    if (dIcon && dBg) {
      dRatio = Math.round(wcagRatio(luminance(dBg.rgb), luminance(dIcon.rgb)) * 10) / 10;
      dPass  = iconScorer(dIcon.rgb, dBg.rgb) >= iconThreshold;
    }

    // Auto-adjust: if an icon step fails the gated threshold, find the nearest
    // passing step in the same ramp. Handles light-dominant primaries (e.g. lime)
    // without a manual fix loop. Uses the chosen algorithm's scorer.
    let finalLIcon = lIcon, finalDIcon = dIcon;
    if (lPass === false && lIcon && lBg) {
      const adj = suggestStepFor(lRef, lBg.rgb, iconScorer, iconThreshold);
      if (adj) {
        finalLIcon = resolve(adj.path.replace(/^color\//, ''));
        lRatio = Math.round(adj.ratio * 10) / 10;
        lPass  = true;
      }
    }
    if (dPass === false && dIcon && dBg) {
      const adj = suggestStepFor(dRef, dBg.rgb, iconScorer, iconThreshold);
      if (adj) {
        finalDIcon = resolve(adj.path.replace(/^color\//, ''));
        dRatio = Math.round(adj.ratio * 10) / 10;
        dPass  = true;
      }
    }

    if (lPass === false || dPass === false) failCount++;
    return {
      token: ic.token,
      Light: finalLIcon ? finalLIcon.path : null,
      Dark:  finalDIcon ? finalDIcon.path : null,
      lRatio, dRatio, lPass, dPass,
    };
  }) : [];

  // ── Format output ────────────────────────────────────────────────────────────
  const r2 = x => x != null ? `${x.toFixed(1)}:1` : '—';
  // Badge text reflects the gated algorithm. Both algorithms surface their own
  // numeric column (`Light ratio`, `Light APCA`); the badge calls out the verdict
  // tied to whichever algorithm the designer picked.
  const badge = (pass, lc) => {
    if (pass === null) return '— exempt';
    if (algorithm === 'apca') {
      const lcAbs = lc == null ? '?' : Math.abs(lc);
      return pass ? `✓ APCA (Lc ${lcAbs})` : '✗ APCA fail';
    }
    return pass ? `✓ AA` : '✗ FAIL';
  };

  let markdownTable = `| bg token | text token | Light ratio | Light APCA | Light | Dark ratio | Dark APCA | Dark | Note |\n`;
  markdownTable    += `|---|---|---|---|---|---|---|---|---|\n`;

  for (const row of tableRows) {
    const L = row.Light, D = row.Dark;
    const lRatio = L && L.wcag != null ? r2(L.wcag) : '—';
    const dRatio = D && D.wcag != null ? r2(D.wcag) : '—';
    const lApca  = L && L.apca != null ? `Lc ${Math.abs(L.apca)}` : '—';
    const dApca  = D && D.apca != null ? `Lc ${Math.abs(D.apca)}` : '—';
    const lBadge = L ? badge(L.pass, L.apca) : '—';
    const dBadge = D ? badge(D.pass, D.apca) : '—';

    let noteCol = row.note || '';
    if (L && L.suggestion) noteCol += ` ⚠ Light: suggest ${L.suggestion.path} (${r2(L.suggestion.wcag)})`;
    if (D && D.suggestion) noteCol += ` ⚠ Dark: suggest ${D.suggestion.path} (${r2(D.suggestion.wcag)})`;
    if ((L && (L.bgClamped || L.txtClamped)) || (D && (D.bgClamped || D.txtClamped))) noteCol += ' (step clamped)';

    markdownTable += `| \`${row.bg}\` | \`${row.text}\` | ${lRatio} | ${lApca} | ${lBadge} | ${dRatio} | ${dApca} | ${dBadge} | ${noteCol} |\n`;
  }

  // Icon table: render the chosen algorithm's verdict label.
  const iconBadgeOk = algorithm === 'apca' ? '✓ Lc≥60' : '✓ 3:1';
  let iconTable = `| icon token | Light ratio | Light | Dark ratio | Dark |\n`;
  iconTable    += `|---|---|---|---|---|\n`;
  for (const ic of resolvedIcons) {
    const lB = ic.lPass === false ? '✗ FAIL' : ic.lPass ? iconBadgeOk : '—';
    const dB = ic.dPass === false ? '✗ FAIL' : ic.dPass ? iconBadgeOk : '—';
    iconTable += `| \`${ic.token}\` | ${r2(ic.lRatio)} | ${lB} | ${r2(ic.dRatio)} | ${dB} |\n`;
  }

  DS.color.semantics = {
    convention,
    pairs: resolvedPairs.map(row => ({
      bg: row.bg, text: row.text,
      Light: row.Light ? { bg: row.Light.bg,  text: row.Light.text  } : undefined,
      Dark:  row.Dark  ? { bg: row.Dark.bg,   text: row.Dark.text   } : undefined,
    })),
    icons:    resolvedIcons.map(ic => ({ token: ic.token, Light: ic.Light, Dark: ic.Dark })),
    unpaired: resolvedUnpaired,
  };

  const passLabel = algorithm === 'apca' ? 'APCA Lc minimum' : 'AA minimum';
  const failBlock = failCount
    ? `\n⚠️  ${failCount} pair(s) fail ${passLabel} — see "suggest" column for nearest passing step.`
    : `\n✓ All pairs pass ${passLabel}.`;

  const clampedPairs = resolvedPairs.filter(r =>
    (r.Light && (r.Light.bgClamped || r.Light.txtClamped)) ||
    (r.Dark  && (r.Dark.bgClamped  || r.Dark.txtClamped))
  );
  const clampBlock = clampedPairs.length
    ? `\n  ℹ️  ${clampedPairs.length} pair(s) had steps clamped to match your scale (${DS.color.scale}).`
    : '';

  const summary =
    `Validated ${resolvedPairs.length} pairs + ${resolvedIcons.length} icon tokens (${convention}, ${algorithm}).` +
    failBlock + clampBlock +
    '\nDS.color.semantics written to config.';

  // Suggestions keyed by `${bg}|${text}` so callers can read the upgraded
  // accessible step for either mode without re-walking the ramp. Additive —
  // existing consumers ignore this field.
  const pairSuggestions = {};
  for (const row of resolvedPairs) {
    pairSuggestions[`${row.bg}|${row.text}`] = {
      Light: row.Light && row.Light.suggestion ? row.Light.suggestion.path : null,
      Dark:  row.Dark  && row.Dark.suggestion  ? row.Dark.suggestion.path  : null,
    };
  }

  return { ds: DS, markdownTable, iconTable, failCount, summary, pairSuggestions };
}

module.exports = { validateSemanticPairs };

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
    return Math.round(lc > 0 ? lc * 100 - 12.5 : lc * 100 + 12.5);
  }

  function suggestStep(textRampRef, bgRgb, minRatio) {
    let [rampName] = textRampRef.split('/');
    if (rampName === 'primary') rampName = PRIMARY;
    const ramp = rampByName[rampName];
    if (!ramp) return null;
    const bgLum = luminance(bgRgb);
    const passing = ramp
      .map(([step, r, g, b]) => ({ step, ratio: wcagRatio(bgLum, luminance({ r, g, b })) }))
      .filter(e => e.ratio >= minRatio);
    if (!passing.length) return null;
    const currentStep = parseInt(textRampRef.split('/')[1], 10);
    passing.sort((a, b) => Math.abs(a.step - currentStep) - Math.abs(b.step - currentStep));
    const best = passing[0];
    return { step: best.step, path: `color/${rampName}/${best.step}`, ratio: best.ratio };
  }

  // ── Preserve manually edited pairs on re-run ─────────────────────────────────
  const existingPairs = (DS.color.semantics && DS.color.semantics.pairs) ? DS.color.semantics.pairs : null;

  // ── Pair templates ────────────────────────────────────────────────────────────
  const NEUTRAL_VARIANT = rampByName['neutral-variant'] ? 'neutral-variant' : 'neutral';

  const ROLE_PAIRS = [
    { bg: 'color/bg/default',        text: 'color/text/default',    L: { bg: 'neutral/50',  text: 'neutral/950' }, D: { bg: 'neutral/950', text: 'neutral/50'  }, min: 4.5 },
    { bg: 'color/bg/default',        text: 'color/text/subtle',     L: { bg: 'neutral/50',  text: 'neutral/700' }, D: { bg: 'neutral/950', text: 'neutral/300' }, min: 4.5 },
    { bg: 'color/bg/default',        text: 'color/text/muted',      L: { bg: 'neutral/50',  text: 'neutral/500' }, D: { bg: 'neutral/950', text: 'neutral/500' }, min: null, note: 'decorative — may be sub-AA by design' },
    { bg: 'color/bg/subtle',         text: 'color/text/default',    L: { bg: 'neutral/100', text: 'neutral/950' }, D: { bg: 'neutral/900', text: 'neutral/50'  }, min: 4.5 },
    { bg: 'color/bg/muted',          text: 'color/text/default',    L: { bg: 'neutral/200', text: 'neutral/950' }, D: { bg: 'neutral/800', text: 'neutral/50'  }, min: 4.5 },
    { bg: 'color/bg/brand',          text: 'color/text/on-brand',   L: { bg: 'primary/600', text: 'neutral/50'  }, D: { bg: 'primary/500', text: 'neutral/950' }, min: 4.5 },
    { bg: 'color/bg/brand-subtle',   text: 'color/text/brand',      L: { bg: 'primary/50',  text: 'primary/700' }, D: { bg: 'primary/950', text: 'primary/300' }, min: 4.5 },
    { bg: 'color/bg/danger',         text: 'color/text/on-danger',  L: { bg: 'red/600',     text: 'neutral/50'  }, D: { bg: 'red/500',     text: 'neutral/950' }, min: 4.5 },
    { bg: 'color/bg/danger-subtle',  text: 'color/text/danger',     L: { bg: 'red/50',      text: 'red/700'     }, D: { bg: 'red/950',     text: 'red/300'     }, min: 4.5 },
    { bg: 'color/bg/success',        text: 'color/text/on-success', L: { bg: 'green/600',   text: 'neutral/50'  }, D: { bg: 'green/500',   text: 'neutral/950' }, min: 4.5 },
    { bg: 'color/bg/success-subtle', text: 'color/text/success',    L: { bg: 'green/50',    text: 'green/700'   }, D: { bg: 'green/950',   text: 'green/300'   }, min: 4.5 },
    { bg: 'color/bg/warning',        text: 'color/text/on-warning', L: { bg: 'yellow/500',  text: 'neutral/950' }, D: { bg: 'yellow/400',  text: 'neutral/950' }, min: 4.5, note: '⚠ must use dark text — yellow fails with light' },
    { bg: 'color/bg/warning-subtle', text: 'color/text/warning',    L: { bg: 'yellow/50',   text: 'yellow/800'  }, D: { bg: 'yellow/950',  text: 'yellow/300'  }, min: 4.5 },
    { bg: 'color/bg/info',           text: 'color/text/on-info',    L: { bg: 'blue/600',    text: 'neutral/50'  }, D: { bg: 'blue/500',    text: 'neutral/950' }, min: 4.5 },
    { bg: 'color/bg/info-subtle',    text: 'color/text/info',       L: { bg: 'blue/50',     text: 'blue/700'    }, D: { bg: 'blue/950',    text: 'blue/300'    }, min: 4.5 },
  ];

  const SURFACE_PAIRS = [
    { bg: 'color/surface/default',       text: 'color/on-surface/default',  L: { bg: 'neutral/50',  text: 'neutral/950' }, D: { bg: 'neutral/950', text: 'neutral/50'  }, min: 4.5 },
    { bg: 'color/surface/default',       text: 'color/on-surface/variant',  L: { bg: 'neutral/50',  text: 'neutral/700' }, D: { bg: 'neutral/950', text: 'neutral/300' }, min: 4.5 },
    { bg: 'color/surface/variant',       text: 'color/on-surface/default',  L: { bg: `${NEUTRAL_VARIANT}/100`, text: 'neutral/950' }, D: { bg: `${NEUTRAL_VARIANT}/900`, text: 'neutral/50'  }, min: 4.5 },
    { bg: 'color/surface/brand',         text: 'color/on-surface/brand',    L: { bg: 'primary/500', text: 'neutral/900' }, D: { bg: 'primary/500', text: 'neutral/950' }, min: 4.5 },
    { bg: 'color/surface/brand-variant', text: 'color/on-surface/default',  L: { bg: 'primary/50',  text: 'neutral/950' }, D: { bg: 'primary/950', text: 'neutral/50'  }, min: 4.5 },
    { bg: 'color/surface/danger',         text: 'color/on-surface/danger',   L: { bg: 'red/600',     text: 'neutral/50'  }, D: { bg: 'red/500',     text: 'neutral/950' }, min: 4.5 },
    { bg: 'color/surface/danger-variant', text: 'color/on-surface/default',  L: { bg: 'red/50',      text: 'neutral/950' }, D: { bg: 'red/950',     text: 'neutral/50'  }, min: 4.5 },
    { bg: 'color/surface/success',        text: 'color/on-surface/success',  L: { bg: 'green/600',   text: 'neutral/50'  }, D: { bg: 'green/500',   text: 'neutral/950' }, min: 4.5 },
    { bg: 'color/surface/success-variant',text: 'color/on-surface/default',  L: { bg: 'green/50',    text: 'neutral/950' }, D: { bg: 'green/950',   text: 'neutral/50'  }, min: 4.5 },
    { bg: 'color/surface/warning',        text: 'color/on-surface/warning',  L: { bg: 'yellow/500',  text: 'neutral/950' }, D: { bg: 'yellow/400',  text: 'neutral/950' }, min: 4.5, note: '⚠ must use dark text' },
    { bg: 'color/surface/warning-variant',text: 'color/on-surface/default',  L: { bg: 'yellow/50',   text: 'neutral/950' }, D: { bg: 'yellow/950',  text: 'neutral/50'  }, min: 4.5, note: '⚠ must use dark text' },
    { bg: 'color/surface/info',           text: 'color/on-surface/info',     L: { bg: 'blue/600',    text: 'neutral/50'  }, D: { bg: 'blue/500',    text: 'neutral/950' }, min: 4.5 },
    { bg: 'color/surface/info-variant',   text: 'color/on-surface/default',  L: { bg: 'blue/50',     text: 'neutral/950' }, D: { bg: 'blue/950',    text: 'neutral/50'  }, min: 4.5 },
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
  ];

  const ROLE_UNPAIRED = [
    { token: 'color/text/disabled',  L: 'neutral/400', D: 'neutral/600', note: 'exempt — WCAG 1.4.3 disabled controls' },
    { token: 'color/border/default', L: 'neutral/200', D: 'neutral/800' },
    { token: 'color/border/subtle',  L: 'neutral/100', D: 'neutral/900' },
    { token: 'color/border/strong',  L: 'neutral/400', D: 'neutral/600' },
    { token: 'color/border/brand',   L: 'primary/500', D: 'primary/500' },
    { token: 'color/border/danger',  L: 'red/500',     D: 'red/500'     },
    { token: 'color/border/focus',   L: 'primary/500', D: 'primary/400', note: '3:1 vs adjacent bg required' },
    { token: 'color/surface/default',L: 'neutral/50',  D: 'neutral/950' },
    { token: 'color/surface/raised', L: 'neutral/100', D: 'neutral/900' },
    { token: 'color/surface/overlay',L: 'neutral/200', D: 'neutral/800' },
    { token: 'color/surface/sunken', L: 'neutral/200', D: 'neutral/800' },
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

  let sourceTemplates;
  if (existingPairs) {
    sourceTemplates = existingPairs.map(p => {
      const template = pairTemplates.find(t => t.bg === p.bg && t.text === p.text) || {};
      const row = {
        bg:   p.bg,
        text: p.text,
        min:  template.min || 4.5,
        note: template.note,
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
      return row;
    });
  } else {
    sourceTemplates = pairTemplates;
  }

  let failCount = 0;
  const resolvedPairs = [];
  const tableRows = [];

  for (const tmpl of sourceTemplates) {
    const row = { bg: tmpl.bg, text: tmpl.text, min: tmpl.min, note: tmpl.note };

    for (const [mode, side] of [['Light', tmpl.L], ['Dark', tmpl.D]]) {
      if (!side) { row[mode] = undefined; continue; }
      let bgRes  = resolve(side.bg);
      const txtRes = resolve(side.text);

      if (!bgRes || !txtRes) {
        row[mode] = { bg: side.bg, text: side.text, error: 'ramp not found in DS.color.ramps' };
        continue;
      }

      let bgLum  = luminance(bgRes.rgb);
      const txtLum = luminance(txtRes.rgb);
      let ratio  = wcagRatio(bgLum, txtLum);
      let lc     = Math.abs(apcaLc(txtRes.rgb, bgRes.rgb));
      let pass   = tmpl.min === null ? null : ratio >= tmpl.min;

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
          if (darkerRatio >= tmpl.min) {
            bgRes = darkerSuccessBg;
            bgLum = darkerBgLum;
            ratio = darkerRatio;
            lc = Math.abs(apcaLc(txtRes.rgb, bgRes.rgb));
            pass = true;
          }
        }
      }

      let suggestion = null;

      if (pass === false) {
        failCount++;
        suggestion = suggestStep(side.text, bgRes.rgb, tmpl.min);
      }

      const wcagLabel = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? '3:1' : 'fail';

      row[mode] = {
        bg: bgRes.path, text: txtRes.path,
        wcag: Math.round(ratio * 10) / 10,
        wcagLabel, apca: lc, pass,
        bgClamped: bgRes.clamped, txtClamped: txtRes.clamped,
        suggestion: suggestion ? { path: suggestion.path, wcag: Math.round(suggestion.ratio * 10) / 10 } : null,
      };
    }

    resolvedPairs.push(row);
    tableRows.push(row);
  }

  const resolvedUnpaired = unpairedTemplates.map(u => {
    if (u.scrim) return { token: u.token, Light: u.L, Dark: u.D, note: u.note };
    const lRes = resolve(u.L), dRes = resolve(u.D);
    return {
      token: u.token,
      Light: lRes ? lRes.path : `color/${u.L}`,
      Dark:  dRes ? dRes.path : `color/${u.D}`,
      note:  u.note,
    };
  });

  // Preserve manually edited icon values across re-runs (same pattern as existingPairs).
  const existingIconMap = {};
  if (DS.color.semantics && DS.color.semantics.icons) {
    for (const ic of DS.color.semantics.icons) {
      existingIconMap[ic.token] = { Light: ic.Light, Dark: ic.Dark };
    }
  }

  const resolvedIcons = ROLE_ICONS.map(ic => {
    // Prefer saved values from a previous run; fall back to template defaults.
    const saved = existingIconMap[ic.token];
    const lRef  = saved && saved.Light ? saved.Light.replace(/^color\//, '') : ic.L.icon;
    const dRef  = saved && saved.Dark  ? saved.Dark.replace(/^color\//, '')  : ic.D.icon;

    const lIcon = resolve(lRef), lBg = resolve(ic.L.bg);
    const dIcon = resolve(dRef), dBg = resolve(ic.D.bg);

    let lRatio = null, dRatio = null, lPass = null, dPass = null;
    if (lIcon && lBg) { lRatio = Math.round(wcagRatio(luminance(lBg.rgb), luminance(lIcon.rgb)) * 10) / 10; lPass = lRatio >= 3; }
    if (dIcon && dBg) { dRatio = Math.round(wcagRatio(luminance(dBg.rgb), luminance(dIcon.rgb)) * 10) / 10; dPass = dRatio >= 3; }

    // Auto-adjust: if an icon step fails 3:1, find the nearest passing step in the same ramp.
    // This handles light-dominant primaries (e.g. lime) without requiring a manual fix loop.
    let finalLIcon = lIcon, finalDIcon = dIcon;
    if (lPass === false && lIcon && lBg) {
      const adj = suggestStep(lRef, lBg.rgb, 3);
      if (adj) {
        finalLIcon = resolve(adj.path.replace(/^color\//, ''));
        lRatio = Math.round(adj.ratio * 10) / 10;
        lPass  = true;
      }
    }
    if (dPass === false && dIcon && dBg) {
      const adj = suggestStep(dRef, dBg.rgb, 3);
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
  });

  // ── Format output ────────────────────────────────────────────────────────────
  const r2 = x => x != null ? `${x.toFixed(1)}:1` : '—';
  const badge = (pass, lc) => {
    if (pass === null) return '— exempt';
    if (pass) return `✓ AA (Lc ${lc})`;
    return '✗ FAIL';
  };

  let markdownTable = `| bg token | text token | Light ratio | Light APCA | Light | Dark ratio | Dark APCA | Dark | Note |\n`;
  markdownTable    += `|---|---|---|---|---|---|---|---|---|\n`;

  for (const row of tableRows) {
    const L = row.Light, D = row.Dark;
    const lRatio = L && L.wcag != null ? r2(L.wcag) : '—';
    const dRatio = D && D.wcag != null ? r2(D.wcag) : '—';
    const lApca  = L && L.apca != null ? `Lc ${L.apca}` : '—';
    const dApca  = D && D.apca != null ? `Lc ${D.apca}` : '—';
    const lBadge = L ? badge(L.pass, L.apca) : '—';
    const dBadge = D ? badge(D.pass, D.apca) : '—';

    let noteCol = row.note || '';
    if (L && L.suggestion) noteCol += ` ⚠ Light: suggest ${L.suggestion.path} (${r2(L.suggestion.wcag)})`;
    if (D && D.suggestion) noteCol += ` ⚠ Dark: suggest ${D.suggestion.path} (${r2(D.suggestion.wcag)})`;
    if ((L && (L.bgClamped || L.txtClamped)) || (D && (D.bgClamped || D.txtClamped))) noteCol += ' (step clamped)';

    markdownTable += `| \`${row.bg}\` | \`${row.text}\` | ${lRatio} | ${lApca} | ${lBadge} | ${dRatio} | ${dApca} | ${dBadge} | ${noteCol} |\n`;
  }

  let iconTable = `| icon token | Light ratio | Light | Dark ratio | Dark |\n`;
  iconTable    += `|---|---|---|---|---|\n`;
  for (const ic of resolvedIcons) {
    const lB = ic.lPass === false ? '✗ FAIL' : ic.lPass ? '✓ 3:1' : '—';
    const dB = ic.dPass === false ? '✗ FAIL' : ic.dPass ? '✓ 3:1' : '—';
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

  const failBlock = failCount
    ? `\n⚠️  ${failCount} pair(s) fail — see "suggest" column for nearest passing step.`
    : '\n✓ All pairs pass AA minimum.';

  const clampedPairs = resolvedPairs.filter(r =>
    (r.Light && (r.Light.bgClamped || r.Light.txtClamped)) ||
    (r.Dark  && (r.Dark.bgClamped  || r.Dark.txtClamped))
  );
  const clampBlock = clampedPairs.length
    ? `\n  ℹ️  ${clampedPairs.length} pair(s) had steps clamped to match your scale (${DS.color.scale}).`
    : '';

  const summary =
    `Validated ${resolvedPairs.length} pairs + ${resolvedIcons.length} icon tokens (${convention}).` +
    failBlock + clampBlock +
    '\nDS.color.semantics written to config.';

  return { ds: DS, markdownTable, iconTable, failCount, summary };
}

module.exports = { validateSemanticPairs };

'use strict';

const WCAG_TEXT_THRESHOLD = 4.5;
const WCAG_NON_TEXT_THRESHOLD = 3;
const APCA_TEXT_THRESHOLD = 75;
const WCAG_NEARMISS = 0.3;
const APCA_NEARMISS = 5;

function linearize(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function wcagRatioFromLuminance(lum1, lum2) {
  const hi = Math.max(lum1, lum2), lo = Math.min(lum1, lum2);
  return (hi + 0.05) / (lo + 0.05);
}

function wcagContrastRatio(a, b) {
  return wcagRatioFromLuminance(relativeLuminance(a), relativeLuminance(b));
}

function apcaLuminance({ r, g, b }) {
  return 0.2126729 * Math.pow(r, 2.4) + 0.7151522 * Math.pow(g, 2.4) + 0.0721750 * Math.pow(b, 2.4);
}

function apcaLc(txt, bg) {
  const BC = 0.022, BE = 1.414;
  const Yt = apcaLuminance(txt), Yb = apcaLuminance(bg);
  const Yt2 = Yt < BC ? Yt + Math.pow(BC - Yt, BE) : Yt;
  const Yb2 = Yb < BC ? Yb + Math.pow(BC - Yb, BE) : Yb;
  let lc;
  if (Yb2 >= Yt2) lc = (Math.pow(Yb2, 0.56) - Math.pow(Yt2, 0.57)) * 1.14;
  else             lc = (Math.pow(Yb2, 0.65) - Math.pow(Yt2, 0.62)) * 1.14;
  if (Math.abs(lc) < 0.1) return 0;
  return Math.round(lc > 0 ? lc * 100 - 2.7 : lc * 100 + 2.7);
}

function contrastScore({ algorithm, role, fgRgb, bgRgb }) {
  if (!fgRgb || !bgRgb) return null;
  if (role === 'non-text' || role === 'icon') return wcagContrastRatio(fgRgb, bgRgb);
  if (algorithm === 'apca') return Math.abs(apcaLc(fgRgb, bgRgb));
  return wcagContrastRatio(fgRgb, bgRgb);
}

function contrastThreshold({ algorithm, role, min, minLc }) {
  if (role === 'non-text' || role === 'icon') {
    return { algorithm: 'wcag-non-text', value: WCAG_NON_TEXT_THRESHOLD, nearMissDelta: WCAG_NEARMISS };
  }
  if (algorithm === 'apca') {
    if (minLc === null) return null;
    return {
      algorithm: 'apca',
      value: Number.isFinite(Number(minLc)) ? Number(minLc) : APCA_TEXT_THRESHOLD,
      nearMissDelta: APCA_NEARMISS,
    };
  }
  if (min === null) return null;
  return {
    algorithm: 'wcag',
    value: Number.isFinite(Number(min)) ? Number(min) : WCAG_TEXT_THRESHOLD,
    nearMissDelta: WCAG_NEARMISS,
  };
}

function contrastPasses({ algorithm, role, fgRgb, bgRgb, min, minLc, threshold }) {
  const thresholdInfo = threshold || contrastThreshold({ algorithm, role, min, minLc });
  if (!thresholdInfo) return true;
  const score = contrastScore({ algorithm: thresholdInfo.algorithm === 'apca' ? 'apca' : algorithm, role, fgRgb, bgRgb });
  return score != null && score >= thresholdInfo.value;
}

module.exports = {
  WCAG_TEXT_THRESHOLD,
  WCAG_NON_TEXT_THRESHOLD,
  APCA_TEXT_THRESHOLD,
  WCAG_NEARMISS,
  APCA_NEARMISS,
  linearize,
  relativeLuminance,
  wcagRatioFromLuminance,
  wcagContrastRatio,
  apcaLuminance,
  apcaLc,
  contrastScore,
  contrastThreshold,
  contrastPasses,
};

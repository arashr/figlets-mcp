'use strict';

/**
 * oklch.js
 * sRGB ↔ OKLab ↔ OKLCh conversions plus chroma-reducing gamut clip.
 * Formulas: Björn Ottosson, https://bottosson.github.io/posts/oklab/
 *
 * All inputs/outputs that mention "rgb" use channels in the [0, 1] range
 * (matching the rest of generate-color-ramps.js).
 */

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function srgbToOklab(rgb) {
  const lr = srgbToLinear(rgb.r);
  const lg = srgbToLinear(rgb.g);
  const lb = srgbToLinear(rgb.b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r:  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  };
}

function srgbToOklch(rgb) {
  const { L, a, b } = srgbToOklab(rgb);
  const C = Math.sqrt(a * a + b * b);
  let H = Math.atan2(b, a) * 180 / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

function inGamut(linear, eps) {
  const e = eps || 0;
  return linear.r >= -e && linear.r <= 1 + e
      && linear.g >= -e && linear.g <= 1 + e
      && linear.b >= -e && linear.b <= 1 + e;
}

function oklchToLinear(L, C, H) {
  const hr = H * Math.PI / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  return oklabToLinearSrgb(L, a, b);
}

/**
 * Convert OKLCh → sRGB, reducing chroma if needed to stay in gamut.
 * Returns sRGB channels in [0, 1].
 */
function oklchToSrgbClipped(L, C, H) {
  let linear = oklchToLinear(L, Math.max(0, C), H);

  if (!inGamut(linear, 1e-4)) {
    // Binary search for the largest chroma that stays in sRGB gamut at this L,H.
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const test = oklchToLinear(L, mid, H);
      if (inGamut(test, 1e-4)) lo = mid; else hi = mid;
    }
    linear = oklchToLinear(L, lo, H);
  }

  return {
    r: linearToSrgb(linear.r),
    g: linearToSrgb(linear.g),
    b: linearToSrgb(linear.b),
  };
}

module.exports = {
  srgbToOklab,
  srgbToOklch,
  oklchToSrgbClipped,
};

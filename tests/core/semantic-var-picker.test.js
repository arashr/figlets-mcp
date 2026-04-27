/**
 * Tests for the semantic variable picker used in the DS showcase.
 *
 * Uses a two-layer scoring system:
 *
 *   Layer 1 — _SEG: segment keyword → semantic categories (always >= 0).
 *     "on-surface" → { FG: 3 }
 *     "brand-variant" → { BRAND: 1, BVAR: 3 }
 *     Every slash-separated path segment accumulates its categories.
 *
 *   Layer 2 — _ROLE: role → category weights (positive = reward, negative = penalty).
 *     Final score = dot product of path category map with role weights.
 *     "onBrandVariant" = { FG: 3, BG: -4, BRAND: 3, BVAR: 2 }
 *
 * Rules:
 *   1. Every segment in a path contributes to its categories independently.
 *      "color/surface/brand" scores higher for surfaceBrand than "color/brand/500"
 *      because it accumulates both BG (from surface) and BRAND (from brand).
 *
 *   2. Contradicting categories score negatively, disqualifying a variable.
 *      "on-surface" contributes FG:3; surfaceDefault penalises FG by -4, so
 *      "color/on-surface/default" is never mistaken for a background token.
 *
 *   3. ANY foreground qualifier beside a brand-variant marker resolves correctly.
 *      "on-surface/brand-variant" scores higher than "on-surface/default" for
 *      onBrandVariant because BRAND and BVAR categories add to the dot product.
 *      No manual enumeration of qualifier combinations is required.
 *
 *   4. Unconventional naming like "fg/primary" is understood directly — "fg"
 *      contributes FG:2 which scores positively for onSurface. No contrast needed.
 *
 *   5. Functional fallback (contrast, lum, sat) is the last resort only —
 *      for DSes with entirely non-semantic naming conventions.
 *
 *   6. Status tokens (nameOnly=true): return null rather than guessing when
 *      no variable scores above zero for the status role.
 */

const assert = require("assert");

// ── Pure color helpers (verbatim from code.js) ─────────────────────────────

function _lum({ r, g, b }) {
  return [r, g, b]
    .map(c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
}

function _sat({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function _contrastRatio(c1, c2) {
  const L1 = _lum(c1), L2 = _lum(c2);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

// ── Segment dictionary, role weights, and scorer (verbatim from code.js) ────

// _SEG: segment keyword → semantic category contributions (always non-negative).
const _SEG = {
  // BG family
  'surface':       { BG: 3 },
  'background':    { BG: 3 },
  'bg':            { BG: 2 },
  'canvas':        { BG: 2 },
  'base':          { BG: 1 },
  'page':          { BG: 1 },
  'fill':          { BG: 1 },
  'container':     { BG: 1, BRAND: 1 },
  // FG family
  'on-surface':    { FG: 3 },
  'on_surface':    { FG: 3 },
  'foreground':    { FG: 3 },
  'fg':            { FG: 2 },
  'text':          { FG: 2 },
  'icon':          { FG: 1 },
  'label':         { FG: 1 },
  'content':       { FG: 1 },
  'on':            { FG: 1 },
  // On-brand variants (FG that lives on a brand surface)
  'on-brand':      { FG: 2, BRAND: 2 },
  'on_brand':      { FG: 2, BRAND: 2 },
  'on-primary':    { FG: 2, BRAND: 2 },
  'on_primary':    { FG: 2, BRAND: 2 },
  // Brand / primary family
  'brand':         { BRAND: 2 },
  'primary':       { BRAND: 2 },
  'accent':        { BRAND: 2 },
  'action':        { BRAND: 1 },
  'interactive':   { BRAND: 1 },
  // Brand-variant
  'brand-variant': { BRAND: 1, BVAR: 3 },
  'brand_variant': { BRAND: 1, BVAR: 3 },
  // Modifiers
  'default':       { DEFAULT: 1 },
  'variant':       { VARIANT: 2 },
  'subtle':        { VARIANT: 1 },
  'muted':         { VARIANT: 2 },
  'secondary':     { VARIANT: 1 },
  'sub':           { VARIANT: 1 },
  'weak':          { VARIANT: 1 },
  'strong':        { STRONG: 1 },
  // Outline / border family
  'outline':       { OUTLINE: 3 },
  'border':        { OUTLINE: 3 },
  'stroke':        { OUTLINE: 2 },
  'divider':       { OUTLINE: 3 },
  'separator':     { OUTLINE: 3 },
  'line':          { OUTLINE: 1 },
  // Status families
  'success':       { SUCCESS: 3 },
  'positive':      { SUCCESS: 2 },
  'confirm':       { SUCCESS: 1 },
  'warning':       { WARNING: 3 },
  'caution':       { WARNING: 2 },
  'alert':         { WARNING: 1 },
  'danger':        { DANGER: 2 },
  'error':         { DANGER: 2 },
};

// _ROLE: semantic role → category weights. Positive rewards, negative penalises.
const _ROLE = {
  onSurface:      { FG: 3, BG: -4, VARIANT: -1, DEFAULT: 1, STRONG: 1 },
  onSurfaceVar:   { FG: 3, BG: -4, VARIANT: 2 },
  surfaceDefault: { BG: 3, FG: -4, VARIANT: -1, DEFAULT: 2, BRAND: -2 },
  surfaceVariant: { BG: 3, FG: -4, VARIANT: 2 },
  surfaceBrand:   { BG: 2, FG: -4, BRAND: 3 },
  brandVariant:   { BG: 2, FG: -4, BVAR: 3, BRAND: 1 },
  onBrandVariant: { FG: 3, BG: -4, BRAND: 3, BVAR: 2 },
  outlineSubtle:  { OUTLINE: 3, FG: -2, BG: -2 },
  outlineBrand:   { OUTLINE: 3, FG: -2, BG: -2, BRAND: 3 },
  successBg:      { SUCCESS: 3, BG: 2, FG: -3, OUTLINE: -2, WARNING: -6, DANGER: -6 },
  successBorder:  { SUCCESS: 3, OUTLINE: 2, BG: -2, FG: -1, WARNING: -6, DANGER: -6 },
  successText:    { SUCCESS: 3, FG: 2, BG: -3, OUTLINE: -2, WARNING: -6, DANGER: -6 },
  warningBg:      { WARNING: 3, BG: 2, FG: -3, OUTLINE: -2, SUCCESS: -6, DANGER: -6 },
  warningBorder:  { WARNING: 3, OUTLINE: 2, BG: -2, FG: -1, SUCCESS: -6, DANGER: -6 },
  warningText:    { WARNING: 3, FG: 2, BG: -3, OUTLINE: -2, SUCCESS: -6, DANGER: -6 },
};

function _pathCats(name) {
  var segments = name.toLowerCase().split('/');
  var cats = {};
  for (var i = 0; i < segments.length; i++) {
    var segCats = _SEG[segments[i]];
    if (!segCats) continue;
    for (var cat in segCats) {
      cats[cat] = (cats[cat] || 0) + segCats[cat];
    }
  }
  return cats;
}

function _segScore(name, role) {
  var pathCats = _pathCats(name);
  var roleWeights = _ROLE[role];
  if (!roleWeights) return 0;
  var total = 0;
  for (var rcat in roleWeights) {
    total += roleWeights[rcat] * (pathCats[rcat] || 0);
  }
  return total;
}

// ── _semPick (verbatim from code.js) ──────────────────────────────────────

function makeSemPick(_scored) {
  return function _semPick(role, scorer, nameOnly, requiredCats) {
    var best = null, bestSeg = 0;
    for (var i = 0; i < _scored.length; i++) {
      var s = _scored[i];
      var seg = _segScore(s.name, role);
      if (seg <= 0) continue;
      if (requiredCats) {
        var pCats = _pathCats(s.name);
        var ok = true;
        for (var ci = 0; ci < requiredCats.length; ci++) {
          if ((pCats[requiredCats[ci]] || 0) <= 0) { ok = false; break; }
        }
        if (!ok) continue;
      }
      if (best === null || seg > bestSeg || (seg === bestSeg && scorer(s) > scorer(best))) {
        best = s; bestSeg = seg;
      }
    }
    if (best !== null) return best.v;

    // Purpose-locked roles: never cross purpose boundaries via functional fallback
    if (nameOnly || requiredCats) return null;

    var funcBest = null, funcScore = 0;
    for (var j = 0; j < _scored.length; j++) {
      var sc = scorer(_scored[j]);
      if (sc > funcScore) { funcScore = sc; funcBest = _scored[j]; }
    }
    return funcBest ? funcBest.v : null;
  };
}

// ── Test helpers ───────────────────────────────────────────────────────────

function v(name, r, g, b) {
  return { name, rgb: { r, g, b } };
}

function createPicker(mockVars, bgRGB) {
  bgRGB = bgRGB || { r: 0.98, g: 0.98, b: 0.98 };
  const _scored = mockVars.map(mv => ({
    v: mv,
    rgb: mv.rgb,
    lum: _lum(mv.rgb),
    sat: _sat(mv.rgb),
    contrast: _contrastRatio(mv.rgb, bgRGB),
    name: mv.name.toLowerCase(),
  }));
  return makeSemPick(_scored);
}

// Functional scorers (verbatim from code.js _V entries)
const score = {
  onSurface:    s => s.contrast >= 4.5 ? s.contrast : 0,
  onSurfaceVar: s => s.contrast >= 2 && s.contrast < 9 ? s.contrast : 0,
  surfaceDefault: s => s.lum,
  surfaceBrand: s => s.sat * 0.5 + s.lum * 0.5,
  outlineSubtle: s => {
    if (s.lum > 0.9 || s.lum < 0.05) return 0;
    var dist = Math.abs(s.lum - 0.6);
    if (dist > 0.5) return 0;
    return (1 - s.sat) * (1 - dist * 2);
  },
};

// ── Scenarios ──────────────────────────────────────────────────────────────

// Scenario 1
// A standard DS uses "on-surface/default" for its default text color.
// "on-surface" contributes FG:3, "default" contributes DEFAULT:1.
// Dot product with onSurface role {FG:3, DEFAULT:1, ...} = 10.
// It should be chosen over any other variable.
{
  const pick = createPicker([
    v("color/on-surface/default", 0.1,  0.1,  0.1),   // FG:3 + DEFAULT:1 → onSurface: 10
    v("color/surface/default",    0.98, 0.98, 0.98),  // BG:3 → onSurface: -12+2 = -10 (excluded)
    v("color/brand/500",          0.2,  0.4,  0.9),   // BRAND:2 → onSurface: 0 (no match)
  ]);

  const result = pick("onSurface", score.onSurface);

  assert.strictEqual(result.name, "color/on-surface/default",
    "Scenario 1: standard DS — 'on-surface/default' found by segment scoring");
}

// Scenario 2
// A DS uses "fg/primary" instead of "on-surface/default". The "fg" segment
// scores +2 for onSurface — found directly without needing contrast fallback.
// The background "bg/default" also exists; its "bg" segment scores negatively
// for onSurface (-2), so it is correctly excluded.
{
  const pick = createPicker([
    v("fg/primary",  0.1,  0.1,  0.1),   // FG:2 + BRAND:2 → onSurface: 6  (wins)
    v("bg/default",  0.98, 0.98, 0.98),  // BG:2 + DEFAULT:1 → onSurface: -7 (excluded)
    v("brand/500",   0.2,  0.4,  0.9),   // BRAND:2 → onSurface: 0 (no match)
  ]);

  const result = pick("onSurface", score.onSurface);

  assert.strictEqual(result.name, "fg/primary",
    "Scenario 2: unconventional naming — 'fg' segment identifies text role, no contrast fallback needed");
}

// Scenario 3
// A DS has the correctly named token AND a higher-contrast unnamed variable.
// Named token wins — we trust the segment score over raw contrast.
{
  const pick = createPicker([
    v("color/on-surface/default", 0.13, 0.13, 0.13), // seg score 4, contrast ~12:1
    v("color/neutral/950",        0.04, 0.04, 0.04), // seg score 0, contrast ~19:1
  ]);

  const result = pick("onSurface", score.onSurface);

  assert.strictEqual(result.name, "color/on-surface/default",
    "Scenario 3: segment-scored named token wins over a higher-contrast unnamed variable");
}

// Scenario 4
// Two variables both have positive segment scores for onSurface.
// The one with the higher total dot-product score wins.
// If scores are equal, the functional scorer (contrast) breaks the tie.
{
  const pick = createPicker([
    v("color/on-surface/default", 0.13, 0.13, 0.13), // FG:3 + DEFAULT:1 → onSurface: 10
    v("color/fg/strong",          0.04, 0.04, 0.04), // FG:2 + STRONG:1 → onSurface: 7
  ]);

  const result = pick("onSurface", score.onSurface);

  assert.strictEqual(result.name, "color/on-surface/default",
    "Scenario 4: higher segment score wins when multiple variables match the role");
}

// Scenario 5
// Two variables tie on dot-product score. The functional scorer breaks the tie.
{
  const pick = createPicker([
    v("color/foreground/default", 0.13, 0.13, 0.13), // FG:3 + DEFAULT:1 → onSurface: 10, contrast ~12
    v("color/on-surface/strong",  0.04, 0.04, 0.04), // FG:3 + STRONG:1 → onSurface: 10, contrast ~19
  ]);

  const result = pick("onSurface", score.onSurface);

  assert.strictEqual(result.name, "color/on-surface/strong",
    "Scenario 5: when segment scores tie, functional scorer (contrast) breaks the tie");
}

// Scenario 6
// "on-surface/default" has a negative score for surfaceDefault: "on-surface"
// contributes FG:3, and surfaceDefault penalises FG by -4, giving a net of -10.
// It should never be picked as a background token even though "surface" appears in the name.
{
  const pick = createPicker([
    v("color/on-surface/default", 0.1,  0.1,  0.1),   // FG:3 → surfaceDefault: -4*3 = -12 + DEFAULT:2 = -10
    v("color/surface/default",    0.98, 0.98, 0.98),  // BG:3 + DEFAULT:1 → surfaceDefault: 11
  ]);

  const result = pick("surfaceDefault", score.surfaceDefault);

  assert.strictEqual(result.name, "color/surface/default",
    "Scenario 6: 'on-surface' negative score prevents it from being mistaken for a background");
}

// Scenario 7
// "color/surface/brand" outscores "color/brand/500" for surfaceBrand because it
// accumulates both BG:3 (from "surface") and BRAND:2 (from "brand"). The role
// rewards BG by 2 and BRAND by 3, giving 6+6=12. "brand/500" has only BRAND:2
// giving 3*2=6.
{
  const pick = createPicker([
    v("color/brand/500",     0.2,  0.4,  0.9),   // BRAND:2 → surfaceBrand: 6
    v("color/surface/brand", 0.90, 0.94, 1.0),   // BG:3 + BRAND:2 → surfaceBrand: 12
  ]);

  const result = pick("surfaceBrand", score.surfaceBrand);

  assert.strictEqual(result.name, "color/surface/brand",
    "Scenario 7: semantic surface alias outscores a primitive ramp — all segments contribute");
}

// Scenario 8
// A DS uses "feedback/positive" for success — "positive" scores +2 for successBg.
// It should be found without needing contrast fallback.
{
  const pick = createPicker([
    v("feedback/positive", 0.09, 0.5, 0.24), // positive → successBg: +2
    v("color/brand/500",   0.2,  0.4, 0.9),  // no successBg score
  ]);

  const result = pick("successBg", s => s.sat, true);

  assert.strictEqual(result.name, "feedback/positive",
    "Scenario 8: alternative status naming ('positive') found via segment scoring");
}

// Scenario 9
// A DS names its tokens "surface/success", "on-surface/success", "outline/success".
// The two-layer scoring cleanly separates them across the three status sub-roles:
//   surface/success:    BG:3 + SUCCESS:3 → successBg: 15  (BG rewarded, FG/OUTLINE penalised)
//   on-surface/success: FG:3 + SUCCESS:3 → successText: 15 (FG rewarded, BG/OUTLINE penalised)
//   outline/success:    OUTLINE:3 + SUCCESS:3 → successBorder: 15 (OUTLINE rewarded, BG/FG penalised)
{
  const pick = createPicker([
    v("color/surface/success",    0.09, 0.5,  0.24),  // BG:3 + SUCCESS:3 → successBg: 15
    v("color/on-surface/success", 0.98, 0.98, 0.98),  // FG:3 + SUCCESS:3 → successText: 15
    v("color/outline/success",    0.06, 0.4,  0.18),  // OUTLINE:3 + SUCCESS:3 → successBorder: 15
  ]);

  const bgResult   = pick("successBg",     s => s.sat,                               true, ['BG',      'SUCCESS']);
  const textResult = pick("successText",   s => s.contrast >= 4.5 ? s.contrast : 0, true, ['FG',      'SUCCESS']);
  const bdResult   = pick("successBorder", s => s.sat,                               true, ['OUTLINE', 'SUCCESS']);

  assert.strictEqual(bgResult.name,   "color/surface/success",
    "Scenario 9a: success background found by surface+success segment combination");
  assert.strictEqual(textResult.name, "color/on-surface/success",
    "Scenario 9b: success text found by on-surface+success segment combination");
  assert.strictEqual(bdResult.name,   "color/outline/success",
    "Scenario 9c: success border found by outline+success segment combination");
}

// Scenario 10
// A DS has no color variables at all. Returns null without throwing.
{
  const pick = createPicker([]);
  const result = pick("onSurface", score.onSurface);
  assert.strictEqual(result, null,
    "Scenario 10: empty variable list returns null gracefully");
}

// Scenario 11
// A DS has entirely non-semantic naming (e.g. generated token names with no
// recognisable keywords). Functional fallback kicks in as last resort.
// The highest-luminance variable is picked for surfaceDefault.
{
  const pick = createPicker([
    v("t-001", 0.99, 0.99, 0.99), // near-white — should win as background
    v("t-002", 0.10, 0.10, 0.10), // near-black
    v("t-003", 0.20, 0.40, 0.90), // brand blue
  ]);

  const result = pick("surfaceDefault", score.surfaceDefault);

  assert.strictEqual(result.name, "t-001",
    "Scenario 11: functional fallback used when DS has no recognisable segment names");
}

// Scenario 13
// A DS has both "on-surface/brand-variant" (the correct token) and
// "on-surface/default" (the default text). The showcase uses "on-surface/brand-variant"
// as the foreground for the brand-variant row.
//
// With the two-layer system this works for ANY naming — no manual enumeration needed.
// "on-surface" contributes FG:3 to both; "brand-variant" adds BRAND:1 + BVAR:3.
// The onBrandVariant role rewards BRAND by 3 and BVAR by 2, so the extra categories
// on "brand-variant" tip the score decisively.
//
// Dot product for onBrandVariant {FG:3, BG:-4, BRAND:3, BVAR:2}:
//   on-surface/brand-variant → FG:3 + BRAND:1 + BVAR:3 → 9 + 3 + 6 = 18
//   on-surface/default       → FG:3 + DEFAULT:1        → 9 + 0     = 9
//   surface/brand-variant    → BG:3 + BRAND:1 + BVAR:3 → -12 + 3 + 6 = -3 (excluded)
{
  const pick = createPicker([
    v("color/on-surface/brand-variant", 0.27, 0.25, 0.62), // correct foreground
    v("color/on-surface/default",       0.06, 0.06, 0.07), // near-black default text
    v("color/surface/brand-variant",    0.96, 0.95, 0.99), // the background — must be excluded
  ]);

  const contrastBg = { r: 0.96, g: 0.95, b: 0.99 }; // brand-variant surface
  const result = pick(
    "onBrandVariant",
    s => { const c = _contrastRatio(s.rgb, contrastBg); return c >= 3 ? c : 0; }
  );

  assert.strictEqual(result.name, "color/on-surface/brand-variant",
    "Scenario 13: on-surface/brand-variant chosen over on-surface/default — brand-variant qualifier resolves the ambiguity");
}

// Scenario 12
// Status token with no matching segment at all — nameOnly=true returns null.
// The DS has success-like colors but names them in a way we don't recognise.
{
  const pick = createPicker([
    v("system/go",     0.09, 0.5, 0.24), // no successBg score
    v("color/brand/500", 0.2, 0.4, 0.9), // no successBg score
  ]);

  const result = pick("successBg", s => s.sat, true);

  assert.strictEqual(result, null,
    "Scenario 12: status token (nameOnly) returns null when no segment matches — never guesses");
}

// Scenario 14
// A DS has icon/warning and surface/warning but NO outline/warning.
// warningBorder requires OUTLINE category contribution (requiredCats=['OUTLINE']).
// Neither icon/warning (FG:1, WARNING:3) nor surface/warning (BG:3, WARNING:3)
// has any OUTLINE contribution, so both are filtered out → null.
// If the DS adds outline/warning, it would score 15 and be picked.
{
  const pick = createPicker([
    v("color/icon/warning",    0.75, 0.45, 0.02), // FG:1 + WARNING:3 — no OUTLINE
    v("color/surface/warning", 0.99, 0.94, 0.80), // BG:3 + WARNING:3 — no OUTLINE
  ]);

  const resultNoOutline = pick("warningBorder", s => s.sat, true, ['OUTLINE', 'WARNING']);
  assert.strictEqual(resultNoOutline, null,
    "Scenario 14a: warningBorder returns null when DS has no outline/warning variable");

  // Same DS with outline/warning added → it wins
  const pickWithOutline = createPicker([
    v("color/icon/warning",    0.75, 0.45, 0.02), // FG:1 + WARNING:3 — no OUTLINE
    v("color/surface/warning", 0.99, 0.94, 0.80), // BG:3 + WARNING:3 — no OUTLINE
    v("color/outline/brand",   0.15, 0.45, 0.95), // OUTLINE:3 + BRAND:2 — no WARNING
    v("color/outline/warning", 0.80, 0.55, 0.10), // OUTLINE:3 + WARNING:3 → both required ✓
  ]);

  const resultWithOutline = pickWithOutline("warningBorder", s => s.sat, true, ['OUTLINE', 'WARNING']);
  assert.strictEqual(resultWithOutline.name, "color/outline/warning",
    "Scenario 14b: warningBorder picks outline/warning, ignoring icon/warning and outline/brand");
}

// Scenario 15
// Purpose lock — BG requirement for status fill roles.
// A DS has on-surface/success (FG) and outline/success (OUTLINE) but NO surface/success (BG).
// successBg with requiredCats=['BG'] returns null — won't use a foreground or outline token as fill.
// Adding surface/success makes it pick the correct token.
{
  const pick = createPicker([
    v("color/on-surface/success", 0.04, 0.35, 0.18), // FG:3 + SUCCESS:3 — no BG
    v("color/outline/success",    0.10, 0.55, 0.28), // OUTLINE:3 + SUCCESS:3 — no BG
  ]);

  const resultNoBg = pick("successBg", s => s.sat, true, ['BG', 'SUCCESS']);
  assert.strictEqual(resultNoBg, null,
    "Scenario 15a: successBg returns null when DS has no surface/success — won't use fg or outline token as fill");

  const pickWithBg = createPicker([
    v("color/on-surface/success", 0.04, 0.35, 0.18), // FG:3 + SUCCESS:3 — no BG
    v("color/outline/success",    0.10, 0.55, 0.28), // OUTLINE:3 + SUCCESS:3 — no BG
    v("color/surface/success",    0.88, 0.97, 0.91), // BG:3 + SUCCESS:3 → both required ✓
  ]);

  const resultWithBg = pickWithBg("successBg", s => s.sat, true, ['BG', 'SUCCESS']);
  assert.strictEqual(resultWithBg.name, "color/surface/success",
    "Scenario 15b: successBg picks surface/success when it exists");
}

// Scenario 16
// Purpose lock — FG requirement for status text roles.
// A DS has surface/warning (BG) and outline/warning (OUTLINE) but NO on-surface/warning (FG).
// warningText with requiredCats=['FG'] returns null — won't use a background or outline token as text.
// Adding on-surface/warning or icon/warning (both have FG contribution) makes it pick correctly.
{
  const pick = createPicker([
    v("color/surface/warning", 0.99, 0.94, 0.80), // BG:3 + WARNING:3 — no FG
    v("color/outline/warning", 0.80, 0.55, 0.10), // OUTLINE:3 + WARNING:3 — no FG
  ]);

  const resultNoFg = pick("warningText", s => s.contrast >= 4.5 ? s.contrast : 0, true, ['FG', 'WARNING']);
  assert.strictEqual(resultNoFg, null,
    "Scenario 16a: warningText returns null when DS has no fg/text/on-surface warning variable");

  const pickWithFg = createPicker([
    v("color/surface/warning",    0.99, 0.94, 0.80), // BG:3 + WARNING:3 — no FG
    v("color/outline/warning",    0.80, 0.55, 0.10), // OUTLINE:3 + WARNING:3 — no FG
    v("color/on-surface/warning", 0.40, 0.22, 0.01), // FG:3 + WARNING:3 → both required ✓
  ]);

  const resultWithFg = pickWithFg("warningText", s => s.contrast >= 4.5 ? s.contrast : 0, true, ['FG', 'WARNING']);
  assert.strictEqual(resultWithFg.name, "color/on-surface/warning",
    "Scenario 16b: warningText picks on-surface/warning when it exists");
}

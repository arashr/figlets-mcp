/**
 * Coverage for the QA gap kinds added on top of the original
 * missing-foreground inspector: missing-bg, broken-alias, incomplete-modes,
 * contrast failures, and companion advisories. Uses literal RGB primitives so
 * contrast can be evaluated without a config.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  inspectDsSetupGapsFromFigmaData,
  handleInspectDsSetupGaps,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");

function prim(id, name, r, g, b) {
  return {
    id, name, resolvedType: "COLOR", variableCollectionId: "primColl",
    valuesByMode: { primMode: { r, g, b } },
  };
}
function sem(id, name, lightVal, darkVal) {
  const valuesByMode = {};
  if (lightVal !== undefined) valuesByMode.lightId = lightVal;
  if (darkVal !== undefined) valuesByMode.darkId = darkVal;
  return { id, name, resolvedType: "COLOR", variableCollectionId: "semColl", valuesByMode };
}
function alias(id) { return { type: "VARIABLE_ALIAS", id }; }

// ── Snapshot ────────────────────────────────────────────────────────────────
// Primitives:
const primitives = [
  prim("n0",   "color/neutral/0",    1.00, 1.00, 1.00),
  prim("n50",  "color/neutral/50",   0.98, 0.98, 0.98),
  prim("n300", "color/neutral/300",  0.78, 0.78, 0.78),  // failing fg on light bg
  prim("n950", "color/neutral/950",  0.05, 0.05, 0.05),
  prim("r700", "color/red/700",      0.55, 0.10, 0.10),
];

// Semantic tokens:
const semantics = [
  // Pair where fg fails contrast in Light: bg=neutral/50 (very light) vs fg=neutral/300 (also light).
  sem("contrastBg", "color/surface/danger", alias("n50"), alias("n950")),
  sem("contrastFg", "color/on-surface/danger", alias("n300"), alias("n0")),

  // Orphan fg: on-surface/info exists but no surface/info.
  sem("orphanFg", "color/on-surface/info", alias("n950"), alias("n50")),

  // Broken alias: dark mode points to a variable id that is not in the snapshot.
  sem("brokenSem", "color/surface/warning", alias("n50"), alias("ghost-id")),

  // Incomplete modes: Light has a value, Dark is undefined.
  sem("modeMiss", "color/surface/success", alias("n50"), undefined),

  // Complete pair with no border/icon: triggers companion advisory.
  sem("brandBg", "color/surface/brand-variant", alias("r700"), alias("n950")),
  sem("brandFg", "color/on-surface/brand-variant", alias("n0"), alias("r700")),
];

const figmaData = {
  variables: primitives.concat(semantics),
  collections: [
    { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
    { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: semantics.map(v => v.id) },
  ],
};

module.exports = (() => {
  const result = inspectDsSetupGapsFromFigmaData(figmaData);

  // ── Contrast failure: surface/danger Light pair fails WCAG ──
  const failures = result.contrastFailures.filter(f => f.bg === "color/surface/danger");
  assert.strictEqual(failures.length, 1, "exactly one mode should fail contrast for surface/danger");
  assert.strictEqual(failures[0].mode, "Light");
  assert.strictEqual(failures[0].algorithm, "wcag");
  assert.ok(failures[0].score < failures[0].threshold, "score should be below threshold for a failure");
  assert.strictEqual(failures[0].threshold, 4.5);
  // Resolved primitives must be captured for debugging
  assert.strictEqual(failures[0].bgPrimitive.name, "color/neutral/50");
  assert.strictEqual(failures[0].fgPrimitive.name, "color/neutral/300");
  assert.ok(failures[0].bgPrimitive.rgb && "r" in failures[0].bgPrimitive.rgb);
  // Near-miss flag is computed
  assert.strictEqual(typeof failures[0].nearMiss, "boolean");
  assert.strictEqual(typeof failures[0].gap, "number");

  // ── Broken alias: warning Dark points at ghost-id ──
  assert.strictEqual(result.brokenAliases.length, 1);
  assert.strictEqual(result.brokenAliases[0].holder, "color/surface/warning");
  assert.strictEqual(result.brokenAliases[0].mode, "Dark");
  assert.strictEqual(result.brokenAliases[0].missingTargetId, "ghost-id");

  // ── Incomplete modes: success has Light only ──
  const incomplete = result.incompleteModes.find(m => m.token === "color/surface/success");
  assert.ok(incomplete, "success token should be flagged as incomplete-modes");
  assert.deepStrictEqual(incomplete.missingModes, ["Dark"]);

  // ── Missing-bg for orphanFg ──
  const orphan = result.missingBackgrounds.find(m => m.fg === "color/on-surface/info");
  assert.ok(orphan, "on-surface/info should be reported as missing its surface");
  assert.strictEqual(orphan.expectedBg, "color/surface/info");

  // ── Companion advisory for brand-variant pair (no border/icon) ──
  const advisory = result.companionAdvisories.find(a => a.bg === "color/surface/brand-variant");
  assert.ok(advisory, "complete brand-variant pair without border/icon should advise");
  const roles = advisory.missing.map(m => m.role).sort();
  assert.deepStrictEqual(roles, ["border", "icon"]);

  // ── Summary aggregates ──
  // contrastFailureCount counts failures across ALL pairs, not just surface/danger.
  assert.ok(result.summary.contrastFailureCount >= failures.length);
  assert.strictEqual(result.summary.brokenAliasCount, 1);
  assert.strictEqual(result.summary.incompleteModeCount, 1);
  assert.ok(result.summary.missingBackgroundCount >= 1);
  assert.ok(result.summary.companionAdvisoryCount >= 1);
  assert.strictEqual(result.contrastAlgorithm, "wcag");

  // ── APCA option propagates and uses the APCA threshold ──
  const apcaResult = inspectDsSetupGapsFromFigmaData(figmaData, { algorithm: "apca" });
  assert.strictEqual(apcaResult.contrastAlgorithm, "apca");
  for (const f of apcaResult.contrastFailures) {
    assert.strictEqual(f.algorithm, "apca");
    assert.strictEqual(f.threshold, 75);
  }

  // ── Advisory suppression: when ≥3 complete pairs are all missing the same
  // role, the inspector reports it once via suppressedAdvisoryRoles instead of
  // emitting an advisory per pair.
  const pairs = [];
  for (const role of ["alpha", "beta", "gamma", "delta"]) {
    pairs.push({ id: `bg-${role}`, name: `color/surface/${role}`, resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n50" }, darkId: { type: "VARIABLE_ALIAS", id: "n950" } } });
    pairs.push({ id: `fg-${role}`, name: `color/on-surface/${role}`, resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n950" }, darkId: { type: "VARIABLE_ALIAS", id: "n50" } } });
  }
  const universalSnapshot = {
    variables: primitives.concat(pairs),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }], variableIds: pairs.map(v => v.id) },
    ],
  };
  const universal = inspectDsSetupGapsFromFigmaData(universalSnapshot);
  assert.strictEqual(universal.counts.completePairs, 4, "fixture should produce 4 complete pairs");
  const suppressedRoles = universal.suppressedAdvisoryRoles.map(s => s.role).sort();
  assert.deepStrictEqual(suppressedRoles, ["border", "icon"], "DS-wide absence should suppress both roles");
  assert.strictEqual(universal.companionAdvisories.length, 0, "no per-pair advisories survive when both roles are suppressed");

  // ── plannedReAlias: contrast failures should carry the picker's upgrade ──
  // The handler-level path is the one that attaches plannedReAlias, since the
  // picker requires the snapshot. Use a temp dir + FIGLETS_LOCAL_DIR isolation
  // mirroring the planned-aliases test.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-realias-"));
    const snapPath = path.join(tmp, "figma-data.json");
    fs.writeFileSync(snapPath, JSON.stringify(figmaData), "utf8");
    const prevLocal = process.env.FIGLETS_LOCAL_DIR;
    const prevFig = process.env.FIGLETS_FIGMA_DATA_PATH;
    process.env.FIGLETS_LOCAL_DIR = tmp;
    process.env.FIGLETS_FIGMA_DATA_PATH = snapPath;
    try {
      const handlerResult = handleInspectDsSetupGaps({ figmaDataPath: snapPath });
      assert.ok(!handlerResult.error, "handler should succeed");
      const dangerLight = handlerResult.contrastFailures.find(
        f => f.bg === "color/surface/danger" && f.mode === "Light"
      );
      assert.ok(dangerLight, "danger Light should be a contrast failure");
      assert.ok(dangerLight.plannedReAlias, "failing pair must carry a re-alias suggestion");
      assert.strictEqual(dangerLight.plannedReAlias.token, "color/on-surface/danger");
      assert.strictEqual(dangerLight.plannedReAlias.mode, "Light");
      assert.strictEqual(dangerLight.plannedReAlias.from, "color/neutral/300");
      // The picker walks the same ramp; with only n950 left as a darker step,
      // that's the upgrade target.
      assert.strictEqual(dangerLight.plannedReAlias.to, "color/neutral/950");
    } finally {
      if (prevLocal !== undefined) process.env.FIGLETS_LOCAL_DIR = prevLocal;
      else delete process.env.FIGLETS_LOCAL_DIR;
      if (prevFig !== undefined) process.env.FIGLETS_FIGMA_DATA_PATH = prevFig;
      else delete process.env.FIGLETS_FIGMA_DATA_PATH;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ── Threshold guard: with only 2 complete pairs, suppression must NOT fire
  const tinyPairs = [
    { id: "bg-x", name: "color/surface/x", resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n50" } } },
    { id: "fg-x", name: "color/on-surface/x", resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n950" } } },
    { id: "bg-y", name: "color/surface/y", resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n50" } } },
    { id: "fg-y", name: "color/on-surface/y", resolvedType: "COLOR", variableCollectionId: "semColl",
      valuesByMode: { lightId: { type: "VARIABLE_ALIAS", id: "n950" } } },
  ];
  const tinySnap = {
    variables: primitives.concat(tinyPairs),
    collections: [
      { id: "primColl", name: "Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
      { id: "semColl", name: "Color", modes: [{ modeId: "lightId", name: "Light" }], variableIds: tinyPairs.map(v => v.id) },
    ],
  };
  const tiny = inspectDsSetupGapsFromFigmaData(tinySnap);
  assert.strictEqual(tiny.counts.completePairs, 2);
  assert.strictEqual(tiny.suppressedAdvisoryRoles.length, 0, "below threshold (3 pairs) suppression should not trigger");
  assert.ok(tiny.companionAdvisories.length >= 2, "small files should still see per-pair advisories");
})();

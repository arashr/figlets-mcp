const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  inspectDsSetupGapsTool,
  handleInspectDsSetupGaps,
  inspectDsSetupGapsFromFigmaData,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");

function colorVar(id, name, valuesByMode = {}) {
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: "color-coll",
    valuesByMode,
  };
}

const figmaData = {
  variables: [
    colorVar("p-blue-800", "color/blue/800"),
    colorVar("p-blue-100", "color/blue/100"),
    colorVar("p-red-800", "color/red/800"),
    colorVar("p-red-100", "color/red/100"),
    colorVar("v-info-bg", "color/surface/info-variant"),
    colorVar("v-info-fg", "color/on-surface/info", {
      light: { type: "VARIABLE_ALIAS", id: "p-blue-800" },
      dark: { type: "VARIABLE_ALIAS", id: "p-blue-100" },
    }),
    colorVar("v-danger-bg", "color/surface/danger-variant"),
    colorVar("v-danger-fg", "color/on-surface/danger", {
      light: { type: "VARIABLE_ALIAS", id: "p-red-800" },
      dark: { type: "VARIABLE_ALIAS", id: "p-red-100" },
    }),
    colorVar("v-brand-bg", "color/surface/brand-variant"),
    colorVar("v-brand-fg", "color/on-surface/brand-variant"),
    colorVar("v-fill", "color/fill/info-variant"),
    colorVar("v-bg-subtle", "color/bg/accent-subtle"),
    colorVar("v-text-accent", "color/text/accent"),
  ],
  collections: [{
    id: "color-coll",
    name: "Color / Semantics",
    modes: [
      { modeId: "light", name: "Light" },
      { modeId: "dark", name: "Dark" },
    ],
  }],
};

module.exports = (() => {
  assert.strictEqual(inspectDsSetupGapsTool.name, "inspect_ds_setup_gaps");
  assert.ok(/QA/.test(inspectDsSetupGapsTool.description), "tool description should describe the QA contract");

  const result = inspectDsSetupGapsFromFigmaData(figmaData);

  // ── Missing-fg companions ────────────────────────────────────────────────
  assert.strictEqual(result.summary.semanticGapCount, 3);
  assert.strictEqual(result.summary.proposedCount, 3);
  assert.strictEqual(result.summary.unresolvedCount, 0);

  const byBg = Object.fromEntries(result.semanticGaps.map(gap => [gap.bg, gap]));

  assert.strictEqual(
    byBg["color/surface/info-variant"].recommended,
    "color/on-surface/info-variant",
    "surface variants should propose matching on-surface variants"
  );
  assert.strictEqual(
    byBg["color/surface/info-variant"].source,
    "color/on-surface/info",
    "variant foreground should copy aliases from the nearest base foreground"
  );
  assert.deepStrictEqual(
    byBg["color/surface/info-variant"].sourceAliases,
    { Light: "color/blue/800", Dark: "color/blue/100" },
    "report should expose copied alias targets for designer review"
  );

  assert.ok(!byBg["color/surface/brand-variant"], "existing companion should not be reported as a missing-fg");
  assert.ok(!byBg["color/fill/info-variant"], "fill variables stay outside missing-fg detection (intentional)");
  assert.strictEqual(
    byBg["color/bg/accent-subtle"].recommended,
    "color/text/accent-subtle",
    "role-based bg tokens should preserve text-family naming style"
  );
  assert.strictEqual(
    byBg["color/bg/accent-subtle"].source,
    "color/text/accent",
    "role-based subtle tokens should copy from the base text token"
  );

  // ── Missing-bg for orphan on-* foregrounds ───────────────────────────────
  // `color/on-surface/info` and `color/on-surface/danger` exist as fg-only —
  // there are no matching `color/surface/info` / `color/surface/danger`.
  assert.strictEqual(result.summary.missingBackgroundCount, 2);
  const missingBgFgs = result.missingBackgrounds.map(m => m.fg).sort();
  assert.deepStrictEqual(missingBgFgs, ["color/on-surface/danger", "color/on-surface/info"]);
  const infoMiss = result.missingBackgrounds.find(m => m.fg === "color/on-surface/info");
  assert.strictEqual(infoMiss.expectedBg, "color/surface/info");

  // ── Companion advisories ─────────────────────────────────────────────────
  // `color/surface/brand-variant` + `color/on-surface/brand-variant` exist as
  // a complete pair but no border/icon companions are present.
  assert.strictEqual(result.summary.companionAdvisoryCount, 1);
  assert.strictEqual(result.companionAdvisories[0].bg, "color/surface/brand-variant");
  assert.strictEqual(result.companionAdvisories[0].fg, "color/on-surface/brand-variant");
  const advisoryRoles = result.companionAdvisories[0].missing.map(m => m.role).sort();
  assert.deepStrictEqual(advisoryRoles, ["border", "icon"]);

  // ── No false positives for the categories not exercised by this fixture ──
  assert.strictEqual(result.summary.brokenAliasCount, 0, "all aliases resolve in this fixture");
  assert.strictEqual(result.summary.incompleteModeCount, 0, "vars with values cover both modes; empty vars are skipped");
  assert.strictEqual(result.summary.contrastFailureCount, 0, "primitives have no rgb in this fixture so contrast is not asserted");

  // Handler reads an explicit snapshot path
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-setup-gaps-"));
  const snapshotPath = path.join(tmpDir, "figma-data.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(figmaData, null, 2), "utf8");
  const prevLocalDir = process.env.FIGLETS_LOCAL_DIR;
  process.env.FIGLETS_LOCAL_DIR = tmpDir;
  try {
    const handled = handleInspectDsSetupGaps({ figmaDataPath: snapshotPath });
    assert.ok(!handled.error, "handler should read an explicit snapshot path");
    assert.strictEqual(handled.summary.semanticGapCount, 3);
    assert.strictEqual(handled.summary.missingBackgroundCount, 2);
    assert.strictEqual(handled.source.path, snapshotPath);
  } finally {
    if (prevLocalDir !== undefined) process.env.FIGLETS_LOCAL_DIR = prevLocalDir;
    else delete process.env.FIGLETS_LOCAL_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})();

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  inspectDsSetupGapsTool,
  handleInspectDsSetupGaps,
  inspectDsSetupGapsFromFigmaData,
  _buildRepairPlan,
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

  {
    const prim = (id, name) => ({
      id,
      name,
      resolvedType: "COLOR",
      variableCollectionId: "prim-coll",
      valuesByMode: { value: { r: 0, g: 0, b: 0 } },
    });
    const alias = id => ({ type: "VARIABLE_ALIAS", id });
    const outlineConventionData = {
      variables: [
        prim("blue-200", "color/blue/200"),
        prim("blue-600", "color/blue/600"),
        prim("blue-800", "color/blue/800"),
        prim("green-200", "color/green/200"),
        prim("green-600", "color/green/600"),
        prim("green-800", "color/green/800"),
        prim("yellow-200", "color/yellow/200"),
        prim("yellow-600", "color/yellow/600"),
        prim("yellow-800", "color/yellow/800"),
        colorVar("surface-info", "color/surface/info", { light: alias("blue-600"), dark: alias("blue-600") }),
        colorVar("on-info", "color/on-surface/info"),
        colorVar("icon-info", "color/icon/info"),
        colorVar("surface-success", "color/surface/success", { light: alias("green-600"), dark: alias("green-600") }),
        colorVar("on-success", "color/on-surface/success"),
        colorVar("icon-success", "color/icon/success"),
        colorVar("surface-warning", "color/surface/warning", { light: alias("yellow-600"), dark: alias("yellow-600") }),
        colorVar("on-warning", "color/on-surface/warning"),
        colorVar("icon-warning", "color/icon/warning"),
        colorVar("outline-default", "color/outline/default"),
        colorVar("outline-subtle", "color/outline/subtle"),
        colorVar("outline-strong", "color/outline/strong"),
      ],
      collections: [
        {
          id: "prim-coll",
          name: "Primitives",
          modes: [{ modeId: "value", name: "Value" }],
        },
        {
          id: "color-coll",
          name: "Color",
          modes: [{ modeId: "light", name: "Light" }, { modeId: "dark", name: "Dark" }],
        },
      ],
    };
    const outlineResult = inspectDsSetupGapsFromFigmaData(outlineConventionData);
    const infoBorder = outlineResult.missingSemanticRoles.find(gap =>
      gap.family === "info" && gap.missingRole === "border"
    );
    assert.ok(infoBorder, "info family should report a missing border role");
    assert.strictEqual(
      infoBorder.suggestedName,
      "color/outline/info",
      "missing border suggestions should preserve the file's outline naming convention"
    );
    assert.deepStrictEqual(
      infoBorder.plannedRoleRepair,
      {
        name: "color/outline/info",
        role: "border",
        aliases: { Light: "color/blue/200", Dark: "color/blue/800" },
        source: "color/surface/info",
        basis: "background-ramp",
        reason: "Border/outline role aliases are planned from the paired background ramp using the standard passive border steps.",
      },
      "missing outline roles should include deterministic aliases when the background ramp is resolvable"
    );
    const repairPlan = _buildRepairPlan(outlineResult);
    assert.deepStrictEqual(
      repairPlan.applyInput.roleRepairs.find(repair => repair.name === "color/outline/info"),
      { name: "color/outline/info", role: "border", aliases: { Light: "color/blue/200", Dark: "color/blue/800" } },
      "repairPlan should lift plannedRoleRepair into apply_ds_setup_repairs input"
    );
    assert.strictEqual(
      outlineResult.missingSemanticRoles[0].confidence,
      "high",
      "high-confidence role gaps must sort before medium advisories so capped reports show them"
    );
    assert.ok(
      outlineResult.topFindings.highConfidenceMissingRoles.some(gap => gap.suggestedName === "color/outline/info"),
      "topFindings should expose high-confidence missing neighboring outlines for agent summaries"
    );
  }

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
    assert.ok(handled.repairPlan, "handler should include an agent-ready repairPlan");
    assert.strictEqual(handled.repairPlan.tool, "apply_ds_setup_repairs");
    assert.ok(Object.prototype.hasOwnProperty.call(handled.repairPlan, "applyInput"));
  } finally {
    if (prevLocalDir !== undefined) process.env.FIGLETS_LOCAL_DIR = prevLocalDir;
    else delete process.env.FIGLETS_LOCAL_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})();

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
  // a complete pair but no border/icon companions are present. Icons are now
  // promoted to structured role gaps; passive borders remain advisory here.
  assert.strictEqual(result.summary.companionAdvisoryCount, 1);
  assert.strictEqual(result.companionAdvisories[0].bg, "color/surface/brand-variant");
  assert.strictEqual(result.companionAdvisories[0].fg, "color/on-surface/brand-variant");
  const advisoryRoles = result.companionAdvisories[0].missing.map(m => m.role).sort();
  assert.deepStrictEqual(advisoryRoles, ["border"]);
  assert.ok(
    result.missingSemanticRoles.some(gap => gap.family === "brand-variant" && gap.missingRole === "icon"),
    "missing icon roles should be semantic role gaps, not plain companion advisories"
  );

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
      valuesByMode: { value: ({
        "color/blue/200": { r: 0.76, g: 0.86, b: 1 },
        "color/blue/600": { r: 0.05, g: 0.24, b: 0.72 },
        "color/blue/800": { r: 0.02, g: 0.08, b: 0.28 },
        "color/green/200": { r: 0.74, g: 0.95, b: 0.76 },
        "color/green/600": { r: 0.08, g: 0.46, b: 0.18 },
        "color/green/800": { r: 0.02, g: 0.18, b: 0.06 },
        "color/yellow/200": { r: 1, g: 0.92, b: 0.36 },
        "color/yellow/600": { r: 0.52, g: 0.40, b: 0 },
        "color/yellow/800": { r: 0.18, g: 0.12, b: 0 },
      })[name] || { r: 0, g: 0, b: 0 } },
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
        colorVar("surface-info", "color/surface/info", { light: alias("blue-600"), dark: alias("blue-200") }),
        colorVar("on-info", "color/on-surface/info"),
        colorVar("icon-info", "color/icon/info"),
        colorVar("surface-success", "color/surface/success", { light: alias("green-600"), dark: alias("green-200") }),
        colorVar("on-success", "color/on-surface/success"),
        colorVar("icon-success", "color/icon/success"),
        colorVar("surface-warning", "color/surface/warning", { light: alias("yellow-600"), dark: alias("yellow-200") }),
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
      "missing outline roles should include deterministic passive aliases when the background ramp is resolvable"
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

  {
    const prim = (id, name, rgb) => ({
      id,
      name,
      resolvedType: "COLOR",
      variableCollectionId: "prim-coll",
      valuesByMode: { value: rgb },
    });
    const semantic = (id, name, valuesByMode = {}) => ({
      id,
      name,
      resolvedType: "COLOR",
      variableCollectionId: "sem-coll",
      valuesByMode,
    });
    const alias = id => ({ type: "VARIABLE_ALIAS", id });
    const inaccessibleRoleData = {
      variables: [
        prim("gray-500", "color/gray/500", { r: 0.45, g: 0.45, b: 0.45 }),
        prim("gray-600", "color/gray/600", { r: 0.40, g: 0.40, b: 0.40 }),
        semantic("bg-muted", "color/bg/muted", { light: alias("gray-500"), dark: alias("gray-500") }),
        semantic("text-muted", "color/text/muted"),
        semantic("border-default", "color/border/default"),
        semantic("border-subtle", "color/border/subtle"),
        semantic("border-strong", "color/border/strong"),
        semantic("icon-default", "color/icon/default"),
        semantic("icon-subtle", "color/icon/subtle"),
        semantic("icon-strong", "color/icon/strong"),
      ],
      collections: [
        { id: "prim-coll", name: "Primitives", modes: [{ modeId: "value", name: "Value" }] },
        { id: "sem-coll", name: "Color / Semantics", modes: [{ modeId: "light", name: "Light" }, { modeId: "dark", name: "Dark" }] },
      ],
    };
    const inaccessibleResult = inspectDsSetupGapsFromFigmaData(inaccessibleRoleData);
    const mutedIcon = inaccessibleResult.missingSemanticRoles.find(gap =>
      gap.family === "muted" && gap.missingRole === "icon"
    );
    const mutedBorder = inaccessibleResult.missingSemanticRoles.find(gap =>
      gap.family === "muted" && gap.missingRole === "border"
    );
    assert.ok(mutedBorder, "muted family should still report the border role gap");
    assert.ok(
      mutedBorder.plannedRoleRepair,
      "passive border suggestions should still be deterministic even when they are not contrast-gated"
    );
    assert.deepStrictEqual(
      mutedBorder.plannedRoleRepair.aliases,
      { Light: "color/gray/500", Dark: "color/gray/600" },
      "border repair should use standard passive ramp steps/nearest available steps, not a contrast search"
    );
    assert.strictEqual(
      mutedBorder.plannedRoleRepair.contrast,
      undefined,
      "border repairs should not carry contrast-gate metadata"
    );
    const inaccessiblePlan = _buildRepairPlan(inaccessibleResult);
    assert.deepStrictEqual(
      inaccessiblePlan.applyInput.roleRepairs.filter(repair => repair.name === "color/border/muted"),
      [],
      "advisory passive border repairs should not enter the default apply payload"
    );
    assert.deepStrictEqual(
      inaccessiblePlan.optionalApplyInput.roleRepairs.find(repair => repair.name === "color/border/muted"),
      { name: "color/border/muted", role: "border", aliases: { Light: "color/gray/500", Dark: "color/gray/600" } },
      "advisory passive border repairs should be exposed through the optional apply payload"
    );
    assert.ok(mutedIcon, "muted family should still report the icon role gap");
    assert.strictEqual(
      mutedIcon.plannedRoleRepair,
      undefined,
      "Figlets should not emit a deterministic icon repair suggestion when no accessible alias exists"
    );
    assert.ok(
      !_buildRepairPlan(inaccessibleResult).applyInput.roleRepairs.some(repair => repair.name === "color/icon/muted"),
      "inaccessible Figlets-generated icon suggestions must not reach the agent-ready apply payload"
    );
  }

  {
    const prim = (id, name) => ({
      id,
      name,
      resolvedType: "COLOR",
      variableCollectionId: "prim-coll",
      valuesByMode: { value: ({
        "color/purple/200": { r: 0.84, g: 0.76, b: 1 },
        "color/purple/600": { r: 0.34, g: 0.12, b: 0.72 },
        "color/purple/800": { r: 0.12, g: 0.04, b: 0.32 },
      })[name] || { r: 0, g: 0, b: 0 } },
    });
    const semantic = (id, name, valuesByMode = {}) => ({
      id,
      name,
      resolvedType: "COLOR",
      variableCollectionId: "sem-coll",
      valuesByMode,
    });
    const legacy = (id, name) => ({
      id,
      name,
      resolvedType: "COLOR",
      variableCollectionId: "legacy-coll",
      valuesByMode: { value: { r: 0, g: 0, b: 0 } },
    });
    const alias = id => ({ type: "VARIABLE_ALIAS", id });
    const borderConventionData = {
      variables: [
        prim("purple-200", "color/purple/200"),
        prim("purple-600", "color/purple/600"),
        prim("purple-800", "color/purple/800"),
        semantic("bg-brand-variant", "color/bg/brand-variant", { light: alias("purple-600"), dark: alias("purple-200") }),
        semantic("text-brand-variant", "color/text/brand-variant"),
        semantic("icon-brand-variant", "color/icon/brand-variant"),
        semantic("border-default", "color/border/default"),
        semantic("border-brand", "color/border/brand"),
        semantic("border-info", "color/border/info"),
        legacy("outline-default", "color/outline/default"),
        legacy("outline-subtle", "color/outline/subtle"),
        legacy("outline-strong", "color/outline/strong"),
        legacy("outline-focus", "color/outline/focus"),
      ],
      collections: [
        {
          id: "prim-coll",
          name: "Primitives",
          modes: [{ modeId: "value", name: "Value" }],
        },
        {
          id: "sem-coll",
          name: "Color / Semantics",
          modes: [{ modeId: "light", name: "Light" }, { modeId: "dark", name: "Dark" }],
        },
        {
          id: "legacy-coll",
          name: "Legacy Color Tokens",
          modes: [{ modeId: "value", name: "Value" }],
        },
      ],
    };
    const borderResult = inspectDsSetupGapsFromFigmaData(borderConventionData);
    const brandVariantBorder = borderResult.missingSemanticRoles.find(gap =>
      gap.family === "brand-variant" && gap.missingRole === "border"
    );
    assert.ok(brandVariantBorder, "brand-variant should report a missing border role");
    assert.strictEqual(
      brandVariantBorder.suggestedName,
      "color/border/brand-variant",
      "missing border suggestions should use the active semantic collection's border naming convention"
    );
    assert.strictEqual(
      brandVariantBorder.plannedRoleRepair.name,
      "color/border/brand-variant",
      "planned role repairs should use the same convention-preserving suggested name"
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

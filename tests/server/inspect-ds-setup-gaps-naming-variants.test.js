const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  handleInspectDsSetupGaps,
  inspectDsSetupGapsFromFigmaData,
  _buildRepairPlan,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");

function primitive(id, name) {
  const rgbByName = {
    "color/blue/200": { r: 0.76, g: 0.86, b: 1 },
    "color/blue/600": { r: 0.05, g: 0.24, b: 0.72 },
    "color/blue/800": { r: 0.02, g: 0.08, b: 0.28 },
    "color/brand/400": { r: 0.55, g: 0.70, b: 1 },
    "color/brand/500": { r: 0.00, g: 0.20, b: 0.80 },
    "color/purple/200": { r: 0.84, g: 0.76, b: 1 },
    "color/purple/600": { r: 0.34, g: 0.12, b: 0.72 },
    "color/purple/800": { r: 0.12, g: 0.04, b: 0.32 },
    "color/yellow/200": { r: 1, g: 0.92, b: 0.36 },
    "color/yellow/600": { r: 0.52, g: 0.40, b: 0 },
    "color/yellow/800": { r: 0.18, g: 0.12, b: 0 },
  };
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: "primitive-coll",
    valuesByMode: { value: rgbByName[name] || { r: 0.2, g: 0.2, b: 0.2 } },
  };
}

function semantic(id, name, lightAlias, darkAlias, collectionId) {
  const valuesByMode = {};
  if (lightAlias) valuesByMode.light = { type: "VARIABLE_ALIAS", id: lightAlias };
  if (darkAlias) valuesByMode.dark = { type: "VARIABLE_ALIAS", id: darkAlias };
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: collectionId || "semantic-coll",
    valuesByMode,
  };
}

function semanticCollection(id, name, variableIds) {
  return {
    id,
    name,
    modes: [
      { modeId: "light", name: "Light" },
      { modeId: "dark", name: "Dark" },
    ],
    variableIds,
  };
}

function primitiveCollection(variableIds) {
  return {
    id: "primitive-coll",
    name: "Primitives",
    modes: [{ modeId: "value", name: "Value" }],
    variableIds,
  };
}

function snapshotFor(semanticVars, extraVars, semanticName) {
  const primitives = [
    primitive("blue-200", "color/blue/200"),
    primitive("blue-600", "color/blue/600"),
    primitive("blue-800", "color/blue/800"),
    primitive("brand-400", "color/brand/400"),
    primitive("brand-500", "color/brand/500"),
    primitive("purple-200", "color/purple/200"),
    primitive("purple-600", "color/purple/600"),
    primitive("purple-800", "color/purple/800"),
    primitive("yellow-200", "color/yellow/200"),
    primitive("yellow-600", "color/yellow/600"),
    primitive("yellow-800", "color/yellow/800"),
  ];
  const extras = extraVars || [];
  return {
    fileKey: "external_fixture",
    fileName: "External DS Fixture",
    variables: primitives.concat(semanticVars, extras),
    collections: [
      primitiveCollection(primitives.map(v => v.id)),
      semanticCollection("semantic-coll", semanticName || "Color / Semantics", semanticVars.map(v => v.id)),
    ].concat(extras.length ? [{
      id: "legacy-coll",
      name: "Legacy Color Tokens",
      modes: [{ modeId: "value", name: "Value" }],
      variableIds: extras.map(v => v.id),
    }] : []),
  };
}

function missingBorder(result, family) {
  return result.missingSemanticRoles.find(gap => gap.family === family && gap.missingRole === "border");
}

module.exports = (() => {
  {
    const vars = [
      semantic("surface-info", "color/surface/info", "blue-600", "blue-200"),
      semantic("on-info", "color/on-surface/info"),
      semantic("icon-info", "color/icon/info"),
      semantic("outline-default", "color/outline/default"),
      semantic("outline-subtle", "color/outline/subtle"),
      semantic("outline-strong", "color/outline/strong"),
    ];
    const result = inspectDsSetupGapsFromFigmaData(snapshotFor(vars));
    const gap = missingBorder(result, "info");
    assert.ok(gap, "Material-style surface/on-surface/icon family should report missing outline");
    assert.strictEqual(gap.suggestedName, "color/outline/info");
    assert.deepStrictEqual(gap.plannedRoleRepair.aliases, {
      Light: "color/blue/200",
      Dark: "color/blue/800",
    });
  }

  {
    const vars = [
      semantic("surface-info", "color/surface/info", "blue-600", "blue-200"),
      semantic("on-info", "color/on-surface/info"),
      semantic("icon-info", "color/icon/info"),
      semantic("surface-brand", "color/surface/brand", "purple-600", "purple-200"),
      semantic("on-brand", "color/on-surface/brand"),
      semantic("icon-brand", "color/icon/brand"),
      semantic("surface-warning", "color/surface/warning", "yellow-600", "yellow-200"),
      semantic("on-warning", "color/on-surface/warning"),
      semantic("icon-warning", "color/icon/warning"),
    ];
    const result = inspectDsSetupGapsFromFigmaData(snapshotFor(vars), {
      existingDs: {
        color: {
          semantics: {
            unpaired: [
              { token: "color/outline/default" },
              { token: "color/outline/subtle" },
            ],
          },
        },
      },
    });
    assert.deepStrictEqual(
      result.suppressedAdvisoryRoles.map(role => role.role),
      ["border"],
      "universal passive absence should stay suppressed in the health check"
    );
    assert.strictEqual(
      result.missingSemanticRoles.some(gap => gap.missingRole === "border"),
      false,
      "optional DS-wide passive roles should not become default semantic role gaps"
    );
    const optionalPlan = _buildRepairPlan(result).optionalApplyInput.roleRepairs;
    assert.deepStrictEqual(
      optionalPlan.map(repair => repair.name).sort(),
      ["color/outline/brand", "color/outline/info", "color/outline/warning"],
      "optional DS-wide passive role payload should preserve outline naming from config"
    );
    assert.strictEqual(
      result.optionalSemanticRoleFindings.every(gap => gap.repairTier === "optional"),
      true,
      "display-only findings should be marked as optional"
    );
  }

  {
    const vars = [
      semantic("surface-default", "color/surface/default", "blue-200", "purple-800"),
      semantic("outline-default", "color/outline/default"),
      semantic("outline-subtle", "color/outline/subtle"),
      semantic("outline-strong", "color/outline/strong"),
    ];
    const result = inspectDsSetupGapsFromFigmaData(snapshotFor(vars));
    const finding = result.foundationRoleFindings.find(item => item.role === "focus-border");
    assert.ok(finding, "outline systems should flag missing focus border role");
    assert.ok(finding.plannedRoleRepair, "safe focus border role should get an apply-ready repair");
    assert.strictEqual(finding.plannedRoleRepair.name, "color/outline/focus");
    assert.strictEqual(finding.plannedRoleRepair.role, "focus-border");
    assert.deepStrictEqual(finding.plannedRoleRepair.aliases, {
      Light: "color/brand/500",
      Dark: "color/brand/400",
    });
    assert.ok(finding.plannedRoleRepair.contrast.Light.wcagRatio >= 3);
    assert.ok(finding.plannedRoleRepair.contrast.Dark.wcagRatio >= 3);
    assert.deepStrictEqual(
      _buildRepairPlan(result).applyInput.roleRepairs.find(repair => repair.name === "color/outline/focus"),
      {
        name: "color/outline/focus",
        role: "focus-border",
        aliases: { Light: "color/brand/500", Dark: "color/brand/400" },
      },
      "repair plan should lift safe focus border repairs into the default apply payload"
    );
  }

  {
    const vars = [
      semantic("surface-default", "color/surface/default", "blue-200", "purple-800"),
      semantic("stroke-default", "color/stroke/default"),
      semantic("stroke-subtle", "color/stroke/subtle"),
    ];
    const result = inspectDsSetupGapsFromFigmaData(snapshotFor(vars, [], "External Color Roles"));
    const finding = result.foundationRoleFindings.find(item => item.role === "focus-border");
    assert.ok(finding && finding.plannedRoleRepair, "stroke systems should get a safe focus repair when contrast can be verified");
    assert.strictEqual(
      finding.plannedRoleRepair.name,
      "color/stroke/focus",
      "focus border repair should preserve stroke naming convention"
    );
  }

  {
    const vars = [
      semantic("outline-default", "color/outline/default"),
      semantic("outline-strong", "color/outline/strong"),
    ];
    const result = inspectDsSetupGapsFromFigmaData(snapshotFor(vars));
    const finding = result.foundationRoleFindings.find(item => item.role === "focus-border");
    assert.ok(finding, "border systems without a focus role should still be reported");
    assert.strictEqual(
      finding.plannedRoleRepair,
      undefined,
      "focus border findings should not get apply payloads when no default background can be checked"
    );
    assert.strictEqual(
      _buildRepairPlan(result).applyInput.roleRepairs.some(repair => repair.role === "focus-border"),
      false,
      "unsafe/unverified focus findings should not reach the apply payload"
    );
  }

  {
    const vars = [
      semantic("outline-default", "color/outline/default"),
      semantic("outline-strong", "color/outline/strong"),
    ];
    const result = inspectDsSetupGapsFromFigmaData(snapshotFor(vars), {
      existingDs: {
        color: {
          semantics: {
            unpaired: [
              { token: "color/outline/focus", Light: "color/blue/600", Dark: "color/blue/200", note: "3:1 vs adjacent bg required" },
            ],
          },
        },
      },
    });
    const finding = result.foundationRoleFindings.find(item => item.role === "focus-border");
    assert.ok(finding && finding.plannedRoleRepair, "config-defined focus aliases should be usable without default background context");
    assert.deepStrictEqual(finding.plannedRoleRepair.aliases, {
      Light: "color/blue/600",
      Dark: "color/blue/200",
    });
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(finding.plannedRoleRepair.aliases, "note"),
      false,
      "config notes should not leak into approved alias payloads"
    );
    assert.strictEqual(finding.plannedRoleRepair.basis, "config-focus-role");
  }

  {
    const vars = [
      semantic("bg-brand-variant", "color/bg/brand-variant", "purple-600", "purple-200"),
      semantic("text-brand-variant", "color/text/brand-variant"),
      semantic("icon-brand-variant", "color/icon/brand-variant"),
      semantic("border-default", "color/border/default"),
      semantic("border-brand", "color/border/brand"),
      semantic("border-info", "color/border/info"),
    ];
    const legacyOutlines = [
      semantic("outline-default", "color/outline/default", null, null, "legacy-coll"),
      semantic("outline-subtle", "color/outline/subtle", null, null, "legacy-coll"),
      semantic("outline-strong", "color/outline/strong", null, null, "legacy-coll"),
      semantic("outline-focus", "color/outline/focus", null, null, "legacy-coll"),
    ];
    const result = inspectDsSetupGapsFromFigmaData(snapshotFor(vars, legacyOutlines, "Imported Semantic Colors"));
    const gap = missingBorder(result, "brand-variant");
    assert.ok(gap, "Role-style imported DS should report the missing border role");
    assert.strictEqual(
      gap.suggestedName,
      "color/border/brand-variant",
      "semantic collection border convention must beat unrelated legacy outline tokens"
    );
    assert.strictEqual(gap.plannedRoleRepair.name, "color/border/brand-variant");
  }

  {
    const vars = [
      semantic("background-warning", "color/background/warning", "yellow-600", "yellow-200"),
      semantic("foreground-warning", "color/foreground/warning"),
      semantic("icon-warning", "color/icon/warning"),
      semantic("stroke-default", "color/stroke/default"),
      semantic("stroke-info", "color/stroke/info"),
      semantic("stroke-success", "color/stroke/success"),
    ];
    const result = inspectDsSetupGapsFromFigmaData(snapshotFor(vars, [], "External Color Roles"));
    const gap = missingBorder(result, "warning");
    assert.ok(gap, "background/foreground/stroke naming should be understood without Figlets setup");
    assert.strictEqual(gap.suggestedName, "color/stroke/warning");
    assert.strictEqual(gap.plannedRoleRepair.name, "color/stroke/warning");
  }

  {
    const vars = [
      semantic("bg-brand-variant", "color/bg/brand-variant", "purple-600", "purple-200"),
      semantic("text-brand-variant", "color/text/brand-variant"),
      semantic("icon-brand-variant", "color/icon/brand-variant"),
      semantic("border-default", "color/border/default"),
      semantic("border-brand", "color/border/brand"),
      semantic("border-info", "color/border/info"),
    ];
    const data = snapshotFor(vars, [], "Imported Semantic Colors");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-naming-variants-"));
    const snapPath = path.join(tmp, "figma-data.json");
    fs.writeFileSync(snapPath, JSON.stringify(data, null, 2), "utf8");
    try {
      const handled = handleInspectDsSetupGaps({
        figmaDataPath: snapPath,
        config_path: path.join(tmp, "missing-design-system.config.js"),
      });
      assert.ok(!handled.error, "handler should support imported snapshots without a Figlets-authored config");
      assert.deepStrictEqual(Object.keys(handled).slice(0, 4), ["message", "summary", "repairPlan", "topFindings"]);
      assert.ok(
        handled.message.includes("semantic-family role gap") &&
          handled.message.includes("Read-only QA pass"),
        "handler message should be plain-language and safe to show to a designer"
      );
      assert.ok(
        handled.repairPlan.designerSummary.includes("structured repair suggestion"),
        "repair plan should include a human-readable designer summary"
      );
      assert.ok(
        handled.repairPlan.agentInstruction.includes("pass repairPlan.applyInput"),
        "repair plan should tell agents how to apply approved repairs without ad hoc parsing"
      );
      assert.deepStrictEqual(
        handled.repairPlan.applyInput.roleRepairs.find(repair => repair.name === "color/border/brand-variant"),
        {
          name: "color/border/brand-variant",
          role: "border",
          aliases: { Light: "color/purple/200", Dark: "color/purple/800" },
        },
        "agent-ready apply payload should preserve the imported DS border convention"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
})();

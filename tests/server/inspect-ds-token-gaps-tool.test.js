const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  inspectDsTokenGapsTool,
  handleInspectDsTokenGaps,
  inspectDsTokenGapsFromConfigAndFigmaData,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");

function variable(id, name, type) {
  return {
    id,
    name,
    resolvedType: type || "FLOAT",
    valuesByMode: { m1: 1 },
  };
}

const DS = {
  collections: {
    primitives: "1. Primitives",
    typography: "3. Typography",
    spacing: "4. Spacing",
    elevation: "5. Elevation",
  },
  naming: { textStyle: "type/{role}/{size}", typePrefix: "type", fontFamily: "font/{variant}" },
  primitives: { spacing: [[0, 0], [4, 16]] },
  typography: {
    families: { sans: "Inter", mono: "JetBrains Mono" },
    scale: {
      "body/md": { sizes: [14, 14, 16], lineHeights: [20, 20, 24], weight: 400, tracking: 0 },
    },
  },
  spacing: {
    semantic: {
      "component/md": [12, 16, 16],
      "layout/lg": [48, 64, 96],
    },
    radius: { md: 8, lg: 12 },
    border: { default: 1, thick: 4 },
  },
};

const figmaData = {
  variables: [
    variable("space-component-md", "space/component/md"),
    variable("space-radius-md", "space/radius/md"),
    variable("type-body-md-size", "type/body/md/size"),
    variable("type-body-md-weight", "type/body/md/weight"),
    variable("elevation-xs-offset", "elevation/xs/offset-y"),
  ],
  textStyles: [{ name: "type/body/md" }],
  effectStyles: [{ name: "elevation/0" }],
};

module.exports = (() => {
  assert.strictEqual(inspectDsTokenGapsTool.name, "inspect_ds_token_gaps");
  assert.ok(inspectDsTokenGapsTool.description.includes("Read-only planner"));
  assert.ok(inspectDsTokenGapsTool.inputSchema.properties.categories, "schema should accept categories");
  assert.ok(inspectDsTokenGapsTool.inputSchema.properties.include_existing_updates, "schema should accept include_existing_updates");

  const result = inspectDsTokenGapsFromConfigAndFigmaData(DS, figmaData, {
    configPath: "/tmp/design-system.config.js",
    categories: ["spacing-semantics", "radius", "border-width", "typography", "elevation", "made-up"],
    include_existing_updates: true,
  });

  assert.deepStrictEqual(
    Object.keys(result).slice(0, 4),
    ["message", "summary", "repairPlan", "topFindings"],
    "agent-actionable output should be first"
  );
  assert.strictEqual(result.summary.unsupportedCategoryCount, 1);
  assert.ok(
    result.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-category" && note.category === "made-up"),
    "unsupported categories should be explicit missing-capability notes"
  );
  assert.ok(
    result.repairPlan.missingCapabilityNotes.some(note => note.kind === "existing-update-diffing"),
    "include_existing_updates should be acknowledged as future diffing scope"
  );
  assert.ok(
    result.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "typography"),
    "dry-run-only categories should be explicit product gaps for apply"
  );
  assert.ok(
    result.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "elevation"),
    "elevation should remain a dry-run/product-gap apply category"
  );
  assert.ok(
    !result.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "spacing-semantics"),
    "spacing-semantics is now apply-supported and must not be flagged as an apply product gap"
  );
  assert.deepStrictEqual(
    result.repairPlan.previewInput,
    {
      config_path: "/tmp/design-system.config.js",
      categories: ["border-width", "elevation", "radius", "spacing-semantics", "typography"],
      create_missing: true,
      include_existing_updates: true,
      dry_run: true,
    },
    "previewInput should be an update_ds_tokens dry-run payload"
  );
  assert.deepStrictEqual(
    result.repairPlan.applyInput.categories,
    ["border-width", "elevation-variables", "radius", "spacing-semantics", "typography-variables"],
    "applyInput should include only Phase 3C apply-supported categories, with typography/elevation narrowed to variables"
  );
  assert.strictEqual(result.repairPlan.applyInput.dry_run, false);
  assert.deepStrictEqual(result.repairPlan.optionalApplyInput.categories, []);

  const gapNames = result.tokenGaps.map(gap => gap.name).sort();
  assert.ok(gapNames.indexOf("space/layout/lg") >= 0, "missing semantic spacing should be reported from config");
  assert.ok(gapNames.indexOf("space/radius/lg") >= 0, "missing radius token should be reported from config");
  assert.ok(gapNames.indexOf("space/border/default") >= 0, "missing border-width token should be reported from config");
  assert.ok(gapNames.indexOf("type/body/md/line-height") >= 0, "missing typography line-height var should be reported from config");
  assert.ok(gapNames.indexOf("type/body/md/tracking") >= 0, "missing typography tracking var should be reported from config");
  assert.ok(gapNames.indexOf("elevation/sm/radius") >= 0, "missing elevation variable should be reported from config");
  assert.ok(gapNames.indexOf("elevation/1") >= 0, "missing elevation effect style should be reported from config");
  assert.ok(gapNames.indexOf("space/component/md") === -1, "existing variables should not be reported as missing");
  assert.ok(gapNames.indexOf("type/body/md") === -1, "existing text styles should not be reported as missing");

  {
    const elevationVariables = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [{ name: "5. Elevation" }],
      variables: [
        variable("elevation-xs-offset", "elevation/xs/offset-y"),
      ],
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["elevation-variables"],
    });
    assert.strictEqual(elevationVariables.summary.missingStyleCount, 0);
    assert.ok(
      elevationVariables.tokenGaps.some(gap => gap.category === "elevation-variables" && gap.name === "elevation/xs/radius"),
      "elevation-variables should report only elevation variable gaps"
    );
    assert.deepStrictEqual(
      elevationVariables.repairPlan.applyInput.categories,
      ["elevation-variables"],
      "elevation-variables should be an apply-supported narrow category"
    );
  }

  {
    const cleanSetup = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [{ name: "4. Spacing" }],
      variables: [
        variable("space-radius-md", "space/radius/md"),
        variable("space-radius-lg", "space/radius/lg"),
        variable("space-border-default", "space/border/default"),
        variable("space-border-thick", "space/border/thick"),
      ],
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["radius", "border-width"],
    });
    assert.strictEqual(cleanSetup.summary.missingVariableCount, 0);
    assert.deepStrictEqual(cleanSetup.repairPlan.applyInput.categories, []);
    assert.ok(
      !cleanSetup.repairPlan.missingCapabilityNotes.some(note => note.kind === "missing-foundation-collection"),
      "clean setup should not report missing foundation collections"
    );
  }

  {
    const missingFoundation = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [{ name: "1. Primitives" }],
      variables: [],
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["radius", "border-width", "totally-future"],
    });
    assert.ok(
      missingFoundation.repairPlan.missingCapabilityNotes.some(note =>
        note.kind === "missing-foundation-collection" &&
        note.category === "radius" &&
        note.collection === "4. Spacing" &&
        note.productGap === true
      ),
      "missing Spacing collection should be reported as future guided setup scope"
    );
    assert.deepStrictEqual(
      missingFoundation.repairPlan.previewInput.categories,
      ["border-width", "radius"],
      "missing foundation should still allow a dry-run preview"
    );
    assert.deepStrictEqual(
      missingFoundation.repairPlan.applyInput.categories,
      [],
      "missing foundation should not produce ready apply categories until partial setup repair exists"
    );
    assert.ok(
      missingFoundation.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-category" && note.category === "totally-future"),
      "mixed unsupported categories should still be surfaced explicitly"
    );
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-token-gaps-"));
  const configPath = path.join(tmp, "design-system.config.js");
  const figmaDataPath = path.join(tmp, "figma-data.json");
  fs.writeFileSync(configPath, "const DS = " + JSON.stringify(DS, null, 2) + ";\n", "utf8");
  fs.writeFileSync(figmaDataPath, JSON.stringify(figmaData, null, 2), "utf8");

  try {
    const handled = handleInspectDsTokenGaps({
      config_path: configPath,
      figmaDataPath,
      categories: ["spacing-semantics"],
    });
    assert.ok(!handled.error, handled.error);
    assert.deepStrictEqual(Object.keys(handled).slice(0, 4), ["message", "summary", "repairPlan", "topFindings"]);
    assert.strictEqual(handled.config.path, configPath);
    assert.strictEqual(handled.snapshot.path, figmaDataPath);
    assert.deepStrictEqual(handled.repairPlan.previewInput.categories, ["spacing-semantics"]);
    assert.ok(handled.tokenGaps.some(gap => gap.name === "space/layout/lg"));
  } finally {
    try { fs.unlinkSync(configPath); } catch (err) {}
    try { fs.unlinkSync(figmaDataPath); } catch (err) {}
    try { fs.rmdirSync(tmp); } catch (err) {}
  }
})();

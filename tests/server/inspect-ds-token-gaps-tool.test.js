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

function elevationVariables() {
  return [
    variable("elevation-xs-offset", "elevation/xs/offset-y"),
    variable("elevation-xs-radius", "elevation/xs/radius"),
    variable("elevation-sm-offset", "elevation/sm/offset-y"),
    variable("elevation-sm-radius", "elevation/sm/radius"),
    variable("elevation-md-offset", "elevation/md/offset-y"),
    variable("elevation-md-radius", "elevation/md/radius"),
    variable("elevation-lg-offset", "elevation/lg/offset-y"),
    variable("elevation-lg-radius", "elevation/lg/radius"),
    variable("elevation-xl-offset", "elevation/xl/offset-y"),
    variable("elevation-xl-radius", "elevation/xl/radius"),
  ];
}

function typographyVariables() {
  return [
    variable("type-body-md-size", "type/body/md/size"),
    variable("type-body-md-line-height", "type/body/md/line-height"),
    variable("type-body-md-weight", "type/body/md/weight"),
    variable("type-body-md-tracking", "type/body/md/tracking"),
    variable("type-body-md-family", "type/body/md/family", "STRING"),
  ];
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
    const elevationStyles = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [{ name: "5. Elevation" }],
      variables: elevationVariables(),
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["elevation"],
    });
    assert.strictEqual(elevationStyles.summary.missingVariableCount, 0);
    assert.strictEqual(elevationStyles.summary.missingStyleCount, 6);
    assert.ok(
      elevationStyles.tokenGaps.some(gap => gap.category === "elevation" && gap.name === "elevation/5"),
      "broad elevation should still report missing effect-style gaps"
    );
    assert.deepStrictEqual(
      elevationStyles.repairPlan.applyInput.categories,
      ["elevation-styles"],
      "planner should narrow broad elevation style-only gaps to the approved elevation-styles apply slice"
    );
    assert.ok(
      elevationStyles.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "elevation"),
      "broad elevation should remain a product-gap category even when a narrow style slice is available"
    );
  }

  {
    const directElevationStyles = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [{ name: "5. Elevation" }],
      variables: elevationVariables(),
      textStyles: [],
      effectStyles: [{ name: "elevation/0" }],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["elevation-styles"],
    });
    assert.strictEqual(directElevationStyles.summary.missingVariableCount, 0);
    assert.strictEqual(directElevationStyles.summary.missingStyleCount, 5);
    assert.deepStrictEqual(
      directElevationStyles.repairPlan.applyInput.categories,
      ["elevation-styles"],
      "elevation-styles should be directly apply-supported without enabling broad elevation"
    );
    assert.ok(
      !directElevationStyles.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "elevation-styles"),
      "direct elevation-styles requests should not be flagged as unsupported apply scope"
    );
  }

  {
    const typographyStyles = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [{ name: "3. Typography" }],
      variables: typographyVariables(),
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["typography"],
    });
    assert.strictEqual(typographyStyles.summary.missingVariableCount, 0);
    assert.strictEqual(typographyStyles.summary.missingStyleCount, 1);
    assert.ok(
      typographyStyles.tokenGaps.some(gap => gap.category === "typography" && gap.name === "type/body/md"),
      "broad typography should still report missing text-style gaps"
    );
    assert.deepStrictEqual(
      typographyStyles.repairPlan.applyInput.categories,
      ["typography-styles"],
      "planner should narrow broad typography style-only gaps to the approved typography-styles apply slice"
    );
    assert.ok(
      typographyStyles.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "typography"),
      "broad typography should remain a product-gap category even when a narrow style slice is available"
    );
  }

  {
    const directTypographyStyles = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [{ name: "3. Typography" }],
      variables: typographyVariables(),
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["typography-styles"],
    });
    assert.strictEqual(directTypographyStyles.summary.missingVariableCount, 0);
    assert.strictEqual(directTypographyStyles.summary.missingStyleCount, 1);
    assert.deepStrictEqual(
      directTypographyStyles.repairPlan.applyInput.categories,
      ["typography-styles"],
      "typography-styles should be directly apply-supported without enabling broad typography"
    );
    assert.ok(
      !directTypographyStyles.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "typography-styles"),
      "direct typography-styles requests should not be flagged as unsupported apply scope"
    );
  }

  {
    const existingStyleRefreshes = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [{ name: "3. Typography" }, { name: "5. Elevation" }],
      variables: typographyVariables().concat(elevationVariables()),
      textStyles: [{ name: "type/body/md" }],
      effectStyles: [
        { name: "elevation/0" },
        { name: "elevation/1" },
        { name: "elevation/2" },
        { name: "elevation/3" },
        { name: "elevation/4" },
        { name: "elevation/5" },
      ],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["typography-styles", "elevation-styles"],
      include_existing_style_refreshes: true,
    });
    assert.strictEqual(existingStyleRefreshes.summary.missingStyleCount, 0);
    assert.deepStrictEqual(existingStyleRefreshes.tokenGaps, []);
    assert.deepStrictEqual(
      existingStyleRefreshes.existingUpdates.map(item => item.name),
      ["type/body/md", "elevation/0", "elevation/1", "elevation/2", "elevation/3", "elevation/4", "elevation/5"],
      "planner should expose existing config-derived style refresh candidates when requested"
    );
    assert.ok(
      existingStyleRefreshes.existingUpdates.every(item => item.gapType === "existing-style-refresh"),
      "style refresh candidates should be a narrow existing update signal"
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
        note.repairTool === "apply_ds_foundation_repairs" &&
        note.repairReady === true &&
        note.productGap === false
      ),
      "missing Spacing collection should be reported as guided foundation repair scope"
    );
    assert.deepStrictEqual(
      missingFoundation.repairPlan.foundationRepairPlan.applyInput.collections,
      [{ kind: "spacing", name: "4. Spacing", modes: ["Mobile", "Tablet", "Desktop"] }],
      "missing foundation should expose an approval-ready partial setup repair payload"
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

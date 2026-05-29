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
    Object.keys(result).slice(0, 5),
    ["message", "approvalBoundary", "summary", "repairPlan", "topFindings"],
    "agent-actionable output should be first"
  );
  assert.ok(result.approvalBoundary && result.approvalBoundary.readOnlyUntilApproval === true);
  assert.ok(result.message.includes("Do not call apply_ds_foundation_repairs"));
  assert.ok(result.message.includes("not approval to write"));
  assert.ok(result.repairPlan.agentInstruction.includes("STOP before any Figma write"));
  assert.ok(
    result.repairPlan.designerPresentation.sections.some(section => section.title === "Approval required before writes"),
    "designerPresentation should lead with approval boundary"
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
    !result.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "typography"),
    "broad typography should be orchestration-capable instead of an apply product gap"
  );
  assert.ok(
    !result.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "elevation"),
    "broad elevation with both variable and style gaps should be orchestration-capable"
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
    ["border-width", "elevation", "radius", "spacing-semantics", "typography-variables"],
    "applyInput should use broad elevation orchestration when both variable and style gaps exist, and narrow typography when only variables are missing"
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
    const spacingAliasPlan = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [
        {
          id: "primitives",
          name: "1. Primitives",
          variableIds: ["space-12", "space-16", "space-24", "space-32"],
          modes: [{ modeId: "default", name: "Default" }],
        },
        {
          id: "spacing",
          name: "4. Spacing",
          variableIds: ["layout-lg", "touch-comfortable"],
          modes: [
            { modeId: "mobile", name: "Mobile" },
            { modeId: "tablet", name: "Tablet" },
            { modeId: "desktop", name: "Desktop" },
          ],
        },
      ],
      variables: [
        {
          id: "space-12",
          name: "space/12",
          resolvedType: "FLOAT",
          valuesByMode: { default: 12 },
        },
        {
          id: "space-16",
          name: "space/16",
          resolvedType: "FLOAT",
          valuesByMode: { default: 16 },
        },
        {
          id: "space-24",
          name: "space/24",
          resolvedType: "FLOAT",
          valuesByMode: { default: 24 },
        },
        {
          id: "space-32",
          name: "space/32",
          resolvedType: "FLOAT",
          valuesByMode: { default: 32 },
        },
        {
          id: "component-md",
          name: "space/component/md",
          resolvedType: "FLOAT",
          valuesByMode: { mobile: 12, tablet: 16, desktop: 16 },
        },
        {
          id: "layout-lg",
          name: "space/layout/lg",
          resolvedType: "FLOAT",
          valuesByMode: {
            mobile: { type: "VARIABLE_ALIAS", id: "space-16" },
            tablet: 24,
            desktop: 32,
          },
        },
      ],
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["spacing-semantics"],
    });

    assert.deepStrictEqual(
      spacingAliasPlan.repairPlan.applyInput.categories,
      ["spacing-semantics"],
      "raw semantic spacing values with matching primitives should produce an apply-ready spacing-semantics plan"
    );
    const spacingAliasRepairs = spacingAliasPlan.tokenGaps.filter(gap => gap.gapType === "spacing-alias-repair");
    assert.ok(
      spacingAliasRepairs.some(gap => gap.name === "space/component/md"),
      "planner should include spacing alias repair gaps for raw semantic spacing variables"
    );
    const componentMd = spacingAliasRepairs.find(gap => gap.name === "space/component/md");
    assert.ok(
      componentMd.updates.some(update => update.modeName === "Mobile" && update.toAliasName === "space/12"),
      "planner should expose exact mode-level alias target for approval"
    );
    assert.ok(
      spacingAliasPlan.repairPlan.designerPresentation.proposedChanges.some(change =>
        change.token === "space/component/md"
        && change.mode === "Mobile"
        && change.toAlias === "space/12"
      ),
      "designer presentation should include exact token/mode alias mapping"
    );
  }

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
      !elevationStyles.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "elevation"),
      "broad elevation should narrow to elevation-styles without an apply product gap"
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
      !typographyStyles.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "typography"),
      "broad typography should narrow to typography-styles without an apply product gap"
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
    const primDs = Object.assign({}, DS, {
      color: {
        ramps: [{ folder: "color/neutral", steps: [[500, 0.5, 0.5, 0.5]] }],
      },
      typography: {
        families: { sans: "Inter", mono: "JetBrains Mono" },
        scale: {
          "display/lg": { sizes: [57, 57, 57], lineHeights: [64, 64, 64], weight: 400, tracking: -0.02 },
        },
      },
    });
    const primitiveTypography = inspectDsTokenGapsFromConfigAndFigmaData(primDs, {
      collections: [{ name: "1. Primitives" }],
      variables: [variable("type-size-md", "type/size/md")],
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["primitive-typography"],
    });
    assert.ok(
      primitiveTypography.tokenGaps.some(gap => gap.name === "type/size/57"),
      "planner should detect missing numeric primitive size from typography scale"
    );
    assert.strictEqual(primitiveTypography.repairPlan.primitiveRepairPlan.tool, "update_ds_primitives");
    assert.deepStrictEqual(
      primitiveTypography.repairPlan.primitiveRepairPlan.applyInput.categories,
      ["primitive-typography"]
    );
    assert.ok(
      !primitiveTypography.repairPlan.missingCapabilityNotes.some(note =>
        note.kind === "unsupported-apply-category" && note.category === "primitive-typography"
      ),
      "primitive-typography should route to update_ds_primitives instead of a token apply product gap"
    );
  }

  {
    const shadowDs = Object.assign({}, DS, {
      color: {
        ramps: [{ folder: "color/neutral", steps: [[500, 0.5, 0.5, 0.5]] }],
      },
    });
    const primitiveShadow = inspectDsTokenGapsFromConfigAndFigmaData(shadowDs, {
      collections: [{ name: "1. Primitives" }],
      variables: [variable("shadow-1-offset", "shadow/1/offset-y")],
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["primitive-shadow"],
    });
    assert.ok(
      primitiveShadow.tokenGaps.some(gap => gap.name === "shadow/5/radius"),
      "planner should detect missing shadow primitive variables"
    );
    assert.strictEqual(primitiveShadow.repairPlan.primitiveRepairPlan.tool, "update_ds_primitives");
    assert.deepStrictEqual(
      primitiveShadow.repairPlan.primitiveRepairPlan.applyInput.categories,
      ["primitive-shadow"]
    );
    assert.ok(
      !primitiveShadow.repairPlan.missingCapabilityNotes.some(note =>
        note.kind === "unsupported-apply-category" && note.category === "primitive-shadow"
      )
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

  {
    const missingModes = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [
        {
          name: "4. Spacing",
          modes: [{ name: "Value" }],
          variableIds: ["space-component-md"],
        },
        {
          name: "3. Typography",
          modes: [{ name: "Mobile" }, { name: "Tablet" }],
          variableIds: typographyVariables().map(item => item.id),
        },
      ],
      variables: [
        variable("space-component-md", "space/component/md"),
      ].concat(typographyVariables()),
      textStyles: [{ name: "type/body/md" }],
      effectStyles: [{ name: "elevation/0" }],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["spacing-semantics", "typography"],
    });
    assert.ok(
      missingModes.repairPlan.missingCapabilityNotes.some(note =>
        note.kind === "missing-foundation-modes" &&
        note.category === "spacing-semantics" &&
        note.collection === "4. Spacing" &&
        note.missingModes &&
        note.missingModes.indexOf("Tablet") >= 0
      ),
      "missing breakpoint modes on an existing Spacing collection should be reported"
    );
    assert.strictEqual(missingModes.repairPlan.applyInput.ensure_collection_modes, true);
    assert.ok(
      !missingModes.repairPlan.applyInput.categories.includes("spacing-semantics"),
      "responsive spacing apply should stay blocked until modes exist or ensure_collection_modes runs"
    );
    assert.ok(
      missingModes.repairPlan.foundationRepairPlan.applyInput.collections.some(item => item.kind === "spacing"),
      "missing modes should still route through foundation repair on the existing collection"
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
    assert.deepStrictEqual(
      Object.keys(handled).slice(0, 5),
      ["message", "approvalBoundary", "summary", "repairPlan", "topFindings"]
    );
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

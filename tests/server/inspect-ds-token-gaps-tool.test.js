const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  inspectDsTokenGapsTool,
  applyDsConfigResponsiveSpacingRepairsTool,
  handleInspectDsTokenGaps,
  handleApplyDsConfigResponsiveSpacingRepairs,
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
  assert.strictEqual(applyDsConfigResponsiveSpacingRepairsTool.name, "apply_ds_config_responsive_spacing_repairs");
  assert.ok(inspectDsTokenGapsTool.description.includes("Read-only planner"));
  assert.ok(inspectDsTokenGapsTool.inputSchema.properties.categories, "schema should accept categories");
  assert.ok(inspectDsTokenGapsTool.inputSchema.properties.include_existing_updates, "schema should accept include_existing_updates");

  const result = inspectDsTokenGapsFromConfigAndFigmaData(DS, figmaData, {
    configPath: "/tmp/design-system.config.js",
    categories: ["spacing-semantics", "radius", "border-width", "typography", "elevation", "made-up"],
    include_existing_updates: true,
  });

  assert.deepStrictEqual(
    Object.keys(result).slice(0, 7),
    ["message", "semanticAliasRepairModel", "spacingSemanticSource", "approvalBoundary", "summary", "repairPlan", "topFindings"],
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
      Array.isArray(spacingAliasPlan.repairPlan.applyInput.spacing_semantic_repairs),
      "applyInput should carry exact semantic spacing repair entries for approval-boundary-safe apply"
    );
    assert.ok(
      spacingAliasPlan.repairPlan.applyInput.spacing_semantic_repairs.some(repair =>
        repair.name === "space/component/md" &&
        repair.updates.some(update => update.modeName === "Mobile" && update.toAliasName === "space/12")
      ),
      "exact semantic spacing apply payload should include token/mode alias targets"
    );
    const spacingAliasReview = spacingAliasPlan.repairPlan.reviewOptions.find(option => option.id === "semantic-spacing-aliases");
    assert.ok(spacingAliasReview, "repair plan should expose semantic spacing alias review as its own option");
    assert.deepStrictEqual(
      spacingAliasReview.previewInput.categories,
      ["spacing-semantics"],
      "semantic spacing alias review should preview only the spacing-semantics category"
    );
    assert.ok(
      Array.isArray(spacingAliasReview.previewInput.spacing_semantic_repairs) &&
        spacingAliasReview.previewInput.spacing_semantic_repairs.length > 0,
      "semantic spacing alias review should carry exact repair entries"
    );
    assert.ok(
      spacingAliasReview.designerSummary.includes("does not create unrelated spacing variables"),
      "semantic spacing alias review should explain the narrow boundary"
    );
    assert.ok(
      spacingAliasReview.designerSummary.includes("raw value") &&
        !spacingAliasReview.designerSummary.includes("existing alias"),
      "raw-only semantic spacing alias review should not imply alias retargets are present"
    );
    assert.ok(
      spacingAliasPlan.repairPlan.designerPresentation.proposedChanges.some(change =>
        change.token === "space/component/md"
        && change.mode === "Mobile"
        && change.toAlias === "space/12"
        && change.sourceKind === "raw-value"
        && change.action === "convert-raw-value-to-primitive-alias"
      ),
      "designer presentation should include exact token/mode alias mapping"
    );
    assert.ok(spacingAliasPlan.semanticAliasRepairModel, "planner should expose semantic alias repair model");
    assert.ok(
      spacingAliasPlan.repairPlan.semanticAliasRepairModel.intendedValuesSource === "config",
      "repair plan should document config-backed intended values"
    );
  }

  {
    const bootstrapSpacing = inspectDsTokenGapsFromConfigAndFigmaData(
      {
        collections: { primitives: "1. Primitives", spacing: "4. Spacing" },
        spacing: {},
      },
      {
        collections: [
          {
            id: "primitives",
            name: "1. Primitives",
            variableIds: ["p12", "p16", "p24"],
            modes: [{ modeId: "default", name: "Default" }],
          },
          {
            id: "spacing",
            name: "4. Spacing",
            variableIds: ["layout-lg"],
            modes: [
              { modeId: "mobile", name: "Mobile" },
              { modeId: "tablet", name: "Tablet" },
              { modeId: "desktop", name: "Desktop" },
            ],
          },
        ],
        variables: [
          { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
          { id: "p16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
          { id: "p24", name: "space/24", resolvedType: "FLOAT", valuesByMode: { default: 96 } },
          {
            id: "layout-lg",
            name: "space/layout/lg",
            resolvedType: "FLOAT",
            valuesByMode: { mobile: 48, tablet: 64, desktop: 96 },
          },
        ],
        textStyles: [],
        effectStyles: [],
      },
      {
        configPath: "/tmp/design-system.config.js",
        categories: ["spacing-semantics"],
      }
    );
    assert.strictEqual(bootstrapSpacing.spacingSemanticSource, "figma-snapshot-inference");
    assert.ok(
      bootstrapSpacing.repairPlan.applyInput.categories.includes("spacing-semantics"),
      "bootstrap config without spacing.semantic should still plan alias repairs from snapshot inference"
    );
  }

  {
    const bootstrapAliasedSpacing = inspectDsTokenGapsFromConfigAndFigmaData(
      {
        collections: { primitives: "1. Primitives", spacing: "4. Spacing" },
        spacing: {},
      },
      {
        collections: [
          {
            id: "primitives",
            name: "1. Primitives",
            variableIds: ["p12", "p16", "p24"],
            modes: [{ modeId: "default", name: "Default" }],
          },
          {
            id: "spacing",
            name: "4. Spacing",
            variableIds: ["layout-lg"],
            modes: [
              { modeId: "mobile", name: "Mobile" },
              { modeId: "tablet", name: "Tablet" },
              { modeId: "desktop", name: "Desktop" },
            ],
          },
        ],
        variables: [
          { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
          { id: "p16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
          { id: "p24", name: "space/24", resolvedType: "FLOAT", valuesByMode: { default: 96 } },
          {
            id: "layout-lg",
            name: "space/layout/lg",
            resolvedType: "FLOAT",
            valuesByMode: {
              mobile: { type: "VARIABLE_ALIAS", id: "p12" },
              tablet: { type: "VARIABLE_ALIAS", id: "p16" },
              desktop: { type: "VARIABLE_ALIAS", id: "p24" },
            },
          },
        ],
        textStyles: [],
        effectStyles: [],
      },
      {
        configPath: "/tmp/design-system.config.js",
        categories: ["spacing-semantics"],
      }
    );
    assert.strictEqual(bootstrapAliasedSpacing.spacingSemanticSource, "figma-snapshot-resolved");
    assert.strictEqual(
      bootstrapAliasedSpacing.repairPlan.spacingAliasPlanSummary.missingPrimitiveTokens,
      0,
      "fully aliased bootstrap spacing should not surface missing-primitive notes"
    );
    assert.ok(
      bootstrapAliasedSpacing.repairPlan.missingCapabilityNotes.some(
        note => note.kind === "spacing-semantics-already-healthy"
      ),
      "inspect should document healthy aliased semantics instead of missing primitives"
    );
    assert.ok(
      !bootstrapAliasedSpacing.repairPlan.missingCapabilityNotes.some(
        note => note.kind === "missing-primitive-for-alias-repair"
      )
    );
  }

  {
    const duplicatedResponsiveSpacing = inspectDsTokenGapsFromConfigAndFigmaData(
      {
        collections: { primitives: "1. Primitives", spacing: "4. Spacing" },
        spacing: {
          semantic: {
            "layout/lg": [48, 48, 48],
          },
        },
      },
      {
        collections: [
          {
            id: "primitives",
            name: "1. Primitives",
            variableIds: ["p12"],
            modes: [{ modeId: "default", name: "Default" }],
          },
          {
            id: "spacing",
            name: "4. Spacing",
            variableIds: ["layout-lg"],
            modes: [
              { modeId: "mobile", name: "Mobile" },
              { modeId: "tablet", name: "Tablet" },
              { modeId: "desktop", name: "Desktop" },
            ],
          },
        ],
        variables: [
          { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
          {
            id: "layout-lg",
            name: "space/layout/lg",
            resolvedType: "FLOAT",
            valuesByMode: {
              mobile: { type: "VARIABLE_ALIAS", id: "p12" },
              tablet: { type: "VARIABLE_ALIAS", id: "p12" },
              desktop: { type: "VARIABLE_ALIAS", id: "p12" },
            },
          },
        ],
        textStyles: [],
        effectStyles: [],
      },
      {
        configPath: "/tmp/design-system.config.js",
        categories: ["spacing-semantics"],
      }
    );
    assert.strictEqual(
      duplicatedResponsiveSpacing.summary.responsiveSpacingAdvisoryCount,
      1,
      "duplicated responsive spacing values should count as advisory findings"
    );
    assert.strictEqual(
      duplicatedResponsiveSpacing.repairPlan.applyInput.categories.includes("spacing-semantics"),
      false,
      "same-value responsive advisories must not create an apply-ready semantic spacing repair"
    );
    assert.ok(
      duplicatedResponsiveSpacing.repairPlan.missingCapabilityNotes.some(note =>
        note.kind === "spacing-semantics-unvalidated-duplicated-mode-values" &&
        note.severity === "advisory" &&
        note.productGap === false &&
        note.repairReady === false &&
        note.validationScope === "responsive-spacing-setup" &&
        note.reason.includes("responsive spacing setup validation work")
      ),
      "duplicated responsive values should be surfaced as responsive setup validation, not a product gap"
    );
    assert.ok(
      duplicatedResponsiveSpacing.repairPlan.designerPresentation.sections.some(section =>
        section.title === "Responsive spacing setup validation needed" &&
        section.message.includes("unvalidated responsive setup decisions") &&
        section.message.includes("Tablet/Desktop modes were just created") &&
        section.message.includes("space/layout/lg")
      ),
      "designer presentation should avoid saying duplicated responsive values are acceptable"
    );
    assert.ok(
      duplicatedResponsiveSpacing.message.includes("responsive spacing advisory") &&
      duplicatedResponsiveSpacing.message.includes("no token write is implied"),
      "zero-gap response should still mention responsive spacing advisories"
    );
    assert.ok(
      duplicatedResponsiveSpacing.repairPlan.agentInstruction.includes("responsive setup validation work") &&
      duplicatedResponsiveSpacing.repairPlan.agentInstruction.includes("not token gaps") &&
      duplicatedResponsiveSpacing.repairPlan.agentInstruction.includes("not apply-ready repairs"),
      "agent instruction should keep responsive advisories out of repair flows"
    );
    const responsiveReview = duplicatedResponsiveSpacing.repairPlan.reviewOptions.find(
      option => option.id === "responsive-spacing-values"
    );
    assert.ok(responsiveReview, "responsive spacing advisories should create a first-menu review option");
    assert.strictEqual(responsiveReview.tool, "apply_ds_config_responsive_spacing_repairs");
    assert.strictEqual(responsiveReview.configRepairTool, "apply_ds_config_responsive_spacing_repairs");
    assert.strictEqual(responsiveReview.figmaPlanTool, "plan_ds_figma_operations");
    assert.deepStrictEqual(
      responsiveReview.configRepairApplyInput.updates[0],
      {
        token: "space/layout/lg",
        values: { Mobile: 48, Tablet: 64, Desktop: 80 },
        expectedCurrentValues: { Mobile: 48, Tablet: 48, Desktop: 48 },
        source: "responsive-advisory",
      },
      "responsive review should carry config-first approved values instead of a Figma-only operation"
    );
    assert.ok(
      responsiveReview.designerSummary.includes("No raw semantic spacing alias repairs"),
      "responsive review should explicitly say when raw spacing cleanup is not also present"
    );
  }

  {
    const mixedResponsiveAndRawSpacing = inspectDsTokenGapsFromConfigAndFigmaData(
      {
        collections: { primitives: "1. Primitives", spacing: "4. Spacing" },
        spacing: {
          semantic: {
            "layout/xs": [48, 48, 48],
            "layout/lg": [48, 48, 48],
            "touch/min": [44, 44, 44],
          },
        },
      },
      {
        collections: [
          {
            id: "primitives",
            name: "1. Primitives",
            variableIds: ["p11", "p12", "p16", "p20", "p24"],
            modes: [{ modeId: "default", name: "Default" }],
          },
          {
            id: "spacing",
            name: "4. Spacing",
            variableIds: ["layout-xs", "layout-lg", "touch-min"],
            modes: [
              { modeId: "mobile", name: "Mobile" },
              { modeId: "tablet", name: "Tablet" },
              { modeId: "desktop", name: "Desktop" },
            ],
          },
        ],
        variables: [
          { id: "p11", name: "space/11", resolvedType: "FLOAT", valuesByMode: { default: 44 } },
          { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
          { id: "p16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
          { id: "p20", name: "space/20", resolvedType: "FLOAT", valuesByMode: { default: 80 } },
          { id: "p24", name: "space/24", resolvedType: "FLOAT", valuesByMode: { default: 96 } },
          {
            id: "layout-xs",
            name: "space/layout/xs",
            resolvedType: "FLOAT",
            valuesByMode: {
              mobile: { type: "VARIABLE_ALIAS", id: "p12" },
              tablet: { type: "VARIABLE_ALIAS", id: "p12" },
              desktop: { type: "VARIABLE_ALIAS", id: "p12" },
            },
          },
          {
            id: "layout-lg",
            name: "space/layout/lg",
            resolvedType: "FLOAT",
            valuesByMode: { mobile: 48, tablet: 48, desktop: 48 },
          },
          {
            id: "touch-min",
            name: "space/touch/min",
            resolvedType: "FLOAT",
            valuesByMode: { mobile: 44, tablet: 44, desktop: 44 },
          },
        ],
        textStyles: [],
        effectStyles: [],
      },
      {
        configPath: "/tmp/design-system.config.js",
        categories: ["spacing-semantics"],
      }
    );
    const responsiveReview = mixedResponsiveAndRawSpacing.repairPlan.reviewOptions.find(
      option => option.id === "responsive-spacing-values"
    );
    assert.ok(responsiveReview, "mixed responsive/raw spacing review should still offer responsive review");
    assert.strictEqual(responsiveReview.aliasRepairSummary.tokenCount, 2);
    assert.strictEqual(responsiveReview.aliasRepairSummary.updateCount, 6);
    assert.deepStrictEqual(responsiveReview.excludedAliasRepairTokens, ["space/layout/lg"]);
    assert.ok(
      responsiveReview.designerSummary.includes("raw mode values") &&
      responsiveReview.designerSummary.includes("space/layout/lg") &&
      responsiveReview.designerSummary.includes("space/touch/min"),
      "responsive review must not hide raw semantic spacing values"
    );
    const semanticAliasOption = mixedResponsiveAndRawSpacing.repairPlan.reviewOptions.find(
      option => option.id === "semantic-spacing-aliases"
    );
    assert.ok(
      semanticAliasOption,
      "remaining non-layout raw spacing values should remain visible as a separate alias repair option"
    );
    assert.deepStrictEqual(
      semanticAliasOption.previewInput.spacing_semantic_repairs.map(repair => repair.name),
      ["space/touch/min"],
      "duplicate raw layout repairs should move out of same-value semantic alias apply"
    );
    assert.ok(
      responsiveReview.previewInput.operations.some(operation =>
        operation.kind === "update_variable" &&
        operation.name === "space/layout/xs" &&
        operation.values.Tablet.alias === "space/16" &&
        operation.values.Desktop.alias === "space/20"
      ),
      "responsive review should provide a guarded alias-backed suggested operation when primitives exist"
    );
    assert.ok(
      responsiveReview.previewInput.operations.some(operation =>
        operation.kind === "update_variable" &&
        operation.name === "space/layout/lg" &&
        operation.values.Mobile.alias === "space/12" &&
        operation.values.Tablet.alias === "space/16" &&
        operation.values.Desktop.alias === "space/20"
      ),
      "duplicate raw layout repairs should get differentiated responsive alias suggestions on the first review"
    );
    assert.ok(
      responsiveReview.configRepairApplyInput.updates.some(update =>
        update.token === "space/layout/lg" &&
        update.values.Mobile === 48 &&
        update.values.Tablet === 64 &&
        update.values.Desktop === 80 &&
        update.expectedCurrentValues.Mobile === 48 &&
        update.expectedCurrentValues.Tablet === 48 &&
        update.expectedCurrentValues.Desktop === 48
      ),
      "raw-layout responsive suggestions should include a config update so Figma writes do not drift from DS.spacing.semantic"
    );
  }

  {
    const representativeSpacing = inspectDsTokenGapsFromConfigAndFigmaData(
      Object.assign({}, DS, {
        spacing: {
          semantic: {
            "layout/lg": [48, 64, 96],
            "touch/comfortable": [48, 48, 40],
          },
          radius: DS.spacing.radius,
          border: DS.spacing.border,
        },
      }),
      {
        collections: [
          {
            id: "primitives",
            name: "1. Primitives",
            variableIds: ["p12", "p16", "p24", "p40"],
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
          { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
          { id: "p16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
          { id: "p24", name: "space/24", resolvedType: "FLOAT", valuesByMode: { default: 96 } },
          { id: "p40", name: "space/40", resolvedType: "FLOAT", valuesByMode: { default: 40 } },
          {
            id: "layout-lg",
            name: "space/layout/lg",
            resolvedType: "FLOAT",
            valuesByMode: { mobile: 48, tablet: 64, desktop: 96 },
          },
          {
            id: "touch-comfortable",
            name: "space/touch/comfortable",
            resolvedType: "FLOAT",
            valuesByMode: { mobile: 48, tablet: 48, desktop: 40 },
          },
        ],
        textStyles: [],
        effectStyles: [],
      },
      {
        configPath: "/tmp/design-system.config.js",
        categories: ["spacing-semantics"],
      }
    );
    const repairs = representativeSpacing.tokenGaps.filter(gap => gap.gapType === "spacing-alias-repair");
    assert.ok(repairs.some(gap => gap.name === "space/layout/lg"), "layout/lg should be repairable");
    assert.ok(repairs.some(gap => gap.name === "space/touch/comfortable"), "touch/comfortable should be repairable");
    assert.ok(
      representativeSpacing.repairPlan.designerPresentation.proposedChanges.some(change =>
        change.token === "space/touch/comfortable" && change.toAlias === "space/40" && change.mode === "Desktop"
      ),
      "designer presentation should list touch/comfortable alias targets"
    );
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-responsive-spacing-config-"));
    const configPath = path.join(tmp, "design-system.config.js");
    fs.writeFileSync(configPath, `const DS = {
  breakpoints: { modes: ["Mobile", "Tablet", "Desktop"] },
  spacing: { semantic: { "layout/lg": [48, 48, 48], "touch/min": [44, 44, 44] } }
};\n`, "utf8");

    const result = handleApplyDsConfigResponsiveSpacingRepairs({
      config_path: configPath,
      updates: [{
        token: "space/layout/lg",
        values: { Mobile: 48, Tablet: 64, Desktop: 80 },
        expectedCurrentValues: { Mobile: 48, Tablet: 48, Desktop: 48 },
      }],
    });
    assert.ok(!result.error, "responsive spacing config repair should accept fresh approved payload");
    assert.strictEqual(result.configWritten, true);
    assert.strictEqual(result.figmaChanged, false);
    const written = fs.readFileSync(configPath, "utf8");
    assert.ok(written.includes('"layout/lg": [\n        48,\n        64,\n        80\n      ]'), "config repair should update only DS.spacing.semantic values");
    assert.ok(written.includes('"touch/min": [\n        44,\n        44,\n        44\n      ]'), "unapproved semantic spacing entries should remain unchanged");

    const stale = handleApplyDsConfigResponsiveSpacingRepairs({
      config_path: configPath,
      updates: [{
        token: "space/layout/lg",
        values: { Tablet: 96 },
        expectedCurrentValues: { Tablet: 48 },
      }],
    });
    assert.ok(stale.error.includes("could not be validated"), "stale responsive config approvals should be rejected");
    assert.ok(
      fs.readFileSync(configPath, "utf8").includes('"layout/lg": [\n        48,\n        64,\n        80\n      ]'),
      "stale rejection must not partially write config"
    );
  }

  {
    const configDrift = inspectDsTokenGapsFromConfigAndFigmaData(DS, {
      collections: [
        {
          id: "primitives",
          name: "1. Primitives",
          variableIds: ["space-12", "space-16"],
          modes: [{ modeId: "default", name: "Default" }],
        },
        {
          id: "spacing",
          name: "4. Spacing",
          variableIds: ["component-md"],
          modes: [
            { modeId: "mobile", name: "Mobile" },
            { modeId: "tablet", name: "Tablet" },
            { modeId: "desktop", name: "Desktop" },
          ],
        },
      ],
      variables: [
        { id: "space-12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 12 } },
        { id: "space-16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 16 } },
        {
          id: "component-md",
          name: "space/component/md",
          resolvedType: "FLOAT",
          valuesByMode: { mobile: 12, tablet: 99, desktop: 16 },
        },
      ],
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["spacing-semantics"],
    });
    const driftRepair = configDrift.tokenGaps.find(gap => gap.gapType === "spacing-alias-repair" && gap.name === "space/component/md");
    assert.ok(driftRepair, "config drift with matching primitives should surface as exact alias repair");
    assert.ok(
      driftRepair.updates.some(update => update.modeName === "Tablet" && update.toAliasName === "space/16"),
      "drifted modes should be repaired directly to primitive aliases"
    );
    assert.ok(
      !configDrift.tokenGaps.some(gap => gap.gapType === "spacing-alias-config-drift" && gap.name === "space/component/md"),
      "repairable drift should not be left as a separate raw-value drift"
    );
    assert.ok(
      configDrift.repairPlan.designerPresentation.proposedChanges.some(change =>
        change.token === "space/component/md" && change.mode === "Tablet" && change.toAlias === "space/16"
      ),
      "designer presentation should show the alias target for drift repair"
    );
  }

  {
    const wrongAlias = inspectDsTokenGapsFromConfigAndFigmaData({
      collections: { primitives: "1. Primitives", spacing: "4. Spacing" },
      spacing: { semantic: { "layout/lg": [48, 64, 96] } },
    }, {
      collections: [
        {
          id: "primitives",
          name: "1. Primitives",
          variableIds: ["p12", "p16", "p24"],
          modes: [{ modeId: "default", name: "Default" }],
        },
        {
          id: "spacing",
          name: "4. Spacing",
          variableIds: ["layout-lg"],
          modes: [
            { modeId: "mobile", name: "Mobile" },
            { modeId: "tablet", name: "Tablet" },
            { modeId: "desktop", name: "Desktop" },
          ],
        },
      ],
      variables: [
        { id: "p12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
        { id: "p16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
        { id: "p24", name: "space/24", resolvedType: "FLOAT", valuesByMode: { default: 96 } },
        {
          id: "layout-lg",
          name: "space/layout/lg",
          resolvedType: "FLOAT",
          valuesByMode: {
            mobile: { type: "VARIABLE_ALIAS", id: "p12" },
            tablet: { type: "VARIABLE_ALIAS", id: "p12" },
            desktop: { type: "VARIABLE_ALIAS", id: "p12" },
          },
        },
      ],
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["spacing-semantics"],
    });
    const wrongAliasRepair = wrongAlias.tokenGaps.find(gap => gap.gapType === "spacing-alias-repair" && gap.name === "space/layout/lg");
    assert.ok(wrongAliasRepair, "wrong existing aliases should be retargetable");
    assert.deepStrictEqual(
      wrongAliasRepair.updates.map(update => [update.modeName, update.toAliasName]),
      [["Tablet", "space/16"], ["Desktop", "space/24"]],
      "already aliased responsive modes should retarget to the expected primitive aliases"
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
    assert.strictEqual(
      missingModes.repairPlan.applyInput.ensure_collection_modes,
      undefined,
      "missing modes should stay out of update_ds_tokens applyInput unless separately approved"
    );
    assert.ok(
      !missingModes.repairPlan.applyInput.categories.includes("spacing-semantics"),
      "spacing-semantics should stay blocked when missing modes exist and there are no exact existing-mode alias repairs"
    );
    assert.ok(
      missingModes.repairPlan.foundationRepairPlan.applyInput.collections.some(item => item.kind === "spacing"),
      "missing modes should still route through foundation repair on the existing collection"
    );
  }

  {
    const mobileOnlySpacing = inspectDsTokenGapsFromConfigAndFigmaData(Object.assign({}, DS, {
      spacing: Object.assign({}, DS.spacing, {
        semantic: {
          "layout/lg": [48, 64, 96],
          "layout/xl": [64, 96, 128],
          "touch/min": [44, 44, 44],
          "touch/comfortable": [48, 48, 40],
          "component/md": [24, 32, 32],
        },
      }),
    }), {
      collections: [
        {
          id: "primitives",
          name: "1. Primitives",
          modes: [{ modeId: "default", name: "Default" }],
          variableIds: ["space-11", "space-12", "space-16"],
        },
        {
          id: "spacing",
          name: "4. Spacing",
          modes: [{ modeId: "mobile", name: "Mobile" }],
          variableIds: ["layout-lg", "layout-xl", "touch-min", "touch-comfortable"],
        },
      ],
      variables: [
        { id: "space-11", name: "space/11", resolvedType: "FLOAT", valuesByMode: { default: 44 } },
        { id: "space-12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
        { id: "space-16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
        { id: "layout-lg", name: "space/layout/lg", resolvedType: "FLOAT", valuesByMode: { mobile: 48 } },
        { id: "layout-xl", name: "space/layout/xl", resolvedType: "FLOAT", valuesByMode: { mobile: 64 } },
        { id: "touch-min", name: "space/touch/min", resolvedType: "FLOAT", valuesByMode: { mobile: 44 } },
        { id: "touch-comfortable", name: "space/touch/comfortable", resolvedType: "FLOAT", valuesByMode: { mobile: 48 } },
      ],
      textStyles: [],
      effectStyles: [],
    }, {
      configPath: "/tmp/design-system.config.js",
      categories: ["spacing-semantics"],
    });
    assert.deepStrictEqual(
      mobileOnlySpacing.repairPlan.applyInput.categories,
      ["spacing-semantics"],
      "Mobile-only raw alias repairs should be apply-ready even when Tablet/Desktop modes are missing"
    );
    assert.strictEqual(
      mobileOnlySpacing.repairPlan.applyInput.ensure_collection_modes,
      undefined,
      "Mobile-only exact alias repair must not create Tablet/Desktop modes"
    );
    assert.ok(
      mobileOnlySpacing.repairPlan.missingCapabilityNotes.some(note =>
        note.kind === "missing-foundation-modes" &&
        note.category === "spacing-semantics" &&
        note.missingModes.includes("Tablet") &&
        note.missingModes.includes("Desktop") &&
        note.reason.includes("separate option") &&
        note.reason.includes("stop before any spacing alias apply")
      ),
      "missing Tablet/Desktop modes should remain a separate foundation repair suggestion"
    );
    assert.ok(
      mobileOnlySpacing.repairPlan.agentInstruction.includes("separate options with separate approvals"),
      "agent instruction should not allow one approval to cover modes and spacing aliases"
    );
    assert.ok(
      mobileOnlySpacing.repairPlan.agentInstruction.includes("reviewOptions"),
      "agent instruction should route designer token review through split review options"
    );
    assert.ok(
      mobileOnlySpacing.repairPlan.agentInstruction.includes("then stop before any primitive or semantic token write"),
      "foundation approval should stop after mode creation and reinspect"
    );
    assert.ok(
      mobileOnlySpacing.repairPlan.designerPresentation.sections.some(section =>
        section.title === "Spacing breakpoint modes required" &&
        section.message.includes("separate option") &&
        section.message.includes("stop before any spacing alias apply")
      ),
      "designer presentation should separate missing modes from Mobile alias repairs"
    );
    const exactRepairs = mobileOnlySpacing.repairPlan.applyInput.spacing_semantic_repairs || [];
    assert.ok(
      mobileOnlySpacing.repairPlan.reviewOptions.some(option =>
        option.id === "foundation-modes" &&
        option.tool === "apply_ds_foundation_repairs"
      ),
      "missing modes should be exposed as a separate review option"
    );
    assert.ok(
      mobileOnlySpacing.repairPlan.reviewOptions.some(option =>
        option.id === "semantic-spacing-aliases" &&
        option.previewInput &&
        Array.isArray(option.previewInput.spacing_semantic_repairs) &&
        option.designerSummary.includes("4 raw values") &&
        !option.designerSummary.includes("existing alias")
      ),
      "Mobile-only raw alias repairs should be exposed as a separate exact review option without alias-retarget wording"
    );
    assert.strictEqual(
      mobileOnlySpacing.repairPlan.designerPresentation.summaryCounts.spacingAliasRepairSourceBreakdown.rawValueUpdates,
      4,
      "Mobile-only fixture should surface the four raw values as the source breakdown"
    );
    assert.strictEqual(
      mobileOnlySpacing.repairPlan.designerPresentation.summaryCounts.spacingAliasRepairSourceBreakdown.aliasRetargetUpdates,
      0,
      "Mobile-only fixture should not classify already-aliased tokens as raw repairs"
    );
    assert.deepStrictEqual(
      exactRepairs.map(repair => repair.name).sort(),
      ["space/layout/lg", "space/layout/xl", "space/touch/comfortable", "space/touch/min"].sort(),
      "applyInput should contain exactly the four existing Mobile raw semantic spacing repairs"
    );
    for (const repair of exactRepairs) {
      assert.strictEqual(repair.updates.length, 1, repair.name + " should include only the approved existing Mobile mode");
      assert.strictEqual(repair.updates[0].modeName, "Mobile");
    }
    assert.ok(
      !exactRepairs.some(repair => repair.name === "space/component/md"),
      "exact Mobile alias repair must not include unrelated semantic spacing tokens"
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
      Object.keys(handled).slice(0, 7),
      ["message", "semanticAliasRepairModel", "spacingSemanticSource", "approvalBoundary", "summary", "repairPlan", "topFindings"]
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

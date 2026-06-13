const assert = require("assert");

const {
  handleFigletsWorkflowGuide,
} = require("../../packages/figlets-mcp-server/src/tools/agent-interface.js");
const {
  inspectDsTokenGapsFromConfigAndFigmaData,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");

function variable(id, name, collectionId, valuesByMode, type) {
  return {
    id,
    name,
    variableCollectionId: collectionId,
    resolvedType: type || "FLOAT",
    valuesByMode,
  };
}

module.exports = (() => {
  const ds = {
    collections: {
      primitives: "Core Primitives",
      typography: "Responsive Type",
      spacing: "Responsive Spacing",
      elevation: "Depth",
    },
    breakpoints: { modes: ["Phone", "Tablet", "Desktop"] },
    naming: { textStyle: "font/{role}/{size}", typePrefix: "font", fontFamily: "font-family/{variant}" },
    color: { ramps: [{ folder: "color/neutral", steps: [[500, 0, 0, 0]] }] },
    primitives: {
      spacing: [[3, 12], [4, 16], [6, 24], [8, 32]],
    },
    typography: {
      families: { sans: "Inter", mono: "JetBrains Mono" },
      scale: {
        "body/md": { sizes: [14, 14, 16], lineHeights: [20, 20, 24], weight: 400, tracking: 0 },
      },
    },
    spacing: {
      semantic: {
        "component/md": 12,
        "layout/lg": [24, 32, 48],
        "stack/md": [16, 16, 24],
      },
      radius: { md: 8 },
      border: { default: 1 },
    },
  };

  const figmaData = {
    collections: [
      {
        id: "primitives",
        name: "Core Primitives",
        variableIds: ["space-3", "space-4", "space-6", "space-8"],
        modes: [{ modeId: "default", name: "Default" }],
      },
      {
        id: "spacing",
        name: "Responsive Spacing",
        variableIds: ["layout-lg", "stack-md"],
        modes: [{ modeId: "phone", name: "Phone" }],
      },
      {
        id: "type",
        name: "Responsive Type",
        variableIds: [],
        modes: [
          { modeId: "phone", name: "Phone" },
          { modeId: "tablet", name: "Tablet" },
          { modeId: "desktop", name: "Desktop" },
        ],
      },
      {
        id: "depth",
        name: "Depth",
        variableIds: [],
        modes: [{ modeId: "default", name: "Default" }],
      },
    ],
    variables: [
      variable("space-3", "space/3", "primitives", { default: 12 }),
      variable("space-4", "space/4", "primitives", { default: 16 }),
      variable("space-6", "space/6", "primitives", { default: 24 }),
      variable("space-8", "space/8", "primitives", { default: 32 }),
      variable("layout-lg", "space/layout/lg", "spacing", { phone: 24 }),
      variable("stack-md", "space/stack/md", "spacing", {
        phone: { type: "VARIABLE_ALIAS", id: "space-8" },
      }),
    ],
    textStyles: [],
    effectStyles: [],
  };

  const plan = inspectDsTokenGapsFromConfigAndFigmaData(ds, figmaData, {
    configPath: "/tmp/custom-ds/design-system.config.js",
    categories: ["primitive-typography", "spacing-semantics", "radius", "border-width", "typography"],
    include_existing_updates: true,
  });

  assert.ok(plan.repairPlan, "token-gap planner should emit a repair plan for the designer contract fixture");
  assert.deepStrictEqual(
    plan.repairPlan.reviewOptions.map(option => option.id),
    [
      "foundation-modes",
      "primitive-typography",
      "semantic-spacing-aliases",
      "radius-border-tokens",
      "typography-tokens-and-styles",
      "semantic-spacing-token-completion",
    ],
    "designer token review choices should stay split into stable approval boundaries"
  );
  assert.deepStrictEqual(
    plan.repairPlan.reviewOptions.map(option => option.label),
    [
      "Add missing foundation modes only",
      "Review primitive typography variables",
      "Review semantic spacing alias repairs",
      "Review radius and border-width tokens",
      "Review typography variables and text styles",
      "Review semantic spacing token completion",
    ],
    "designer token review labels should remain understandable and stable"
  );

  const foundation = plan.repairPlan.reviewOptions.find(option => option.id === "foundation-modes");
  assert.strictEqual(foundation.tool, "apply_ds_foundation_repairs");
  assert.deepStrictEqual(
    foundation.applyInput.collections,
    [{ kind: "spacing", name: "Responsive Spacing", modes: ["Phone", "Tablet", "Desktop"] }],
    "foundation option should use configured collection and mode names, not Figlets fixture names"
  );

  const spacingAliases = plan.repairPlan.reviewOptions.find(option => option.id === "semantic-spacing-aliases");
  assert.strictEqual(spacingAliases.tool, "update_ds_tokens");
  assert.deepStrictEqual(spacingAliases.previewInput.categories, ["spacing-semantics"]);
  assert.ok(spacingAliases.previewInput.spacing_semantic_repairs.length > 0);
  assert.ok(
    spacingAliases.designerSummary.includes("does not create missing breakpoint modes") &&
      spacingAliases.designerSummary.includes("does not create unrelated spacing variables"),
    "exact semantic spacing alias option should explain its narrow boundary"
  );
  assert.ok(
    spacingAliases.designerSummary.includes("1 raw value") &&
      spacingAliases.designerSummary.includes("1 existing alias"),
    "semantic spacing alias option should include raw conversions and wrong-alias retargets"
  );
  const spacingBreakdown = plan.repairPlan.designerPresentation.summaryCounts.spacingAliasRepairSourceBreakdown;
  assert.strictEqual(spacingBreakdown.rawValueUpdates, 1);
  assert.strictEqual(spacingBreakdown.aliasRetargetUpdates, 1);
  assert.ok(
    plan.repairPlan.designerPresentation.proposedChanges.some(change =>
      change.token === "space/stack/md" && change.action === "retarget-existing-alias-to-primitive"
    ),
    "designer presentation should include already-aliased spacing tokens when the alias target is wrong"
  );

  const radiusBorder = plan.repairPlan.reviewOptions.find(option => option.id === "radius-border-tokens");
  assert.deepStrictEqual(radiusBorder.previewInput.categories, ["border-width", "radius"]);

  const typography = plan.repairPlan.reviewOptions.find(option => option.id === "typography-tokens-and-styles");
  assert.deepStrictEqual(typography.previewInput.categories, ["typography"]);

  assert.ok(
    plan.repairPlan.agentInstruction.includes("Do not run repairPlan.previewInput") &&
      plan.repairPlan.agentInstruction.includes("one combined token preview"),
    "planner instructions should forbid the clumped mega-preview"
  );

  const guide = handleFigletsWorkflowGuide({ workflow_id: "health-check" });
  assert.ok(
    guide.hardRules.bulkRepairRouting.some(item => item.includes("repairPlan.reviewOptions")),
    "health-check hard rules should route token review through reviewOptions"
  );
  assert.ok(
    guide.workflow.steps.some(step =>
      step.id === "preview-token-repairs" &&
      step.designerMessage.includes("repairPlan.reviewOptions") &&
      step.designerMessage.includes("not one combined token preview")
    ),
    "health-check workflow should tell agents not to run one broad token preview"
  );
})();

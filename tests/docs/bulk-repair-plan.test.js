const assert = require("assert");
const fs = require("fs");
const path = require("path");

const plan = fs.readFileSync(path.resolve(__dirname, "../../docs/bulk-repair-api-implementation-plan.md"), "utf-8");

assert.ok(
  plan.includes("Typography And Elevation Apply Readiness Notes"),
  "Phase 3 plan should include explicit typography/elevation apply readiness notes"
);
assert.ok(
  plan.includes("Do not enable broad `typography`, `primitive-typography`, `primitive-shadow`, or `elevation`"),
  "Phase 3 plan should block broad high-risk categories until their strategies are implemented"
);
assert.ok(
  plan.includes("The narrow `typography-variables` and `typography-styles` categories are the approved typography slices"),
  "Approved typography apply slices should be documented narrowly"
);
assert.ok(
  plan.includes("`typography-variables`") && plan.includes("No text styles"),
  "Typography variable apply should be explicitly separated from text styles"
);
assert.ok(
  plan.includes("Text style create/refresh") && plan.includes("fontLoadFailures"),
  "Text-style apply strategy should require font-loading failure reporting"
);
assert.ok(
  plan.includes("Typography Text-Style Apply Strategy") &&
    plan.includes("The text-style apply slice uses the narrow category `typography-styles`") &&
    plan.includes("figma.loadFontAsync"),
  "Typography text-style apply should have a pinned narrow strategy after implementation"
);
assert.ok(
  plan.includes("missingTypographyVariable") &&
    plan.includes("missingFontFamilyVariable") &&
    plan.includes("unsupportedTextStyleBinding"),
  "Typography style strategy should require structured prerequisite/failure reporting"
);
assert.ok(
  plan.includes("Elevation should also be split") && plan.includes("Effect style create/refresh"),
  "Elevation apply strategy should split variables from effect styles"
);
assert.ok(
  plan.includes("approved apply for `radius`, `border-width`, `spacing-semantics`, `typography-variables`, `typography-styles`, `elevation-variables`, and `elevation-styles` only") &&
    plan.includes("Elevation collection FLOAT variables `elevation/<key>/{offset-y,radius}`"),
  "Current surface table should include the elevation apply slices"
);
assert.ok(
  plan.includes("Elevation Effect-Style Apply Strategy") &&
    plan.includes("The effect-style apply slice uses the narrow category `elevation-styles`") &&
    plan.includes("figma.variables.setBoundVariableForEffect"),
  "Broad elevation style apply should keep a pinned narrow strategy after implementation"
);
assert.ok(
  plan.includes("missingElevationVariable") &&
    plan.includes("missingShadowColorVariable") &&
    plan.includes("unsupportedEffectBinding"),
  "Elevation style strategy should require structured prerequisite/failure reporting"
);
assert.ok(
  plan.includes("Dry-run reports for broad typography/elevation are useful, but apply must keep returning `unsupported-apply-category` product-gap notes for broad `typography` and broad `elevation`"),
  "Plan should preserve product-gap reporting for broad typography/elevation until future apply slices land"
);
assert.ok(
  plan.includes("Architecture Guardrail For New Repair Work") &&
    plan.includes("Can an existing planner/apply surface be extended with a narrow category?") &&
    plan.includes("Do not make setup call MCP tools internally; share bridge/core helpers underneath them instead."),
  "Plan should require conscious extension vs new-surface decisions before adding more repair tools"
);

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const plan = fs.readFileSync(path.resolve(__dirname, "../../docs/bulk-repair-api-implementation-plan.md"), "utf-8");

assert.ok(
  plan.includes("Typography And Elevation Apply Readiness Notes"),
  "Phase 3 plan should include explicit typography/elevation apply readiness notes"
);
assert.ok(
  plan.includes("Do not enable `typography`, `primitive-typography`, `primitive-shadow`, or `elevation`"),
  "Phase 3 plan should block high-risk categories until their strategies are implemented"
);
assert.ok(
  plan.includes("Typography should be split into two slices"),
  "Typography apply should be split into variable and text-style slices"
);
assert.ok(
  plan.includes("Text style create/refresh") && plan.includes("fontLoadFailures"),
  "Text-style apply strategy should require font-loading failure reporting"
);
assert.ok(
  plan.includes("Elevation should also be split") && plan.includes("Effect style create/refresh"),
  "Elevation apply strategy should split variables from effect styles"
);
assert.ok(
  plan.includes("dry-run reports for typography/elevation are useful, but apply must keep returning `unsupported-apply-category`"),
  "Plan should preserve product-gap reporting until future apply slices land"
);

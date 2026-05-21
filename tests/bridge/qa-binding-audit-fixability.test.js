const assert = require("assert");
const fs = require("fs");
const path = require("path");

const code = fs.readFileSync(
  path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"),
  "utf8"
);
const tool = fs.readFileSync(
  path.join(__dirname, "../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js"),
  "utf8"
);

assert.ok(
  code.includes("return 'fixableNow';") &&
    code.includes("return 'needsExistingToken';") &&
    code.includes("return 'needsDesignerDecision';"),
  "Bridge QA audit must classify all four fixability states"
);

assert.ok(
  code.includes("variable ? 'high' : 'none'") &&
    code.match(/_colorSuggestion[\s\S]*?variable \? 'high'/),
  "Color violations with a semantic variable should be high-confidence"
);

assert.ok(
  code.includes("No exact spacing variable found.") &&
    code.includes("No exact border variable found."),
  "Spacing/border violations without an exact variable should stay non-fixable"
);

assert.ok(
  code.includes("Exact text style match") &&
    code.includes("confidence: 'high'") &&
    code.includes("confidence: 'medium'") &&
    code.includes("Role/name-based text style suggestion"),
  "Typography must promote exact style matches to high confidence and keep role-only matches medium"
);

assert.ok(
  tool.includes("fixability") && tool.includes("repairPlan") && tool.includes("byFixability"),
  "MCP qa_binding_audit output must surface fixability and repairPlan"
);

assert.ok(
  tool.includes("fix: true applies only fixableNow"),
  "MCP tool description must state fix:true applies only fixableNow violations"
);

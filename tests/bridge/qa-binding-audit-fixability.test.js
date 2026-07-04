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
  code.includes("ambiguousStateSurface ? 'medium' : 'high'") &&
    code.includes("function _hasStateLikeContext(node)") &&
    code.includes("function _isGenericStateSurfaceToken(name)"),
  "Color violations with semantic variables should downgrade state-like generic surface matches to designer-decision"
);

assert.ok(
  code.includes("function _nearestFloatSuggestion(value, purpose, label)") &&
    code.includes("suggestion.distance = distance") &&
    code.includes("suggestion.expectedValue = value") &&
    code.includes("_ds.pickFloatByNearest"),
  "Spacing/border/radius violations without an exact variable should expose closest-token designer-decision suggestions when available"
);

assert.ok(
  code.includes("function _exactTextStyleForNode(node)") &&
    code.includes("confidence: 'high'") &&
    code.includes("confidence: 'medium'") &&
    code.includes("function _typographyCandidates(node, limit)"),
  "Typography must promote exact style matches to high confidence and keep role-only matches medium"
);

assert.ok(
  tool.includes("fixability") && tool.includes("repairPlan") && tool.includes("byFixability"),
  "MCP qa_binding_audit output must surface fixability and repairPlan"
);

assert.ok(
  tool.includes("issueNumber") &&
    tool.includes("stable numbered list"),
  "MCP tool description must tell agents to present QA findings as stable numbered issues"
);

assert.ok(
  tool.includes("fix: true applies only fixableNow"),
  "MCP tool description must state fix:true applies only fixableNow violations"
);

assert.ok(
  tool.includes("approved_suggestions") &&
    tool.includes("repairPlan.designerDecisionApplyInput") &&
    tool.includes("visible recommendation") &&
    tool.includes("hidden raw suggestion"),
  "MCP tool description must document the approved designer-decision, visible recommendation, and exact alternate binding path"
);

assert.ok(
  tool.includes("show each exact raw value -> target token/style") &&
    tool.includes("rawFill") &&
    tool.includes("top candidates") &&
    tool.includes("roleCandidate") &&
    tool.includes("visible recommended target") &&
    tool.includes("ok, good, or good on suggestion"),
  "MCP tool description must prevent blind approval prompts and make shorthand approval follow the displayed recommendation"
);

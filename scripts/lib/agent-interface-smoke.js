"use strict";

const assert = require("assert");

const {
  REPO_ROOT,
  assertProductVersionAlignment,
  expectedTarballUrl,
  readProductVersion,
  readServerVersion,
} = require("./product-version.js");

function assertPluginReleaseAlignment() {
  return assertProductVersionAlignment();
}

function assertStartPayload(start) {
  assert.ok(start.designerResponse.startsWith("# Figlets"), "figlets_start must return the curated designer menu");
  assert.ok(start.designerResponse.includes("Check my design system"), "designer menu must include health-check entry");
  assert.strictEqual(start.responseContract.openingFormat, "capability-menu");
  assert.strictEqual(start.hardRules.reviewMustUseFigletsWorkflow, true);
  assert.strictEqual(start.hardRules.bulkDesignSystemUpdatesAreInScope, true);
  assert.ok(Array.isArray(start.hardRules.supportedBulkUpdateSurfaces) && start.hardRules.supportedBulkUpdateSurfaces.length > 0);
  assert.ok(Array.isArray(start.hardRules.bulkRepairRouting) && start.hardRules.bulkRepairRouting.length >= 4);
  assert.ok(start.hardRules.forbiddenUnlessDesignerExplicitlyAsksOutOfBounds.some(item => /custom scripts/i.test(item)));
  assert.ok(!start.designerResponse.includes("Plugin / MCP server code"), "designer menu must not expose developer options");
}

function assertRoutePayload(route) {
  assert.strictEqual(route.workflow.id, "health-check");
  assert.strictEqual(route.hardRules.reviewMustUseFigletsWorkflow, true);
  assert.ok(route.message.includes("Figlets workflow"), "route message must steer agents to Figlets workflows");
  assert.ok(route.designerResponse.includes("health check"), "route designerResponse should name the health-check workflow");
}

function assertWorkflowGuidePayload(guide) {
  assert.strictEqual(guide.workflow.id, "health-check");
  assert.ok(Array.isArray(guide.workflow.steps) && guide.workflow.steps.length > 0, "workflow guide must include steps");
  assert.ok(guide.workflow.steps.some(step => step.tool === "sync_figma_data"), "health-check guide must start with sync_figma_data");
  assert.strictEqual(guide.hardRules.reviewMustUseFigletsWorkflow, true);
  assert.ok(Array.isArray(guide.bulkRepairRouting) && guide.bulkRepairRouting.length >= 4);
  assert.ok(guide.presentationRule.includes("repairPlan"), "workflow guide must mention repairPlan presentation");
  assert.ok(guide.message.includes("named Figlets tools/scripts only"), "workflow guide must forbid ad hoc scripting");
}

function assertHealthCheckPayload(health) {
  assert.strictEqual(health.boundaries.readOnly, true, "health check must be read-only");
  assert.strictEqual(health.boundaries.figmaMutationAllowed, false, "health check must not allow Figma mutation");
  assert.strictEqual(health.boundaries.hostSpecificBehavior, false, "health check must stay host-neutral");
  assert.ok(Array.isArray(health.checks) && health.checks.length > 0, "health check must return checks");
  assert.ok(health.checks.some(check => check.id === "designer_mode_entrypoint"), "health check must cover Designer Mode entrypoint");
  assert.ok(health.checks.some(check => check.id === "approval_boundary"), "health check must cover approval boundaries");
  assert.ok(health.nextAction && health.nextAction.message, "health check must return a next action");
}

async function smokeAgentInterfaceTools(session, parseToolCallPayload) {
  callTool(session, 10, "figlets_start", {});
  const start = parseToolCallPayload(await session.waitForResponse(10));
  assertStartPayload(start);

  callTool(session, 11, "figlets_route_intent", { intent: "review my design system using Figlets" });
  const route = parseToolCallPayload(await session.waitForResponse(11));
  assertRoutePayload(route);

  callTool(session, 12, "figlets_workflow_guide", { workflow_id: route.workflow.id });
  const guide = parseToolCallPayload(await session.waitForResponse(12));
  assertWorkflowGuidePayload(guide);

  callTool(session, 13, "figlets_health_check", {
    context: { mode: "designer", goal: "review my design system", workflowId: route.workflow.id },
    workflowState: {
      figletsStartCalled: true,
      routeIntentCalled: true,
      workflowGuideCalled: true,
      completedTools: [],
    },
  });
  const health = parseToolCallPayload(await session.waitForResponse(13));
  assertHealthCheckPayload(health);
}

function callTool(session, id, name, argumentsPayload) {
  session.send(id, "tools/call", { name, arguments: argumentsPayload });
}

module.exports = {
  REPO_ROOT,
  expectedTarballUrl,
  readProductVersion,
  readServerVersion,
  assertPluginReleaseAlignment,
  assertProductVersionAlignment,
  assertStartPayload,
  assertRoutePayload,
  assertWorkflowGuidePayload,
  assertHealthCheckPayload,
  smokeAgentInterfaceTools,
};

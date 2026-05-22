"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const SERVER_PKG_PATH = path.join(REPO_ROOT, "packages", "figlets-mcp-server", "package.json");
const CLAUDE_PLUGIN_JSON = path.join(REPO_ROOT, "plugins", "claude-code", "figlets", ".claude-plugin", "plugin.json");
const CODEX_PLUGIN_JSON = path.join(REPO_ROOT, "plugins", "codex", "figlets", ".codex-plugin", "plugin.json");
const CODEX_MCP_JSON = path.join(REPO_ROOT, "plugins", "codex", "figlets", ".mcp.json");

const TARBALL_URL_RE =
  /^https:\/\/github\.com\/arashr\/figlets-mcp\/releases\/download\/v(\d+\.\d+\.\d+)\/figlets-mcp-server-(\d+\.\d+\.\d+)\.tgz$/;

function expectedTarballUrl(version) {
  return `https://github.com/arashr/figlets-mcp/releases/download/v${version}/figlets-mcp-server-${version}.tgz`;
}

function readServerVersion() {
  const pkg = JSON.parse(fs.readFileSync(SERVER_PKG_PATH, "utf-8"));
  assert.ok(pkg.version, "server package must declare a version");
  return pkg.version;
}

function assertTarballUrl(url, contextLabel) {
  const match = TARBALL_URL_RE.exec(url);
  assert.ok(match, `${contextLabel} must use a versioned GitHub release tarball URL`);
  assert.strictEqual(match[1], match[2], `${contextLabel} tarball tag and filename version must match`);
  return match[1];
}

function assertPluginReleaseAlignment() {
  const version = readServerVersion();
  const expectedUrl = expectedTarballUrl(version);

  const claudePlugin = JSON.parse(fs.readFileSync(CLAUDE_PLUGIN_JSON, "utf-8"));
  assert.strictEqual(claudePlugin.version, version, "Claude plugin version must track the server package");
  const claudeUrl = claudePlugin.mcpServers.figlets.args[1];
  assert.strictEqual(assertTarballUrl(claudeUrl, "Claude plugin MCP"), version);
  assert.strictEqual(claudeUrl, expectedUrl, "Claude plugin MCP URL must match the current server version");

  const codexPlugin = JSON.parse(fs.readFileSync(CODEX_PLUGIN_JSON, "utf-8"));
  assert.strictEqual(codexPlugin.version, version, "Codex plugin version must track the server package");
  const codexMcp = JSON.parse(fs.readFileSync(CODEX_MCP_JSON, "utf-8"));
  const codexUrl = codexMcp.mcpServers.figlets.args[1];
  assert.strictEqual(assertTarballUrl(codexUrl, "Codex plugin MCP"), version);
  assert.strictEqual(codexUrl, expectedUrl, "Codex plugin MCP URL must match the current server version");

  return { version, expectedUrl };
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
}

function callTool(session, id, name, argumentsPayload) {
  session.send(id, "tools/call", { name, arguments: argumentsPayload });
}

module.exports = {
  REPO_ROOT,
  expectedTarballUrl,
  readServerVersion,
  assertPluginReleaseAlignment,
  assertStartPayload,
  assertRoutePayload,
  assertWorkflowGuidePayload,
  smokeAgentInterfaceTools,
};

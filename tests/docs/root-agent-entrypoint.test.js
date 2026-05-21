const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const files = ["CLAUDE.md", "AGENTS.md"];

for (const file of files) {
  const content = fs.readFileSync(path.join(ROOT, file), "utf-8");
  assert.ok(content.includes("## Designer Mode"), `${file} should define Designer Mode`);
  assert.ok(content.includes("Call the Figlets MCP tool `figlets_start` first"), `${file} should require figlets_start first`);
  assert.ok(content.includes("Use `figlets_start.designerResponse`"), `${file} should use the MCP-provided designer menu`);
  assert.ok(content.includes("If the designer already stated a concrete goal"), `${file} should route concrete requests instead of showing the menu`);
  assert.ok(content.includes("selectionPrompt"), `${file} should support structured selection prompts`);
  assert.ok(content.includes("Hard rule for reviews/checks/audits"), `${file} should make Figlets scripts mandatory for designer review`);
  assert.ok(content.includes("use the Figlets workflow and the Figlets MCP tools/scripts"), `${file} should forbid ad hoc design-system review paths`);
  assert.ok(content.includes("Bulk repair/update posture"), `${file} should define Figlets bulk repair posture`);
  assert.ok(content.includes("bulk design-system updates are in Figlets scope"), `${file} should keep bulk DS updates in Figlets scope`);
  assert.ok(content.includes("do not tell the designer the gaps cannot be fixed"), `${file} should avoid dead-end gap reporting`);
  assert.ok(content.includes("Only go outside the Figlets workflow when the designer explicitly asks you to go out of bounds"), `${file} should preserve an explicit out-of-bounds escape hatch`);
  assert.ok(content.includes("If `figlets_start` is not available"), `${file} should define missing-MCP behavior`);
  assert.ok(content.includes("I should not approximate this flow with raw Figma tools"), `${file} should reject raw-tool fallback`);
  assert.ok(content.includes("Do not read `memory/PROJECT_MEMORY.md`"), `${file} should block project memory before designer intro`);
  assert.ok(content.includes("Do not offer developer work"), `${file} should block developer options in designer mode`);
  assert.ok(content.includes("Architecture guardrail"), `${file} should require architecture awareness in Developer Mode`);
  assert.ok(content.includes("check the existing bulk-capable surfaces"), `${file} should tell developer agents to inspect existing surfaces before adding parallel repair paths`);
  assert.ok(content.includes("do not duplicate setup/update logic casually"), `${file} should discourage accidental divergent implementations`);
  assert.ok(content.includes("Plugin / MCP server code") === false, `${file} should not offer plugin code as a menu item`);
  assert.ok(content.includes("Check my design system"), `${file} should list designer menu items`);
  assert.ok(content.includes("Export DESIGN.md"), `${file} should list designer menu items`);
  assert.ok(content.includes("## Developer Mode"), `${file} should preserve a developer path`);
}

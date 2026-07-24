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
  assert.ok(content.includes("interpreted_workflow_id"), `${file} should pass the AI-interpreted canonical workflow id`);
  assert.ok(content.includes("designer's own language"), `${file} should make intent routing language-independent`);
  assert.ok(content.includes("do not rely on English keyword scoring"), `${file} should reserve keyword scoring for fallback`);
  assert.ok(content.includes("selectionPrompt"), `${file} should support structured selection prompts`);
  assert.ok(content.includes("Hard rule for reviews/checks/audits"), `${file} should make Figlets scripts mandatory for designer review`);
  assert.ok(content.includes("use the Figlets workflow and the Figlets MCP tools/scripts"), `${file} should forbid ad hoc design-system review paths`);
  assert.ok(content.includes("Bulk repair/update posture"), `${file} should define Figlets bulk repair posture`);
  assert.ok(content.includes("bulk design-system updates are in Figlets scope"), `${file} should keep bulk DS updates in Figlets scope`);
  assert.ok(content.includes("do not tell the designer the gaps cannot be fixed"), `${file} should avoid dead-end gap reporting`);
  assert.ok(content.includes("Only go outside the Figlets workflow when the designer explicitly asks you to go out of bounds"), `${file} should preserve an explicit out-of-bounds escape hatch`);
  assert.ok(content.includes("If `figlets_start` is not available"), `${file} should define missing-MCP behavior`);
  assert.ok(content.includes("I should not approximate this flow with raw Figma tools"), `${file} should reject raw-tool fallback`);
  assert.ok(
    content.includes("restart") && content.includes("figlets_start"),
    `${file} should tell designers to restart and verify figlets_start after setup`
  );
  assert.ok(content.includes("Do not read `memory/PROJECT_MEMORY.md`"), `${file} should block project memory before designer intro`);
  assert.ok(content.includes("Do not offer developer work"), `${file} should block developer options in designer mode`);
  assert.ok(content.includes("Architecture guardrail"), `${file} should require architecture awareness in Developer Mode`);
  assert.ok(content.includes("check the existing bulk-capable surfaces"), `${file} should tell developer agents to inspect existing surfaces before adding parallel repair paths`);
  assert.ok(content.includes("do not duplicate setup/update logic casually"), `${file} should discourage accidental divergent implementations`);
  assert.ok(content.includes("Plugin / MCP server code") === false, `${file} should not offer plugin code as a menu item`);
  assert.ok(content.includes("Check my design system"), `${file} should list designer menu items`);
  assert.ok(content.includes("Export DESIGN.md"), `${file} should list designer menu items`);
  assert.ok(content.includes("Generate Figma Make guidelines"), `${file} should list the Make guidelines workflow`);
  assert.ok(content.includes("## Developer Mode"), `${file} should preserve a developer path`);
  assert.ok(content.includes("repairPlan.optionalApplyInput"), `${file} should document optional bulk apply payloads`);
  assert.ok(content.includes("inspect_ds_token_gaps"), `${file} should route token completion through inspect_ds_token_gaps`);
  assert.ok(content.includes("fixableNow"), `${file} should document qa_binding_audit fixableNow apply boundary`);
  assert.ok(content.includes("effect_style_repairs"), `${file} should preserve exact raw elevation style findings through preview and apply`);
  assert.ok(content.includes("Linear task comments"), `${file} should define Linear task comment logging in Developer Mode`);
  assert.ok(content.includes("Status: started | checkpoint | review | completed | blocked"), `${file} should include the Linear comment template`);
  assert.ok(content.includes("paste-ready comment text"), `${file} should require paste-ready comments when Linear is unavailable`);
}

const genericEntrypoint = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf-8");
assert.ok(
  genericEntrypoint.includes("figlets-mcp setup --hosts=antigravity --yes") &&
    genericEntrypoint.includes("figlets-mcp setup --hosts=gemini --yes"),
  "AGENTS.md should give concrete setup commands for Gemini-family hosts when Figlets MCP is missing"
);
assert.ok(
  genericEntrypoint.includes("I can set it up for this host if you approve") &&
    genericEntrypoint.includes("you can run the setup command yourself"),
  "AGENTS.md should offer approved agent-run setup and self-service setup"
);
assert.ok(
  genericEntrypoint.includes("server named `figlets`") &&
    genericEntrypoint.includes("command `figlets-mcp`"),
  "AGENTS.md should include a generic fallback MCP server shape for non-packaged hosts"
);

const claudeEntrypoint = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf-8");
assert.ok(
  claudeEntrypoint.includes("figlets-mcp setup --yes") ||
    claudeEntrypoint.includes("figlets-mcp setup --hosts=claude-code-plugin --yes"),
  "CLAUDE.md should give a concrete Claude setup command when Figlets MCP is missing"
);

const developerGuide = fs.readFileSync(path.join(ROOT, "docs/developer-guide.md"), "utf-8");
assert.ok(developerGuide.includes("additive task comments"), "developer-guide should reference Linear task comment convention");
assert.ok(developerGuide.includes("AGENTS.md"), "developer-guide should point to AGENTS.md for the comment template");
assert.ok(
  !/planned `figlets_health_check`/i.test(developerGuide),
  "developer-guide should not describe figlets_health_check as planned-only"
);
assert.ok(
  developerGuide.includes("figlets_health_check"),
  "developer-guide should reference shipped figlets_health_check"
);

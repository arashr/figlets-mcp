const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const paths = [
  "AGENTS.md",
  "CLAUDE.md",
  "packages/figlets-adapter/AGENTS.md",
  "packages/figlets-adapter/CLAUDE.md",
  "plugins/claude-code/figlets/skills/figlets-designer/SKILL.md",
  "plugins/claude-code/figlets/commands/start.md",
  "plugins/codex/figlets/skills/figlets-designer/SKILL.md",
  "plugins/codex/figlets/commands/start.md",
  "packages/figlets-mcp-server/src/agent-interface/workflows.js",
];

const requiredPhrases = [
  "repairPlan.applyInput",
  "repairPlan.optionalApplyInput",
  "inspect_ds_token_gaps",
  "fixableNow",
  "byFixability",
  "custom scripts",
  "binding-audit",
];

for (const rel of paths) {
  const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
  for (const phrase of requiredPhrases) {
    assert.ok(content.includes(phrase), `${rel} should mention ${phrase}`);
  }
}

const workflows = fs.readFileSync(
  path.join(ROOT, "packages/figlets-mcp-server/src/agent-interface/workflows.js"),
  "utf8"
);
assert.ok(workflows.includes("id: \"token-gap-completion\""), "workflows should define token-gap-completion");
assert.ok(workflows.includes("bulkRepairRouting"), "workflows should expose bulkRepairRouting rules");

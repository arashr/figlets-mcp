const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const forbidden = [
  "prepare-broken-ds-fixture",
  "request-prepare-broken-ds-fixture",
  "broken fixture",
  "BNN-37",
];

const designerFiles = [
  "packages/figlets-mcp-server/src/agent-interface/workflows.js",
  "packages/figlets-mcp-server/src/tools/agent-interface.js",
  "plugins/claude-code/figlets/skills/figlets-designer/SKILL.md",
  "plugins/codex/figlets/skills/figlets-designer/SKILL.md",
  "plugins/claude-code/figlets/commands/start.md",
  "plugins/codex/figlets/commands/start.md",
  "plugins/claude-code/figlets/.claude-plugin/plugin.json",
  "plugins/codex/figlets/.codex-plugin/plugin.json",
];

for (const file of designerFiles) {
  const body = fs.readFileSync(path.join(root, file), "utf8");
  for (const term of forbidden) {
    assert.ok(!body.includes(term), `${file} must not expose developer-only fixture term ${term}`);
  }
}

const start = require("../../packages/figlets-mcp-server/src/tools/agent-interface.js").handleFigletsStart();
const startText = JSON.stringify(start);
for (const term of forbidden) {
  assert.ok(!startText.includes(term), `figlets_start must not expose developer-only fixture term ${term}`);
}

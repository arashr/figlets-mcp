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

const adapterPaths = [
  "packages/figlets-adapter/AGENTS.md",
  "packages/figlets-adapter/CLAUDE.md",
];
for (const rel of adapterPaths) {
  const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
  assert.ok(
    !/Broad typography and elevation remain product-gap scope/i.test(content),
    `${rel} should not treat broad typography/elevation apply as a product gap`
  );
  assert.ok(
    content.includes("broad `typography` / `elevation` orchestration"),
    `${rel} should document broad typography/elevation orchestration apply`
  );
  assert.ok(
    content.includes("primitive-shadow"),
    `${rel} should document primitive-shadow on update_ds_primitives`
  );
}

const developerGuide = fs.readFileSync(path.join(ROOT, "docs/developer-guide.md"), "utf8");
assert.ok(
  !/planned `figlets_health_check`/i.test(developerGuide),
  "developer-guide should not describe figlets_health_check as planned-only"
);
assert.ok(
  developerGuide.includes("figlets_health_check"),
  "developer-guide should reference shipped figlets_health_check"
);

const workflows = fs.readFileSync(
  path.join(ROOT, "packages/figlets-mcp-server/src/agent-interface/workflows.js"),
  "utf8"
);
assert.ok(workflows.includes("id: \"token-gap-completion\""), "workflows should define token-gap-completion");
assert.ok(workflows.includes("bulkRepairRouting"), "workflows should expose bulkRepairRouting rules");

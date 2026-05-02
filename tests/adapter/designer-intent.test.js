const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ADAPTER_DIR = path.resolve(__dirname, "../../packages/figlets-adapter");
const docs = [
  fs.readFileSync(path.join(ADAPTER_DIR, "AGENTS.md"), "utf-8"),
  fs.readFileSync(path.join(ADAPTER_DIR, "CLAUDE.md"), "utf-8")
];

for (const content of docs) {
  assert.ok(content.includes("## Intent Routing"), "Adapter docs should include designer intent routing");
  assert.ok(content.includes("Build a showcase of my design system"), "Adapter docs should route showcase intent");
  assert.ok(content.includes("do not move product logic into the prompt"), "Adapter docs should keep logic out of prompts");
  assert.ok(content.includes("Never modify plugin scripts, binding rules, QA rules, or generated output"), "Adapter docs should protect deterministic output logic");
  assert.ok(content.includes("Tool names are for internal clarity and debugging"), "Adapter docs should prefer designer-friendly language");
}

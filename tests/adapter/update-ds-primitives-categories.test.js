const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ADAPTER_DIR = path.resolve(__dirname, "../../packages/figlets-adapter");
const files = ["AGENTS.md", "CLAUDE.md"];

for (const file of files) {
  const content = fs.readFileSync(path.join(ADAPTER_DIR, file), "utf-8");
  const toolRow = content.match(/\|\s*`update_ds_primitives`\s*\|[^|]+\|[^|]+\|/);
  assert.ok(toolRow, `${file} should document update_ds_primitives in the tools table`);
  assert.ok(
    toolRow[0].includes("color-semantics"),
    `${file} update_ds_primitives row must mention color-semantics category`
  );
  assert.ok(
    /Today:\s*`color`,\s*`spacing`,\s*`color-semantics`/.test(content),
    `${file} primitive update workflow should list color, spacing, and color-semantics`
  );
}

const workflows = fs.readFileSync(
  path.join(__dirname, "../../packages/figlets-mcp-server/src/agent-interface/workflows.js"),
  "utf-8"
);
assert.ok(
  workflows.includes("color, spacing, and color-semantics"),
  "agent-interface bulk surfaces should name all update_ds_primitives categories"
);

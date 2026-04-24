const assert = require("assert");
const fs = require("fs");
const path = require("path");

const TOOLS_DIR = path.resolve(__dirname, "../../packages/figlets-mcp-server/src/tools");
const ADAPTER_DIR = path.resolve(__dirname, "../../packages/figlets-adapter");

const claudeMd = fs.readFileSync(path.join(ADAPTER_DIR, "CLAUDE.md"), "utf-8");
const agentsMd = fs.readFileSync(path.join(ADAPTER_DIR, "AGENTS.md"), "utf-8");

// Collect every tool name registered in the MCP server by reading tool definition files
const toolFiles = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith(".js"));

const registeredTools = toolFiles.flatMap(file => {
  const mod = require(path.join(TOOLS_DIR, file));
  return Object.values(mod)
    .filter(v => v && typeof v === "object" && typeof v.name === "string" && /^[a-z_]+$/.test(v.name))
    .map(v => v.name);
});

assert.ok(registeredTools.length > 0, "Should find at least one registered tool");

// Test: every registered tool name appears in both CLAUDE.md and AGENTS.md
for (const toolName of registeredTools) {
  assert.ok(
    claudeMd.includes(`\`${toolName}\``),
    `Tool '${toolName}' is registered in the MCP server but missing from CLAUDE.md`
  );
  assert.ok(
    agentsMd.includes(`\`${toolName}\``),
    `Tool '${toolName}' is registered in the MCP server but missing from AGENTS.md`
  );
}

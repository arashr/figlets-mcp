const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "claude-code");
const PLUGIN_DIR = path.join(PLUGIN_ROOT, "figlets");

function readJson(relativePath) {
  const full = path.join(PLUGIN_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(full, "utf-8"));
}

// Marketplace manifest.
const marketplace = readJson(".claude-plugin/marketplace.json");
assert.strictEqual(marketplace.name, "figlets-claude-code", "marketplace name must match published id");
assert.ok(marketplace.owner && marketplace.owner.name, "marketplace must declare an owner");
assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length >= 1, "marketplace must list at least one plugin");
const figletsEntry = marketplace.plugins.find(p => p.name === "figlets");
assert.ok(figletsEntry, "marketplace must list the figlets plugin");
assert.strictEqual(figletsEntry.source, "./figlets", "marketplace must point at the bundled figlets plugin folder");

// Plugin manifest.
const plugin = readJson("figlets/.claude-plugin/plugin.json");
assert.strictEqual(plugin.name, "figlets", "plugin name must be 'figlets' so the command surfaces as /figlets:start");
assert.ok(typeof plugin.version === "string" && plugin.version.length > 0, "plugin must declare a version");
assert.ok(typeof plugin.description === "string" && plugin.description.length > 0, "plugin must declare a description");

// MCP server contract.
assert.ok(plugin.mcpServers && plugin.mcpServers.figlets, "plugin must register a 'figlets' MCP server entry");
const server = plugin.mcpServers.figlets;
assert.strictEqual(server.command, "npx", "MCP command should be npx so designers do not need a global install");
assert.deepStrictEqual(server.args, ["-y", "@figlets/mcp-server"], "MCP args must invoke the published Figlets server package");

// Slash command file.
const commandPath = path.join(PLUGIN_DIR, "commands", "start.md");
const commandSource = fs.readFileSync(commandPath, "utf-8");
const frontmatterMatch = commandSource.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
assert.ok(frontmatterMatch, "start.md must have YAML frontmatter");
const [, frontmatter, body] = frontmatterMatch;
assert.ok(/description:/.test(frontmatter), "start.md frontmatter must include a description");
assert.ok(body.includes("figlets_start"), "start.md must instruct the agent to call figlets_start");
assert.ok(body.includes("designerResponse"), "start.md must direct the agent to use figlets_start.designerResponse");
assert.ok(/not approximate.*raw Figma/i.test(body), "start.md must forbid raw-Figma-tool fallback when Figlets is unavailable");
assert.ok(!/repo edit|plugin edit|developer/i.test(body) || /not.*developer-mode/i.test(body), "start.md must not offer developer-mode options");

// Plugin README sanity.
const readme = fs.readFileSync(path.join(PLUGIN_DIR, "README.md"), "utf-8");
assert.ok(readme.includes("/plugin marketplace add"), "plugin README must show the marketplace-add install step");
assert.ok(readme.includes("/figlets:start"), "plugin README must mention the /figlets:start command");

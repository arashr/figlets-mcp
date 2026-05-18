const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const PLUGIN_DIR = path.join(ROOT, "plugins", "codex", "figlets");

const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, ".agents", "plugins", "marketplace.json"), "utf-8"));
assert.strictEqual(marketplace.name, "figlets-codex", "Codex marketplace name must match the setup id");
assert.ok(marketplace.interface && marketplace.interface.displayName === "Figlets", "marketplace should have user-facing display metadata");
const figletsEntry = marketplace.plugins.find(p => p.name === "figlets");
assert.ok(figletsEntry, "marketplace must list the figlets plugin");
assert.strictEqual(figletsEntry.source.source, "local", "Codex marketplace currently uses a local source");
assert.strictEqual(figletsEntry.source.path, "./plugins/codex/figlets", "marketplace source must point at the Codex-specific plugin folder");
assert.strictEqual(figletsEntry.policy.installation, "AVAILABLE", "marketplace entry must include installation policy");
assert.strictEqual(figletsEntry.policy.authentication, "ON_INSTALL", "marketplace entry must include authentication policy");
assert.strictEqual(figletsEntry.category, "Design", "marketplace entry must include a category");

const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, ".codex-plugin", "plugin.json"), "utf-8"));
assert.strictEqual(plugin.name, "figlets", "plugin name must be 'figlets'");
assert.strictEqual(plugin.version, "0.1.0", "plugin version should track the server package version");
assert.strictEqual(plugin.skills, "./skills/", "plugin must expose the designer skill folder");
assert.strictEqual(plugin.mcpServers, "./.mcp.json", "plugin must expose MCP server config");
assert.ok(plugin.interface && plugin.interface.displayName === "Figlets", "plugin must include Codex interface metadata");
assert.ok(plugin.interface.defaultPrompt.some(prompt => /Figma design system/i.test(prompt)), "default prompts should be designer-facing");
assert.ok(!JSON.stringify(plugin).includes(osHome()), "plugin manifest must not leak the developer's home directory");

const mcp = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, ".mcp.json"), "utf-8"));
assert.ok(mcp.mcpServers && mcp.mcpServers.figlets, "plugin must register a figlets MCP server");
assert.strictEqual(mcp.mcpServers.figlets.command, "npx", "MCP command should be npx so designers do not need a global install");
assert.deepStrictEqual(mcp.mcpServers.figlets.args.slice(0, 1), ["-y"]);
assert.ok(
  /^https:\/\/github\.com\/arashr\/figlets-mcp\/releases\/download\/v\d+\.\d+\.\d+\/figlets-mcp-server-\d+\.\d+\.\d+\.tgz$/.test(mcp.mcpServers.figlets.args[1]),
  "MCP args must invoke the Figlets server via a versioned GitHub release tarball URL"
);

const commandSource = fs.readFileSync(path.join(PLUGIN_DIR, "commands", "start.md"), "utf-8");
assert.ok(commandSource.includes("figlets_start"), "start command must instruct the agent to call figlets_start");
assert.ok(commandSource.includes("designerResponse"), "start command must direct the agent to use figlets_start.designerResponse");
assert.ok(commandSource.includes("figlets_route_intent"), "start command must route concrete initial goals instead of showing the menu");
assert.ok(commandSource.includes("selectionPrompt"), "start command must support structured selection prompts for ambiguous goals");
assert.ok(/Use `figlets_start\.designerResponse` only for generic help\/start requests/i.test(commandSource), "start command must reserve the generic menu for generic help");
assert.ok(/design-system review[\s\S]*Figlets MCP tools\/scripts/i.test(commandSource), "start command must require Figlets tools/scripts for designer review");
assert.ok(/Do not create custom scripts/i.test(commandSource), "start command must forbid ad hoc scripts for designer review");
assert.ok(/explicitly ask.*go out of bounds/i.test(commandSource), "start command must allow out-of-bounds work only when explicitly requested");
assert.ok(/not approximate.*raw Figma/i.test(commandSource), "start command must forbid raw-Figma fallback when Figlets is unavailable");

const skillSource = fs.readFileSync(path.join(PLUGIN_DIR, "skills", "figlets-designer", "SKILL.md"), "utf-8");
const skillMatch = skillSource.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
assert.ok(skillMatch, "SKILL.md must have YAML frontmatter");
const [, skillFrontmatter, skillBody] = skillMatch;
assert.ok(/^name:\s*figlets-designer\s*$/m.test(skillFrontmatter), "skill frontmatter must declare name: figlets-designer");
assert.ok(/Figma design system/i.test(skillFrontmatter), "skill description must mention Figma design system");
assert.ok(/figlets_start/.test(skillFrontmatter), "skill description must mention routing to figlets_start");
assert.ok(skillBody.includes("figlets_start"), "skill body must instruct calling figlets_start");
assert.ok(skillBody.includes("designerResponse"), "skill body must direct the agent to use figlets_start.designerResponse");
assert.ok(skillBody.includes("figlets_route_intent"), "skill body must route concrete initial goals");
assert.ok(skillBody.includes("selectionPrompt"), "skill body must support structured selection prompts");
assert.ok(/Only use `figlets_start\.designerResponse` verbatim for generic help\/start requests/i.test(skillBody), "skill body must not show the generic menu for concrete goals");
assert.ok(/workflow guide is mandatory/i.test(skillBody), "skill body must make the workflow guide mandatory for designer review");
assert.ok(/do not write custom scripts/i.test(skillBody), "skill body must forbid ad hoc scripts for designer review");
assert.ok(/product\/tool gap/i.test(skillBody), "skill body must report missing Figlets data as a product/tool gap");
assert.ok(!/repo edit|plugin edit/i.test(skillBody) || /not.*developer-mode|do not offer developer-mode/i.test(skillBody), "skill body must not offer developer-mode options");
assert.ok(/setup --hosts=codex-plugin --yes/.test(skillBody), "skill body should point to the Codex setup target when Figlets is unavailable");

const readme = fs.readFileSync(path.join(PLUGIN_DIR, "README.md"), "utf-8");
assert.ok(readme.includes("figlets-mcp setup --hosts=codex-plugin --yes"), "plugin README must show the one-command setup path");
assert.ok(/local marketplace/i.test(readme), "plugin README must document the Codex local marketplace limitation");
assert.ok(readme.includes("figlets_start.designerResponse"), "plugin README must preserve the Figlets-curated first response contract");
assert.ok(!/Plugin \/ MCP server code|repo editing|plugin editing/i.test(readme), "plugin README must not offer developer-mode menu items");

function osHome() {
  return require("os").homedir();
}

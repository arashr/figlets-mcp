const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const PLUGIN_DIR = path.join(ROOT, "plugins", "claude-code", "figlets");

// Marketplace manifest lives at the REPO ROOT — Claude Code reads
// <repo-root>/.claude-plugin/marketplace.json strictly for `claude plugin marketplace add owner/repo`.
const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"), "utf-8"));
assert.strictEqual(marketplace.name, "figlets-claude-code", "marketplace name must match the install id");
assert.ok(marketplace.owner && marketplace.owner.name, "marketplace must declare an owner");
assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length >= 1, "marketplace must list at least one plugin");
const figletsEntry = marketplace.plugins.find(p => p.name === "figlets");
assert.ok(figletsEntry, "marketplace must list the figlets plugin");
assert.strictEqual(figletsEntry.source, "./plugins/claude-code/figlets", "marketplace source must resolve from the repo root to the nested plugin folder");
// The nested marketplace.json was removed; only the root one should exist.
assert.ok(!fs.existsSync(path.join(ROOT, "plugins", "claude-code", ".claude-plugin", "marketplace.json")), "nested plugins/claude-code/.claude-plugin/marketplace.json must not exist (superseded by the root manifest)");

// Plugin manifest.
const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), "utf-8"));
const { readProductVersion } = require("../../scripts/lib/product-version.js");
assert.strictEqual(plugin.name, "figlets", "plugin name must be 'figlets' so the command surfaces as /figlets:start");
assert.strictEqual(plugin.version, readProductVersion(), "plugin version must track the server package version");
assert.ok(typeof plugin.description === "string" && plugin.description.length > 0, "plugin must declare a description");

// MCP server contract — distributed as a GitHub release tarball, not an npm package (no npm account).
assert.ok(plugin.mcpServers && plugin.mcpServers.figlets, "plugin must register a 'figlets' MCP server entry");
const server = plugin.mcpServers.figlets;
assert.strictEqual(server.command, "npx", "MCP command should be npx so designers do not need a global install");
assert.strictEqual(server.args.length, 2, "MCP args should be ['-y', <tarball-url>]");
assert.strictEqual(server.args[0], "-y");
assert.ok(
  /^https:\/\/github\.com\/arashr\/figlets-mcp\/releases\/download\/v\d+\.\d+\.\d+\/figlets-mcp-server-\d+\.\d+\.\d+\.tgz$/.test(server.args[1]),
  "MCP args must invoke the Figlets server via a versioned GitHub release tarball URL"
);

// Slash command file.
const commandPath = path.join(PLUGIN_DIR, "commands", "start.md");
const commandSource = fs.readFileSync(commandPath, "utf-8");
const frontmatterMatch = commandSource.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
assert.ok(frontmatterMatch, "start.md must have YAML frontmatter");
const [, frontmatter, body] = frontmatterMatch;
assert.ok(/description:/.test(frontmatter), "start.md frontmatter must include a description");
assert.ok(body.includes("figlets_start"), "start.md must instruct the agent to call figlets_start");
assert.ok(body.includes("designerResponse"), "start.md must direct the agent to use figlets_start.designerResponse");
assert.ok(body.includes("figlets_route_intent"), "start.md must route concrete initial goals instead of showing the menu");
assert.ok(body.includes("selectionPrompt"), "start.md must support structured selection prompts for ambiguous goals");
assert.ok(/Use `figlets_start\.designerResponse` only for generic help\/start requests/i.test(body), "start.md must reserve the generic menu for generic help");
assert.ok(/design-system review[\s\S]*Figlets MCP tools\/scripts/i.test(body), "start.md must require Figlets tools/scripts for designer review");
assert.ok(/Do not create custom scripts/i.test(body), "start.md must forbid ad hoc scripts for designer review");
assert.ok(/bulk design-system updates as Figlets scope/i.test(body), "start.md must keep bulk DS updates in Figlets scope");
assert.ok(/exact `inspect_ds_setup_gaps\.repairPlan\.applyInput` object/i.test(body), "start.md must require exact setup repair applyInput handoff");
assert.ok(/Never replace `aliases` with counts/i.test(body), "start.md must forbid replacing aliases with summaries");
assert.ok(/schema validation rejects[\s\S]*rerun `inspect_ds_setup_gaps`/i.test(body), "start.md must recover from malformed setup repair payloads by reinspecting");
assert.ok(/do not end at "the gaps cannot be fixed"/i.test(body), "start.md must avoid dead-end bulk repair wording");
assert.ok(/explicitly ask.*go out of bounds/i.test(body), "start.md must allow out-of-bounds work only when explicitly requested");
assert.ok(/not approximate.*raw Figma/i.test(body), "start.md must forbid raw-Figma-tool fallback when Figlets is unavailable");
assert.ok(!/repo edit|plugin edit|developer/i.test(body) || /not.*developer-mode/i.test(body), "start.md must not offer developer-mode options");

// Auto-trigger skill file.
const skillPath = path.join(PLUGIN_DIR, "skills", "figlets-designer", "SKILL.md");
assert.ok(fs.existsSync(skillPath), "plugin must ship a figlets-designer skill so designer phrases auto-route to Figlets");
const skillSource = fs.readFileSync(skillPath, "utf-8");
const skillMatch = skillSource.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
assert.ok(skillMatch, "SKILL.md must have YAML frontmatter");
const [, skillFrontmatter, skillBody] = skillMatch;
assert.ok(/^name:\s*figlets-designer\s*$/m.test(skillFrontmatter), "skill frontmatter must declare name: figlets-designer");
const descriptionMatch = skillFrontmatter.match(/description:\s*(.+)/);
assert.ok(descriptionMatch, "skill frontmatter must declare a description");
const description = descriptionMatch[1];
assert.ok(/Figma design system/i.test(description), "skill description must mention Figma design system");
assert.ok(/figlets_start/.test(description), "skill description must mention routing to figlets_start so the agent knows the entrypoint");
assert.ok(skillBody.includes("figlets_start"), "skill body must instruct calling figlets_start");
assert.ok(skillBody.includes("designerResponse"), "skill body must direct the agent to use figlets_start.designerResponse");
assert.ok(skillBody.includes("figlets_route_intent"), "skill body must route concrete initial goals");
assert.ok(skillBody.includes("selectionPrompt"), "skill body must support structured selection prompts");
assert.ok(/Only use `figlets_start\.designerResponse` verbatim for generic help\/start requests/i.test(skillBody), "skill body must not show the generic menu for concrete goals");
assert.ok(/workflow guide is mandatory/i.test(skillBody), "skill body must make the workflow guide mandatory for designer review");
assert.ok(/do not write custom scripts/i.test(skillBody), "skill body must forbid ad hoc scripts for designer review");
assert.ok(/plan_ds_figma_operations/i.test(skillBody), "skill body must route exact high-level edits through the Figlets operations planner");
assert.ok(/bulk design-system updates as Figlets scope/i.test(skillBody), "skill body must keep bulk DS updates in Figlets scope");
assert.ok(/exact `repairPlan\.applyInput` object/i.test(skillBody), "skill body must require exact setup repair applyInput handoff");
assert.ok(/Never replace `aliases` with counts/i.test(skillBody), "skill body must forbid replacing aliases with summaries");
assert.ok(/schema validation rejects[\s\S]*rerun `inspect_ds_setup_gaps`/i.test(skillBody), "skill body must recover from malformed setup repair payloads by reinspecting");
assert.ok(skillBody.includes("repairPlan.optionalApplyInput"), "skill body must document optional bulk apply payloads");
assert.ok(skillBody.includes("inspect_ds_token_gaps"), "skill body must mention token-gap planner");
assert.ok(skillBody.includes("fixableNow"), "skill body must document binding-audit fixableNow boundary");
assert.ok(/gaps cannot be fixed as a dead end/i.test(skillBody), "skill body must avoid dead-end bulk repair wording");
assert.ok(!/repo edit|plugin edit/i.test(skillBody) || /not.*developer-mode|do not offer developer-mode/i.test(skillBody), "skill body must not offer developer-mode options");

// Plugin README sanity.
const readme = fs.readFileSync(path.join(PLUGIN_DIR, "README.md"), "utf-8");
assert.ok(readme.includes("figlets-mcp setup --hosts=claude-code-plugin"), "plugin README must show the one-command setup path");
assert.ok(readme.includes("/plugin marketplace add"), "plugin README must show the manual marketplace-add fallback");
assert.ok(readme.includes("/figlets:start"), "plugin README must mention the /figlets:start command");
assert.ok(readme.includes("figlets-designer"), "plugin README must mention the auto-triggering designer skill");

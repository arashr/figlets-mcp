# Figlets — Claude Code plugin

Designer-friendly entrypoint for the Figlets design-system toolkit. Installing this plugin:

- Registers the Figlets MCP server (`figlets_start`, `figlets_route_intent`, `figlets_workflow_guide`, and the rest of the toolkit).
- Adds a `/figlets:start` slash command that routes Claude Code into the Figlets designer workflow.
- Ships a `figlets-designer` skill that auto-triggers on phrases like *"help me with my design system"* so designers do not have to remember the slash command.

## Status: not yet a no-clone install

> [!IMPORTANT]
> The plugin manifest registers the Figlets MCP server as `npx -y @figlets/mcp-server`, but `@figlets/mcp-server` is **not yet published to npm**. Until it is, the plugin can only start its MCP server when the package is locally resolvable — either because you have this repo cloned with `npm install` run (the workspace symlink at `node_modules/@figlets/mcp-server` makes `npx` resolve it), or because you have applied the local-dev override below.
>
> The next release step is `npm publish` from `packages/figlets-mcp-server/`. The `prepack` script already bundles this marketplace into the tarball, so once published the plugin works on any machine with Node and Claude Code — no clone required.

## One-command install (from a clone)

From a clone of the `figlets-mcp` repo with `npm install` run:

```
node packages/figlets-mcp-server/bin/figlets-mcp.js setup --hosts=claude-code-plugin --yes
```

…or, once `@figlets/mcp-server` is installed via `npm i -g @figlets/mcp-server`:

```
figlets-mcp setup --hosts=claude-code-plugin --yes
```

That command runs `claude plugin marketplace add` and `claude plugin install` for you, detects existing state, removes any legacy `figlets` MCP entries the plugin supersedes, and is idempotent. Restart Claude Code afterwards.

## Manual install

If you would rather drive Claude Code directly:

```
/plugin marketplace add /absolute/path/to/figlets-mcp/plugins/claude-code
/plugin install figlets@figlets-claude-code
```

Restart the Claude Code session, then either type:

```
/figlets:start
```

…or just describe what you want — *"help me with my Figma design system"* — and the `figlets-designer` skill will route you in.

## Requirements

- Claude Code with `claude plugin` support.
- Node.js and `npx` on `PATH`.
- The `@figlets/mcp-server` package locally resolvable — see the *Status* callout above and the *Local development override* below.

## Local development override

Until `@figlets/mcp-server` is published to npm and you do not have the repo cloned, replace the `mcpServers.figlets` entry in `.claude-plugin/plugin.json` with an absolute path to a local checkout:

```json
"mcpServers": {
  "figlets": {
    "command": "node",
    "args": ["/absolute/path/to/figlets-mcp/packages/figlets-mcp-server/bin/figlets-mcp.js"]
  }
}
```

Do not commit that override — it is machine-specific. The committed manifest tracks the eventual published target.

## What gets installed

- `commands/start.md` → the `/figlets:start` slash command (designer types this explicitly).
- `skills/figlets-designer/SKILL.md` → auto-trigger skill bound to designer phrases. Forbids developer-mode options and raw-Figma-tool fallback in line with root `CLAUDE.md`.
- `mcpServers.figlets` → the Figlets MCP server, registered as `plugin:figlets:figlets` when the plugin is enabled.

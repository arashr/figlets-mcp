# Figlets — Claude Code plugin

Designer-friendly entrypoint for the Figlets design-system toolkit. Installing this plugin:

- Registers the Figlets MCP server (`figlets_start`, `figlets_route_intent`, `figlets_workflow_guide`, and the rest of the toolkit).
- Adds a `/figlets:start` slash command that routes Claude Code into the Figlets designer workflow.
- Ships a `figlets-designer` skill that auto-triggers on phrases like *"help me with my design system"* so designers do not have to remember the slash command.

## One-command install (recommended)

From a clone of the `figlets-mcp` repo:

```
node packages/figlets-mcp-server/bin/figlets-mcp.js setup --hosts=claude-code-plugin --yes
```

…or, once `@figlets/mcp-server` is installed via `npm i -g @figlets/mcp-server`:

```
figlets-mcp setup --hosts=claude-code-plugin --yes
```

That command runs `claude plugin marketplace add` and `claude plugin install` for you, detects existing state, and is idempotent. Restart Claude Code afterwards.

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

The plugin's MCP server entry runs `npx -y @figlets/mcp-server`. That requires:

- Node.js and `npx` on `PATH`.
- The `@figlets/mcp-server` package to be reachable. While that package is unpublished, use the local-dev override below.

## Local development override

Until `@figlets/mcp-server` is published to npm, replace the `mcpServers.figlets` entry in `.claude-plugin/plugin.json` with an absolute path to this checkout, e.g.:

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
- `mcpServers.figlets` → the Figlets MCP server, registered as `figlets` when the plugin is enabled.

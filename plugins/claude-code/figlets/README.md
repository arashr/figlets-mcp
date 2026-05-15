# Figlets — Claude Code plugin

Designer-friendly entrypoint for the Figlets design-system toolkit. Installing this plugin:

- Registers the Figlets MCP server (`figlets_start`, `figlets_route_intent`, `figlets_workflow_guide`, and the rest of the toolkit).
- Adds a `/figlets:start` slash command that routes Claude Code into the Figlets designer workflow.
- Ships a `figlets-designer` skill that auto-triggers on phrases like *"help me with my design system"* so designers do not have to remember the slash command.

## How distribution works (no npm account)

This plugin is **agent-agnostic-friendly**: the Figlets toolkit itself lives in the main repo and is shared by every agent. Only this thin Claude integration lives under `plugins/claude-code/`.

- The marketplace manifest is at the **repo root** (`<repo>/.claude-plugin/marketplace.json`) because Claude Code only reads it from there. It just redirects to `./plugins/claude-code/figlets`.
- The MCP server is **not** published to npm. Instead the manifest runs `npx -y <GitHub release tarball URL>`. `npx` downloads that tarball and resolves dependencies from the public npm registry (registry reads are free and need no login).

> [!IMPORTANT]
> The server tarball must be attached to a GitHub release before this works for anyone. Build it with `npm run build:server-tarball` (from the repo root) and follow the printed steps to create the `v0.1.0` release on `github.com/arashr/figlets-mcp`. Until that release exists, use the *Local development override* below.

## One-command install

```
figlets-mcp setup --hosts=claude-code-plugin --yes
```

That runs `claude plugin marketplace add arashr/figlets-mcp --sparse .claude-plugin plugins/claude-code` + `claude plugin install figlets@figlets-claude-code`, is idempotent, and removes any legacy `figlets` MCP entries the plugin supersedes. Restart Claude Code afterwards.

For local development before the GitHub repo is pushed, point setup at the repo root instead:

```
FIGLETS_MARKETPLACE_SOURCE=/absolute/path/to/figlets-mcp figlets-mcp setup --hosts=claude-code-plugin --yes
```

## Manual install

```
/plugin marketplace add arashr/figlets-mcp --sparse .claude-plugin plugins/claude-code
/plugin install figlets@figlets-claude-code
```

Restart the Claude Code session, then either type `/figlets:start` or just describe what you want — *"help me with my Figma design system"* — and the `figlets-designer` skill will route you in.

## Local development override

Until the `v0.1.0` GitHub release exists, the `npx -y <tarball-url>` command in `.claude-plugin/plugin.json` cannot resolve. For local testing, replace `mcpServers.figlets` with an absolute path to your checkout:

```json
"mcpServers": {
  "figlets": {
    "command": "node",
    "args": ["/absolute/path/to/figlets-mcp/packages/figlets-mcp-server/bin/figlets-mcp.js"]
  }
}
```

Do not commit that override — it is machine-specific. The committed manifest tracks the GitHub release target.

## What gets installed

- `commands/start.md` → the `/figlets:start` slash command (designer types this explicitly).
- `skills/figlets-designer/SKILL.md` → auto-trigger skill bound to designer phrases. Forbids developer-mode options and raw-Figma-tool fallback in line with root `CLAUDE.md`.
- `mcpServers.figlets` → the Figlets MCP server, registered as `plugin:figlets:figlets` when the plugin is enabled.

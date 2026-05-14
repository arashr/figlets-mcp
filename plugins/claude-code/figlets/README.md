# Figlets — Claude Code plugin

Designer-friendly entrypoint for the Figlets design-system toolkit. Installing this plugin:

- Registers the Figlets MCP server (`figlets_start`, `figlets_route_intent`, `figlets_workflow_guide`, and the rest of the toolkit).
- Adds a `/figlets:start` slash command that routes Claude Code into the Figlets designer workflow.

## Install

Once the marketplace is available (this repo serves as its own marketplace during local development):

```
/plugin marketplace add /absolute/path/to/figlets-mcp/plugins/claude-code
/plugin install figlets@figlets-claude-code
```

Restart the Claude Code session, then type:

```
/figlets:start
```

## Requirements

The plugin's MCP server entry runs `npx -y @figlets/mcp-server`. That requires:

- Node.js and `npx` on `PATH`.
- The `@figlets/mcp-server` package to be reachable. While that package is unpublished, point the manifest at a local install instead — see *Local development override* below.

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

## What `/figlets:start` does

Sends a designer-intent prompt that asks the agent to call `figlets_start` and respond with the curated Figlets capability menu (check / fix / set up / showcase / document / export). The plugin intentionally does **not** expose developer-mode options.

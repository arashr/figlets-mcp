# MCP Config Examples

How to wire `figlets-mcp` into your AI agent host.

> [!NOTE]
> The MCP server uses **stdio transport** — the host spawns the process and communicates over stdin/stdout. You do not need to run a separate server manually.

---

## Claude Desktop

Add the following to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "figlets": {
      "command": "node",
      "args": ["/Users/<you>/Projects/figlets-mcp/packages/figlets-mcp-server/src/index.js"]
    }
  }
}
```

Restart Claude Desktop after saving. You should see the figlets tools available in the tool picker.

---

## Cursor

Add the following to `.cursor/mcp.json` in your project root (or the global Cursor settings):

```json
{
  "mcpServers": {
    "figlets": {
      "command": "node",
      "args": ["/Users/<you>/Projects/figlets-mcp/packages/figlets-mcp-server/src/index.js"]
    }
  }
}
```

---

## Available Tools

Once connected, the agent will have access to:

| Tool | Description |
|---|---|
| `sync_figma_data` | Triggers the Figma bridge plugin to extract and save the full design system snapshot. Blocks until complete. |
| `inspect_component` | Grabs the currently selected Figma node(s) and returns their structure, layout, and variant properties. |
| `detect_design_system` | Analyzes a saved Figma data snapshot and returns a structured design system summary. |

---

## Prerequisites

Both workflows require the local bridge receiver to be running first:

```bash
# Start the bridge receiver (keep this running in the background)
npm run start -w @figlets/figma-bridge-plugin
```

Then open the **Figlets Bridge** plugin in Figma Desktop (run in development mode from `packages/figma-bridge-plugin/manifest.json`). The plugin will show "Listening for Agent" when it is ready.

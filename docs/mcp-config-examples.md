# MCP Config Examples

How to wire `figlets-mcp` into your AI agent host.

> [!NOTE]
> The server speaks the standard MCP protocol over **stdio** — every host below uses the same binary. No agent-specific code is needed.

## Quick Install

From the repo root, link the server globally so every agent can find it by name:

```bash
npm link --workspace=@figlets/mcp-server
```

After linking, `figlets-mcp` is available as a global command. All configs below use it this way — no absolute paths needed.

---

## Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "figlets": {
      "command": "figlets-mcp"
    }
  }
}
```

Restart Claude Desktop after saving.

---

## Cursor

File: `.cursor/mcp.json` in your project root (or global Cursor settings):

```json
{
  "mcpServers": {
    "figlets": {
      "command": "figlets-mcp"
    }
  }
}
```

---

## Windsurf

File: `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "figlets": {
      "command": "figlets-mcp"
    }
  }
}
```

---

## VS Code (GitHub Copilot)

File: `.vscode/mcp.json` in your project root:

```json
{
  "servers": {
    "figlets": {
      "type": "stdio",
      "command": "figlets-mcp"
    }
  }
}
```

---

## Codex CLI (OpenAI)

File: `~/.codex/config.toml` (global) or `.codex/config.toml` (project):

```toml
[[mcp_servers]]
name = "figlets"
command = "figlets-mcp"
```

Or in JSON format if your version of Codex uses `config.json`:

```json
{
  "mcpServers": {
    "figlets": {
      "command": "figlets-mcp"
    }
  }
}
```

---

## Gemini CLI

File: `~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "figlets": {
      "command": "figlets-mcp"
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
| `inspect_component` | Grabs the currently selected Figma node(s) and returns structure, layout, and variant properties. |
| `detect_design_system` | Analyzes a saved snapshot and returns a structured design system summary. |
| `audit_tokens` | Audits the snapshot for unaliased values, duplicate values, and naming inconsistencies. |
| `qa_binding_audit` | Audits selected Figma layers for raw/unbound design-system properties and can apply safe high-confidence fixes. |
| `build_ds_showcase` | Builds the visual token showcase in Figma. |
| `create_ds_config_from_design_md` | Creates a starter design-system config from an existing Google DESIGN.md file. |
| `prepare_ds_config` | Previews and validates a design-system config before building variables. |
| `apply_ds_setup` | Builds Figma variable collections from a prepared config. |
| `generate_component_doc` | Builds a component spec sheet in Figma and returns local markdown for developer handoff. |

---

## Prerequisites

The MCP server starts the local bridge receiver automatically. Designers normally only need to open the **Figlets Bridge** plugin in Figma Desktop and keep it open while the agent works. The plugin will show **"Listening for Agent"** when ready.

```bash
# Optional health check for setup/debugging
figlets-mcp doctor
```

For local development or debugging, the receiver can still be started manually:

```bash
npm run start -w @figlets/figma-bridge-plugin
```

`detect_design_system` and `audit_tokens` can also work offline if `.local/figma-data.json` already exists from a previous sync.

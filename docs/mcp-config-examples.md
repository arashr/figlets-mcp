# MCP Config Examples

How to wire `figlets-mcp` into your AI agent host.

> [!NOTE]
> The server speaks the standard MCP protocol over **stdio** — every host below uses the same binary. No agent-specific code is needed.

## Quick Install

For normal use, install the released Figlets command from the GitHub release tarball:

```bash
npm install -g https://github.com/arashr/figlets-mcp/releases/download/v1.1.1/figlets-mcp-server-1.1.1.tgz
```

For local development from this repo checkout, link the server globally instead:

```bash
npm link --workspace=@figlets/mcp-server
```

After either install, `figlets-mcp` is available as a global command. Raw MCP host configs below use it this way — no absolute paths needed.

To preview agent config updates without changing files:

```bash
figlets-mcp setup
```

For local designer-experience testing from a repo checkout, use the launcher:

```bash
figlets-mcp launch
```

It writes the project-local Claude Code MCP config, previews the exact designer menu, checks bridge status, and prints the prompt to send in Claude Code.

To let Figlets patch supported MCP configs after reviewing the dry run:

```bash
figlets-mcp setup --yes
```

### Claude Code plugin path

For Claude Code, the Figlets plugin registers the MCP server, adds a `/figlets:start` slash command, and ships an auto-trigger `figlets-designer` skill so designer phrases route into Designer Mode automatically:

```bash
figlets-mcp setup --hosts=claude-code-plugin --yes
```

Behind the scenes that runs `claude plugin marketplace add arashr/figlets-mcp --sparse .claude-plugin plugins/claude-code` + `claude plugin install figlets@figlets-claude-code`, is idempotent on re-run, re-points the marketplace if its source changed, and — only after a smoke check confirms the plugin's MCP server is actually reachable — removes any pre-existing user/project/local-scope `figlets` MCP entries that the plugin supersedes. If the server is not reachable, setup leaves existing config intact and reports why, so a designer with a working setup is never migrated into a broken one. After a session restart, designers can either type `/figlets:start` or just describe their design system.

The plugin is distributed from the public GitHub repo (`arashr/figlets-mcp`), and the plugin's MCP server runs via `npx -y <GitHub release tarball URL>` — no npm account or npm publish is involved. Before this works for anyone, the server tarball must be attached to a GitHub release: run `npm run build:server-tarball` from the repo root and follow the printed `gh release` step.

> Local development before the release exists: `FIGLETS_MARKETPLACE_SOURCE=/path figlets-mcp setup --hosts=claude-code-plugin` only changes where Claude Code fetches the plugin *files* — the plugin still launches its MCP server from the pinned GitHub release tarball URL, so the server will not start until the release is published or the plugin manifest is manually overridden. For everyday pre-release local development, use the legacy path below (`figlets-mcp setup --hosts=claude-code --yes`); it registers the local server directly and works immediately.

When `claude` is on `PATH`, this plugin path is also what the default `figlets-mcp setup --yes` runs for Claude Code — the legacy `claude mcp add` path below is dropped from defaults via supersession in that case.

### Claude Code (legacy fallback)

For environments that cannot run the plugin path (older Claude Code without `claude plugin marketplace add`, or hosts that consume only raw MCP config), the legacy `claude mcp add` path is still reachable:

```bash
figlets-mcp setup --hosts=claude-code --yes
```

This uses Claude's native user-scope MCP command with the current Node executable and the local `figlets-mcp.js` binary. If Claude reports a stale existing `figlets` entry, setup removes Figlets entries from Claude Code's local/project/user scopes and re-adds the user-scope entry. The setup command backs up existing config files before writing, preserves unrelated MCP servers, and uses `"command": "figlets-mcp"` instead of machine-specific paths for the JSON/TOML configs of every other host.

To check the local bridge after your MCP host has started Figlets:

```bash
figlets-mcp doctor
```

`doctor` may report the bridge receiver as not running immediately after setup. That is expected until an MCP host starts the Figlets server.

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

### Codex plugin path

For Codex, the Codex plugin package registers the Figlets MCP server through the plugin's `.mcp.json` and ships the `figlets-designer` skill so designer phrases route into the Figlets-curated capability menu.

This path currently uses a local Codex plugin marketplace, so run it from a `figlets-mcp` repo checkout or set `FIGLETS_CODEX_MARKETPLACE_SOURCE` to that checkout:

```bash
figlets-mcp setup --hosts=codex-plugin --yes
```

Setup registers this repo checkout as a local `figlets-codex` marketplace in `~/.codex/config.toml` and enables `figlets@figlets-codex`. Restart Codex afterwards, then ask: `Help me with my Figma design system using Figlets.`

Codex has a local plugin manifest/marketplace convention (`.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, `skills/`, and `.mcp.json`), but this repo does not assume a public Codex marketplace install command equivalent to Claude Code's `plugin marketplace add owner/repo`. If Codex adds one later, Figlets should move setup to that path while preserving the same designer contract.

### Codex raw MCP fallback

For local development, prefer setup so Codex does not depend on a shell-only NVM/Homebrew PATH:

```bash
figlets-mcp setup --hosts=codex --yes
```

Setup writes the current Node executable plus the local Figlets server bin. The resulting `~/.codex/config.toml` looks like:

```toml
[mcp_servers.figlets]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/figlets-mcp/packages/figlets-mcp-server/bin/figlets-mcp.js"]
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

You can also let Figlets write this for you:

```bash
figlets-mcp setup --hosts=gemini --yes
```

---

## Google Antigravity

Antigravity stores custom MCP servers in `~/.gemini/antigravity/mcp_config.json`.

The easiest setup is:

```bash
figlets-mcp setup --hosts=antigravity --yes
```

Restart Antigravity after setup. If you want to inspect or edit the file manually, open the Agent panel menu, choose **Manage MCP Servers**, then **View raw config**. The config should contain:

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
| `figlets_start` | Returns the Agent Interface intro, safety contract, runtime environment hints, capability menu, and first designer-facing question. |
| `figlets_route_intent` | Routes a designer's natural-language request to the most likely Figlets workflow. |
| `figlets_workflow_guide` | Returns workflow steps, read/write boundaries, confirmation points, recovery notes, and safe next flows. |
| `sync_figma_data` | Triggers the Figma bridge plugin to extract and save the full design system snapshot. Blocks until complete. |
| `inspect_component` | Grabs the currently selected Figma node(s) and returns structure, layout, and variant properties. |
| `detect_design_system` | Analyzes a saved snapshot and returns a structured design system summary. |
| `audit_tokens` | Audits the snapshot for unaliased values, duplicate values, and naming inconsistencies. |
| `qa_binding_audit` | Audits selected Figma layers for raw/unbound design-system properties and can apply safe high-confidence fixes. |
| `build_ds_showcase` | Builds the visual token showcase in Figma. |
| `create_ds_config_from_intake` | Creates a file-scoped local design-system config from completed setup intake answers without mutating Figma. |
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

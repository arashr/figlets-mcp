# Figlets — Codex plugin

Designer-friendly entrypoint for the Figlets design-system toolkit in Codex. Installing this plugin:

- Registers the Figlets MCP server (`figlets_start`, `figlets_route_intent`, `figlets_workflow_guide`, and the rest of the toolkit).
- Ships a `figlets-designer` skill that auto-triggers on phrases like *"help me with my design system"* so designers do not have to remember tool names.
- Keeps the first response curated by Figlets through `figlets_start.designerResponse`.

## Install

```bash
figlets-mcp setup --hosts=codex-plugin --yes
```

Restart Codex afterwards. Then ask:

```text
Help me with my Figma design system using Figlets.
```

Setup registers this repo checkout as the local `figlets-codex` marketplace in `~/.codex/config.toml` and enables `figlets@figlets-codex`.

## Distribution note

Codex has a plugin manifest and local marketplace convention (`.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, `skills/`, and `.mcp.json`), but this repo does not rely on an observed public Codex marketplace install command. The reliable setup path is local-marketplace registration through `figlets-mcp setup`.

The plugin MCP server runs `npx -y <GitHub release tarball URL>`, the same npm-free release tarball used by the Claude Code plugin. The tarball must be attached to the matching GitHub release before the plugin can start the MCP server outside local development.

## Designer contract

The plugin does not invent a Codex-specific workflow. It routes to the shared Figlets Agent Interface:

1. Call `figlets_start` first.
2. Use `figlets_start.designerResponse` as the opening capability menu.
3. After the designer picks a goal, call `figlets_route_intent`, then `figlets_workflow_guide`.
4. Run read-only QA before mutation.
5. Ask for explicit approval before any Figma write.
6. Apply changes only through known Figlets tools.

If `figlets_start` is unavailable, stop the designer flow and tell the user Figlets is not connected. Do not approximate Figlets with raw Figma tools.

# Figlets Codex plugin package

This folder contains the Codex-specific wrapper for Figlets. The deterministic design-system logic stays in the shared MCP server; the Codex package only supplies local plugin metadata, MCP registration, and designer-facing routing instructions.

Use:

```bash
figlets-mcp setup --hosts=codex-plugin --yes
```

Then restart Codex and ask: `Help me with my Figma design system using Figlets.`

Codex currently uses a local plugin marketplace entry rather than the Claude Code `plugin marketplace add owner/repo` flow. Setup registers this repo checkout as the local `figlets-codex` marketplace in `~/.codex/config.toml` and enables `figlets@figlets-codex`. If Codex adds a public marketplace install command later, this package should move to that path without changing the designer contract.

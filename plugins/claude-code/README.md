# Figlets — Claude Code marketplace

This folder is a Claude Code plugin marketplace. It currently ships one plugin:

- [`figlets/`](./figlets) — designer-friendly entrypoint that registers the Figlets MCP server and adds `/figlets:start`.

Install locally with:

```
/plugin marketplace add /absolute/path/to/figlets-mcp/plugins/claude-code
/plugin install figlets@figlets-claude-code
```

Sibling agent marketplaces (Cursor, Windsurf, etc.) belong at `plugins/<agent>/`, not inside this folder.

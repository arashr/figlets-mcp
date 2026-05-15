# plugins/claude-code

The Claude Code integration for the Figlets toolkit. This folder is intentionally isolated: the
Figlets toolkit itself (in `packages/`) is agent-agnostic, and this is just the Claude-specific
wrapper. Sibling integrations for other agents would live at `plugins/<agent>/`.

- [`figlets/`](./figlets) — the plugin: `/figlets:start` command, `figlets-designer` auto-trigger
  skill, and the `mcpServers.figlets` entry that launches the Figlets MCP server.

The Claude Code **marketplace manifest is not here** — it lives at the repo root
(`<repo>/.claude-plugin/marketplace.json`) because `claude plugin marketplace add owner/repo`
only reads it from the repository root. That manifest's plugin `source` redirects here
(`./plugins/claude-code/figlets`), so all real Claude content stays in this folder.

Install (once the GitHub repo + `v0.1.0` release exist):

```
claude plugin marketplace add arashr/figlets-mcp --sparse .claude-plugin plugins/claude-code
claude plugin install figlets@figlets-claude-code
```

…or just run `figlets-mcp setup --hosts=claude-code-plugin --yes`.

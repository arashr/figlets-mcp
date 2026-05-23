# plugins/claude-code

The Claude Code integration for the Figlets toolkit. This folder is intentionally isolated. The Figlets toolkit itself (in `packages/`) is agent-agnostic, and this is the Claude-specific wrapper. Sibling integrations for other agents live at `plugins/<agent>/`.

- [`figlets/`](./figlets): the plugin with `/figlets:start` command, `figlets-designer` auto-trigger skill, and the `mcpServers.figlets` entry that launches the Figlets MCP server.

The Claude Code **marketplace manifest is not here**. It lives at the repo root (`<repo>/.claude-plugin/marketplace.json`) because `claude plugin marketplace add owner/repo` only reads it from the repository root. That manifest's plugin `source` redirects here (`./plugins/claude-code/figlets`), so all real Claude content stays in this folder.

Install (once the GitHub repo and a tagged release with the server tarball exist):

```
claude plugin marketplace add arashr/figlets-mcp --sparse .claude-plugin plugins/claude-code
claude plugin install figlets@figlets-claude-code
```

Or run `figlets-mcp setup --hosts=claude-code-plugin --yes`.

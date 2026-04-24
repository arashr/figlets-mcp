# figlets-adapter

Agent orchestration prompts for figlets-mcp. Works with any MCP-compatible agent.

## What's here

| File | Picked up by |
|------|-------------|
| `CLAUDE.md` | Claude Code (auto-loaded from project directory) |
| `AGENTS.md` | Codex CLI (auto-loaded from project directory) |

Both files contain the same workflows and rules. Only the header differs. Update one, update both.

## How to use

Copy or symlink the relevant file to your project root so the agent picks it up automatically:

```bash
# Claude Code
cp packages/figlets-adapter/CLAUDE.md ./CLAUDE.md

# Codex CLI
cp packages/figlets-adapter/AGENTS.md ./AGENTS.md
```

Or paste the contents into your agent's system prompt / custom instructions for runtimes that don't auto-load project files (e.g. Claude Desktop).

## What it does

Defines four workflows the agent should follow when using figlets-mcp tools:
- **Detect design system** — sync + analyze collections, variables, styles
- **Inspect component** — trigger selection extraction, summarize structure
- **Audit tokens** — surface unaliased values, duplicates, naming issues
- **Full health check** — sync → detect → audit in one pass

All analysis happens inside the MCP tools. The adapter handles intake, ambiguity, and presentation only.

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

Defines designer-facing intent routes and workflows the agent should follow when using figlets-mcp tools:

- **Detect design system:** sync and analyze collections, variables, styles
- **Inspect component:** trigger selection extraction, summarize structure
- **Audit tokens:** surface token hygiene issues while treating primitives as neutral inventory
- **QA binding audit:** check selected Figma work for raw/unbound values
- **Build token showcase:** render the DS showcase in Figma
- **Set up a design system:** preview and build variable collections from config
- **Document a component:** generate a Figma spec sheet and markdown handoff with component variants, bound variable-mode previews, boolean states, conditional layers, visual state previews, and implementation bindings
- **Full health check:** sync, detect, audit, semantic setup/accessibility QA, and approved repair in one flow

All analysis and output generation happens inside the MCP tools and bridge plugin. The adapter handles intent routing, intake, ambiguity, confirmation, and presentation only.

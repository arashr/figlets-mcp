# Figlets Claude entrypoint

This repo supports two very different modes. Choose the mode from the user's request before reading project memory or exploring files.

## Designer Mode

Use Designer Mode when the user is trying the Figlets product experience or asks for help with their Figma design system as a designer, for example:

- "Help me with my Figma design system"
- "What can Figlets do?"
- "Check/fix/setup/document/export my design system"
- "I want to try the Figlets experience"

In Designer Mode:

1. Call the Figlets MCP tool `figlets_start` first.
2. Use `figlets_start.designerResponse` as the opening response whenever possible.
3. Preserve the capability-menu shape.
4. Do not read `memory/PROJECT_MEMORY.md`, `DECISIONS.md`, source files, or package docs before the first designer response.
5. Do not offer developer work such as repo editing, plugin editing, MCP server changes, or generic Figma console actions.
6. Do not mention `figma-console`, raw tool names, project guardrails, codebase details, or implementation notes unless the designer asks.
7. If the designer already stated a concrete goal, call `figlets_route_intent`, then `figlets_workflow_guide`, and use the routed response instead of showing the generic menu or asking what they want to do.
8. If routing returns a `selectionPrompt`, use a single-choice selection UI when the host supports it; otherwise render `selectionPrompt.message`.
9. After the designer picks a goal, call `figlets_route_intent`, then `figlets_workflow_guide`, then follow that workflow.
10. Inspect before changing anything, summarize in plain language, and ask before any Figma write.

Hard rule for reviews/checks/audits: use the Figlets workflow and the Figlets MCP tools/scripts named by `figlets_workflow_guide`. Do not write or run custom scripts over Figma snapshots, MCP transcripts, `tool-results`, local `.local/.../figma-data.json` files, or raw Figma APIs to perform the designer-facing review. If a Figlets tool does not expose the needed information, say that this is a Figlets product/tool gap. Only go outside the Figlets workflow when the designer explicitly asks you to go out of bounds.

If `figlets_start` is not available, stop the designer workflow and say:

> "Figlets is not connected in this Claude Code session yet. To use the Figlets designer flow, run `figlets-mcp setup --yes` (which installs the Figlets Claude Code plugin when `claude` is on `PATH`), restart Claude Code, then ask me again. I should not approximate this flow with raw Figma tools."

Do not offer to proceed with raw `figma-console`, generic Figma MCP tools, repo inspection, or project-memory summaries as a substitute for Figlets.

The designer-facing menu must stay limited to Figlets workflows:

- Check my design system
- Set up a new design system
- Build a token showcase
- Document a component
- Export DESIGN.md

## Developer Mode

Use Developer Mode only when the user asks to edit this repository, debug code, run tests, implement features, review changes, or otherwise work as a developer.

In Developer Mode, read `memory/PROJECT_MEMORY.md`, `DECISIONS.md`, and the relevant source files before editing.

## Default

If the request is ambiguous but mentions Figlets as a product or a Figma design system, default to Designer Mode.

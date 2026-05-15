---
name: figlets-designer
description: Designer entrypoint for the Figlets MCP toolkit in Codex. Use this whenever the user wants help with their Figma design system, mentions Figlets, or asks about checking, fixing, setting up, documenting, or exporting a design system. Triggers on phrases like "help me with my Figma design system", "check my design system", "fix setup gaps", "set up a new design system", "build a token showcase", "document a component", "export DESIGN.md", "what can Figlets do", or "I want to try Figlets". Routes to figlets_start so the Figlets-curated capability menu opens. Do not auto-trigger for repo edits, plugin debugging, MCP server changes, or generic Figma authoring requests — those are developer-mode tasks.
---

Call the `figlets_start` MCP tool first, then reply using its `designerResponse` verbatim.

Preserve the capability-menu shape and do not offer developer-mode options (no repo editing, no plugin editing, no raw Figma authoring, no generic `figma-console` actions). Do not read project memory, repo source, or package docs before that first designer response.

After the designer picks a goal, call `figlets_route_intent`, then `figlets_workflow_guide`, and follow the steps in that workflow. Inspect before changing anything, summarize in plain language, and ask for explicit approval before any Figma write.

If `figlets_start` is not available in this session, stop and tell the user Figlets is not connected yet — do not approximate the flow with raw Figma tools. The fix is to run `figlets-mcp setup --hosts=codex-plugin --yes`, restart Codex, then ask again.

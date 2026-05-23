---
name: figlets-designer
description: Designer entrypoint for the Figlets MCP toolkit. Use this whenever the user wants help with their Figma design system, mentions Figlets, or asks about checking, fixing, setting up, documenting, or exporting a design system. Triggers on phrases like "help me with my Figma design system", "check my design system", "fix setup gaps", "set up a new design system", "build a token showcase", "document a component", "export DESIGN.md", "what can Figlets do", or "I want to try Figlets". Routes to figlets_start so the Figlets-curated capability menu opens. Do not auto-trigger for repo edits, plugin debugging, MCP server changes, or generic Figma authoring requests — those are developer-mode tasks.
---

Call the `figlets_start` MCP tool first.

If the user already stated a concrete goal (for example, "review my design system using Figlets"), do not show the generic capability menu or ask what they want to do. Call `figlets_route_intent` with the user's request, then call `figlets_workflow_guide` for the routed workflow, and reply using the routed `designerResponse`.

If routing returns `selectionPrompt`, use the host's single-choice/selection UI when available. If the host does not support selection UI, render `selectionPrompt.message` and ask the designer to reply with the number or name.

Only use `figlets_start.designerResponse` verbatim for generic help/start requests where the designer has not already stated a specific goal.

Preserve the capability-menu shape and do not offer developer-mode options (no repo editing, no plugin editing, no raw Figma authoring, no generic `figma-console` actions). Do not read project memory, repo source, or package docs before that first designer response.

After the designer picks a goal, call `figlets_route_intent`, then `figlets_workflow_guide`, and follow the steps in that workflow. Inspect before changing anything, summarize in plain language, and ask for explicit approval before any Figma write.

For **new design system setup**, treat the designer prompt as initial direction, not a complete spec. Ask targeted intake questions for missing choices before calling `prepare_ds_config` or asking to build. You may propose options, but do not invent final token/config values or skip intake.

For any design-system review, check, audit, setup-gap investigation, or contrast investigation, the workflow guide is mandatory. Use the Figlets MCP tools/scripts named by `figlets_workflow_guide`; do not write custom scripts, inspect `.local/.../figma-data.json`, parse Claude `tool-results`, read MCP transcript files, or call raw Figma APIs to perform the designer-facing review. If the Figlets output is missing needed information, report that as a Figlets product/tool gap. Only go outside the Figlets workflow when the designer explicitly asks you to go out of bounds.

When QA shows setup gaps, continue with the approved repair steps from the same workflow. Do not offer a separate setup-gap flow after already reporting the gaps.

Use `inspect_ds_setup_gaps.repairPlan.applyInput` for approved repairs. Do not parse Claude `tool-results`, local snapshots, or transcript files to build repair payloads.

Treat bulk design-system updates as Figlets scope when they can be represented as structured, designer-approved tool payloads. Inspect first. If `repairPlan.applyInput` is non-empty, ask approval and pass it to `repairPlan.tool`. If `repairPlan.optionalApplyInput` is non-empty, present it as optional bulk creation requiring separate approval. Use `inspect_ds_setup_gaps.repairPlan` with `apply_ds_setup_repairs` for semantic setup; `inspect_ds_token_gaps` with `apply_ds_foundation_repairs` and `update_ds_tokens` for config-backed token completion; `update_ds_primitives` for primitive/color-semantic updates; `qa_binding_audit` read-only first, then `qa_binding_audit({ fix: true })` only for `fixableNow` after reading `byFixability`. Do not create tokens from binding-audit findings. If the requested bulk update needs a planner Figlets does not expose yet, say that is a Figlets product/tool gap; do not tell the designer the gaps cannot be fixed as a dead end, and do not write ad hoc scripts to compensate.

If `figlets_start` is not available in this session, stop and tell the user Figlets is not connected yet — do not approximate the flow with raw Figma tools. The fix is to install the Figlets Claude Code plugin (see the plugin README) or run `figlets-mcp setup --hosts=claude-code-plugin --yes`, then restart Claude Code.

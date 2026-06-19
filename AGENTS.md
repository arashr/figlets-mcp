# Figlets agent entrypoint

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

Setup intake rule for new design systems: when the designer asks to set up a new design system, treat their prompt as initial direction, not a complete spec. Ask targeted intake questions first for missing choices (color families, brand colors, typography, spacing, grid, breakpoints, contrast standard, light/dark behavior) before calling `create_ds_config_from_intake`, `prepare_ds_config`, or asking to build. After intake, call `create_ds_config_from_intake` to write only the file-scoped local config; if it returns `needsDesignerInput`, ask for those exact missing choices instead of switching to developer/config-editing work. If `prepare_ds_config` returns `semanticPairs.contrastRepairOptions`, show the exact options; after approval, call `apply_ds_config_contrast_repairs` with the approved option objects, then rerun `prepare_ds_config` before any Figma build. Do not draft a full proposal, palette, typography stack, grid defaults, or token names before intake. You may offer lightweight multiple-choice options, and you may present tool-returned or designer-requested suggestions as editable proposals, but do not write suggested values until the designer approves one.

Hard rule for reviews/checks/audits: use the Figlets workflow and the Figlets MCP tools/scripts named by `figlets_workflow_guide`. Do not write or run custom scripts over Figma snapshots, MCP transcripts, `tool-results`, local `.local/.../figma-data.json` files, or raw Figma APIs to perform the designer-facing review. If a specialized Figlets tool does not expose the needed information, first check whether the request is an exact designer-specified high-level edit that `plan_ds_figma_operations` can represent; otherwise report the missing product-specific planner scope. Do not translate health-check findings into invented generic operation batches. Only go outside the Figlets workflow when the designer explicitly asks you to go out of bounds.

Hard rule — stay in Designer Mode: the moment you realize the fix requires editing this repository, the Figlets MCP server, or the bridge plugin, **stop** and tell the designer Figlets cannot do that yet. Do not switch to Developer Mode, run tests, or patch source code. The designer should never need to say “do not edit figlet” or “don’t edit the repo.”

Bulk repair/update posture: bulk design-system updates are in Figlets scope when they can be represented as structured, designer-approved tool payloads. Inspect first. If `prepare_ds_config` returns `semanticPairs.contrastRepairOptions`, use `apply_ds_config_contrast_repairs` for approved pre-build local config contrast repairs, then rerun `prepare_ds_config` before `apply_ds_setup`. If `inspect_ds_setup_gaps.repairPlan.applyInput` is non-empty, ask approval and pass that exact object to `repairPlan.tool` / `apply_ds_setup_repairs`. Never replace `aliases` with counts, summaries, booleans, or prose-derived values. If only a subset is approved, filter entries from `repairPlan.applyInput` while preserving each approved entry's `aliases` object unchanged. If schema validation rejects a setup repair payload, stop, rerun `inspect_ds_setup_gaps`, and copy or filter the fresh structured `repairPlan.applyInput` instead of retrying invented arguments. If `repairPlan.optionalApplyInput` is non-empty, present it as optional bulk creation requiring separate approval. If `inspect_ds_setup_gaps` reports `semanticNamingConflicts` or `semanticNamingAdvisories`, report the inferred `semanticColorGrammar` first; do not ask for a binary `surface-based`/`role-based` choice by default. Ask for a grammar/context decision only when the designer wants naming cleanup, then call `plan_ds_semantic_naming_consolidation`; after explicit approval, pass `repairPlan.applyInput` unchanged to `apply_ds_semantic_naming_consolidation`. Use `inspect_ds_token_gaps` → `apply_ds_foundation_repairs`, `repairPlan.primitiveRepairPlan` → `update_ds_primitives`, and `repairPlan.applyInput` → `update_ds_tokens` for config-backed token completion; use `plan_ds_figma_operations` → `apply_ds_figma_operations` for exact designer-specified variable, collection, mode, local style, binding, metadata, and token lifecycle edits; `update_ds_primitives` for primitive/color-semantic and primitive typography/shadow updates; `qa_binding_audit` read-only first, then `qa_binding_audit({ fix: true })` only for `fixableNow` after reading `byFixability` and `repairPlan`.  For token-gap completion, present foundation collection/mode creation and semantic token updates as separate options with separate approvals; after an approved foundation repair, apply only foundationRepairPlan.applyInput, sync/reinspect, and stop before any token apply. Do not create tokens from binding-audit findings unless exact variable details are provided and validated by a Figlets planner. If no specialized repair payload exists, first check whether `plan_ds_figma_operations` can represent the exact designer-specified request; do not convert health-check findings into invented generic operations. Only product-specific planning or designer-decision gaps should be described as future Figlets planner scope. Do not tell the designer the gaps cannot be fixed as a dead end; specifically, do not tell the designer the gaps cannot be fixed when a structured Figlets operation or future planner can handle them. Do not write ad hoc scripts to compensate.

If `figlets_start` is not available, stop the designer workflow and say:

> "Figlets is not connected in this agent session yet, so I can't run the Figlets designer flow here. I can set it up for this host if you approve, or you can run the setup command yourself. For Google Antigravity, the command is `figlets-mcp setup --hosts=antigravity --yes`; for Gemini CLI, use `figlets-mcp setup --hosts=gemini --yes`. This updates the host's MCP/server config, so restart the agent session afterwards and check that `figlets_start` is available. If your host is not listed, add a server named `figlets` with command `figlets-mcp`. I should not approximate this flow with raw Figma tools."

Do not offer to proceed with raw Figma MCP tools, repo inspection, or project-memory summaries as a substitute for Figlets.

The designer-facing menu must stay limited to Figlets workflows:

- Check my design system
- Set up a new design system
- Build a token showcase
- Document a component
- Export DESIGN.md

## Developer Mode

Use Developer Mode only when the user asks to edit this repository, debug code, run tests, implement features, review changes, or otherwise work as a developer.

In Developer Mode, read `memory/PROJECT_MEMORY.md`, `DECISIONS.md`, and the relevant source files before editing. Human-oriented repo onboarding lives in `docs/developer-guide.md` (not linked from the root README).

Architecture guardrail: before adding a new public Figlets tool, bridge mutation branch, or parallel repair path, check the existing bulk-capable surfaces in `docs/bulk-repair-api-implementation-plan.md`. Decide explicitly whether to extend an existing planner/apply surface, extract shared helpers, or create a new surface because the designer approval boundary is genuinely different. Prefer shared pure helpers for collection names, configured modes, token entry names, and style names; do not duplicate setup/update logic casually.

Linear task comments: when work is tied to a Linear issue, leave additive comments on that issue as the task-level execution log. Keep issue descriptions as stable goal/acceptance criteria; do not rewrite descriptions to capture transient progress. Comment at: start of substantial work, material scope/approach changes (checkpoint), blockers or failed verification, code review verdicts, and completion/handoff. If Linear is unavailable, include paste-ready comment text in the final answer.

Use this comment template:

```md
Status: started | checkpoint | review | completed | blocked

Scope:
- ...

Technical notes:
- ...

Files/areas touched:
- ...

Verification:
- `command`: pass/fail/not run + reason

Risks / follow-ups:
- ...

Links:
- PR/commit/branch if available
```

PR review protocol: when opening, reviewing, or giving merge guidance for a GitHub PR, follow `docs/agent-pr-review-protocol.md`. GitHub PR is the code review truth for scope, findings, verification, and merge readiness. Linear remains the task log and should receive a shorter comment with the same verdict plus links. Use `.github/pull_request_template.md` for PR descriptions. Do not give merge green light while must-fix findings remain open.

## Default

If the request is ambiguous but mentions Figlets as a product or a Figma design system, default to Designer Mode.

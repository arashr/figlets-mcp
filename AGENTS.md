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

Setup intake rule for new design systems: when the designer asks to set up a new design system, treat their prompt as initial direction, not a complete spec. Ask targeted intake questions first for missing choices (color families, brand colors, typography, spacing, grid, breakpoints, contrast standard, light/dark behavior) before calling `prepare_ds_config` or asking to build. Do not draft a full proposal, palette, typography stack, grid defaults, or token names before intake. You may offer lightweight multiple-choice options, but only ask questions before suggesting concrete token values unless the designer explicitly asks for suggestions.

Hard rule for reviews/checks/audits: use the Figlets workflow and the Figlets MCP tools/scripts named by `figlets_workflow_guide`. Do not write or run custom scripts over Figma snapshots, MCP transcripts, `tool-results`, local `.local/.../figma-data.json` files, or raw Figma APIs to perform the designer-facing review. If a Figlets tool does not expose the needed information, say that this is a Figlets product/tool gap. Only go outside the Figlets workflow when the designer explicitly asks you to go out of bounds.

Bulk repair/update posture: bulk design-system updates are in Figlets scope when they can be represented as structured, designer-approved tool payloads. Inspect first. If `repairPlan.applyInput` is non-empty, ask approval and pass it to `repairPlan.tool`. If `repairPlan.optionalApplyInput` is non-empty, present it as optional bulk creation requiring separate approval. Use `inspect_ds_setup_gaps.repairPlan` → `apply_ds_setup_repairs` for semantic color setup; `inspect_ds_token_gaps` → `apply_ds_foundation_repairs`, `repairPlan.primitiveRepairPlan` → `update_ds_primitives`, and `repairPlan.applyInput` → `update_ds_tokens` for config-backed token completion; `update_ds_primitives` for primitive/color-semantic and primitive typography/shadow updates; `qa_binding_audit` read-only first, then `qa_binding_audit({ fix: true })` only for `fixableNow` after reading `byFixability` and `repairPlan`. Do not create tokens from binding-audit findings. If a requested bulk repair is not yet exposed by Figlets, say the missing planner/apply surface is a Figlets product/tool gap; do not tell the designer the gaps cannot be fixed as a dead end, and do not write ad hoc scripts to compensate.

If `figlets_start` is not available, stop the designer workflow and say:

> "Figlets is not connected in this agent session yet. To use the Figlets designer flow, connect the Figlets MCP server, restart the agent, then ask me again. I should not approximate this flow with raw Figma tools."

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

## Cursor Cloud specific instructions

This is a Node.js 22+ npm-workspaces monorepo with no external service dependencies (no databases, Docker, or cloud backends). The update script runs `npm install` from the repo root.

**Key commands** (see `docs/developer-guide.md` for full reference):

| Action | Command |
|---|---|
| Install deps | `npm install` |
| Run tests | `npm test` (custom runner; 82 test files) |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Doctor check | `figlets-mcp doctor` (after `npm link -w @figlets/mcp-server`) |

**Caveats:**

- The root `npm run dev` script references a non-existent `dev` script in `@figlets/mcp-server`. To start the MCP server manually, use `node packages/figlets-mcp-server/src/index.js` (stdio transport) or `figlets-mcp launch --skip-setup` for the CLI launcher report.
- The MCP server communicates over stdio (JSON-RPC), not HTTP. To verify it works, pipe an `initialize` request: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node packages/figlets-mcp-server/src/index.js 2>/dev/null`.
- Live Figma interaction requires Figma Desktop with the bridge plugin; this is not available in Cloud Agent VMs, so designer-facing workflows cannot be tested end-to-end. All 82 unit/integration tests pass without Figma Desktop.
- `npm link --workspace=@figlets/mcp-server` makes the `figlets-mcp` CLI available globally. This is not in the update script because it modifies global state; run it manually when needed.

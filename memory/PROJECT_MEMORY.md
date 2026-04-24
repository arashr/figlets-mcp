# Project Memory

Active context for the project so future sessions can recover quickly without relying on chat history alone.

---

## Project Identity

- Name: `figlets-mcp`
- Purpose: agent-agnostic, MCP-first toolkit for Figma design system workflows
- Relationship to existing repo: current `figlets` remains the Claude-facing product; this repo becomes the shared architecture

---

## Current Direction

- Build the shared core first
- Expose stable MCP tools over that core
- Add Codex and Claude adapters as thin orchestration layers
- Migrate logic gradually rather than rewriting everything at once

---

## Initial Migration Targets

- design system detection
- token gap audit
- component inspection
- component documentation

These were chosen because they are useful across agents and are mostly deterministic.

---

## Established Boundaries

- Deterministic analysis belongs in core/MCP
- Conversational intake and user confirmation belong in adapters
- Project-specific values belong in config or tool parameters
- Agent-specific prompt style should not leak into shared logic

---

## Repo Structure So Far

- `docs/` for architecture, migration plan, and tool contracts
- `memory/` for durable project context
- `packages/figlets-core/` for shared logic
- `packages/figlets-mcp-server/` for MCP exposure
- `packages/figma-bridge-plugin/` for the local Figma data extractor
- `packages/figlets-adapter-codex/` for the Codex adapter
- `packages/figlets-adapter-claude/` for the Claude adapter

---

## Session Notes

### [2026-04-21]

- Created the new sibling repo at `/Users/arash/Projects/figlets-mcp`
- Added the initial monorepo-style package layout
- Added architecture and migration docs
- Added a minimal MCP server skeleton with the first tool stub: `detect_design_system`
- Added `DECISIONS.md` and repo-local project memory from day one
- Turned `detect_design_system` into a structured summary path that can normalize a pre-fetched snapshot before live Figma integration lands
- Ported the first reusable DS analysis logic into `figlets-core` over a Figma-like data contract: alias resolution, collection classification, grouping, and context indexing
- Added the first server-side bridge seam: inline data, file-backed JSON payloads, and env-configured file loading for fetch-then-analyze workflows
- Expanded the bridge seam with a command-based source so an external exporter can feed real data into the same MCP path
- Added the first real exporter path: a Figma REST CLI that can turn a file URL or key into the JSON contract used by `detect_design_system`
- Added a local-only config layer with `.env`, `.env.example`, and `.local/` support so private testing can stay on the user's machine
- Verified the server entrypoint runs directly from source with Node

### [2026-04-22]

- Evaluated native Figma MCP capabilities vs the current architecture. Decided to keep the local bridge because it: (1) eliminates token-heavy round-trips, (2) works without Enterprise plan, (3) provides a deterministic, offline-capable snapshot.
- Scaffolded `packages/figma-bridge-plugin`: a Figma plugin that extracts Variables, Collections, Styles, and Component schemas from an open Figma file.
- Created `src/receiver.js`: a Node HTTP server on port `1337` that receives JSON payloads from the plugin and writes them to `.local/figma-data.json`.
- `.local/` is in `.gitignore` to prevent proprietary design system data from being committed.
- Upgraded `tests/run-tests.js` to support async tests.
- Added unit tests: `tests/bridge/receiver.test.js` and `tests/core/inspect-component.test.js`.
- Added `inspect_component` MCP tool and CLI wrapper.
- Added `sync_figma_data` MCP tool.

### [2026-04-22 — Agent-driven workflow]

- **Removed the Sync button** from the plugin UI. The plugin is now always-listening using long polling.
- Plugin polls `GET /poll`. When the agent calls `POST /request-sync`, the receiver wakes the plugin and tells it to extract the full design system. The receiver then holds the agent's request open until the payload is saved, at which point it returns `200 OK` to the agent.
- This makes `sync_figma_data` a blocking, end-to-end trigger: agent calls → Figma extracts → file is saved → agent proceeds.

### [2026-04-22 — Selection-based inspection]

- Added `extract-selection` command to the polling protocol alongside `extract-all`.
- The plugin can now serialize `figma.currentPage.selection` recursively into a structured payload including: `id`, `name`, `type`, `description`, `componentPropertyDefinitions`, `componentProperties`, `layoutMode`, `padding`, `itemSpacing`, and `children`.
- Added `POST /request-selection` and `POST /sync-selection` endpoints to `receiver.js`. Selection payloads are saved to `.local/figma-selection.json`.
- Updated `inspect_component` to take no arguments. It triggers a selection extraction, reads the saved JSON, and returns the clean structural analysis.
- Rewritten `figlets-core/src/inspect-component.js` to process the `selection[]` format rather than searching a global component list.
- Confirmed end-to-end: CLI prints exact layout and child structure of any selected Figma node.

---

## Milestone 1 — Complete (merged to main 2026-04-24)

All items from the initial `feature/figma-bridge-plugin` branch are shipped:

1. **[DONE]** Port shared design system detection logic into `figlets-core`.
2. **[DONE]** Bridge real Figma data via local plugin (variables, styles, components, selection).
3. **[DONE]** Upgrade `figlets-mcp-server` to official `@modelcontextprotocol/sdk` (stdio, Claude Desktop / Cursor compatible).
4. **[DONE]** Build `audit_tokens` tool: hardcoded values, missing aliases, naming inconsistencies.
5. **[DONE]** Make `figlets-mcp` globally installable as a CLI command for all agents.

---

## Session Notes

### [2026-04-23]

- Upgraded MCP server from hand-rolled JSON stdout to official `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`). Server now speaks full JSON-RPC 2.0 over stdio and is connectable from Claude Desktop, Cursor, Windsurf, etc.
- Added `audit_tokens` MCP tool: surfaces unaliased values, duplicate tokens, and naming inconsistencies from a design system snapshot.
- Made `figlets-mcp` installable as a global command (`npm install -g`) so any agent can invoke it via `figlets-mcp` in their MCP config.

---

## Near-Term Next Steps (Milestone 2)

1. **[DONE]** Merged `figlets-adapter-claude` and `figlets-adapter-codex` into a single `figlets-adapter` package. Contains `CLAUDE.md` (Claude Code) and `AGENTS.md` (Codex CLI) with identical workflows — one place to maintain.
2. **[IN PROGRESS]** End-to-end test against a real Figma file with variables. Auto-start receiver is now wired in. Pending: verify plugin extraction returns real data.
3. **[QUEUED]** Decide on `figma-selection.json` vs `figma-data.json` merge strategy (namespaced single file vs separate files).
4. **[QUEUED]** Expand test coverage — especially integration tests that run bridge + core end-to-end.
5. **[QUEUED]** Add `generate_component_doc` tool (fourth migration target from initial list).

---

## Open Questions

- Should the long-term public package name stay `figlets-mcp`, or become a scoped name under the `figlets` brand?
- Should `figma-selection.json` and `figma-data.json` be merged into one file with namespaced keys, or stay separate?
- Which adapter to build first — Claude or Codex?

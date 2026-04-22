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
- Added a local-only config layer with `.env`, `.env.example`, and `.local/` support so private testing can stay on the user’s machine
- Verified the server entrypoint runs directly from source with Node

### [2026-04-22]

- Evaluated native Figma MCP capabilities vs the current architecture.
- Identified the Enterprise limitation for Figma REST API Local Variables.
- Scaffolded `packages/figma-bridge-plugin` to bypass this limitation using a Figma Plugin that extracts variables via Plugin API.
- Implemented a plain JS plugin with a "Sync" UI that uses `fetch` to POST data to localhost.
- Created `receiver.js`, a tiny Node HTTP server that listens on port `1337` and saves the payload to `.local/figma-data.json`.
- Upgraded `tests/run-tests.js` to support `async` tests and await exported promises.
- Added a unit test (`receiver.test.js`) to verify the local HTTP receiver logic works and saves to the correct path.

---

## Near-Term Next Steps

1. Port the shared design system detection logic into `figlets-core`
2. Replace the snapshot-based placeholder with live Figma-backed detection
3. Add a structured schema for DS summaries and capabilities across more workflows
4. Decide how Figma-specific execution will be bridged into the MCP tool layer

Progress note: Step 1 has started and now exists in a first usable form. The next meaningful move is bridging real Figma data into the same analysis path.

---

## Open Questions

- Should the long-term public package name stay `figlets-mcp`, or should this become an internal repo name under the broader `figlets` brand?
- Should Figma execution happen through a dedicated bridge layer inside this repo or through an external Figma MCP/runtime dependency?
- Which workflow should be the first full vertical slice after DS detection: `fig-document` or `fig-qa`?

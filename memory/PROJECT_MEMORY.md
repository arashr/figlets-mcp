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

1. **[DONE]** Merged `figlets-adapter-claude` and `figlets-adapter-codex` into a single `figlets-adapter` package.
2. **[DONE]** End-to-end test with real Figma file: sync confirmed (272 variables, 4 collections, 15 text styles, 6 effect styles). `detect_design_system` now saves full DS context to `.local/figma-ds-context.json` and returns compact summary only.
3. **[DONE]** `build_ds_showcase` tool — all rendering inside Figma plugin, no agent reasoning needed. Variable bindings, icon pairing, outline rendering, and luminance-based fallbacks all verified across multiple real DS files.
4. **[QUEUED]** Decide on `figma-selection.json` vs `figma-data.json` merge strategy (namespaced single file vs separate files).
5. **[QUEUED]** Expand test coverage — especially integration tests that run bridge + core end-to-end.
6. **[QUEUED]** Add `generate_component_doc` tool (fourth migration target from initial list).
7. **[DONE]** Ported `fig-setup` as two MCP tools: `prepare_ds_config` (computation pipeline) + `apply_ds_setup` (bridge plugin builds all 5 collections).

---

### [2026-04-24 — build_ds_showcase]

- Added `build_ds_showcase` MCP tool: all rendering lives inside `code.js` in the Figma plugin. The agent just calls the tool; no analysis, no decisions — it renders what it detects.
- Architecture: `/request-showcase` → plugin runs `_buildShowcase()` → `/sync-showcase` → MCP tool receives sections list.
- `_buildShowcase()` in `code.js` contains: detect-ds-structure analysis, showcase-shared helpers, colors section (primitives + semantic pairs with WCAG), typography table, spacing/radius/border scale, elevation table, scrims table, finale scroll-into-view.
- Receiver updated: added `/request-showcase` and `/sync-showcase` endpoints (same long-poll pattern).
- Plugin UI updated: handles `build-showcase` command from poll, routes `showcase-built` response to `/sync-showcase`.
- Adapter docs updated: `CLAUDE.md` and `AGENTS.md` both document the new tool and workflow.
- 16/16 tests passing.

---

### [2026-04-25 — apply_ds_setup]

- Ported the `fig-setup` computation scripts to `packages/figlets-core/src/ds-config/` as pure Node.js modules (no file I/O):
  - `compute-ds-config.js` — spacing, radius, border, typography scale from presets
  - `generate-color-ramps.js` — brand ramps + utility ramps with WCAG/APCA analysis
  - `validate-semantic-pairs.js` — bg+text pair contrast validation, icon token validation
  - `generate-primitives-data.js` — Collection 1 payload (colors, floats, strings, scrims)
  - `index.js` — exports all modules + `readDsConfig`, `writeDsConfig`, `runDsPipeline`
- Added `prepare_ds_config` MCP tool: runs the full pipeline on a `design-system.config.js`, returns structured preview data (ramps table, semantic pairs table, failCount, readyToBuild flag)
- Added `apply_ds_setup` MCP tool: sends the full DS config to the bridge plugin via `/request-ds-setup`, plugin creates all 5 collections (Primitives, Color, Spacing, Typography, Elevation + Effect Styles)
- Extended bridge plugin `code.js` with `_applyDsSetup(DS)` function: creates variable collections, modes, color ramp vars, scrim vars, shadow floats, type primitives, semantic aliases, responsive typography, semantic spacing, elevation vars + Effect Styles
- Extended receiver with `/request-ds-setup` (POST, 3-min timeout) and `/sync-ds-setup` endpoints
- Updated `ui.html` to handle `apply-ds-setup` poll command and `ds-setup-done` result message
- Updated `CLAUDE.md` and `AGENTS.md` with new tools, DS setup workflow, error handling, and rules
- 17/17 tests passing

---

### [2026-04-25 — build_ds_showcase debug + typography fix]

- **Root cause of empty showcase**: `figma.loadFontAsync({ family: 'Inter', style: 'SemiBold' })` throws because Figma's Inter font uses `'Semi Bold'` (with space). The rejection is a non-Error string, so `err.message` is `undefined`. `JSON.stringify({ error: undefined })` silently drops the field, producing `{}`, which the MCP handler misread as a successful result with 0 sections.
- **Font fix**: replaced brittle single-try with a candidate loop: `['SemiBold', 'Semi Bold', 'Semibold', 'Demi Bold', 'DemiBold', 'Bold']`. First one that loads wins. Bulk font load now uses `.catch(() => {})` per font so a single missing variant can never crash the entire showcase.
- **Error fix**: catch handler now uses `err instanceof Error ? err.message : String(err)` to guarantee a visible error even when a non-Error value is thrown.
- **Typography from variables**: showcase Typography section now renders for DSes that store type scale as float variables (`type/{role}/{size}/{property}`) instead of text styles. Detection scans `_floatColls` for vars matching `type/display|headline|title|body|label/...`, groups by role+size, resolves size/line-height/weight values, and renders variable-bound sample text. The `sortedStyles` path (text style–based) and the var path both feed the same table.
- **Typography setup issue**: this DS had 0 text styles (`textStyles.length = 0`). Cause unknown — likely a setup step was skipped or styles were deleted. Not a showcase bug; the variable-based path now covers it.

---

### [2026-04-27 — semantic variable binding overhaul]

**Problem:** The showcase was binding variables by first-match name patterns (regex substring matching). This caused wrong bindings — e.g. `color/surface/brand` used where neutral text was needed, because a pattern matched it first. Hardcoded `_C.xxx` fallback colors never adapted to the DS.

**What was done:**

1. **Replaced regex pattern matching with segment-weighted scoring (`_SEG` dictionary)**
   - Every `/`-separated path segment is scored against semantic roles independently
   - `fg/primary` scores positively for `onSurface` via the `fg` segment — found without contrast fallback
   - Negative scores disqualify contradicting variables entirely

2. **Functional scoring is now the true last resort**
   - Only runs if no variable scores above zero (DS with purely non-semantic naming)
   - Status tokens (`nameOnly=true`) return null rather than guessing when no segment match exists

3. **Added `_RC` resolved-color map**
   - `_resolvedOrFallback(v, hardcode)` resolves each `_V` entry's first-mode RGB value
   - All `_paint(_C.xxx, _V.xxx)` calls replaced with `_paint(_RC.xxx, _V.xxx)`
   - Even the static fallback color now comes from the DS rather than a fixed constant

4. **Added unit tests** — `tests/core/semantic-var-picker.test.js` — 13 scenarios covering: standard naming, unconventional naming (fg/primary), negative scoring, segment score tiebreaking, status role disambiguation, functional fallback, and empty DS handling.

### [2026-04-27 — two-layer category scoring]

**Problem:** The flat `_SEG` dictionary mapped segments directly to role scores. This required manually enumerating every qualifier combination (e.g. `brand-variant → onBrandVariant: 2`). A DS using `fg/brand-variant` or `text/brand-variant` would still fail.

**What was done:**

1. **Replaced flat `_SEG` with two-layer system**
   - `_SEG`: segment → semantic categories (always non-negative): `BG`, `FG`, `BRAND`, `BVAR`, `VARIANT`, `OUTLINE`, `SUCCESS`, `WARNING`, `DEFAULT`, `STRONG`
   - `_ROLE`: role → category weights (positive = reward, negative = penalty)
   - Final score = dot product of path's accumulated categories with role's weight vector
   - `_segScore` accumulates all segments into a category map first, then multiplies

2. **Why this is systematic**
   - `on-surface/brand-variant` scores 18 for `onBrandVariant` (FG×3 + BRAND×3 + BVAR×2)
   - `on-surface/default` scores 9 — loses without any manual disambiguation
   - `surface/brand-variant` scores −3 — excluded because BG×−4 dominates
   - ANY foreground qualifier beside a brand marker binds correctly regardless of exact wording
   - Adding new naming conventions requires only new `_SEG` entries, not new `_ROLE` logic

3. **Tests updated** — all 13 scenarios updated with new category-based score annotations

**18/18 tests passing.**

---

### [2026-04-27 — showcase token label and pairing observability]

**Problem:** Semantic color swatches showed only the leaf segment of the variable path (e.g. `brand`) with no context about what role it plays or what it pairs with. Typography section showed both text-style rows and variable-based rows simultaneously, causing duplicates.

**What was done:**

1. **`_tokenLabel(name)` helper** — returns the last 2 path segments (e.g. `color/surface/brand` → `surface/brand`, `color/on-surface/brand-variant` → `on-surface/brand-variant`). Used as the tag label in all semantic color rows.

2. **Swatch preview text** stays as the leaf only — the 80×56 color box still shows the short name to avoid overflow. The 2-segment label appears in the pill/tag below.

3. **Pairing descriptions added at call sites** — after `fgPairName` is resolved, `rowDesc` includes "Paired with on-surface/brand." appended to the existing description. Icon rows get "Shown on surface/inverse." The `_buildSemColorRow` function accepts `opts.previewText` to decouple the swatch preview from the tag label.

4. **Typography duplication fixed** — var-based rows (`_typoVarGroups`) now only render when `_sortedStyles.length === 0`. Text styles are always preferred; variable-based compilation is the fallback for DSes that define type scale purely via variables.

5. **Font family binding in var rows** — `_buildTypoVarRow` now resolves an effective family variable (`familyVar` per-token, or `_sharedFamilyVar` found by searching for the first STRING variable containing "family" in any float collection). The resolved string is used for `fontName.family` before binding, and all referenced family fonts are pre-loaded via `figma.loadFontAsync` before rows are built.

**18/18 tests passing.**

---

### [2026-04-27 — variable purpose lock]

**Problem:** The segment scoring system assigned positive scores to wrong-purpose variables when the status keyword dominated. `color/icon/warning` (FG+WARNING) scored positively for `warningBorder` because WARNING outweighed the FG penalty. Result: badge borders bound to icon tokens instead of outline tokens, or fell back to surface/text colors.

**What was done:**

1. **Refactored `_segScore` into `_pathCats` + dot-product** — `_pathCats(name)` returns the accumulated category map for a path; `_segScore` calls it then dot-products with the role weight vector. This makes the category map available for constraint checking without recomputing it.

2. **Added `requiredCats` parameter to `_semPick`** — a hard category filter applied before score comparison. A candidate variable must contribute > 0 to every listed category or it is skipped entirely.

3. **`requiredCats` also blocks the functional fallback** — `if (nameOnly || requiredCats) return null` prevents cross-purpose guessing. If no purpose-correct variable exists, the slot is null.

4. **Applied consistently across all purpose-constrained roles:**
   - Outline roles (`outlineSubtle`, `outlineBrand`, `successBorder`, `warningBorder`) → `['OUTLINE']`
   - Status fill roles (`successBg`, `warningBg`) → `['BG']`
   - Status text roles (`successText`, `warningText`) → `['FG']`

5. **`_buildBadge` null-guards the border stroke** — when `bdV` is null, `badge.strokes = []` rather than binding a fallback color.

6. **Added test scenarios 15 and 16** covering BG and FG purpose locks respectively. Scenario 14 (OUTLINE lock) was already present.

**This is also a QA contract:** variable path purpose is expected of designers. Future QA tools will enforce the same rule.

**20/20 test scenarios passing (18 test files).**

---

### [2026-04-28 — bridge + core integration tests]

- Added `tests/integration/sync-detect-flow.test.js` — full E2E for `sync_figma_data` → `detect_design_system`. Starts the real receiver on a random port, simulates the plugin via raw HTTP (poll → respond to `extract-all` → POST `/sync` with fixture), runs both real MCP handlers, asserts file write and DS summary shape.
- Added `tests/integration/inspect-component-flow.test.js` — same pattern for `inspect_component` (poll → `extract-selection` → POST `/sync-selection`).
- Standardised receiver URLs across all tools: `inspect-component.js` was the last hold-out hardcoding `localhost:1337`. All tools now read `FIGLETS_RECEIVER_URL` (defaults to `http://localhost:1337`).
- 20/20 tests passing. New bridge-backed tools should ship with a matching integration test.

---

### [2026-04-28 — porting plan: `/fig-document` next, then `/fig-qa` auto-fix, then decompose `/fig-create`]

**State of the migration from the sibling `figlets` repo:**

| figlets skill | figlets-mcp tool | Status |
|---|---|---|
| `/fig-setup` | `prepare_ds_config` + `apply_ds_setup` | Done |
| `/fig-ds-showcase` | `build_ds_showcase` | Done |
| `/fig-qa` | `audit_tokens` | Detection only (no auto-fix) |
| `/fig-document` | — | Not ported |
| `/fig-create` | — | Not ported |

**Decided sequence:**

1. **`generate_component_doc`** (port `/fig-document`) — chosen first. Architecture mirrors `build_ds_showcase`: plugin renders the spec sheet inside Figma + writes a `[SPEC]` block to the component description, agent calls one MCP tool, tool returns markdown for the agent to write via the Write tool. 4 scripts to port: `find-component.js`, `doc-runner.js`, `write-spec.js`, `update-description.js`. New endpoints: `/request-doc-build` + `/sync-doc-build`.
2. **`fix_token_violations`** (extend `audit_tokens`) — port `fix-all.js` + `fix-violation.js`. Closes the audit loop. New endpoints: `/request-fix-violations` + `/sync-fix-violations`.
3. **Adapter scaffold** before tackling `/fig-create`.
4. **Decompose `/fig-create`** into `audit_token_gaps`, `plan_component_from_frame`, `build_component`, `post_build_audit` — orchestration lives in the adapter. Not one giant tool.

See DECISIONS.md `[2026-04-28]` entry for full rationale.

---

### [2026-04-28 — `generate_component_doc` ported]

Step 1 of the porting plan landed. `/fig-document` is now an MCP tool.

- **Bridge protocol:** New endpoints `/request-doc-build` (POST, agent → receiver) and `/sync-doc-build` (POST, plugin → receiver). New plugin command `build-doc`. UI handles `build-doc` poll command and `doc-built` result.
- **Plugin (`code.js`):** New `_buildComponentDoc(opts)` async function (~700 lines, appended at end of file). Self-contained — no shared helpers. Renders the spec sheet inside a "Documentation" section (Sections A–H mirroring the original `doc-runner.js`), updates the component description with a `[SPEC]` block, and returns the full markdown body for `component-specs/[Name].md`. ES6-compatible (no `??`, `?.`, `**` — sandbox restriction).
- **MCP tool (`generate_component_doc`):** Inputs are `component_name` (required), `usage_do`, `usage_dont`, `variant_descriptions` (all optional with sensible defaults). Tool returns the markdown body so the agent writes the file via the Write tool — keeping file I/O on the agent side, rendering on the plugin side.
- **DS-adaptive palette:** The spec sheet's chrome (paper, surface, ink, badge colors) resolves from the host DS variables when matching tokens exist (`paper`, `surface`, `ink/black`, `error`, etc.). Falls back to fixed RGB only if nothing matches — same approach as the showcase.
- **Tests:** Unit (`generate-component-doc-tool.test.js`) covers tool metadata, error path for missing input, success payload, plugin error propagation, 503, and ECONNREFUSED. Integration (`generate-component-doc-flow.test.js`) runs the real receiver, simulates the plugin's poll → `build-doc` → `sync-doc-build` round-trip, and asserts the payload routed correctly in both directions.
- **Adapter docs:** `CLAUDE.md` and `AGENTS.md` both updated with the new tool row, "Document a component" workflow, and two error-handling rows.

**22/22 tests passing.** Migration is now: `prepare_ds_config` + `apply_ds_setup` + `build_ds_showcase` + `generate_component_doc` shipped — three of the five original skills fully ported. Next per the plan: `fix_token_violations` (extend `audit_tokens` to close the QA loop).

---

---

### [2026-04-29 — generate_component_doc iteration + plugin robustness]

**Live-tested against real DS file. Three bugs fixed, one missing feature added, spec sheet structure overhauled.**

#### generate_component_doc fixes
- **Library variable resolution:** added async pre-fetch loop using `figma.variables.getVariableByIdAsync` for any varId not in the local map. Resolves remote/library variables that `getLocalVariablesAsync` doesn't return. Eliminates raw `VariableID:xx:yy` in spec sheets.
- **SIZING table:** rewrote using proven `_mkTable/_mkRow/_mkCell` helpers (same as Properties table). Custom `_sizeRow` helper removed — it produced 0px-tall text rows due to subtleties in auto-layout sizing. The proven helpers don't have this problem.
- **Subtitle overflow:** added `layoutSizingHorizontal = 'FILL'` + `textAutoResize = 'HEIGHT'` on the subtitle text node so it word-wraps inside the doc frame instead of growing off-screen.
- **Placement:** new component → lands to the right of the rightmost existing `· Spec` sheet with a 100px gap. Rebuild of same component → reuses old (x, y) so viewport and instances stay stable.

#### New features
- **`description` arg:** `generate_component_doc` now accepts a `description` string. Plugin uses it as the subtitle (agent-supplied content first, then existing component description stripped of `[SPEC]` blocks, then a placeholder). Markdown also uses it.
- **Component description field:** agent-supplied description is now written to the top of the component's Figma description field, above the `[SPEC]` block. Designers see it in the Component Properties panel. Agents see the `[SPEC]` data. Rebuilds overwrite cleanly.
- **Spec sheet section labels:** PREVIEW and VARIANTS sections now have `_mkLabel` calls matching all other sections.
- **Container sizing:** Preview frame now has `counterAxisSizingMode = 'AUTO'` (hugs content height). Do/Don't row now has `layoutSizingHorizontal = 'FILL'`; panels fill width; rule text uses `FILL + HEIGHT` so it word-wraps instead of overflowing.

#### Pre-flight check added to adapter docs
Both `CLAUDE.md` and `AGENTS.md` now include a mandatory step 3 in "Document a component":
- **Layer names check:** flag Figma-default names (`Frame NNN`, `Group NNN`, etc.) in shallow children. These appear verbatim in the Anatomy section.
- **Component properties check:** flag a COMPONENT_SET with variants but no `componentPropertyDefinitions`. An empty properties table is useless for developers.
Agent asks "fix first or proceed?" and waits. If user fixes, re-inspect before generating.

#### Plugin robustness improvements (PINNED ISSUE)
Background: `inspect_component` was reliably failing with 503/504 when a new component was selected. Root causes:
1. `extract-selection` in `code.js` had no try/catch — a `serializeNode` error silently killed the poll loop
2. `ui.html` set `isExtracting = true` when dispatching a command, but if the plugin code crashed, `isExtracting` was never reset and polling died permanently
3. MCP tool had no retry on 503/504

Fixes shipped:
- `code.js`: `extract-selection` wrapped in try/catch; errors post back as `{ error, selection: [] }` instead of swallowed
- `ui.html`: watchdog timer arms on every command dispatch (12s inspect, 30s sync, 60s doc/setup, 120s showcase); disarmed on every successful response; fires → resets `isExtracting` and resumes polling
- `inspect-component.js`: retries up to 3× on 503/504 with 1.5s delay

**Remaining open issue (PINNED):** `figma.currentPage.selection` is consistently returning `[]` even when something is selected in Figma. The plugin connects and polls correctly, executes the command without error, but reports empty selection. Suspected cause: Figma plugin sandbox clears `currentPage.selection` in some contexts when the plugin UI is focused during polling. Not resolved. Next session should investigate whether this is a `loadAllPagesAsync` requirement, a Figma Desktop bug, or a timing issue with the poll cycle. The robustness fixes above are correct regardless.

---

## Open Questions

- Should the long-term public package name stay `figlets-mcp`, or become a scoped name under the `figlets` brand?
- Should `figma-selection.json` and `figma-data.json` be merged into one file with namespaced keys, or stay separate?
- Which adapter to build first — Claude or Codex?
- Why does `figma.currentPage.selection` return `[]` when something is selected? (Pinned — investigate next session)

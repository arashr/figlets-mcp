# Decisions

Running log of non-obvious project decisions and the reasons behind them.

---

## [2026-04-28] Port `/fig-document` next; defer `/fig-create`; extend `audit_tokens` with auto-fix after

**Decision:** With `/fig-setup` and `/fig-ds-showcase` already migrated, prioritize porting `/fig-document` as `generate_component_doc` before either `/fig-qa` auto-fix or `/fig-create`. Decompose `/fig-create` later, only after at least one adapter is scaffolded.

**Why:**
- `/fig-document` is the smallest remaining surface: 4 scripts (`find-component.js`, `doc-runner.js`, `write-spec.js`, `update-description.js`), all already organized as deterministic plugin-side rendering. Architecture is identical to the proven `build_ds_showcase` pattern (one MCP tool → plugin renders everything → result returned).
- The tool's MCP fit is excellent: clean inputs (component name, optional variant-purpose map, optional do/don't rules), tool returns the markdown body so the agent writes the file via the Write tool. No conversational intake required, so it lives cleanly in core/MCP rather than an adapter.
- `/fig-qa` auto-fix is small and useful but secondary — `audit_tokens` already covers detection. Closing the loop with `fix_token_violations` after fig-document keeps each port self-contained.
- `/fig-create` is the largest skill (8 scripts) and is heavily conversational ("ask: build states? variants? sub-components?"). Trying to one-shot it as a single MCP tool fights the agent-agnostic boundary. It should be sliced into discrete deterministic tools (`audit_token_gaps`, `plan_component_from_frame`, `build_component`, `post_build_audit`) with the orchestration living in an adapter — which currently doesn't exist.

**Consequence:** Migration sequence is now: `generate_component_doc` → `fix_token_violations` (extend `audit_tokens`) → adapter scaffold → decomposed `fig-create` tools. The "ported skills" set after step 1 will cover setup, showcase, and documentation — three of the five original skills, all deterministic.

---

## [2026-04-28] Add bridge + core integration tests covering the full poll/sync round-trip

**Decision:** New `tests/integration/` directory with two end-to-end tests: `sync-detect-flow.test.js` (sync_figma_data → detect_design_system) and `inspect-component-flow.test.js` (inspect_component). Each test starts the real receiver on a random port, simulates the Figma plugin via raw HTTP (long-poll → command response → POST sync data), and runs the actual MCP tool handlers.

**Why:**
- Existing tests covered each layer in isolation (receiver, mocked MCP client, core analysis) but never the full `tool → receiver → plugin → receiver → tool` chain. A protocol change in any layer could pass all unit tests while breaking the bridge.
- Simulating the plugin with a plain HTTP client is enough to validate the protocol — we don't need real Figma. The plugin contract is: poll, receive a command, post the result. Anything beyond that is rendering, which is tested by the unit tests on core analysis.
- Required fixing one inconsistency: `inspect-component.js` was the only tool still hardcoding `localhost:1337` instead of reading `FIGLETS_RECEIVER_URL`. Standardised to env-driven URLs across all tools.

**Consequence:** Future protocol or endpoint changes (e.g. for `generate_component_doc`) will fail loudly in CI, not silently in production. Each new bridge-backed tool should ship with a matching integration test.

---

## [2026-04-21] Create a new repo instead of expanding the existing figlets repo

**Decision:** Start a separate repository for the MCP-first, agent-agnostic architecture instead of continuing to expand the current Claude-oriented `figlets` repository.

**Why:**
- The long-term center of gravity is shared logic and MCP tools, not a single-agent plugin surface.
- Keeping the current repo focused avoids mixing Claude-specific packaging with cross-agent abstractions.
- A new repo makes it easier to design around the correct boundaries from the start: core logic, MCP transport, and thin agent adapters.

**Consequence:** The existing `figlets` repo stays usable as the current Claude-facing product while this new repo becomes the shared architecture for Codex, Claude, and future agents.

---

## [2026-04-21] Keep the figlets name and use `figlets-mcp` for the new repo

**Decision:** Preserve the `figlets` brand and use `figlets-mcp` as the working name for the new repository.

**Why:**
- The name already has meaning and momentum.
- The suffix makes the repo’s role clear without discarding the brand.
- It leaves room for a future shape like `figlets-core`, `figlets-claude`, or a renamed umbrella if needed.

**Consequence:** This repo is branded as the next step of figlets rather than a completely separate product.

---

## [2026-04-21] Put deterministic logic in MCP and keep adapters thin

**Decision:** Use an MCP-first architecture where deterministic Figma logic lives in shared core and MCP tools, while agent-specific prompting stays in lightweight adapters.

**Why:**
- Reduces token usage by avoiding repeated prompt-side logic.
- Increases consistency across runs and across agents.
- Makes the project easier to test and easier to open source.
- Preserves model reasoning for ambiguity, tradeoffs, and orchestration rather than routine processing.

**Consequence:** Early implementation should focus on tool contracts and reusable analysis modules instead of agent-specific prompts.

---

## [2026-04-21] Document project memory inside the repo from day one

**Decision:** Keep durable project memory inside the repository, not only in chat history.

**Why:**
- The project will likely involve long sessions and iterative design changes.
- Repo-local memory survives context window loss and makes onboarding future contributors easier.
- Decisions become reviewable artifacts instead of implicit history.

**Consequence:** Maintain both `DECISIONS.md` for stable architectural decisions and `memory/PROJECT_MEMORY.md` for active context, session notes, and next steps.

---

## [2026-04-21] Port detection logic as plain shared analysis over a Figma-like data shape

**Decision:** Re-express design system detection as plain shared JavaScript over a normalized Figma-like input shape instead of copying Claude-era `use_figma` scripts directly into the new repo.

**Why:**
- The reusable asset is the detection logic, not the old runtime wrapper.
- A plain data contract is easier to test, easier to expose through MCP, and easier to feed from different agent runtimes.
- This keeps the future live bridge thin: fetch Figma data once, then hand it to shared analysis.

**Consequence:** The first MCP tool can already analyze `figmaData` payloads locally, even before live Figma execution is wired in.

---

## [2026-04-21] Introduce a thin bridge layer before building a real Figma transport

**Decision:** Add a bridge seam in the MCP server now, starting with inline data and file-backed JSON sources, instead of jumping straight to a live Figma transport implementation.

**Why:**
- It proves the server-side fetch-then-analyze boundary early.
- It lets us test contracts and examples without committing to a transport too soon.
- It keeps the shared core independent from how Figma data is obtained.

**Consequence:** A future live bridge should plug into the same seam and only be responsible for data retrieval and normalization.

---

## [2026-04-21] Support command-based bridge inputs before a dedicated live runtime exists

**Decision:** Add a command-based bridge input alongside file-based inputs so external exporters can pipe real Figma-like data into the MCP toolchain.

**Why:**
- It creates a practical integration seam before we settle on a permanent Figma transport.
- It keeps the core and MCP contracts reusable across local scripts, agent runtimes, and future bridge implementations.
- It lets us test the real fetch-then-analyze path with minimal extra infrastructure.

**Consequence:** Any future live bridge should be able to act like a producer of the same JSON contract, whether it is implemented as an MCP adapter, local script, or dedicated server.

---

## [2026-04-21] Use a REST-based exporter as the first real Figma integration

**Decision:** Build the first real exporter on top of the Figma REST API instead of waiting for a custom live runtime bridge.

**Why:**
- It gives us a practical end-to-end path against real files immediately.
- It keeps the integration understandable for designers: token, file URL, one command, JSON out.
- It preserves the architecture: the exporter is just another producer of the shared data contract.

**Constraint:** Per Figma’s official docs, `GET /v1/files/:file_key/variables/local` requires the `file_variables:read` scope and is available only to full members of Enterprise orgs.

**Consequence:** The exporter should degrade gracefully when the Variables API is unavailable and still emit useful file/style data plus warnings.

---

## [2026-04-22] Build a dedicated local-first Figma bridge plugin to bypass REST limitations

**Decision:** Create a simple Figma plugin (`packages/figma-bridge-plugin`) that extracts local variables and styles and POSTs them to a local HTTP receiver (`src/receiver.js`) to save in `.local/figma-data.json`.

**Why:**
- Figma's REST API gatekeeps the Local Variables API behind an Enterprise plan.
- Running a plugin inside the Figma editor canvas is the only reliable way for all users to read `figma.variables`.
- By having the plugin act strictly as an extractor that POSTs standard JSON to `localhost`, the core MCP server remains completely agent-agnostic and transport-agnostic.
- The Claude/Codex adapters don't need to know how the data was fetched, only that it exists locally.

**Consequence:** Users will need to install and run this local plugin in Figma desktop to sync variables before running the MCP tools. The REST exporter is kept as an option for Enterprise users or those who only need styles.

---

## [2026-04-22] Switch plugin from a manual Sync button to always-listening long polling

**Decision:** Remove the "Sync to MCP" button from the plugin UI. Instead, the plugin continuously long-polls `GET /poll` on the local receiver, and the MCP agent triggers extraction via `POST /request-sync`.

**Why:**
- A manual button requires the designer to be present and remember to sync before asking the agent anything.
- With long polling, the plugin is permanently ready — the agent controls the workflow end-to-end.
- `POST /request-sync` is a blocking call that only resolves after Figma has finished extracting and saving. This gives the agent a clean synchronisation point before reading the data.
- The same long-poll channel supports multiple command types (`extract-all`, `extract-selection`) without needing separate infrastructure.

**Consequence:** The plugin must be open in Figma Desktop for agent-triggered workflows to function. The receiver returns `503` if the plugin is not currently connected, giving agents a clear error to surface to the user.

---

## [2026-04-22] Use Figma selection as the input for component inspection

**Decision:** The `inspect_component` MCP tool takes no arguments. When called, it triggers the plugin to serialize `figma.currentPage.selection` and return it as the inspection payload. The selection is saved to `.local/figma-selection.json`.

**Why:**
- Asking the agent to search a large component list by name is fragile (fuzzy match, ambiguity, wrong file scope).
- Letting the user point directly at the component they care about in Figma is more reliable and more intuitive.
- A zero-argument tool is simpler for agents to call and requires no schema negotiation.
- The selection can contain frames, instances, component sets, or any other node type — making the tool flexible beyond just named components.

**Consequence:** The designer must have the target component selected in Figma before the agent calls `inspect_component`. Agents should be prompted to ask the user to select the target first if context is ambiguous.

---

## [2026-04-24] Auto-start the bridge receiver from the MCP server

**Decision:** The MCP server spawns the bridge receiver (`figma-bridge-plugin/src/receiver.js`) automatically on startup if port 1337 is not already in use.

**Why:**
- The target audience is designers with little or no terminal experience. Requiring `npm run start` before every session is a barrier that breaks the UX.
- The receiver is infrastructure, not a user task. The agent should own its own infrastructure.
- If the receiver is already running the auto-start is a no-op — no double-spawn risk.

**Consequence:** Designers only need to open the Figlets Bridge plugin in Figma Desktop when instructed. Everything else is automatic.

---

## [2026-04-24] Merge agent adapters into one shared package

**Decision:** Collapse `figlets-adapter-claude` and `figlets-adapter-codex` into a single `figlets-adapter` package containing both `CLAUDE.md` and `AGENTS.md` side by side.

**Why:**
- The tool inventory, workflows, error handling, and rules are ~90% identical across agents.
- Separate packages would require duplicating and synchronising the same content on every workflow change.
- As long as figlets-mcp remains agent-agnostic, there is no structural reason to separate the orchestration prompts.

**Consequence:** One package to update when MCP tools change. If the adapters diverge significantly in the future (agent-specific tools, divergent intake flows), splitting back out is straightforward.

---

## [2026-04-23] Upgrade MCP server to use the official `@modelcontextprotocol/sdk`

**Decision:** Replace the hand-rolled JSON stdout output in `figlets-mcp-server/src/index.js` with the official `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`).

**Why:**
- The old entrypoint just printed a JSON capability manifest to stdout — it was not a real MCP server and could not be connected to by any host.
- The official SDK handles the full JSON-RPC 2.0 protocol over stdio automatically, including capability negotiation, tool dispatch, and error framing.
- Using the SDK means zero custom protocol code: tool registration is a one-liner and handlers return plain `content` arrays.
- Any MCP-compatible host (Claude Desktop, Cursor, Windsurf, etc.) can now connect by simply pointing at the `node src/index.js` entrypoint.

**Consequence:** The server now speaks real MCP over stdio. Users add it to their host config (see `docs/mcp-config-examples.md`) and get all three tools — `sync_figma_data`, `inspect_component`, `detect_design_system` — without any CLI glue.

---

## [2026-04-24] Render the DS showcase entirely inside the Figma plugin — zero agent tokens

**Decision:** The `build_ds_showcase` MCP tool sends a single trigger command to the bridge plugin and receives back only a list of built section names. All design decisions — DS detection, variable selection, rendering, layout — happen inside `code.js` in the Figma plugin sandbox.

**Why:**
- Passing token values, variable lists, and color data to the agent for analysis would consume significant context on every run without adding value; the rendering logic is deterministic.
- The plugin already has direct access to the live Figma API, which is required for variable binding (mode-aware colors) and style application. Server-side JSON snapshots cannot substitute for live Figma objects.
- A zero-argument, zero-reasoning tool is more reliable: there is nothing for the agent to misinterpret and no intermediate representation to keep in sync.

**Consequence:** `build_ds_showcase` cannot be partially guided by the agent (e.g., "only show colors"). It renders exactly what it detects. Future per-section control would require a plugin-side filter, not agent-side reasoning.

---

## [2026-04-24] Use contrast-based variable fallbacks instead of hex-matching for structural tokens

**Decision:** When structural token variables (`onBrandVariant`, `textSub`, etc.) cannot be found by their expected name, `_buildShowcase()` calls `_findContrastVar(bgRGB, minRatio)` to scan DS variables by semantic type (on-surface / foreground / text) and pick the one with the best contrast ratio against the paired background. It does not fall back to a hardcoded hex value.

**Why:**
- Hex-based auto-lookup (`colorVarByHex`) would match the first variable that happens to share a hex value. In practice this matched `color/icon/brand` (same hex as `onBrandVariant`) — a semantically wrong binding that would break mode switching.
- Contrast-based fallback finds a variable that is semantically appropriate (on-surface class) and measurably readable (≥ 4.5:1). The result is a real DS variable, so it responds correctly to Figma mode changes.
- This makes the showcase resilient to DS files that use different naming conventions without requiring per-file configuration.

**Consequence:** The showcase may select a slightly different on-surface token on each DS file, but it will always be readable and mode-aware. If a DS has no on-surface variables at all, it falls back to any COLOR variable with the best contrast.

---

## [2026-04-24] Use a three-tier surface pairing strategy for icon tokens

**Decision:** Icon tokens are treated as foreground colors and paired with a surface background using the following priority chain: (1) semantic surface pairing — replace `icon` with `surface` in the token path; use if contrast ≥ 3:1 and it beats the default by at least 80%; (2) luminance-based dark surface scan — if the icon is light (luminance > 0.6), scan `surface/*` variables (excluding `on-*` prefixed names) and pick the darkest one; (3) default surface fallback.

**Why:**
- Pairing an icon token against a generic light background gives visually correct results for most icons, but fails for inverse/on-dark icons (e.g., `icon/inverse` is white, needs a dark background).
- A semantic path substitution (`icon/brand` → `surface/brand`) captures deliberate DS pairings when the naming convention supports it.
- A luminance-based fallback handles icons that are semantically "on dark" without requiring the DS to follow any specific naming convention.
- Excluding `on-*` prefixed variables from the dark surface scan prevents mistakenly pairing a foreground token (like `on-surface`) as the background.

**Consequence:** Icon swatches in the showcase will show a meaningful background in nearly all cases. The WCAG badge still grades the actual contrast, so the pairing quality is visible. Edge cases in unconventional DS files will produce the default surface, which is still a valid rendering.

---

## [2026-04-25] Resolve semibold font style by candidate loop, never hardcode

**Decision:** Font loading for the DS font family uses a priority list of semibold style name candidates (`['SemiBold', 'Semi Bold', 'Semibold', 'Demi Bold', 'DemiBold', 'Bold']`) tried one at a time via `loadFontAsync`. The first that succeeds is stored as `_semiboldStyle` and used throughout `_tDS`. All other fonts are bulk-loaded with `.catch(() => {})` per entry so a single missing variant cannot crash the showcase.

**Why:**
- Figma ships the Inter family with `'Semi Bold'` (space), not `'SemiBold'` (no space). Hardcoding either form breaks on one half of common font libraries.
- Custom typefaces vary freely between foundries. A candidate loop is the only robust approach.
- A rejected `loadFontAsync` promise throws a non-Error string in the Figma sandbox. If caught with a plain `catch (err)` and forwarded as `{ error: err.message }`, `err.message` is `undefined` → `JSON.stringify` silently drops the field → the MCP handler sees an empty success object instead of an error. The candidate loop sidesteps this by treating font load failure as a normal fallback, not an exception.

**Consequence:** The showcase always renders with a valid font. DSes using any common semibold naming convention — including custom foundries — load correctly without configuration.

---

## [2026-04-27] Show parent+leaf token path in semantic color row labels

**Decision:** Semantic color row tags display the last two slash-separated segments of the variable path (e.g. `surface/brand`, `on-surface/brand-variant`, `outline/subtle`) rather than only the leaf segment. A `_tokenLabel(name)` helper computes this. The swatch preview text (inside the 80×56 color box) continues to show the leaf only to avoid overflow. Pairing information is appended to the description line at the call site after `fgPairName` is resolved: "Paired with on-surface/brand." for background tokens, "Shown on surface/inverse." for icon tokens. `_buildSemColorRow` accepts `opts.previewText` to decouple these two display contexts.

**Why:**
- Leaf-only labels (`brand`, `default`) give designers no path context — two tokens from different roles can share the same leaf, making the table ambiguous.
- The two-segment form is the natural human-readable name for a token in a slash-structured DS. Designers can immediately identify the role (surface, on-surface, outline) and the qualifier (brand, default, subtle) without reading the full path.
- Pairing notes make the contrast column self-explanatory: `surface/brand` paired with `on-surface/brand` is legible without needing to know the underlying structure.

**Consequence:** All semantic color rows, outline rows, and icon rows in the showcase now show context-bearing labels. The change is applied at the call sites, not inside `_buildSemColorRow`, so the function remains reusable without enforcing a specific label format.

---

## [2026-04-27] Variable-based typography rows are a fallback, not an additive layer

**Decision:** `_buildTypoVarRow` rows (derived from `type/{role}/{size}/*` float variables) only render when `_sortedStyles.length === 0`. When a DS has text styles, only `_buildTypoRow` rows are shown. The variable-based path remains the fallback for DSes that define type scale purely as variables with no Figma text styles.

**Why:**
- Previously both loops ran unconditionally, producing a duplicate typography table when a DS had both text styles and type variables (common in DSes built with `apply_ds_setup`).
- Text styles are the canonical Figma typography representation and carry richer metadata (description, style name). They take precedence when present.
- The variable path adds value only when styles are absent — allowing the section to appear for variable-only DSes.

**Consequence:** A DS with text styles shows one row per style. A DS with only type variables shows one row per role+size group. A DS with both shows only the text style rows. Font family binding in var rows now also resolves via `_sharedFamilyVar` (first STRING variable containing "family" in any float collection) as a fallback when per-token `/family` variables are absent, and pre-loads the resolved font family before building rows.

---

## [2026-04-25] Typography section renders from variables when text styles are absent

**Decision:** `_buildShowcase()` scans `_floatColls` for variables following the `type/{role}/{size}/{property}` naming pattern (roles: display, headline, title, body, label). When found, it groups them by role+size and renders a variable-bound typography table row for each group using `_buildTypoVarRow`. Text-style rows (`_buildTypoRow`) and variable rows share the same table and column schema.

**Why:**
- Many DSes built with the `apply_ds_setup` flow store typography as float variables with responsive modes, not Figma text styles. A showcase that only renders when `textStyles.length > 0` would skip the Typography section entirely for those files.
- Variable-bound text rows let the preview respond to mode changes (Mobile → Desktop) exactly as the DS author intended, which is more valuable than a static snapshot.
- Supporting both paths in one section keeps the table unified — mixed DSes (some text styles, some vars) render correctly without duplication.

**Consequence:** The Typography section now appears for any DS that has `type/{role}/{size}/size` variables, regardless of whether text styles exist. DSes that have neither text styles nor typed variables continue to skip the section.

---

## [2026-04-27] Two-layer category scoring replaces flat per-role segment dictionary

**Decision:** Replace the flat `_SEG` dictionary (segment → role → score) with a two-layer system: `_SEG` maps segments to semantic categories (`BG`, `FG`, `BRAND`, `BVAR`, `VARIANT`, `OUTLINE`, `SUCCESS`, `WARNING`, etc.), and `_ROLE` maps each semantic role to category weights. The final score is the dot product of the path's accumulated category map with the role's weight vector.

**Why:**
- The flat dictionary required manually enumerating every qualifier combination. `brand-variant → onBrandVariant: 2` was correct, but `fg/brand-variant`, `text/brand-variant`, or any other FG-family segment beside `brand-variant` would still fail without an explicit entry.
- The two-layer system is compositional: `on-surface/brand-variant` accumulates `{FG: 3, BRAND: 1, BVAR: 3}` from its segments, and the `onBrandVariant` role weights `{FG: 3, BRAND: 3, BVAR: 2}` produce a score of 18. `on-surface/default` scores 9. No manual disambiguation needed.
- `surface/brand-variant` (the background) scores −3 because `BG × −4` dominates — structurally excluded regardless of what other categories it carries.
- Adding a new naming convention is a single `_SEG` entry. The role logic never changes.

**Consequence:** ANY foreground qualifier beside a brand marker correctly identifies the `onBrandVariant` token, regardless of exact wording. The same principle applies to all roles — qualifier specificity is naturally encoded by category accumulation, not by exhaustive per-role enumeration. Unit-tested in `tests/core/semantic-var-picker.test.js`.

---

## [2026-04-29] Plugin poll loop must be self-healing — watchdog + try/catch on every command handler

**Decision:** Every command dispatched to the plugin from `ui.html` arms a watchdog timer that resets `isExtracting` and resumes polling if the plugin code doesn't respond in time. Every command handler in `code.js` wraps its body in try/catch and always calls `figma.ui.postMessage` — including on error, so the UI always gets a response and polling always resumes.

**Why:**
- Before this change, a silent crash in `serializeNode` (or any other plugin-side throw) left `isExtracting = true` permanently, killing the poll loop for the rest of the session. The only recovery was closing and reopening the plugin.
- The plugin sandbox swallows uncaught errors without notifying the UI. There is no equivalent of `window.onerror` for the sandbox. The only reliable contract is: every message dispatched to `code.js` must produce a reply.
- Watchdog timers on the UI side are the only defense against plugin code that hangs or crashes without posting back. Each command has a generous but bounded timeout (12s inspect, 30s sync, 60s doc/setup, 120s showcase).

**Consequence:** The plugin self-heals after any crash or hang. A failed command produces an error result (not silence), the UI disarms the watchdog, resets state, and resumes polling. The MCP tool also retries 503/504 up to 3× with 1.5s delay so transient disconnects during the retry window are handled without surfacing to the user.

---

## [2026-04-29] Spec sheet containers must FILL width and HUG height — no custom row builders

**Decision:** Every container in `_buildComponentDoc` that holds variable-height content must set `layoutSizingHorizontal = 'FILL'` (fills the doc frame width) and either `counterAxisSizingMode = 'AUTO'` or `primaryAxisSizingMode = 'AUTO'` to hug content height. Text nodes inside containers must use `layoutSizingHorizontal = 'FILL'` + `textAutoResize = 'HEIGHT'` — never `WIDTH_AND_HEIGHT`. Custom row/cell builders are prohibited: always use the proven `_mkTable/_mkRow/_mkCell` helpers for tabular data.

**Why:**
- `WIDTH_AND_HEIGHT` text auto-resize lets text nodes grow horizontally without bound, escaping their container and overflowing the doc frame. `FILL + HEIGHT` constrains width to the parent and grows height instead.
- Frames without explicit `counterAxisSizingMode = 'AUTO'` default to a fixed height (typically 100px), silently clipping taller content (e.g., a 169px component preview, long rule text in Do/Don't panels).
- Custom row builders reliably produce 0px-tall text rows because the auto-layout sizing semantics (when to set `textAutoResize` vs `layoutSizingHorizontal`, and in what order relative to `appendChild`) are non-obvious. The proven helpers encode the correct sequence.

**Consequence:** All new sections added to the spec sheet must follow this sizing contract. A new tabular section must use `_mkTable/_mkRow/_mkCell`. A new non-tabular container must explicitly set FILL + HUG. Violations produce invisible or overflowing content that is hard to debug visually.

---

## [2026-04-27] Variable purpose is a semantic contract — purpose locks enforced via requiredCats

**Decision:** Every `_semPick` call that targets a specific-purpose slot (outline/border, surface/fill, text/fg) passes a `requiredCats` array. A candidate variable must contribute to all required categories to be considered — regardless of its role score. The functional fallback is also blocked when `requiredCats` is set. If no purpose-correct variable exists, the slot returns null.

Applied consistently:
- `outlineSubtle`, `outlineBrand`, `successBorder`, `warningBorder` → `['OUTLINE']`
- `successBg`, `warningBg` → `['BG']`
- `successText`, `warningText` → `['FG']`

Structural roles (`onSurface`, `surfaceDefault`, etc.) do not use `requiredCats` — they retain the functional fallback for DSes with entirely non-semantic naming.

**Why:**
- A variable path encodes its intended purpose. `color/outline/warning` is a border token; `color/icon/warning` is an icon-fill token. Using a wrong-purpose variable is a semantic error even if it scores positively for a role.
- The scoring system can assign a positive score to a variable with the wrong purpose if the status keyword (e.g. `warning`) dominates over the purpose keyword (e.g. `icon` vs `outline`). `requiredCats` is a hard filter that scoring alone cannot provide.
- This is also a QA contract: designers are expected to name variables according to their purpose. The showcase and future QA tools enforce the same rule.

**Consequence:** Status badge borders and fills only bind to variables that are explicitly named for that purpose. If the DS has no `outline/warning` variable, the badge renders without a border rather than borrowing an icon or surface token. Unit-tested in scenarios 14–16 of `tests/core/semantic-var-picker.test.js`.

---

## [2026-04-27] Bind showcase variables by path-segment scoring, not regex name matching

**Decision:** Replace all regex-based name pattern matching in `_buildShowcase()` with a segment-weighted scoring system (`_SEG` dictionary + `_segScore`). Every `/`-separated segment in a variable path contributes a positive or negative score to each semantic role. The variable with the highest total score wins. Functional scoring (contrast, luminance, saturation) runs only as a last resort when no variable scores above zero.

**Why:**
- Regex substring matching was semantically blind: `/surface/` matched `on-surface/default`, causing a foreground text token to be picked as a background.
- Name matching treated the path as an opaque string. Segment scoring treats each component as a meaningful signal — `on-surface` and `surface` are semantically opposite, which is now encoded directly.
- DSes with unconventional naming (e.g. `fg/primary` instead of `on-surface/default`) are understood via segment meaning rather than requiring a contrast fallback.
- The DS author's naming convention is trusted first. Functional scoring (contrast, lum, sat) only runs if the DS has no recognisable semantic keywords at all.
- All `_C.xxx` hardcoded fallback colors replaced with `_RC.xxx` — a resolved-color map that reads the DS variable's actual first-mode value, falling back to `_C` only if the variable is absent entirely.

**Consequence:** Variable bindings adapt to any DS naming convention that uses recognisable semantic keywords. Adding new naming conventions is a one-line dictionary entry. Status token disambiguation (`surface/success` vs `outline/success` vs `on-surface/success`) is handled by combined segment scores, not separate regex lists. Unit-tested in `tests/core/semantic-var-picker.test.js`.

---

## [2026-04-24] Always show the indicator glyph for icon tokens regardless of contrast threshold

**Decision:** `_buildSwatch` accepts a `forceIndicator` option. When set to `true`, the sample text glyph (☻) is rendered unconditionally. This option is passed for all icon token swatches. The WCAG badge continues to grade the actual contrast ratio independently.

**Why:**
- The default `≥ 4.5:1` threshold for rendering the glyph was suppressing it on icon swatches at 3–4:1 — tokens that are not text but are still meaningful to display.
- Icons operate at a different WCAG threshold (3:1 for graphical elements) and the glyph is the only visual indicator in the swatch cell; omitting it makes the swatch appear empty.
- Separating the "show the glyph" decision from the "pass WCAG AA" decision is cleaner: `forceIndicator` controls presence, the badge controls grading.

**Consequence:** Icon swatches always show the indicator glyph. Non-icon swatches continue to gate on 4.5:1. The WCAG badge reflects true pass/fail for both.


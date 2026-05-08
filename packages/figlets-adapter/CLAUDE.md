# figlets adapter — Claude orchestration

Thin orchestration layer for Claude Code and Claude Desktop over the figlets-mcp tools.
All deterministic Figma analysis happens inside the MCP tools — this file defines when to call what, how to handle ambiguity, and what to surface to the user.

---

## Prerequisites

1. figlets-mcp server running and configured in your MCP config (see `docs/mcp-config-examples.md`)
2. For live Figma data: figma-bridge-plugin open in Figma Desktop (port 1337)

---

## Tools

| Tool | Purpose | When to use |
|------|---------|-------------|
| `sync_figma_data` | Triggers the bridge plugin to extract the full DS snapshot and save it to `.local/figma-data.json` | Before any analysis when the user wants fresh data from Figma |
| `detect_design_system` | Analyzes the snapshot: collections, variables, styles, inferred capabilities | After syncing, or when a snapshot already exists on disk |
| `inspect_component` | Extracts layout, variants, and properties of the currently selected Figma node | When the user wants to inspect a specific component or frame |
| `audit_tokens` | Reports unaliased values, duplicate tokens, and naming violations in the snapshot | When the user wants a token health check |
| `qa_binding_audit` | Audits the current Figma selection/page for raw unbound layer properties and optional safe binding fixes | When the user wants QA on designed frames/components, especially before documentation |
| `build_ds_showcase` | Renders a full token showcase in Figma — colors, typography, spacing, elevation, scrims | When the user wants a visual overview of the design system rendered as Figma frames |
| `create_ds_config_from_design_md` | Creates a starter `design-system.config.js` from an existing Google DESIGN.md file | At the start of setup when the designer already has DESIGN.md and wants to skip answered intake questions |
| `prepare_ds_config` | Runs the computation pipeline on a design-system.config.js: color ramps, contrast validation (APCA or WCAG), spacing scale | After intake and before building collections — validates everything before touching Figma |
| `apply_ds_setup` | Creates all 5 variable collections in Figma from the prepared config (Primitives, Color, Typography, Spacing, Elevation) | After `prepare_ds_config` confirms `readyToBuild === true` |
| `update_ds_primitives` | Updates values of EXISTING primitive variables in place (variable IDs preserved, aliases stay intact). Supported categories today: `color`, `spacing`. Use after re-running `prepare_ds_config` to push only changed values into Figma without recreating collections. | After tweaking the config (e.g. switching color algorithm, adjusting spacing scale) when the Primitives collection already exists in Figma. |
| `generate_component_doc` | Renders a complete spec sheet for a component inside Figma (preview, variants, properties, sizing, anatomy, usage) AND returns the markdown body for `component-specs/[Name].md`. Also writes a `[SPEC]` block to the component description for MCP handover. | When the user wants to document a component for design + LLM code handover. The component must be on the current Figma page. |

---

## Intent Routing

Designers should be able to ask in natural language. Route their intent to MCP tools, but do not move product logic into the prompt.

| Designer says... | Agent should... |
|---|---|
| "Build a showcase of my design system" | Explain that you'll check what the file contains, ask them to keep the Figlets Bridge plugin open, then run the showcase workflow. |
| "Check my design system" | Run a health check workflow: sync if needed, detect the system, audit tokens, and summarize the highest-impact issues. |
| "QA this frame/component" | Ask them to select the target in Figma, run `qa_binding_audit` without fixes, then summarize raw/unbound values. |
| "Fix the binding gaps" | Confirm they want automatic safe fixes, then run `qa_binding_audit` with `fix: true`. |
| "Set up a design system" | Walk through setup intake in plain language, show previews, then use `prepare_ds_config` and `apply_ds_setup`. |
| "Document this component" | Ask them to select the component, inspect it, craft human usage copy, then call `generate_component_doc`. |

Keep the designer-facing language non-technical. Say "I'll check what's available in the file" rather than "I'll call `sync_figma_data` and `detect_design_system`." Tool names are for internal clarity and debugging, not the default user experience.

---

## Workflows

### Detect design system
1. Ask: "Sync fresh data from Figma first, or analyze the existing snapshot?"
2. If fresh: call `sync_figma_data`
3. Call `detect_design_system`
4. Summarize: collection names, variable counts by type, text and effect style counts, inferred capabilities

### Inspect a component
1. Ask the user to select the target node in Figma Desktop, then wait for confirmation
2. Call `inspect_component`
3. Summarize: name, type, layout mode, padding and spacing, variants, key children and their bindings

### Audit tokens
1. Ask: "Sync fresh data first, or audit the existing snapshot?"
2. If fresh: call `sync_figma_data`
3. Call `audit_tokens`
4. Report violations by type: unaliased values → duplicate tokens → naming inconsistencies
5. Surface the highest-impact fixes first

### QA binding audit
1. Ask the user to select the frame/component to QA, or confirm that auditing the current page is intended.
2. Call `qa_binding_audit` with `fix: false`.
3. Summarize unbound raw values by type: color, spacing, border, typography.
4. Treat suggestions as semantic binding suggestions, not hex/value guesses. Color, spacing, radius, and border suggestions are variable-first; typography may prefer text styles because they bundle variable-backed type decisions. If a violation has no suggestion, report that the DS lacks a matching variable/style and raw values would remain.
5. If the user asks to fix everything, call `qa_binding_audit` with `fix: true`; report fixed and failed counts.

### Build token showcase
1. Tell the designer: "I'll check what this file exposes, then build the showcase sections that apply. Please keep the Figlets Bridge plugin open in Figma."
2. Call `sync_figma_data` if fresh data is needed (or skip if already synced)
3. By default, call `build_ds_showcase` with no options. It renders what the design system exposes and keeps descriptions deterministic and cheap.
4. If the user explicitly accepts numeric nearest/floor fallback for generated showcase chrome, call `build_ds_showcase` with `numericFallback`, for example `{ "radius": "nearest", "border": "floor", "maxDistance": 8 }`. Exact token matches still win; colors never use nearest fallback.
5. Report which sections were built (Colors, Typography, Spacing, Elevation, Scrims)
6. Tell the user to look at the "00 · Tokens" page in their Figma file

### Set up a new design system (bootstrap collections)
1. Ask whether the designer already has a Google `DESIGN.md`. If yes, call `create_ds_config_from_design_md` to create the starter config, then only ask for missing or intentionally overridden answers. Treat DESIGN.md as imported intake answers, not as the final source of truth.
2. Run any remaining intake: project name, platform, grid base (4px/8px), breakpoints (3-tier/4-tier), naming convention (role-based/surface-based), **contrast standard (APCA default / WCAG 2.2)**, color scale, brand colors (name + hex), typeface, typography preset.
   When asking about contrast standard, give the short pros/cons:
   - **APCA (default)** — perceptually accurate, designed for WCAG 3, more lenient on yellows and accurate on dark mode where WCAG is overly strict; *not yet a legal standard*.
   - **WCAG 2.2** — current legal standard for ADA / Section 508 / EN 301 549; well understood; can over-fail dark themes and under-fail bright yellows.
3. Write or update `design-system.config.js` with all intake answers: `DS.grid`, `DS.breakpoints`, `DS.typography.families`, `DS.typography.scalePreset`, `DS.color.brand`, `DS.color.scale`, `DS.color.convention`, `DS.color.contrastAlgorithm` (`'apca'` default, `'wcag'` if the user picked it), `DS.collections.*`, `DS.naming.*`
4. Call `prepare_ds_config` with the config path
5. Show the user: spacing preview, color ramps table, semantic pairs table (both APCA Lc and WCAG ratios are visible side-by-side; the gated `failCount` reflects whichever standard the designer chose), and the generated `DESIGN.md` export path if present.
6. If `failCount > 0`: show which pairs fail under the chosen standard, suggest the nearest passing step, update the config, re-run
7. If `needsDesignerInput` contains `DS.typography.scale`: ask the designer for the missing type scale, write it to the config, re-run `prepare_ds_config`
8. Ask: "Does this all look right? Ready to build in Figma?"
9. Once confirmed and `readyToBuild === true`: ask the user to keep the Figlets Bridge plugin open
10. Call `apply_ds_setup` with the config path
11. Report: collections created, any skipped (already existed), config path, and `DESIGN.md` export path for reference

Optional DESIGN.md follow-ups:
- Suggest `npx @google/design.md lint DESIGN.md` only when the designer wants external spec validation or plans to share the file with coding agents.
- Suggest DESIGN.md diff/drift checks only with designer permission. Do not run network-dependent lint/diff automatically.

### Update primitive values in place
Use this when only some primitive values changed — for example, the designer switched `DS.color.algorithm` from HSL to OKLCh, switched `DS.color.contrastAlgorithm` between APCA and WCAG, or adjusted the spacing scale — and the Primitives collection already exists in Figma. This avoids the destructive delete-and-rebuild path and keeps every alias from Color/Typography/Spacing/Elevation collections intact.

When the designer flips `DS.color.contrastAlgorithm`, expect `failCount` to change — APCA and WCAG do not always agree on which pairs pass. Surface the difference plainly: "switching to APCA cleared 2 previously failing pairs" or "switching to WCAG flagged 3 pairs that passed APCA". The choice itself is not a code change in Figma; only the readiness verdict and the showcase render reflect it.

1. Confirm the user has already run `prepare_ds_config` on the updated config (so `DS.color.ramps` reflects the new values).
2. Ask the user to keep the Figlets Bridge plugin open in Figma Desktop.
3. Ask which categories they want updated. Today: `color`, `spacing`. If they don't say, default to all supported categories.
4. Call `update_ds_primitives` with `config_path` and optional `categories`.
5. Report per-category counts: updated, unchanged, missing (variables in the config that don't exist in Figma — usually means the scale grew and a fresh `apply_ds_setup` is needed for those).
6. Do not call this for first-time creation — use `apply_ds_setup` for that. Do not call this to add new categories of primitives that don't exist in Figma yet.

### Document a component
The Figma spec sheet is for **humans**; the markdown handover is for **agents**. The plugin renders structure and tangible data (variants, sizing, anatomy, token names). The agent must supply the human-readable content — never rely on generic defaults.

1. Ask the user to navigate to the Figma page containing the target component (it must be on the current page), select the component or component set, and keep the Figlets Bridge plugin open.
2. **Inspect first.** Call `inspect_component` (after asking the user to select the component) or read the existing `figma-data.json` snapshot to understand: what the component is, its variants, properties, anatomy, and likely use cases.
3. **Pre-flight readiness check.** Before generating, evaluate the inspection result for two issues that degrade spec quality. Report any findings to the user clearly and ask whether they'd like to fix them in Figma first or proceed as-is:

   **a. Generic layer names** — scan all direct and shallow children for Figma default names: `Frame NNN`, `Group NNN`, `Rectangle NNN`, `Ellipse NNN`, `Vector NNN`, `Component NNN`. These names appear as-is in the Anatomy section of the spec sheet. Renamed layers produce a readable anatomy; default names produce noise. Example message: _"I noticed 3 layers still have default Figma names (Frame 12, Rectangle 7, Group 3). Renaming them in Figma before generating will make the Anatomy section readable for developers. Want to fix that first, or proceed now?"_

   **b. Missing component properties** — if the node is a COMPONENT_SET with variants but `componentPropertyDefinitions` is empty or has no entries, the Properties table in the spec sheet will be empty. Component properties (boolean toggles, text overrides, variant selectors) are what developers interact with at the API level; without them the spec is incomplete. Example message: _"This component has N variants but no component properties defined. Adding properties in Figma (text overrides, boolean toggles, variant switches) will make the Properties table meaningful. Proceed without them, or fix in Figma first?"_

   If both issues are present, report them together. If the user chooses to fix in Figma: wait for confirmation that they're done, then re-inspect before proceeding. If the user proceeds as-is: continue without further prompting.

4. **Craft the content** based on what you learned. If the user supplied any of these, use their wording verbatim; otherwise generate them yourself as a UX expert would:
   - `description` — 1–2 sentences: what the component is and when to use it
   - `usage_do` — 2–3 rules grounded in this specific component's purpose (not generic "ensure 44px touch target" boilerplate unless that's actually the key concern here)
   - `usage_dont` — 2–3 rules grounded in misuse risks specific to this component
   - `variant_descriptions` — map of exact variant name → ≤10-word purpose
5. Call `generate_component_doc` with `component_name` plus all four content inputs.
6. Use the Write tool to save the returned `markdown` to the returned `path` (e.g. `component-specs/Button.md`). Confirm the path with the user first if it's a new directory.
7. Tell the user: spec sheet rendered in the Documentation section, markdown saved locally, `[SPEC]` block written to the component description for MCP handover.

### Full design system health check
1. Call `sync_figma_data`
2. Call `detect_design_system`
3. Call `audit_tokens`
4. Deliver one combined summary: capabilities detected, variable and style counts, violation breakdown, recommended next steps

---

## Error handling

| Symptom | Cause | What to tell the user |
|---------|-------|-----------------------|
| `sync_figma_data` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `inspect_component` returns empty selection | Nothing selected in Figma | "Select a component or frame in Figma, then try again." |
| `detect_design_system` returns no collections | No snapshot on disk | "Run a sync first to pull data from Figma." |
| `audit_tokens` returns no violations | Clean token set or no snapshot | Confirm snapshot exists; if it does, report the all-clear to the user |
| `qa_binding_audit` returns violations with no suggestion | The selected layer uses a value/role not covered by existing variables or typography styles | Tell the user the binding policy could not find a matching DS variable/style; the DS may need a new token or the layer role may need adjustment |
| `qa_binding_audit` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `build_ds_showcase` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `prepare_ds_config` returns error about missing ramps | Config missing `DS.color.brand` | "Add brand color(s) to the config (name + hex) and try again." |
| `prepare_ds_config` returns `failCount > 0` | Semantic pairs fail contrast | Show the pairs table, suggest the nearest passing step, update the config, re-run |
| `apply_ds_setup` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `update_ds_primitives` returns "Primitives collection ... not found" | The collection has not been built yet in this Figma file | Tell the user to run `apply_ds_setup` first; in-place update only works on an existing Primitives collection |
| `update_ds_primitives` returns variables in `unmatched` | The config defines tokens that don't exist in Figma yet (e.g. new color stops added after setup) | Tell the user; offer either a fresh `apply_ds_setup` (after deleting the old Primitives) or to drop those new tokens from the config |
| `update_ds_primitives` says the connected plugin does not advertise the command | Local development build mismatch | For designers, say "The bridge is connected but this command is unavailable in the current plugin session." For developers, reload the local Figlets Bridge plugin so it loads the latest code. |
| `update_ds_primitives` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `generate_component_doc` returns "Component not found on current page" | The component is on a different page or named differently | Ask the user to navigate to the page with the component, or confirm the exact component name |
| `generate_component_doc` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `apply_ds_setup` collection skipped | Collection already exists | Report which were skipped; offer to delete and rebuild if user wants a clean slate |

---

## Rules

- Never embed design system analysis logic in the prompt — call the MCP tools instead
- Never modify plugin scripts, binding rules, QA rules, or generated output as part of a public designer workflow. If the designer asks for unsupported behavior, explain the gap and treat it as a product request.
- Never ask the user for variable names, token values, or collection names — the tools extract these from Figma
- Never call `inspect_component` without first confirming the user has selected a node in Figma
- Never call `detect_design_system` or `audit_tokens` without checking whether a sync is needed first
- Never present raw JSON tool output directly — always summarize into plain language
- Treat the shared binding resolver as the binding authority. Color and scalar bindings are variable-first; typography may prefer text styles because they can bundle variable-backed type decisions. Never invent hex or nearest-color auto-binding.
- Never add agent reasoning steps to `build_ds_showcase` unless the user explicitly opts into a supported parameter such as `numericFallback`. Showcase descriptions are deterministic by default; agent-enriched description polish is post-MVP and should only run when the user asks for it.
- Never call `apply_ds_setup` until `prepare_ds_config` returns `readyToBuild === true` — building with failing pairs will produce inaccessible tokens
- Never hardcode token values in intake — all values come from the user and are written to the config file
- Never skip showing the semantic pairs table before building — the user must confirm contrast ratios before any collections are created

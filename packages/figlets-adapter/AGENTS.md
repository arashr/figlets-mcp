# figlets adapter — Codex orchestration

Thin orchestration layer for Codex CLI over the figlets-mcp tools.
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
| `build_ds_showcase` | Renders a full token showcase in Figma — colors, typography, spacing, elevation, scrims | When the user wants a visual overview of the design system rendered as Figma frames |
| `prepare_ds_config` | Runs the computation pipeline on a design-system.config.js: color ramps, WCAG validation, spacing scale | After intake and before building collections — validates everything before touching Figma |
| `apply_ds_setup` | Creates all 5 variable collections in Figma from the prepared config (Primitives, Color, Typography, Spacing, Elevation) | After `prepare_ds_config` confirms `readyToBuild === true` |
| `generate_component_doc` | Renders a complete spec sheet for a component inside Figma (preview, variants, properties, sizing, anatomy, usage) AND returns the markdown body for `component-specs/[Name].md`. Also writes a `[SPEC]` block to the component description for MCP handover. | When the user wants to document a component for design + LLM code handover. The component must be on the current Figma page. |

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

### Build token showcase
1. Call `sync_figma_data` if fresh data is needed (or skip if already synced)
2. Ask the user to keep the Figma plugin open — rendering happens inside Figma
3. Call `build_ds_showcase`
4. Report which sections were built (Colors, Typography, Spacing, Elevation, Scrims)
5. Tell the user to look at the "00 · Tokens" page in their Figma file

### Set up a new design system (bootstrap collections)
1. Run intake: project name, platform, grid base (4px/8px), breakpoints (3-tier/4-tier), naming convention (role-based/surface-based), color scale, brand colors (name + hex), typeface, typography preset
2. Write `design-system.config.js` with all intake answers: `DS.grid`, `DS.breakpoints`, `DS.typography.families`, `DS.typography.scalePreset`, `DS.color.brand`, `DS.color.scale`, `DS.color.convention`, `DS.collections.*`, `DS.naming.*`
3. Call `prepare_ds_config` with the config path
4. Show the user: spacing preview, color ramps table, semantic pairs table (with WCAG ratios), failCount
5. If `failCount > 0`: show which pairs fail, suggest the nearest passing step, update `DS.color.semantics.pairs` in the config, re-run `prepare_ds_config` until `failCount === 0`
6. If `needsClaude` contains `DS.typography.scale`: generate the custom scale, write it to the config, re-run `prepare_ds_config`
7. Ask: "Does this all look right? Ready to build in Figma?"
8. Once confirmed and `readyToBuild === true`: ask the user to keep the Figlets Bridge plugin open
9. Call `apply_ds_setup` with the config path
10. Report: collections created, any skipped (already existed), config path for reference

### Document a component
The Figma spec sheet is for **humans**; the markdown handover is for **agents**. The plugin renders structure and tangible data (variants, sizing, anatomy, token names). The agent must supply the human-readable content — never rely on generic defaults.

1. Ask the user to navigate to the Figma page containing the target component (it must be on the current page), select the component or component set, and keep the Figlets Bridge plugin open.
2. **Inspect first.** Call `inspect_component` (after asking the user to select the component) or read the existing `figma-data.json` snapshot to understand: what the component is, its variants, properties, anatomy, and likely use cases.
3. **Pre-flight readiness check.** Before generating, evaluate the inspection result for two issues that degrade spec quality. Report any findings to the user clearly and ask whether they'd like to fix them in Figma first or proceed as-is:

   **a. Generic layer names** — scan all direct and shallow children for Figma default names: `Frame NNN`, `Group NNN`, `Rectangle NNN`, `Ellipse NNN`, `Vector NNN`, `Component NNN`. These appear as-is in the Anatomy section. Renamed layers produce a readable anatomy; default names produce noise. Example message: _"I noticed 3 layers still have default Figma names (Frame 12, Rectangle 7, Group 3). Renaming them will make the Anatomy section readable for developers. Fix first, or proceed?"_

   **b. Missing component properties** — if the node is a COMPONENT_SET with variants but `componentPropertyDefinitions` is empty, the Properties table will be empty. Component properties are what developers interact with at the API level. Example message: _"This component has N variants but no component properties defined. Adding properties (text overrides, boolean toggles, variant switches) will make the Properties table meaningful. Proceed without them, or fix first?"_

   If both issues are present, report them together. If the user chooses to fix in Figma: wait for confirmation, then re-inspect before proceeding. If the user proceeds as-is: continue without further prompting.

4. **Craft the content** based on what you learned. If the user supplied any of these, use their wording verbatim; otherwise generate them yourself as a UX expert would:
   - `description` — 1–2 sentences: what the component is and when to use it
   - `usage_do` — 2–3 rules grounded in this specific component's purpose
   - `usage_dont` — 2–3 rules grounded in misuse risks specific to this component
   - `variant_descriptions` — map of exact variant name → ≤10-word purpose
5. Call `generate_component_doc` with `component_name` plus all four content inputs.
6. Use the Write tool to save the returned `markdown` to the returned `path`. Confirm the path with the user first if it's a new directory.
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
| `build_ds_showcase` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `prepare_ds_config` returns error about missing ramps | Config missing `DS.color.brand` | "Add brand color(s) to the config (name + hex) and try again." |
| `prepare_ds_config` returns `failCount > 0` | Semantic pairs fail contrast | Show the pairs table, suggest nearest passing step, update config, re-run |
| `apply_ds_setup` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `apply_ds_setup` collection skipped | Collection already exists | Report which were skipped; offer to delete and rebuild if user wants a clean slate |
| `generate_component_doc` returns "Component not found on current page" | The component is on a different page or named differently | Ask the user to navigate to the page with the component, or confirm the exact component name |
| `generate_component_doc` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |

---

## Rules

- Never embed design system analysis logic in the prompt — call the MCP tools instead
- Never ask the user for variable names, token values, or collection names — the tools extract these from Figma
- Never call `inspect_component` without first confirming the user has selected a node in Figma
- Never call `detect_design_system` or `audit_tokens` without checking whether a sync is needed first
- Never present raw JSON tool output directly — always summarize into plain language
- Never add reasoning steps to `build_ds_showcase` — it renders exactly what it detects, no decisions needed
- Never call `apply_ds_setup` until `prepare_ds_config` returns `readyToBuild === true` — building with failing pairs will produce inaccessible tokens
- Never hardcode token values in intake — all values come from the user and are written to the config file
- Never skip showing the semantic pairs table before building — the user must confirm WCAG ratios before any collections are created

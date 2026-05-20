# figlets adapter — Codex orchestration

Thin orchestration layer for Codex CLI over the figlets-mcp tools.
All deterministic Figma analysis happens inside the MCP tools — this file defines when to call what, how to handle ambiguity, and what to surface to the user.

---

## Prerequisites

1. figlets-mcp server running and configured in your MCP config (see `docs/mcp-config-examples.md`)
2. For live Figma data: figma-bridge-plugin open in Figma Desktop (default port 17337)

---

## Tools

| Tool | Purpose | When to use |
|------|---------|-------------|
| `figlets_start` | Returns the Agent Interface intro, safety contract, runtime environment hints, capability menu, and first designer-facing question | At the start of a Figlets conversation, before improvising workflow steps |
| `figlets_route_intent` | Maps the designer's natural-language request to the most likely Figlets workflow | After the designer says what they want, especially when the wording is broad or ambiguous |
| `figlets_workflow_guide` | Returns the step-by-step contract for a workflow, including read/write steps, confirmation points, error recovery, and next flows | Before running a workflow that could lead to Figma writes or local file writes |
| `sync_figma_data` | Triggers the bridge plugin to extract the full DS snapshot and save it to `.local/figma-data.json` | Before any analysis when the user wants fresh data from Figma |
| `detect_design_system` | Analyzes the snapshot: collections, variables, styles, inferred capabilities | After syncing, or when a snapshot already exists on disk |
| `inspect_component` | Extracts layout, variants, and properties of the currently selected Figma node | When the user wants to inspect a specific component or frame |
| `audit_tokens` | Reports token inventory plus real raw-value, duplicate, and naming issues in the snapshot. Primitive values are inventory, not defects. | When the user wants token hygiene checked as part of broader DS QA |
| `qa_binding_audit` | Audits the current Figma selection/page for raw unbound layer properties and optional safe binding fixes | When the user wants QA on designed frames/components, especially before documentation |
| `build_ds_showcase` | Renders a full token showcase in Figma — colors, typography, spacing, elevation, scrims | When the user wants a visual overview of the design system rendered as Figma frames |
| `refresh_ds_config_from_figma` | Refreshes existing config entries from the synced Figma snapshot without creating new config tokens or mutating Figma | Before config-backed setup/update/showcase work when Figma may have changed since the config was written |
| `inspect_ds_setup_gaps` | Reports semantic setup/accessibility gaps and deterministic repair suggestions from the synced Figma snapshot without mutating Figma or config | Inside the design-system health check, before asking the designer to approve any repair |
| `inspect_ds_token_gaps` | Read-only planner for config-backed non-color token gaps. Reports future `update_ds_tokens` preview/apply payload placeholders plus missingCapabilityNotes for unsupported categories; it does not write Figma. | When a designer asks about missing typography, spacing, radius, border-width, or elevation tokens beyond semantic color setup |
| `update_ds_tokens` | Dry-run preview for config-backed non-color token completion, plus narrow approved apply for `radius`, `border-width`, `spacing-semantics`, and `typography-variables` only. Broad typography text styles and elevation remain product-gap scope. | After `inspect_ds_token_gaps` emits `repairPlan.previewInput`; only call `repairPlan.applyInput` after designer approval and only for the filtered apply-supported categories |
| `apply_ds_setup_repairs` | Applies only designer-approved setup repairs, alias updates, and missing role creations, then updates the file-scoped config after Figma succeeds | After `inspect_ds_setup_gaps` and explicit designer confirmation |
| `create_ds_config_from_design_md` | Creates a starter `design-system.config.js` from an existing Google DESIGN.md file | At the start of setup when the designer already has DESIGN.md and wants to skip answered intake questions |
| `export_design_md` | Syncs the Figma file, refreshes `design-system.config.js` from the latest snapshot, and writes a portable `DESIGN.md` next to the config (or to a custom path) | When the designer wants a fresh DESIGN.md handover artifact without re-running the full setup flow. Supports `dry_run` for preview. |
| `prepare_ds_config` | Runs the computation pipeline on a design-system.config.js: color ramps, contrast validation (APCA or WCAG), spacing scale | After intake and before building collections — validates everything before touching Figma |
| `apply_ds_setup` | Creates all 5 variable collections in Figma from the prepared config (Primitives, Color, Typography, Spacing, Elevation) | After `prepare_ds_config` confirms `readyToBuild === true` |
| `update_ds_primitives` | Updates values of EXISTING primitive variables and color semantic aliases in place (variable IDs preserved, aliases stay intact). Supported categories today: `color`, `spacing`, `color-semantics`. Use after re-running `prepare_ds_config` to push only changed values into Figma without recreating collections. | After tweaking the config (e.g. switching color algorithm, adjusting spacing scale) when the Primitives or Color collection already exists in Figma. |
| `generate_component_doc` | Renders a complete spec sheet for a component inside Figma (preview, variants, properties, sizing, anatomy, usage) AND returns the markdown body for `component-specs/[Name].md`. Also writes a `[SPEC]` block to the component description for MCP handover. | When the user wants to document a component for design + LLM code handover. The component must be on the current Figma page. |

---

## Intent Routing

Designers should be able to ask in natural language. Route their intent to MCP tools, but do not move product logic into the prompt.

| Designer says... | Agent should... |
|---|---|
| "Build a showcase of my design system" | Explain that you'll check what the file contains, ask them to keep the Figlets Bridge plugin open, then run the showcase workflow. |
| "Check my design system" | Run the full QA workflow: sync if needed, detect the system, audit tokens, inspect semantic setup gaps, summarize the highest-confidence issues first, then ask whether to apply the exact suggested repairs. |
| "QA this frame/component" | Ask them to select the target in Figma, run `qa_binding_audit` without fixes, then summarize raw/unbound values. |
| "Fix the binding gaps" | Confirm they want automatic safe fixes, then run `qa_binding_audit` with `fix: true`. |
| "Set up a design system" | Walk through setup intake in plain language, show previews, then use `prepare_ds_config` and `apply_ds_setup`. |
| "Document this component" | Ask them to select the component, inspect it, craft human usage copy, then call `generate_component_doc`. |

Keep the designer-facing language non-technical. Say "I'll check what's available in the file" rather than "I'll call `sync_figma_data` and `detect_design_system`." Tool names are for internal clarity and debugging, not the default user experience.

When starting a fresh Figlets conversation, call `figlets_start` first and use its `designerResponse` as the opening response whenever possible. It intentionally uses a capability-menu format; preserve that shape instead of inventing a broad capability list. Use `figlets_route_intent` to pick a workflow from the designer's words, then call `figlets_workflow_guide` before executing the workflow. These Agent Interface tools are read-only; they exist so agents can follow the same product contract across runtimes.

Do not broaden the Figlets introduction with generic Figma authoring capabilities from other MCP servers such as figma-console. Figlets is the design-system workflow layer: setup, QA, approved repair, showcase, component documentation, and DESIGN.md export.

Never offer "Plugin / MCP server code", repo editing, plugin editing, or arbitrary Figma create/delete/move actions in the designer-facing menu. Those are developer tasks, not Figlets designer workflow options.

Bulk design-system updates are part of Figlets when the change can be expressed as a structured, designer-approved payload. Use the workflow's bulk-capable tools and data: `inspect_ds_setup_gaps.repairPlan.applyInput` with `apply_ds_setup_repairs`, `update_ds_primitives`, and `qa_binding_audit({ fix: true })`. If a designer asks for a bulk repair that Figlets cannot yet plan or apply, call that out as a Figlets product/tool gap or proposed feature scope instead of saying the gaps cannot be fixed. Do not write custom scripts to fill that gap in Designer Mode.

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
4. Report true issues by severity, then mention primitive/raw-value inventory separately and neutrally
5. Do not describe primitive collections as unhealthy just because they intentionally hold literal values

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
6. If `failCount > 0`: show which pairs fail under the chosen standard, suggest nearest passing step, update config, re-run
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

1. Run `sync_figma_data`, then `refresh_ds_config_from_figma` to update existing config entries from current Figma values without creating new config tokens or mutating Figma.
2. Ask the user to keep the Figlets Bridge plugin open in Figma Desktop.
3. Run `inspect_ds_setup_gaps` to report additive repair candidates from current Figma state without mutating Figma or config.
4. Ask which categories to update. Today: `color`, `spacing`, `color-semantics`. If unspecified, default to all supported categories.
5. For setup repair gaps, ask the designer which proposed repairs to apply, then call `apply_ds_setup_repairs` with only those approved repairs.
6. For config-backed value updates, run `prepare_ds_config` and call `update_ds_primitives` first with `dry_run: true` and the intended `create_missing` setting. Report `wouldCreateNames`, `wouldCreate`, `wouldUpdate`, `unmatched`, and substitutions, then ask the designer what to apply.
7. Only after confirmation, call `update_ds_primitives` again with `dry_run: false` and the designer-approved categories/options.
8. Report per-category counts: updated, unchanged, created, missing, substituted.
9. Do not call this for first-time creation — use `apply_ds_setup` for that.

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
4. Call `inspect_ds_setup_gaps`
5. Deliver one combined summary: high-confidence semantic gaps and accessibility failures first, then token issues, then capabilities and inventory. Do not report "healthy" unless both token audit and setup-gap QA have no high-confidence issues.
6. If there are approved repair suggestions in the QA output (`plannedAliases`, `plannedReAlias`, or `plannedRoleRepair` on high-confidence `missingSemanticRoles`), ask the designer which exact repairs to apply in the same QA flow. Do not offer to run a separate setup-gap flow after already showing those gaps.
7. Prefer `inspect_ds_setup_gaps.repairPlan.applyInput` as the source for approved repairs. If the designer approves all suggested repairs, pass that object directly to `apply_ds_setup_repairs`; if they approve only some, filter that object without deriving new aliases.
8. If approved, call `apply_ds_setup_repairs` with only the approved structured repairs, then call `inspect_ds_setup_gaps` again to verify.

---

## Error handling

| Symptom | Cause | What to tell the user |
|---------|-------|-----------------------|
| `sync_figma_data` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `inspect_component` returns empty selection | Nothing selected in Figma | "Select a component or frame in Figma, then try again." |
| `detect_design_system` returns no collections | No snapshot on disk | "Run a sync first to pull data from Figma." |
| `audit_tokens` returns no violations | Token hygiene is clean or no snapshot exists | Confirm snapshot exists, then still run `inspect_ds_setup_gaps` before reporting the design system healthy |
| `qa_binding_audit` returns violations with no suggestion | The selected layer uses a value/role not covered by existing variables or typography styles | Tell the user the binding policy could not find a matching DS variable/style; the DS may need a new token or the layer role may need adjustment |
| `qa_binding_audit` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `build_ds_showcase` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `prepare_ds_config` returns error about missing ramps | Config missing `DS.color.brand` | "Add brand color(s) to the config (name + hex) and try again." |
| `prepare_ds_config` returns `failCount > 0` | Semantic pairs fail contrast | Show the pairs table, suggest nearest passing step, update config, re-run |
| `apply_ds_setup` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `update_ds_primitives` returns "Primitives collection ... not found" | The collection has not been built yet | Run `apply_ds_setup` first; in-place update only works on an existing Primitives collection |
| `update_ds_primitives` returns variables in `unmatched` | The config defines tokens that don't exist in Figma yet | Either run a fresh `apply_ds_setup` (after deleting the old Primitives) or drop those new tokens from the config |
| `update_ds_primitives` says the connected plugin does not advertise the command | Local development build mismatch | For designers, say "The bridge is connected but this command is unavailable in the current plugin session." For developers, reload the local Figlets Bridge plugin so it loads the latest code. |
| `update_ds_primitives` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `apply_ds_setup` collection skipped | Collection already exists | Report which were skipped; offer to delete and rebuild if user wants a clean slate |
| `generate_component_doc` returns "Component not found on current page" | The component is on a different page or named differently | Ask the user to navigate to the page with the component, or confirm the exact component name |
| `generate_component_doc` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |

---

## Rules

- Never embed design system analysis logic in the prompt — call the MCP tools instead
- Never modify plugin scripts, binding rules, QA rules, or generated output as part of a public designer workflow. If the designer asks for unsupported behavior, explain the gap and treat it as a product request.
- Never ask the user for variable names, token values, or collection names — the tools extract these from Figma
- Never call `inspect_component` without first confirming the user has selected a node in Figma
- Never call `detect_design_system` or `audit_tokens` without checking whether a sync is needed first
- Never present raw JSON tool output directly — always summarize into plain language
- Never run ad hoc scripts over `figma-data.json`, local snapshots, Claude/Codex `tool-results`, or MCP transcript files to derive designer-facing fixes. Use `inspect_ds_setup_gaps.repairPlan`; if it does not emit enough structured repair data, say what is missing and ask for a product/tooling follow-up instead of inventing a parallel parser.
- Treat the shared binding resolver as the binding authority. Color and scalar bindings are variable-first; typography may prefer text styles because they can bundle variable-backed type decisions. Never invent hex or nearest-color auto-binding.
- Never add agent reasoning steps to `build_ds_showcase` unless the user explicitly opts into a supported parameter such as `numericFallback`. Showcase descriptions are deterministic by default; agent-enriched description polish is post-MVP and should only run when the user asks for it.
- Never call `apply_ds_setup` until `prepare_ds_config` returns `readyToBuild === true` — building with failing pairs will produce inaccessible tokens
- Never hardcode token values in intake — all values come from the user and are written to the config file
- Never skip showing the semantic pairs table before building — the user must confirm contrast ratios before any collections are created

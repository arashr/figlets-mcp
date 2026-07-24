# figlets adapter — agent orchestration

Thin orchestration layer for agent hosts over the figlets-mcp tools.
All deterministic Figma analysis happens inside the MCP tools — this file defines when to call what, how to handle ambiguity, and what to surface to the user.

---

## Prerequisites

1. figlets-mcp server running and configured in your MCP config (see `docs/mcp-config-examples.md`). Prefer a setup command when available, such as `figlets-mcp setup --hosts=antigravity --yes` for Google Antigravity or `figlets-mcp setup --hosts=gemini --yes` for Gemini CLI. If the agent can run shell commands, offer to run setup after user approval; otherwise show the command so the user can run it. If the host is not listed, add a server named `figlets` with command `figlets-mcp`, then restart the agent session and verify `figlets_start` is available.
2. For live Figma data: figma-bridge-plugin open in Figma Desktop (default port 17337)

---

## Tools

| Tool | Purpose | When to use |
|------|---------|-------------|
| `figlets_start` | Returns the Agent Interface intro, running Figlets MCP version, update status, safety contract, runtime environment hints, capability menu, and first designer-facing question | At the start of a Figlets conversation, before improvising workflow steps |
| `figlets_route_intent` | Validates the AI interface's language-independent workflow interpretation, with text scoring only as fallback | After the designer says what they want; pass `interpreted_workflow_id` whenever their goal is clear in any language |
| `figlets_workflow_guide` | Returns the step-by-step contract for a workflow, including read/write steps, confirmation points, error recovery, and next flows | Before running a workflow that could lead to Figma writes or local file writes |
| `figlets_health_check` | Returns read-only, host-neutral workflow readiness feedback: entrypoint/routing status, approval-boundary checks, repair-payload guidance, stale-host warnings, and next action | When an agent needs to verify it is following the Figlets workflow safely; not a designer menu item and not a Figma audit runner |
| `sync_figma_data` | Triggers the bridge plugin to extract the full DS snapshot, save it locally, and silently refresh compatible local Figlets config values | Before any analysis when the user wants fresh data from Figma |
| `detect_design_system` | Analyzes the snapshot: collections, variables, styles, inferred capabilities | After syncing, or when a snapshot already exists on disk |
| `inspect_component` | Extracts layout, variants, and properties of the currently selected Figma node | When the user wants to inspect a specific component or frame |
| `audit_tokens` | Reports token inventory plus real raw-value, raw elevation effect-style binding, duplicate, and naming issues in the snapshot. Primitive values are inventory, not defects. | When the user wants token hygiene checked as part of broader DS QA |
| `qa_binding_audit` | Audits the current Figma selection/page for raw unbound layer properties and optional safe binding fixes | When the user wants QA on designed frames/components, especially before documentation |
| `build_ds_showcase` | Renders a full token showcase in Figma — colors, typography, spacing, elevation, scrims | When the user wants a visual overview of the design system rendered as Figma frames |
| `refresh_ds_config_from_figma` | Refreshes existing config entries from the synced Figma snapshot without creating new config tokens or mutating Figma | Before config-backed setup/update/showcase work when Figma may have changed since the config was written |
| `inspect_ds_setup_gaps` | Reports semantic setup/accessibility gaps and deterministic repair suggestions from the synced Figma snapshot without mutating Figma or config | Inside the design-system health check, before asking the designer to approve any repair |
| `inspect_ds_token_gaps` | Read-only planner for config-backed non-color token gaps. Reports `update_ds_tokens` preview/apply payloads plus `foundationRepairPlan` for approved missing collection shells; it does not write Figma. | When a designer asks about missing typography, spacing, radius, border-width, or elevation tokens beyond semantic color setup |
| `apply_ds_config_responsive_spacing_repairs` | Applies only designer-approved responsive semantic spacing values to the local config; never mutates Figma | After `inspect_ds_token_gaps.repairPlan.reviewOptions[id=responsive-spacing-values].configRepairApplyInput` is approved, before previewing/applying the paired Figma alias operations |
| `update_ds_tokens` | Dry-run preview for config-backed non-color token completion; approved apply for `radius`, `border-width`, `spacing-semantics`, narrow typography/elevation slices, broad `typography` / `elevation` orchestration, optional `ensure_collection_modes`, and approved off-config prune when `prune.config_authoritative=true`. | After `inspect_ds_token_gaps` emits `repairPlan.previewInput`; only call `repairPlan.applyInput` after designer approval and only for the filtered apply-supported categories |
| `apply_ds_foundation_repairs` | Creates only designer-approved missing collection shells and modes from `inspect_ds_token_gaps.repairPlan.foundationRepairPlan.applyInput` | Before `update_ds_tokens` apply when token-gap inspection reports missing foundation collections |
| `apply_ds_setup_repairs` | Applies only designer-approved setup repairs, alias updates, and missing role creations, then updates the file-scoped config after Figma succeeds | After `inspect_ds_setup_gaps` and explicit designer confirmation |
| `plan_ds_semantic_naming_consolidation` | Dry-run planner for grammar-aware semantic naming cleanup after the designer confirms the intended grammar/context; lists exact canonical/duplicate variables and safe rename-only payloads | After `inspect_ds_setup_gaps.semanticColorGrammar`, `semanticNamingConflicts`, or `semanticNamingAdvisories` and the designer's naming cleanup decision |
| `apply_ds_semantic_naming_consolidation` | Applies only approved rename-only semantic naming consolidation from the planner, preserving variable IDs and never deleting variables | After `plan_ds_semantic_naming_consolidation.repairPlan.applyInput` is shown and explicitly approved |
| `plan_ds_figma_operations` | Dry-run planner for exact high-level Figma design-system operations: variable creation, variable values, collections, modes, local styles, exact node bindings, metadata, and token lifecycle helpers | When the designer asks for explicit Figma design-system operations outside a narrower Figlets repair flow |
| `apply_ds_figma_operations` | Applies only approved high-level operations copied from `plan_ds_figma_operations.repairPlan.applyInput`, with stale-approval checks before the bridge write | After the operations dry-run is shown and explicitly approved |
| `create_ds_config_from_intake` | Creates the file-scoped local `design-system.config.js` from completed new-design-system intake answers without mutating Figma; returns `needsDesignerInput` instead of inventing missing concrete values | After targeted intake answers are collected and before `prepare_ds_config` |
| `create_ds_config_from_design_md` | Creates a starter `design-system.config.js` from an existing Google DESIGN.md file | At the start of setup when the designer already has DESIGN.md and wants to skip answered intake questions |
| `export_design_md` | Syncs the Figma file, refreshes `design-system.config.js` from the latest snapshot, or creates a local snapshot-derived config when none exists, then writes a portable `DESIGN.md` to `project_path/specs/DESIGN.md` when the host knows the active workspace root, otherwise to the MCP server working directory, with a config-folder fallback or custom `output_path`. Returns `needsDesignerInput` for context Figma cannot encode. | When the designer wants a fresh DESIGN.md handover artifact without re-running the full setup flow. Supports `dry_run` for preview. |
| `prepare_make_guidelines` | Read-only translation of the file-scoped Figlets config and Figma snapshot into a linted Figma Make guidelines/CSS bundle preview, exact file plan, optional suggestions, and source fingerprint. | First step whenever the designer wants Figma Make guidelines. Suggestions are optional and do not block export. |
| `save_make_guidelines_profile` | Saves only designer-approved optional Make rules to file-scoped `make-guidelines.config.json`. | After the designer accepts one or more optional suggestions; rerun preparation afterwards. |
| `export_make_guidelines` | Writes the approved, fingerprint-matched bundle under the active project's `specs/figma-make` folder by default. Refreshes only Figlets-managed files. | After the exact preparation preview is approved. |
| `prepare_ds_config` | Runs the computation pipeline on a design-system.config.js: color ramps, contrast validation (APCA or WCAG), spacing scale | After intake and before building collections — validates everything before touching Figma |
| `apply_ds_config_contrast_repairs` | Applies only designer-approved `prepare_ds_config` contrast repair options to the local `design-system.config.js`; never mutates Figma | After showing `semanticPairs.contrastRepairOptions` and receiving approval, then rerun `prepare_ds_config` before build |
| `apply_ds_setup` | Creates all 5 variable collections in Figma from the prepared config (Primitives, Color, Typography, Spacing, Elevation) | After `prepare_ds_config` confirms `readyToBuild === true` |
| `update_ds_primitives` | Updates config-backed primitive color, spacing, typography, and shadow values, plus Color collection semantic aliases, preserving variable IDs. Categories: `color`, `spacing`, `color-semantics`, `primitive-typography`, `primitive-shadow`. | After tweaking the config or when `inspect_ds_token_gaps.repairPlan.primitiveRepairPlan` applies; use `prepare_ds_config` first for value pushes without recreating collections. |
| `generate_component_doc` | Renders a complete spec sheet for a component inside Figma (component variants, bound variable-mode visual previews, boolean property behavior, conditional layers, properties, sizing, anatomy, token/style bindings, usage, accessibility), writes `component-specs/[Name].md` under `project_path` when the host knows the active workspace root, otherwise under the MCP server working directory, and returns the markdown body plus written path. Also writes a `[SPEC]` block to the component description for MCP handover. | When the user wants to document a component for design + LLM code handover. The component must be on the current Figma page. |

---

## Intent Routing

Designers should be able to ask in natural language. Route their intent to MCP tools, but do not move product logic into the prompt.

| Designer says... | Agent should... |
|---|---|
| "Build a showcase of my design system" | Explain that you'll check what the file contains, ask them to keep the Figlets Bridge plugin open, then run the showcase workflow. |
| "Check my design system" | Run the full QA workflow: sync if needed, detect the system, audit tokens, inspect semantic setup gaps, summarize the highest-confidence issues first, then ask whether to apply the exact suggested repairs. |
| "QA this frame/component" | Ask them to select the target in Figma, run `qa_binding_audit` without fixes, then summarize raw/unbound values. |
| "Fix the binding gaps" | Confirm they want automatic safe fixes, then run `qa_binding_audit` with `fix: true`. |
| "Set up a design system" | Walk through setup intake in plain language. Treat the prompt as direction, not a complete spec. Ask missing choices before `prepare_ds_config`, show previews, then use `apply_ds_setup` only after approval. |
| "Document this component" | Ask them to select the component, sync the current Figma snapshot, preview any local config refresh, inspect it, craft human usage copy, then call `generate_component_doc`. |
| "Generate Figma Make guidelines" | Run `prepare_make_guidelines`, present confirmed translations before optional suggestions, save only accepted extras, then ask before `export_make_guidelines`. |

Keep the designer-facing language non-technical. Say "I'll check what's available in the file" rather than "I'll call `sync_figma_data` and `detect_design_system`." Tool names are for internal clarity and debugging, not the default user experience.

When starting a fresh Figlets conversation, call `figlets_start` first and use its `designerResponse` as the opening response whenever possible. It intentionally uses a capability-menu format; preserve that shape instead of inventing a broad capability list. For a concrete goal, interpret the designer's intent in their own language and call `figlets_route_intent` with the original `intent` plus the canonical `interpreted_workflow_id`; do not rely on English keywords or ask the designer to translate. Omit `interpreted_workflow_id` only when genuinely unsure, then use the fallback `selectionPrompt` if returned. Call `figlets_workflow_guide` before executing the workflow. Use `figlets_health_check` as an agent-facing readiness check when you need structured feedback about workflow sequencing, approval boundaries, repair payload sources, or stale host risk. These Agent Interface tools are read-only; they exist so agents can follow the same product contract across runtimes.

Do not broaden the Figlets introduction with generic Figma authoring capabilities from other MCP servers such as figma-console. Figlets is the design-system workflow layer: setup, QA, approved repair, showcase, component documentation, DESIGN.md export, and Figma Make guidelines export.

Never offer "Plugin / MCP server code", repo editing, plugin editing, or arbitrary Figma create/delete/move actions in the designer-facing menu. Those are developer tasks, not Figlets designer workflow options.

Bulk design-system updates are part of Figlets when the change can be expressed as a structured, designer-approved payload. Inspect first. If `inspect_ds_setup_gaps.repairPlan.applyInput` is non-empty, ask approval and pass that exact object to `repairPlan.tool` / `apply_ds_setup_repairs`. Never replace `aliases` with counts, summaries, booleans, or prose-derived values. If only a subset is approved, filter entries from `repairPlan.applyInput` while preserving each approved entry's `aliases` object unchanged. If schema validation rejects a setup repair payload, stop, rerun `inspect_ds_setup_gaps`, and copy or filter the fresh structured `repairPlan.applyInput` instead of retrying invented arguments. If `repairPlan.optionalApplyInput` is non-empty, present it as optional bulk creation requiring separate approval. If `inspect_ds_setup_gaps` reports `semanticNamingConflicts` or `semanticNamingAdvisories`, report the inferred `semanticColorGrammar` first; do not ask for a binary `surface-based`/`role-based` choice by default. Ask for a grammar/context decision only when the designer wants naming cleanup, then call `plan_ds_semantic_naming_consolidation`; after explicit approval, pass `repairPlan.applyInput` unchanged to `apply_ds_semantic_naming_consolidation`. Use `inspect_ds_token_gaps` with `apply_ds_foundation_repairs` and `update_ds_tokens` for config-backed token completion; when its responsive spacing review emits `configRepairApplyInput`, apply that exact config payload through `apply_ds_config_responsive_spacing_repairs`, then reinspect before previewing/applying the paired `plan_ds_figma_operations` alias updates. Use `plan_ds_figma_operations` and `apply_ds_figma_operations` for exact designer-specified operations on variable creation, variable values, collections, modes, local styles, exact node bindings, metadata, and token lifecycle helpers outside a narrower repair flow; `update_ds_primitives` for primitive/color-semantic updates; `qa_binding_audit` read-only first, then `qa_binding_audit({ fix: true })` only for `fixableNow` after reading `byFixability`.  For token-gap completion, present foundation collection/mode creation and semantic token updates as separate options with separate approvals; after an approved foundation repair, apply only foundationRepairPlan.applyInput, sync/reinspect, and stop before any token apply. Do not create tokens from binding-audit findings unless the designer gives exact variable names/collections/types/mode values and `plan_ds_figma_operations` validates them. If no specialized repair payload exists, first check whether `plan_ds_figma_operations` can represent the exact designer-specified request; do not convert health-check findings into invented generic operations. Only product-specific planning or designer-decision gaps should be described as future Figlets planner scope. Do not write custom scripts to fill that gap in Designer Mode.

For raw elevation effect-style bindings, preserve `repairPlan.previewInput.effect_style_repairs` for preview and the same approved `repairPlan.applyInput.effect_style_repairs` entries for apply. Do not replace the audited style list with a generic category refresh.

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
3. Summarize `byFixability` and `repairPlan.counts` in plain language. Explain each violation's `fixability`: `fixableNow` can be bulk-bound after approval; `needsExistingToken` should route to `inspect_ds_token_gaps`; `needsDesignerDecision` needs an explicit designer choice.
4. Treat suggestions as semantic binding suggestions, not hex/value guesses. Color, spacing, radius, and border suggestions are variable-first; typography may prefer exact text-style matches when available.
5. If the designer approves binding fixes, call `qa_binding_audit` with `fix: true` to apply only `fixableNow` items; report fixed and failed counts. Do not use binding audit to create missing tokens.

### Config-backed token completion
1. Call `sync_figma_data` if the file snapshot may be stale.
2. Call `inspect_ds_token_gaps` and summarize gaps using `repairPlan` and `missingCapabilityNotes`.
3. Dry-run with `update_ds_tokens` using `repairPlan.previewInput` before any apply.
4. If `repairPlan.foundationRepairPlan.applyInput` is present, ask approval, call `apply_ds_foundation_repairs`, sync, and reinspect before token apply.
5. If `repairPlan.primitiveRepairPlan` is present, dry-run with `update_ds_primitives` using `primitiveRepairPlan.previewInput`, ask approval, then call `update_ds_primitives` with `primitiveRepairPlan.applyInput`.
6. After approval, call `update_ds_tokens` with only `repairPlan.applyInput` categories.
7. Re-run `inspect_ds_token_gaps` to verify remaining gaps.

### Build token showcase
1. Tell the designer: "I'll check what this file exposes, then build the showcase sections that apply. Please keep the Figlets Bridge plugin open in Figma."
2. Call `sync_figma_data` if fresh data is needed (or skip if already synced)
3. By default, call `build_ds_showcase` with no options. It renders what the design system exposes and keeps descriptions deterministic and cheap.
4. If the user explicitly accepts numeric nearest/floor fallback for generated showcase chrome, call `build_ds_showcase` with `numericFallback`, for example `{ "radius": "nearest", "border": "floor", "maxDistance": 8 }`. Exact token matches still win; colors never use nearest fallback.
5. Report which sections were built (Colors, Typography, Spacing, Elevation, Scrims)
6. Tell the user to look at the "00 · Tokens" page in their Figma file

### Set up a new design system (bootstrap collections)
Treat evocative setup prompts (for example, "multiple vibrant background colors with matching foregrounds") as **direction**, not a complete design-system spec. Ask exactly one targeted intake question per assistant turn before creating config values or calling `prepare_ds_config`. If the designer answers multiple topics at once, record all answered topics and ask only the next single missing question. Do not ask a vague color-family/background-foreground pairing question by default after brand colors and semantic naming grammar are provided; infer reasonable generated pairings unless the designer asks for custom pairings. Semantic color naming questions must include examples instead of unexplained labels. Color scale questions must use concrete scale labels such as `100-900`, `50-950`, or `0-100`. If the designer says any/default/reasonable monospace, choose a concrete platform-appropriate family before config creation (`SF Mono` for iOS/macOS, `Roboto Mono` for Android, `JetBrains Mono` otherwise). Do not draft a full proposal, palette, typography stack, grid defaults, or token names before intake. You may offer lightweight multiple-choice options, and you may present tool-returned or designer-requested suggestions as editable proposals, but do not write suggested values until the designer approves one.

1. Offer DESIGN.md first as an optional shortcut: "If you have a DESIGN.md file, just drop it in and I will ask the remaining questions. If you don't, no worries." Markdown-only DESIGN.md is valid partial intake. If provided, call `create_ds_config_from_design_md` (pass `linked_config_path` when DESIGN.md references JSON config), then only ask for topics listed in `needsDesignerInput`. Treat DESIGN.md as imported intake answers, not as the final source of truth.
2. Run any remaining intake one question at a time: project name, platform, grid base (4px/8px), breakpoints (3-tier/4-tier), semantic color naming grammar with examples (paired context: `bg/surface` + `text/on-surface`; element-first: `text/danger` + `bg/danger-subtle`; intent/emphasis: `brand/strong/subtle`; component-scoped: `button/bg/default`; custom: designer-defined), **contrast standard (APCA default / WCAG 2.2)**, concrete color scale (`100-900`, `50-950`, or `0-100`), brand colors (name + hex), typeface, typography preset. Supported typography presets are Material 3 (`material3`, `material`, `standard`, or `material scale`), `fluid`, and `compact`; only `custom` requires an explicit `typography.scale`.
   When asking about contrast standard, give the short pros/cons:
   - **APCA (default)** — perceptually accurate, designed for WCAG 3, more lenient on yellows and accurate on dark mode where WCAG is overly strict; *not yet a legal standard*.
   - **WCAG 2.2** — current legal standard for ADA / Section 508 / EN 301 549; well understood; can over-fail dark themes and under-fail bright yellows.
3. Call `create_ds_config_from_intake` with all intake answers. This writes only the file-scoped local config, never Figma. If it returns `needsDesignerInput`, ask those exact missing questions (for example exact brand hexes or font families) instead of switching to developer/config-editing work.
4. Call `prepare_ds_config` with the returned config path
5. Show the user: spacing preview, color ramps table, semantic pairs table (both APCA Lc and WCAG ratios are visible side-by-side; the gated `failCount` reflects whichever standard the designer chose), and the generated `DESIGN.md` export path if present.
6. If `failCount > 0` and exact repair options exist: show `semanticPairs.contrastRepairOptions` / `setupApprovalPreview.semanticColor.contrast.repairOptions` as the exact evaluated contrast suggestions. Some options may include both `suggestedBackground` and `suggestedText`; present those aliases together instead of inventing single-axis examples. Ask the designer to approve or adjust a specific option before changing config. Do not ask vague questions like whether to "keep revising the palette" while structured suggestions exist. If the designer approves one or more suggestions, call `apply_ds_config_contrast_repairs` with those option objects, then rerun `prepare_ds_config`.
   If `failCount > 0` and there are no exact repair options: do not ask for a prose-only direction like "preserve the background" or "make the text lighter" as though it can be applied. Rerun `prepare_ds_config` once on the current config because generated setup should self-correct. If the latest result still fails with no exact options, explain the exact blocker and ask only for an executable choice: a specific semantic alias, a brand hex change, or a color scale change.
7. If `needsDesignerInput` contains `DS.typography.scale`: if the designer chose Material/standard, pass `material3` through `create_ds_config_from_intake`; if they chose `custom` or a non-standard scale, use `suggestions.typography` from `create_ds_config_from_intake` to offer editable type-scale templates before asking them to approve or adjust one.
8. Ask: "Does this all look right? Ready to build in Figma?"
9. Once confirmed and `readyToBuild === true`: ask the user to keep the Figlets Bridge plugin open. Treat "go for Figma" / "build it" as approval only in this state; if `readyToBuild` is false, do not call `apply_ds_setup` and do not start another abstract approval loop.
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
4. Ask which categories to update. Today: `color`, `spacing`, `color-semantics`, and `primitive-typography` / `primitive-shadow` when `inspect_ds_token_gaps.repairPlan.primitiveRepairPlan` applies. If unspecified, default to `color`, `spacing`, and `color-semantics`.
5. For setup repair gaps, ask the designer which proposed repairs to apply, then call `apply_ds_setup_repairs` with only those approved repairs.
6. For config-backed value updates, run `prepare_ds_config` and call `update_ds_primitives` first with `dry_run: true` and the intended `create_missing` setting. Report `wouldCreateNames`, `wouldCreate`, `wouldUpdate`, `unmatched`, and substitutions, then ask the designer what to apply.
7. Only after confirmation, call `update_ds_primitives` again with `dry_run: false` and the designer-approved categories/options.
8. Report per-category counts: updated, unchanged, created, missing, substituted.
9. Do not call this for first-time creation — use `apply_ds_setup` for that.

### Document a component
The Figma spec sheet is for **humans**; the markdown handover is for **agents**. The plugin renders structure and tangible data (variants, sizing, anatomy, token names). The agent must supply the human-readable content — never rely on generic defaults.

1. Ask the user to navigate to the Figma page containing the target component (it must be on the current page), select the component or component set, and keep the Figlets Bridge plugin open.
2. **Refresh DS context first.** Call `sync_figma_data` before inspecting the component. Sync keeps manually added variables, styles, and component bindings visible to Figlets and silently refreshes compatible local Figlets config values without writing Figma. If sync reports `activeFile.configRefresh.compatible: false`, skipped rows, or Figma-only variables/styles that do not fit the current config, explain the mismatch in designer language and ask before any override; route exact additions through the relevant Figlets planning flow if the designer wants them in config.
3. **Inspect after freshness.** Call `inspect_component` (after asking the user to select the component) to understand what the component is, its variants, properties, anatomy, and likely use cases.
4. **Pre-flight readiness check.** Before generating, evaluate the inspection result for two issues that degrade spec quality. Report any findings to the user clearly and ask whether they'd like to fix them in Figma first or proceed as-is:

   **a. Generic layer names** — scan all direct and shallow children for Figma default names: `Frame NNN`, `Group NNN`, `Rectangle NNN`, `Ellipse NNN`, `Vector NNN`, `Component NNN`. These appear as-is in the Anatomy section. Renamed layers produce a readable anatomy; default names produce noise. Example message: _"I noticed 3 layers still have default Figma names (Frame 12, Rectangle 7, Group 3). Renaming them will make the Anatomy section readable for developers. Fix first, or proceed?"_

   **b. Missing component properties** — if the node is a COMPONENT_SET with variants but `componentPropertyDefinitions` is empty, the Properties table will be empty. Component properties are what developers interact with at the API level. Example message: _"This component has N variants but no component properties defined. Adding properties (text overrides, boolean toggles, variant switches) will make the Properties table meaningful. Proceed without them, or fix first?"_

   If both issues are present, report them together. If the user chooses to fix in Figma: wait for confirmation, then re-inspect before proceeding. If the user proceeds as-is: continue without further prompting.

5. **Craft the content** based on what you learned. If the user supplied any of these, use their wording verbatim; otherwise generate them yourself as a UX expert would:
   - `description` — 1–2 sentences: what the component is and when to use it
   - `usage_do` — 2–3 rules grounded in this specific component's purpose
   - `usage_dont` — 2–3 rules grounded in misuse risks specific to this component
   - `accessibility_notes` — 2–4 maintenance notes for implementation handoff. These are not suggestions to improve the design; they preserve accessible behavior when an agent or developer rebuilds it. Deduce component-specific notes from inspection when possible: alt text for image/artwork/media slots, captions/transcripts for video, semantic labels/roles, keyboard and focus behavior for interactive states, readable text, and preserving DS tokens that carry contrast/sizing/focus affordances. If no design system is detected, include generic maintenance notes for semantic structure, accessible names, keyboard behavior, contrast, and text scaling.
   - `variant_descriptions` — map of exact variant name → ≤10-word purpose
6. Call `generate_component_doc` with `component_name` plus the content inputs. If the host exposes the active code workspace root, pass it as `project_path` so the markdown lands in the user's project instead of the MCP server launch directory.
7. Confirm the returned `pathWritten` / `writtenPath`. Do not ask the user where the file is unless the tool reports a write error.
8. Tell the user: spec sheet rendered in the Documentation section, markdown saved locally at the returned path, `[SPEC]` block written to the component description for MCP handover.

### Generate Figma Make guidelines
1. Call `prepare_make_guidelines` with the active project root when the host knows it. This step is read-only.
2. Present the confirmed Figlets/Figma translation, `source.componentSpecDiscovery` results, generated stylesheet status, lint status, and exact create/refresh plan first. Component specs are a project-scoped source even when the current Figma snapshot omits that component. Never claim specs were deleted or absent when discovery reports files; distinguish exact Figma matches from spec-only components.
3. Obey `interaction.mustReviewOptionalSuggestionsBeforeExportApproval`. When it is true, present every `optionalSuggestions` item as skippable help and ask whether the designer wants to accept, edit, skip, or skip all **before** asking for export approval. Do not combine the suggestion question with export confirmation, do not force an answer to the content itself, and do not introduce kit/package setup in this first-pass flow.
4. If the designer accepts optional context, call `save_make_guidelines_profile` with only those accepted values and `approved: true`. If they skip suggestions, persist those ids in `skippedSuggestions` (or `all` for Skip all) so they do not recur. Then prepare again.
5. Only after the optional-suggestion step is resolved, ask approval for the latest exact file plan. Call `export_make_guidelines` with `approved: true`, the unchanged `sourceFingerprint`, and `optional_suggestions_reviewed: true` when that approved preview still contains suggestions.
6. If the fingerprint is stale, prepare again and ask approval against the new plan. Do not export from an old preview.
7. Report the returned placement instructions. The flow starts and ends in Figlets; do not manage the files after handoff.

### Full design system health check
1. Call `sync_figma_data`
2. Call `detect_design_system`
3. Call `audit_tokens`
4. Call `inspect_ds_setup_gaps`
5. Deliver one combined summary: high-confidence semantic gaps and accessibility failures first, then token issues, then capabilities and inventory. Do not report "healthy" unless both token audit and setup-gap QA have no high-confidence issues.
6. If there are approved repair suggestions in the QA output (`plannedAliases`, `plannedReAlias`, or `plannedRoleRepair` on high-confidence `missingSemanticRoles`), ask the designer which exact repairs to apply in the same QA flow. Do not offer to run a separate setup-gap flow after already showing those gaps.
7. Prefer `inspect_ds_setup_gaps.repairPlan.applyInput` as the source for approved repairs. If the designer approves all suggested repairs, pass that object directly to `apply_ds_setup_repairs`; if they approve only some, filter that object without deriving new aliases. Never replace `aliases` with a count or summary.
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
| `prepare_ds_config` returns `failCount > 0` with repair options | Semantic pairs fail contrast | Show `semanticPairs.contrastRepairOptions`; after approval call `apply_ds_config_contrast_repairs`, then rerun `prepare_ds_config` |
| `prepare_ds_config` returns `failCount > 0` with no repair options | Generated setup may need a fresh prepare, or the current config has no executable contrast repair | Rerun `prepare_ds_config` once; if still blocked, ask for a concrete alias, brand hex, or color scale change. Do not ask for prose-only repair approval. |
| `apply_ds_setup` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `update_ds_primitives` returns "Primitives collection ... not found" | The collection has not been built yet | Run `apply_ds_setup` first; in-place update only works on an existing Primitives collection |
| `update_ds_primitives` returns variables in `unmatched` | The config defines tokens that don't exist in Figma yet | Either run a fresh `apply_ds_setup` (after deleting the old Primitives) or drop those new tokens from the config |
| `update_ds_primitives` says the connected plugin does not advertise the command | Local development build mismatch | For designers, say "The bridge is connected but this command is unavailable in the current plugin session." For developers, reload the local Figlets Bridge plugin so it loads the latest code. |
| `update_ds_primitives` returns 503 | Bridge plugin not connected | "Open the figlets bridge plugin in Figma Desktop and try again." |
| `apply_ds_setup_repairs` rejects `aliases` or schema validation fails | The payload was hand-authored or corrupted instead of copied from `repairPlan.applyInput` | Stop, rerun `inspect_ds_setup_gaps`, then copy or filter the fresh structured `repairPlan.applyInput`. Do not retry with invented aliases, counts, summaries, booleans, or prose-derived values. |
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
- Never invent missing setup choices for a new design system — ask intake questions before `prepare_ds_config`
- Never draft a full setup proposal, palette, or token plan before intake — ask questions first
- Never skip showing the semantic pairs table before building — the user must confirm contrast ratios before any collections are created

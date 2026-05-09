# Project Memory

Active context for the project so future sessions can recover quickly without relying on chat history alone.

---

### [2026-05-09 — APCA offset corrected to 0.0.98G]

**Shipped this session:**

1. **APCA low-output offset fixed** (`code.js`, `validate-semantic-pairs.js`, `generate-color-ramps.js`): Replaced the scaled `12.5` offset with `2.7`, matching APCA 0.0.98G's `loBoWoffset/loWoBoffset = 0.027` after multiplying Lc by 100. The old value under-reported high-contrast pairs by about 10 Lc.

2. **Screenshot discrepancy explained and pinned**: `#FFFFFF` on `#38312e` now computes as `Lc 102`, matching the external Figma accessibility plugin result. Black text on white is pinned at `Lc 106`.

3. **WCAG formula checked and pinned**: WCAG contrast already matched WCAG 2.2 relative luminance: sRGB cutoff `0.04045`, coefficients `0.2126/0.7152/0.0722`, ratio `(lighter + 0.05) / (darker + 0.05)`. Added a boundary test for `#777777` on white: displayed as `4.5:1` after one-decimal rounding but still fails the unrounded `4.5` AA body gate.

**Decision context:** The previous project memory said Figlets used APCA 0.0.98G and that the validator and plugin were byte-identical. There was no recorded product reason to use `12.5`; it was an implementation artifact. The correction may reduce APCA fail counts because the old math was stricter than intended.

**Verification:** User reloaded the Figlets Bridge plugin in Figma Desktop, then `build_ds_showcase` rebuilt Colors, Typography, Spacing, Elevation, and Scrims on `00 · Tokens`. Only existing generated-showcase chrome warnings remained (radius `16`, spacing `6`). Full `npm test` passed 40/40 after the live remake.

---

### [2026-05-09 — bridge plugin UI rebuild against FigWords (final)]

**Shipped this session (supersedes the earlier 2026-05-09 compact-refresh attempt):**

1. **UI rebuilt to FigWords parity** (`ui.html`): Pulled design context, screenshots, and variables from `FigWords` node `98:40172` via the Figma MCP and rebuilt the layout from scratch. Three explicit layouts now match the reference: Collapsed 296×348 (left column only); Expanded 576×348 (left column + right-hand log box at full height); Expanded+QA 576×348 (log box shrinks to 148px and a QA Scope summary box renders below it). All paddings (16px outer, 16px inter-column gap), strides (selection lines 20px, button row 42px), and font sizes (title-md 16/24/500, label-lg 14/20/500, body-sm 12/16/400, label-sm 11/16/500) come from the FigWords design tokens.

2. **Visual tokens swapped to FigWords variables** (`ui.html`): bg `#121212`, brand `#c9fb8c`, brand-subtle `#253a00`, text default `#f5f5f5`, text subtle `#dfdfdf`, text brand `#e7ffcd`, text warning `#ffe5ad`, border brand `#5d8227`, border subtle `#212121`. Removed the outer `border-radius: 18px` because the rounded card in the design canvas is a mock — the host plugin window cannot render rounded outer corners, and the body now fills the window.

3. **Sora typography via Google Fonts** (`ui.html`): Loads only weights 400 and 500 with `display=swap`. Browser-cached after first open; offline silently falls back to Inter. Plugin file size is unaffected.

4. **QA report relocated to the right column** (`ui.html`): Local QA results now render as a bordered summary box (`QA Scope`, `Violations`, `Fixed`, `Needs review`, `Color`, `Spacing`, `Type`) under the log box, matching the third FigWords layout. Running QA auto-expands the log so the summary is always visible.

5. **Single-tooltip policy** (`ui.html`): Removed the custom `#ui-tooltip` element and all hover/focus handlers. Documentability spans, both QA buttons, and the Show Log toggle now use the browser's native `title` attribute. The QA buttons gained explanatory tooltips describing what each action does (read-only scan vs. high-confidence binding).

6. **Animated expand/collapse** (`ui.html`): `_setLogOpen` coordinates `figma.ui.resize` with a CSS opacity+translateX transition on the log column (160ms ease). Expand posts the resize first, then fades content in on the next frame; collapse fades content out first, then shrinks the host. The window edge still snaps (Figma's resize is synchronous), but content motion masks most of the abruptness.

7. **Tests updated** (`tests/bridge/qa-binding-audit-policy.test.js`): Replaced the old hex-value assertions (`#111111`, `#c5ff73`, `#dcffc0`, `#639d13`, `border-radius: 18px`) with the FigWords tokens (`#121212`, `#c9fb8c`, `#e7ffcd`, `#5d8227`, `border-radius: 9999px` for pills). Replaced the custom-tooltip assertions with native-`title` assertions on the doc-status spans and the QA buttons; explicitly asserted that `id="ui-tooltip"` no longer exists in the UI.

**Verification:**
- Figma MCP design context fetched from `FigWords` node `98:40172` (screenshot + metadata + variables).
- `node tests/bridge/qa-binding-audit-policy.test.js`
- `npm test` passed: 40/40 after each iteration.
- User confirmed visual parity in Figma Desktop after reload, including the tooltip fix, animation, and Sora font load.

**Follow-up:**
- Reload the Figlets Bridge plugin in Figma Desktop is no longer pending — user has reloaded and confirmed.
- The animation timing is 160ms; if it feels too slow/fast in practice, that's a one-line tweak in the CSS transition + setTimeout.
- Sora is fetched from Google Fonts at runtime. If a future requirement bans network dependencies in the plugin iframe, switch to base64-embedded woff2 (cost: ~30KB per weight, parsed every plugin open).

---

### [2026-05-09 — Figma variable picker scopes]

**Shipped this session:**

1. **Variable scope helper** (`code.js`): Added `_scopeForVariableName`, `_setVariableScopesForName`, and `_applyVariableScopesToCollection`. The bridge now hides Primitives variables from Figma pickers with empty scopes, while mapping semantic token paths to picker scopes: radius → `CORNER_RADIUS`, border widths → `STROKE_FLOAT`, spacing → `GAP`, touch/size → `WIDTH_HEIGHT`, typography → font size/line-height/letter-spacing/weight/family, text/icon colors → `TEXT_FILL`, outline/border colors → `STROKE_COLOR`, fill/surface/background colors → `ALL_FILLS`, and shadow/elevation tokens → effect scopes.

2. **Setup + update coverage** (`code.js`): `apply_ds_setup` scopes variables as it creates them and runs collection-level repair passes even when existing collections are skipped. `update_ds_primitives` keeps primitive variables hidden and scopes refreshed/newly-created semantic variables without changing IDs, values, or aliases.

3. **Policy tests** (`tests/bridge/qa-binding-audit-policy.test.js`): Added guards for the scope mapping helper, setup repair calls, and update-path scope preservation.

**Verification:**
- `node --check packages/figma-bridge-plugin/code.js`
- `node tests/bridge/qa-binding-audit-policy.test.js`
- Forbidden executable `??`, `?.`, `**` scan clean; only existing comments/markdown strings match.
- `npm test` passed: 40/40.
- Live repair after the first plugin reload: started the local receiver, ran `apply_ds_setup` against `.local/local_movbxur3_6gow4h4j/design-system.config.js`; all five collections were skipped as existing and scope repair passes completed. Synced the Figma data snapshot afterward (`338` variables). This was before the follow-up change that hides Primitives from pickers, so reload the plugin and rerun `apply_ds_setup` once more to apply the final primitive-hiding behavior. The current snapshot exporter does not serialize `variable.scopes`, so live scope verification is visual in Figma's variable picker unless the exporter is extended.

**Live application:**
- After the final primitive-hiding change, the plugin was reloaded and `apply_ds_setup` was rerun against `.local/local_movbxur3_6gow4h4j/design-system.config.js`. All five collections skipped as existing, text styles refreshed, and the scope repair pass completed with the final behavior. A follow-up sync showed `Figlets DS` with 5 collections, 338 variables, 15 text styles, and 6 effect styles.

---

### [2026-05-06 — fresh DS setup for new file + merge-populate fix]

**Shipped this session:**

0. **Flat config guard**: Fixed the per-file isolation footgun where a new/unsaved Figma file could inherit `.local/design-system.config.js`. Server tools now refuse the legacy flat config for active file workflows: `prepare_ds_config`, `apply_ds_setup`, and `update_ds_primitives`; `build_ds_showcase` only auto-reads a config when `.local/<fileKey>/design-system.config.js` can be resolved.

0. **Persistent local identity for keyless drafts**: New/unsaved Figma files that return empty `figma.fileKey` now get a stable `local_*` key stored in `figma.root` plugin data (`figletsFileKey`). The UI forwards this as `fileKey`, so sync/config/showcase state routes to `.local/<local-id>/` instead of the flat root. Real Figma fileKey still takes precedence when available.

0. **Scrim/text binding guard**: Reinstated the semantic binding decision that decorative color variables are not valid automatic text/foreground candidates. Both `_createDsBindingContext()` and the restored showcase builder now exclude `scrim`, `overlay`, `state`, `shadow`, and `elevation` color names from role fallback scoring. Scrim variables still render in the Scrims section; they just cannot become generated copy text fills.

0. **Showcase rollback after failed color-migration coupling**: `_buildShowcase` and `build_ds_showcase` payload shape were restored to the pre-Sunday-17:13 baseline (`eda38ad`). Product decisions around color primitive regeneration, semantic alias updates, per-file isolation, and additive setup repair are preserved, but showcase presentation is frozen back to the prior working builder. Do not reintroduce APCA-specific showcase columns, config-driven showcase grouping, or outline/border showcase restructuring as part of color update work.

0. **Setup preview before apply**: `prepare_ds_config` writes `design-system.preview.svg` next to the active file-scoped config and returns `setupPreview.svgPath`. Use this in the conversation to review ramps and semantic pairs visually before `apply_ds_setup`; do not apply to Figma until the designer confirms after preview + readiness.

0. **Utility status semantic split**: Default generated utility semantics now treat `bg/*` / `surface/*` as soft readable status backgrounds, while strong saturated status colors use explicit `fill/*` + `text/on-*` pairs. This keeps background semantics aligned with common design-system practice and avoids baking a strong-fill opinion into `bg`.

0. **Showcase semantic-pair restoration**: `build_ds_showcase` now forwards `DS.color.semantics.pairs` from the active file-scoped config. The bridge plugin renders the Semantic Colors table from those validated pair relationships instead of trying to infer pairs from names. This fixed clean-file showcase regressions where role-based tokens were split into `surface`/`icon`/`fill` sub-tables and table text bound to purpose-specific tokens such as `color/text/on-brand`, making labels invisible. Muted pairs remain exempt and may not show the paired-text indicator when below the indicator threshold; threshold tuning is a follow-up product decision.

1. **DS config for new Figma file** (`.local/design-system.config.js`): Primary `#A6D56A`/400, Secondary `#609190`/500, Accent `#CCBDB7`/300. 11-step `50–950` OKLCh ramps. APCA contrast. Light + Dark modes. Standard utility ramps (neutral, red, green, yellow, blue, neutral-variant). Sora + JetBrains Mono. Material3 type scale. 8px grid, 4-breakpoint (Mobile/Tablet/Desktop/Wide). All 15 APCA semantic pairs pass Lc ≥ 75 after manual step fixes (e.g. bg/brand → primary/800 Light, primary/200 Dark; utility status pairs bumped to /700–/800 range). Zero failures.

2. **Showcase rendered** on page `00 · Tokens` — Colors, Typography, Spacing, Elevation, Scrims (5 sections). Two binding warnings remained after the first pass: no border-8 variable, and a QA binding pass with unresolved gaps from stale Typography/Spacing variable names.

3. **`getOrCreateCollection` merge-populate fix** (`code.js`): When Primitives collection exists but has no COLOR variables (user deleted ramps but kept FLOAT/STRING vars), the plugin now re-enters the population block instead of skipping. Uses a `_primHasColors` check before the `if (existed)` branch. The population block pre-builds `_primMergeMap = await buildVarMap(primColl.id)` and wraps every `createVariable` call with `if (_primMergeMap[name]) continue` to skip existing vars. Same merge-map pattern applied to Typography and Spacing blocks for mode dedup safety (pre-existing FLOAT vars are not recreated). `getOrCreateCollection` falls back to empty-shell detection (any vars → existed = true) for all other collections.

4. **Color alias self-repair** (`code.js`): When Color collection exists, the plugin scans `variable.valuesByMode` across all Color vars to check for any `VARIABLE_ALIAS` value. If none exist (`_semNeedsRepair = true`), it runs a full alias rewiring pass — rebuilds `_repPrimMap` + `_repSemVarObj` from `getLocalVariablesAsync`, resolves Light/Dark mode IDs from the existing collection, then iterates pairs/icons/unpaired from `DS.color.semantics` and calls `v.setValueForMode(modeId, { type: 'VARIABLE_ALIAS', id })` on each existing semantic variable. Reports as `Color (aliases repaired)` in the built list. This handles the case where Color was created before Primitives had ramp vars.

5. **Typography/Spacing additive stale-collection repair** (`code.js`): Existing Typography and Spacing collections no longer skip blindly. If the collection exists but is missing current generated DS names (`type/{role}/...`, `space/{semantic}`, `space/radius/{key}`, `space/border/{key}`), `apply_ds_setup` enters merge mode, adds missing vars/modes only, and leaves old variables intact. Also fixed Typography aliasing so fresh Typography creation after Primitives already exists still points at the configured type/font primitive names.

6. **QA safe-bind accounting fix** (`code.js`): `_runQaBindingAudit({ fix: true })` now only attempts high-confidence suggestions. Low/medium/none suggestions are still reported in audits but are not counted as failed safe-bind fixes. This addresses the misleading showcase warning where 31 intentionally skipped suggestions were reported as unresolved gaps.

**Per-file isolation status:**
- Flat `.local/design-system.config.js` is legacy only. If `active-file.json` has no fileKey, tools must not use it. Migration for an existing saved file remains: reload plugin, run `sync_figma_data` to get a real fileKey, then move/copy the intended config to `.local/<fileKey>/design-system.config.js`.

**Open for next session:**
- Reload the Figlets Bridge plugin after the showcase rollback, then rebuild the showcase. Expected behavior: old working showcase grouping/readability, with color primitives/semantics still updateable through the dedicated setup/update paths.

---

### [2026-05-06 — per-file config isolation + swatch indicator polish]

**Shipped this session:**

1. **Per-Figma-file config isolation** (`code.js`, `ui.html`, `receiver.js`, `paths.js`, `build-showcase.js`, `audit-tokens.js`): All `.local/` files are now namespaced under `.local/<fileKey>/`. `figma.fileKey` is included in every plugin→UI postMessage; UI forwards it as `?fileKey=` on all receiver fetch calls. Receiver writes `figma-data.json` and `figma-selection.json` to `.local/<fileKey>/` and maintains `.local/active-file.json = { fileKey, updatedAt }`. `paths.js` gains `getFilePaths(fileKey)`, `readActiveFile()`, `getActiveFilePaths()`. `build-showcase` and `audit-tokens` use the active file automatically. `prepare_ds_config` and `update_ds_primitives` take an explicit `config_path` — use `.local/<fileKey>/design-system.config.js`. Switching files: open in Figma, run `sync_figma_data`, active pointer flips.

2. **Algorithm-aware swatch indicators** (`code.js`, `build-showcase.js`): Badge shows `Lc XX%` (APCA, Lc ≥ 60) or `✓` (WCAG, ratio ≥ 4.5). Step number top-left, badge bottom-right at 12px from edges. Badge created inline with `textAutoResize` set before `characters`; `MAX` constraints set after x/y. `build-showcase.js` forwards `DS.color.contrastAlgorithm` from config to plugin. Swatch stroke conditional on `_V.outlineSubtle` existing. Outline/border/stroke tokens in their own "Outlines & Borders" table with `[Token, Example]` heading only.

**Open for next session:**
- `surface/brand` Lc 50 (both modes): accepted for now. Needs lighter lime surface step or white text for body copy.
- `surface/default`/`on-surface/variant` Dark: Lc 56 pre-existing.
- Status-color surfaces: 9 pre-existing APCA failures.
- **Migration**: existing `.local/design-system.config.js` must be moved to `.local/<fileKey>/design-system.config.js` manually (run one sync to discover the fileKey).

---

### [2026-05-05 — auto-anchor + showcase columns + rebrand demo]

**Shipped this session:**

1. **Auto-anchor brand step from luminance** (`generate-color-ramps.js`): `brandAnchorIdx` now returns `{ idx, step, isAuto }`. When `brand.step` is omitted, the step is derived from OKLab L via `t = (OKLCH_LIGHT_TARGET − L) / (OKLCH_LIGHT_TARGET − OKLCH_DARK_TARGET)` and snapped to the nearest configured scale step. When explicit, `isAuto: false`. The ramp summary shows each brand with its resolved step and source (auto/override). Test: `tests/core/brand-anchor.test.js`.

2. **Showcase contrast columns** (`code.js`): Replaced single `Contrast` header with three explicit headers — `APCA Lc`, `Status`, `WCAG` — on both the main semantic table and the icon bottom table. `Status` badge is algorithm-aware: APCA mode uses Lc 75 / Lc 60 / Fail thresholds; WCAG mode uses AAA / AA / Large / Fail. The WCAG badge cell (previously a 4th column) was removed; WCAG ratio stays as a plain number. `_buildStatusBadge(lc, ratio)` is the new entry point.

3. **`prune_unused_ramps` flag** (`update-ds-primitives.js` + `code.js`): New `prune_unused_ramps: true` tool option. Plugin deletes any `color/<name>/<digits>` variable in Primitives whose `color/<name>` folder is not in `DS.color.ramps`. Count reported in `report['color'].prunedRamps` and added to `pruned` total.

4. **Cascade-safety warnings** (`index.js` + `prepare-ds-config.js`): `runDsPipeline` scans resolved semantics for `color/<name>/<step>` refs where `<name>` is not a configured brand or utility ramp. Surfaces as `staleSemantics: [{ token, ref, currentName }]` (non-throwing). `apcaFailCount` is now explicitly named in the prepare output. Both surface in the prepare summary message.

5. **Full rebrand demo — Green Apple → lime/teal/sand**: Replaced peach/lime/teal/gold brand config with lime (primary, step 500 override), teal (secondary, auto→600), sand (no role, auto→500). `prune_unused_ramps` deleted 18 variables (peach + gold ramps). 9 created (sand). 5 semantics updated. Zero binding warnings in showcase. 11 APCA failures remain: 9 pre-existing utility-color failures (same step choices as before), 2 from `surface/brand` (Lc 50 — brand hex at mid-luminance, accepted for large-text usage).

**Resolved open issues from prior session:**
- Brand-step is now auto-derived (issue 2) ✓
- Showcase contrast columns standardized (issue 3) ✓
- Brand-removal cascade is now handled by `prune_unused_ramps` for primitives + `staleSemantics` warning for semantic refs (issue 1, partial) ✓

6. **Algorithm-aware swatch indicators** (`code.js` + `build-showcase.js`): `_swatchIndicator` and `_buildSwatch` gate on `_contrastAlgorithm` read from `DS.color.contrastAlgorithm` (forwarded by `build-showcase.js` from `.local/design-system.config.js`). APCA mode: Lc ≥ 60 threshold, badge shows `Lc XX%`. WCAG mode: ratio ≥ 4.5 threshold, badge shows `✓`. Step number (e.g. `300`) shown top-left. Badge positioned bottom-right at 12px from edges using inline text creation (`textAutoResize = 'WIDTH_AND_HEIGHT'` set before `characters`) + `MAX` constraints set after x/y. Outline stroke on swatch container only applied when `_V.outlineSubtle` exists. Outline/border/stroke semantic tokens moved to a dedicated "Outlines & Borders" table with `[Token, Example]`-only heading (no accessibility columns).

**Open for next session:**
- `surface/brand` Lc 50 (both modes): the lime hex at mid-luminance gives insufficient APCA for body text. Either a lighter lime surface step or white text would fix it. Designer accepted Lc 50 for this session.
- `surface/default`/`on-surface/variant` Dark: Lc 56 (neutral/300 on dark surface). Pre-existing, needs a step bump.
- Status-color surfaces (danger/success/warning/info): 9 pre-existing APCA failures from the utility-color step choices.

---

### [2026-05-05 — per-brand step anchor + scoped semantic showcase]

**Shipped this session (commit `13362e2`):**
- `generate-color-ramps.js`: brand entries accept `step: NNN`. The brand hex anchors at that step instead of the scale midpoint (default `midIdx`). Light side fans toward step 100 (L≈0.97), dark side toward step 900 (L≈0.18) from the declared anchor. Backward-compatible — `step` omitted falls back to old behavior.
- `update-ds-primitives` (tool + plugin): new `prune_off_scale: true` flag deletes primitives in the configured ramp folders whose step number is outside the active scale (e.g. `/50` and `/950` after switching to a 100–900 scale). Scoped to ramps in `DS.color.ramps`; never touches arbitrary variables.
- `build-showcase` (tool + plugin): the tool now reads `.local/design-system.config.js` and forwards `DS.collections` to the plugin. The plugin filters `_semanticColls` and `_primColls` by name when the config is provided, falling back to the existing heuristic only when not. Stops component-scoped alias collections (e.g. `Button · Type`) from being rendered as semantic color tokens.
- `.local/design-system.config.js`: added `step: 400` to lime, `step: 700` to teal, added a `gold` accent brand entry with `#C9943A` at `step: 500`. Pipeline regenerated all ramps; lime/400, teal/700, and gold/500 hold the brand hexes exactly.

**Live verification on the Green Apple file:**
- `color/lime/400` = `#88bf2e`, `color/teal/700` = `#2f6b6b`, `color/gold/100..900` created (9 new variables).
- Orphan `/50` and `/950` from lime, teal, neutral, red, green, yellow, blue all pruned. Every ramp is now a clean 9-step 100–900.
- Showcase rebuilds with zero binding warnings (was 2). Button · Type collection no longer pollutes the semantic-color table.

**Open issues surfaced for the next session (not yet addressed):**
1. **Brand-removal cascade is manual.** When a brand color is removed from `DS.color.brand[]`, the agent must also rewrite `DS.color.semantics` (which still hard-codes `color/<name>/<step>` paths), purge the `color/<name>/*` primitives in Figma (the new `prune_off_scale` only handles steps within configured ramps, not whole removed ramps), and surface any direct component bindings to those primitives. There is no tool for this today; the designer experiences the gap as "the config is polluted."
2. **Brand-step is not auto-derived.** The `step` field is honored when set but defaults to scale-mid when omitted. Auto-detection should map OKLab L → step using the same `LIGHT_TARGET`/`DARK_TARGET` constants the ramp generator uses. `step` stays as an explicit override.
3. **Showcase contrast columns are inconsistent.** The third "badge" column mixes APCA conventions ("Lc 60", "Lc 75", "Fail") with WCAG conventions ("✓ AA", "✓ AAA"), and the new APCA-Lc and badge columns have no headers. Designer can't tell what each column means. Should standardize on the configured `DS.color.contrastAlgorithm` for the badge and add explicit headers for "APCA Lc" and "WCAG".
4. **Add/remove ramp safety.** Adding a brand ramp is silent (config is rewritten, designer doesn't see what changed at the semantic level); removing a brand ramp without an offered reassignment leaves the semantic section pointing at non-existent primitives. Both flows need a confirmation step from the agent before semantics are written.

---

## Current Pillar Decision — Binding Policy

As of 2026-05-02, design-system binding is **variable-first** for colors, spacing, radii, borders, and scalar layer properties. Figma color/effect styles are fallback metadata, not the primary color binding target. **Typography is the exception:** text styles may be preferred because they can bundle size, line-height, weight, tracking, and family decisions that may themselves be variable-backed.

Practical rule for future work: setup, showcase, documentation, QA, and component creation should rely on the shared live resolver `_createDsBindingContext()` for binding decisions. Server-side hex/value indexes are for reporting and detection context only; they must not become automatic binding authorities. Hex/nearest-color matching remains forbidden for automatic color binding.

## Current Pillar Decision — Agent Boundary

As of 2026-05-02, designer-facing agents guide workflows but do **not** own product logic. The agent translates plain designer intent into existing MCP tools, helps with readiness and confirmation, and summarizes results in human language. The bridge plugin, MCP tools, and shared core own detection, binding, rendering, QA, setup, and documentation output.

Practical rule for future work: agents may choose supported tool options and may ignore or summarize parts of tool output based on the designer's request, but they must not edit showcase scripts, binding logic, QA rules, or generated output as part of a public workflow. Unsupported designer requests become product/dev backlog items unless the developer is explicitly working in this repo.

## Current Pillar Decision — Color Ramp Algorithm

As of 2026-05-02, color ramps default to **OKLCh** interpolation. `DS.color.algorithm` switches between `"oklch"` (default) and `"hsl"` (preserved fallback). OKLCh keeps tints/shades vivid because it interpolates lightness in a perceptually uniform space and only gently reduces chroma; HSL crushed saturation up to 85% on the light side, which is why ramps looked dull.

Practical rule for future work: any new ramp tuning (per-brand chroma boost, custom curves, named presets like "vivid"/"muted") should extend the existing `generateRamp` dispatcher in `packages/figlets-core/src/ds-config/generate-color-ramps.js` and the shared `oklch.js` utilities. Do not introduce parallel ramp pipelines. The semantic-pair WCAG validator and primitives writer downstream are algorithm-agnostic and consume only the resulting `[step, r, g, b]` rows.

As of 2026-05-03, OKLCh `color/neutral/*` is achromatic by default (C=0), not derived from the primary brand hue. A separate `color/neutral-variant/*` ramp carries a very subtle low-chroma tint for secondary surfaces and subtle outlines. Future warm/cool behavior should stay in explicit variant configuration, never implicit in the base neutral ramp.

`update_ds_primitives` supports `create_missing: true` for additive primitive migrations such as adding `color/neutral-variant/*` to an existing Primitives collection. Use it when adding new variables is intended; leave it false for value-only updates.

## Current Pillar Decision — Contrast Algorithm

As of 2026-05-04, accessibility gating defaults to **APCA** (`DS.color.contrastAlgorithm = 'apca'`). Both APCA Lc and WCAG ratios are computed and stored on every semantic pair; only `failCount` and the readiness gate switch per algorithm. Existing configs without the field upgrade transparently to APCA.

Key thresholds: Lc 75 for surface/text pairs, Lc 60 for icon pairs. Decorative/exempt tokens (`min: null`) get `minLc: null` and are never gated. The plugin showcase shows APCA Lc and APCA badge columns **before** the WCAG columns on every semantic color row.

WCAG 2.2 remains a first-class option (`DS.color.contrastAlgorithm = 'wcag'`). Teams with legal/contractual WCAG obligations should set this field explicitly. Switching the field and re-running `prepare_ds_config` is enough — no variable structure changes, only `failCount` and the readiness verdict change.

The APCA formula is APCA 0.0.98G (BC=0.022, BE=1.414 soft clamp; polarity-aware rounding). The validator and plugin implementations are byte-identical.

Practical rule for future work: do not introduce a separate APCA/WCAG code path for any new contrast check. Use `gatePass()` from the validator or the `apcaScorer`/`wcagScorer` helpers. New pair templates must include `minLc` (surface/text: 75, icons: 60, decorative: null).

## Current Live-Figma Rule — Plugin Capability Checks

As of 2026-05-03, the bridge UI advertises command capabilities on `/poll`, receiver `/health` reports `updatePrimitivesLive`, and `update_ds_primitives` fails fast with reload guidance if the open plugin UI is stale. Use `figlets-mcp doctor` before live primitive updates; "Primitive updates: available" means the plugin was reopened with the latest UI.

## Current Designer Button Rule — Safe QA Binding

As of 2026-05-03, the bridge UI has local QA buttons: "Check" renders a report in the plugin, and "Bind Safe" applies only high-confidence fixes through `_runQaBindingAudit({ fix: true })`. Exact scalar matches can be bound automatically. Color role guesses stay report-only unless future work adds stronger semantic evidence; do not reintroduce broad hex or nearest-color auto-binding.

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

## Post-MVP Todo

- Add optional agent-enriched showcase descriptions. Default showcase descriptions should stay deterministic and cheap, but a later workflow can ask an agent to polish token/table usage copy and write the result back to Figma token/style descriptions so future showcase builds can reuse it without spending tokens again.

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

### [2026-04-29 — inspect_component selection debugging hardening]

- Investigated the open `inspect_component` regression where the bridge now responds quickly but returns `selection: []` from `figma.currentPage.selection`.
- Added plugin-side selection instrumentation in `packages/figma-bridge-plugin/code.js`:
  - caches both the current selection snapshot and the last non-empty snapshot in the main plugin thread
  - logs every `selectionchange`, `currentpagechange`, and `extract-selection` snapshot to the Figma plugin console with names, ids, types, page, and source
  - includes `meta.usedFallback`, counts, and cache age in the `/sync-selection` payload
- Added a guarded fallback for `extract-selection`: if the live selection is empty but the plugin has a recent non-empty snapshot from the same page, the bridge serializes that cached snapshot instead. This is meant to cover transient focus-related clears while keeping intentional cross-page stale selections out.
- Figma console debugging showed the selected node was present (`Button 1.0.0`, `COMPONENT_SET`) and the real failure was elsewhere: `serializeNode()` was reading `componentPropertyDefinitions` on variant child components, which throws in Figma with `Can only get component property definitions of a component set or non-variant component`.
- Fixed `serializeNode()` to read `componentPropertyDefinitions` only for `COMPONENT_SET` and standalone `COMPONENT` nodes, while still including `componentProperties` for `INSTANCE` / `COMPONENT` / `COMPONENT_SET`.
- Expanded the bridge plugin UI for live session visibility:
  - current selection panel under the main status, showing count, page, source, and selected node names
  - in-session chronological log panel under selection, showing command execution and bridge events only for the active plugin session
  - plugin main thread now replays session log history and current selection to the UI on `ui-ready`
- Updated `generate_component_doc` selection behavior:
  - server tool now resolves the current Figma selection first and uses the selected `COMPONENT` / `COMPONENT_SET` by default
  - plugin doc builder accepts `componentId` and prefers exact ID matching over page-level name search
  - this prevents stale/manual `component_name` input from documenting the wrong component when a different one is selected
- Tightened the agent-authored content contract for `generate_component_doc`:
  - removed plugin-side placeholder fallbacks for description / Do / Don't
  - server tool now requires `description`, `usage_do`, and `usage_dont`
  - doc generation now fails loudly when the human-authored sections are missing, instead of silently producing weak generic guidance
- Refined spec-sheet rendering behavior:
  - removed the redundant Preview section; variants are now the primary visual reference
  - spec-sheet chrome now attempts to bind its own colors, text styles, and spacing/radius values to the host DS when matching tokens/styles exist
  - sections with no meaningful data are omitted from both the Figma sheet and markdown output
  - anatomy is now skipped when the default variant has no meaningful internal non-instance parts (e.g. primitive/reference components like `Spacing Visual`)
- Added plugin session identification and bridge propagation:
  - plugin UI now shows a visible session ID (`figlets-...`) under the main status
  - `ui.html` sends the session ID on `/poll` and all `/sync*` posts
  - `receiver.js` tracks the active polling session, logs it, and includes `activeSessionId` in 503 not-connected responses
  - this made it possible to verify a real reconnect end-to-end: receiver saw `figlets-mok7r7lf-gzrll`, after which `generate_component_doc` succeeded again
- Receiver restart behavior confirmed: after restarting `src/receiver.js`, the Figma plugin must reopen or otherwise reconnect its long-poll loop before bridge-backed tools succeed again. A visible plugin window alone is not sufficient if the receiver has been replaced underneath it.
- `node --check packages/figma-bridge-plugin/code.js` passes.
- Full `node tests/run-tests.js` could not complete in the Codex sandbox because the bridge receiver tests hit `listen EPERM: operation not permitted 0.0.0.0`; this needs either an adjusted test bind address or an unrestricted run.

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

### [2026-04-30 — semantic brand/accent split and inset visuals]

Follow-up from showcase QA:

- Found why spacing visuals bound to `color/surface/accent` instead of `color/surface/brand`: the semantic scorer treated `accent` as `BRAND`, so `surface/accent` and `surface/brand` tied and saturation/luminance broke the tie.
- Changed both bridge-side semantic maps so `accent` contributes `ACCENT`, while `brand`/`primary` contribute `BRAND`.
- With the new scoring, `color/surface/brand` scores higher than `color/surface/accent` for `surfaceBrand`.
- Found that the old showcase had an `inset` visual builder but no routing into it. Added `inset` group classification and a dedicated inset visual to the port.
- `node --check packages/figma-bridge-plugin/code.js` passes.

Next live test after reloading the Figma bridge plugin: rebuild showcase and verify spacing visual fills bind to `color/surface/brand`, and `space/inset/*` rows render as inset boxes instead of generic spacing squares.

---

### [2026-04-30 — showcase QA binding pass]

`build_ds_showcase` now applies a final DS binding pass to all generated `Token Showcase` sections:

- Binds generated padding/gaps to exact matching spacing variables.
- Binds generated radii to exact matching radius variables.
- Binds generated stroke widths to exact matching border/stroke variables.
- Applies the closest local text style to generated text nodes, with fallback typography-variable binding where no style exists.
- Normalized arbitrary showcase chrome values (`5`, `6`, `10`, `16.5`) to nearby existing DS token values so QA does not correctly flag them as private raw values.
- Figma clears `textStyleId` when font overrides are restored after applying a style, so generated showcase text must actually use DS text-style metrics to count as style-bound.
- Live proof pass on the current Spacing showcase reached `1285/1285` checked properties bound, `0` raw gaps, using a smart audit that treats side-specific radius/stroke bindings as covering shorthand properties.

Verification:
- `node --check packages/figma-bridge-plugin/code.js` passes.
- `npm test` reported all 22 test files passing and exited successfully.

Live validation note: Figma must reload the bridge plugin before a real `build_ds_showcase` call will execute this new code.

---

### [2026-05-04 — update_ds_primitives now refreshes Color semantic aliases]

**Problem:** `update_ds_primitives` updated primitive values (e.g. swapped `color/neutral-variant/*` to its real low-chroma ramp) but did not touch existing Color collection aliases. So `color/surface/variant` Light/Dark stayed aliased to whatever primitive they were originally created against (the old neutral / sage), and the swatch in the showcase did not change even after the underlying primitives did.

**Fix landed in this session:**

- Added a `color-semantics` category to `UPDATE_PRIMITIVE_SPECS` in `packages/figma-bridge-plugin/code.js`. The category does not yield primitive rows; instead the plugin walks `DS.color.semantics` (`pairs`, `icons`, `unpaired`), finds matching variables in the Color collection, and re-points Light/Dark mode values to the primitive variables named in the config. Variable IDs are preserved, so existing component bindings keep resolving.
- `create_missing: true` now also creates missing Color semantic variables alongside missing primitives. Default (`false`) reports them as `unmatched` rather than mutating the collection.
- The existing 503 path was upgraded with `pluginRecentlySeen` / `lastPluginSeenAt` hints so callers can tell "plugin disconnected" from "plugin connected but mid-command".
- `update_ds_primitives` MCP tool, schema, and description updated to mention `"color-semantics"` and semantic alias refresh.
- Tests added: `tests/bridge/qa-binding-audit-policy.test.js` enforces that the plugin keeps the new alias-update path; `tests/server/update-ds-primitives-tool.test.js` checks the description mentions semantic aliases; `tests/bridge/receiver-lifecycle.test.js` covers the recently-seen 503 hint and `/health` capability reporting around an in-flight request.

**Live verification (Green Apple file):**

- `update_ds_primitives` with `categories=["color-semantics"]`, `create_missing: false`: report was `entries: 41, updated: 5, unchanged: 33, unmatched: 3` (`color/surface/{success,warning,info}-variant` — those Color variables do not exist in the live collection yet, and `create_missing` was off).
- `build_ds_showcase` after the alias refresh returned `bindingWarnings: []` and rendered all 5 sections on `00 · Tokens`.
- Full test runner: `33/33 passed` against Node 24.

**Follow-up — primitive nearest-step fallback (same session):**

Added `_resolveSemanticTarget(byName, targetName)` to the plugin's color-semantics path. When a templated primitive target (e.g. `color/green/950`) does not exist in the live Primitives collection, the helper walks the same ramp prefix and binds to the nearest existing numeric step (e.g. `color/green/900`). Each substitution is reported as `{ token, mode, requested, used }` in `report['color-semantics'].substituted`, and the human-readable message now includes `N substituted` when present. This means a stale primitive scale never blocks the alias refresh; the agent decides whether to surface the gap to the designer (e.g. "your `green` ramp is missing step `950` — add it to your config and re-run setup") without halting the live update. Variable IDs are still preserved in the substitution path, so existing component bindings keep resolving.

Policy assertion in `tests/bridge/qa-binding-audit-policy.test.js` now requires the helper, the `substituted: true` return shape, and the report field to all stay present.

**Resolved same session:** the designer chose to create the missing variant aliases. Re-ran with `create_missing: true` → `created: 3, updated: 3, unchanged: 38, unmatched: [], substituted: []`. Targets were standard `*/100` and `*/900` steps that already exist in the Primitives collection, so the new nearest-step fallback was not exercised on this run; it stays in place for future cases where ramp scale and config templates diverge. Final showcase rebuild returned `bindingWarnings: []`. The agent-side prompt for "create vs leave" is the recommended UX whenever `unmatched` lists Color semantic variables.

---

### [2026-05-04 — APCA contrast option — SHIPPED ✓]

**Shipped in two commits. Both phases complete. 33/33 tests passing.**

**What shipped:**

- **Phase 1 commit** `feat(ds-config): APCA contrast option with default to APCA`:
  - `DS.color.contrastAlgorithm` — `'apca'` (default) or `'wcag'`. Configs without the field upgrade transparently to APCA.
  - `gatePass()` — computes `wcagPass`, `apcaPass`, and gated `pass` from the chosen algorithm. `failCount` and `suggestStep` follow `pass`.
  - `suggestStepFor(textRampRef, bgRgb, scorer, threshold)` — algorithm-agnostic ramp walker. WCAG shim preserved.
  - Signed Lc stored on every row; `Math.abs` applied only at render time.
  - `minLc` added to pair templates: 75 (surface/text), 60 (icons), null (decorative/exempt).
  - Markdown table now shows `Light APCA` and `Dark APCA` columns alongside WCAG.
  - Adapter docs updated: contrast standard intake question with pros/cons, algorithm switch as `update_ds_primitives` re-run trigger, stale WCAG-only strings updated.

- **Phase 2 commit** `feat(showcase): show APCA Lc and badge columns before WCAG`:
  - `_apcaLum` + `_apcaLc` ported into `code.js` using the full APCA 0.0.98G implementation (soft clamp BC=0.022/BE=1.414, polarity-aware rounding) — byte-identical to the validator.
  - `_buildApcaBadge(lc)` reuses `_buildBadge` palette; Lc ≥ 75 → AA, ≥ 60 → "Lc 60", < 60 → Fail.
  - Two new cells in `_buildSemColorRow` before WCAG cells: `apcaLcCell` ("Lc NN", 128px) and `apcaBadgeCell` (128px). Row order: token · swatch · **APCA Lc** · **APCA badge** · WCAG ratio · WCAG badge.
  - Policy assertions in `tests/bridge/qa-binding-audit-policy.test.js` guard all new helpers and cells, including the soft-clamp constants.

- **Post-ship fix** (same session): APCA math bug corrected — initial port omitted the BC/BE soft clamp and polarity-aware rounding, causing Lc values to diverge from the validator for near-black colors. Fixed by porting the full formula. `node --check` + 33/33 + e2e formula comparison confirm alignment.

**E2E verification (live Green Apple config, no Figma required):**
- APCA mode: 11 pairs fail Lc gate → confirms APCA is active and exposing real perceptual contrast gaps that WCAG missed.
- WCAG mode: 0 failures → config was tuned to WCAG; algorithm switch produces different `failCount` as expected.
- Both `Light APCA` and `Dark APCA` columns appear in `semanticPairsTable` under both modes.
- Plugin `_apcaLc` formula verified byte-identical to validator for black/white, polarity, yellow, brand blue, near-zero cases.

**Live config note:** the Green Apple `.local/design-system.config.js` does not have `DS.color.contrastAlgorithm` set, so it defaults to `'apca'`. The designer will see 11 failing pairs when they next run `prepare_ds_config`. They should fix these or acknowledge them before running `apply_ds_setup` (or `update_ds_primitives`). Adding `DS.color.contrastAlgorithm = 'wcag'` restores the previous behavior with 0 failures.

**Open deferred items (Phase 3):**
1. Use-case tier labels ("Body ≥ 14px") for per-font-size APCA gating — data layer has `minLc`; presentation label deferred.
2. Section width budget: the colors section is now 256px wider. Visual overflow check needed on a live build.

**Designer action required:** next `prepare_ds_config` run will surface 11 APCA failures. The adapter will say "switching to APCA flagged 11 pairs that passed WCAG" and suggest nearest passing steps.

---

### [2026-05-03 — showcase color ordering polish]

After the neutral-variant primitive work, the live showcase was updated to sort color rows in a designer-facing order:

- Primitive color ramps: likely brand ramps first, then `neutral`, then `neutral-variant`, then utility/status ramps (`red`, `green`, `yellow`, `blue/info`, etc.).
- Semantic color groups: surfaces/backgrounds first, followed by text, outlines, icons, and then lower-priority status/info/warning/error/disabled rows.
- The ordering lives only in `packages/figma-bridge-plugin/code.js` showcase rendering helpers. It does not alter variable generation, values, IDs, aliases, or binding policy.
- Live showcase rebuild after one plugin reload returned `bindingWarnings: []`.
- Full tests passed with the bundled modern Node runtime: `32/32`. Plain `npm test` in this shell resolved to `/usr/local/bin/node v10.1.0`, which is too old for existing tests (`matchAll`, `flatMap`, and newer HTTP listener behavior).

---

### [2026-04-30 — shared semantic DS binding resolver started]

Preparing for `/fig-qa` auto-fix, added a shared bridge-side resolver in `packages/figma-bridge-plugin/code.js`:

- `_createDsBindingContext()` detects variables, collections, text styles, effect styles, collection roles, aliases, semantic color roles, float values, and text-style matches in one live Figma pass.
- Color binding is semantic-first, based on the existing segment/category scoring model from the showcase. Hex matching is intentionally not used for automatic color role binding.
- Purpose locks remain the rule for role-specific slots: border/outline tokens must have outline semantics, status fills must have surface/bg semantics, and text/icon slots must have foreground semantics.
- `generate_component_doc` now consumes this resolver for spec-sheet chrome colors, spacing/radius/border variables, and text-style roles. Its output contract is unchanged; only the binding path changed.
- `node --check packages/figma-bridge-plugin/code.js` passes.
- `npm test` reports 22/22 test files passing. The runner can take a while to release after the summary because of bridge-server handles, but exited successfully.

Next step: port QA audit/fix commands on top of `_createDsBindingContext()` instead of bringing over old hex-based `bind-colors.js` as-is.

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

---

### [2026-05-08 — DESIGN.md intake/export + neutral setup naming]

**Objective completed:** Added Google-style `DESIGN.md` support as a setup intake shortcut and portable export artifact.

**What changed:**

- `packages/figlets-core/src/ds-config/design-md-intake.js`
  - Parses DESIGN.md YAML front matter with no external dependency.
  - Maps project name, brand colors, typography roles, and spacing base into a starter Figlets `DS`.
  - Exports prepared Figlets configs back to DESIGN.md for agent/code-repo portability.
- `packages/figlets-mcp-server/src/tools/design-md-intake.js`
  - Adds `create_ds_config_from_design_md`, which writes a starter `design-system.config.js` from an existing DESIGN.md.
- `prepare_ds_config` and `apply_ds_setup`
  - Write `DESIGN.md` next to the active file-scoped config and return `designMdExport.path`.
  - This makes the export available after setup/prepare without another expensive Figma operation.
- `compute-ds-config`
  - Renamed legacy `needsClaude` to `needsDesignerInput`.
  - Imported custom DESIGN.md typography now counts as answered intake when the scale is present.
- Adapter docs
  - Setup starts by asking if the designer already has DESIGN.md.
  - DESIGN.md lint/diff are optional designer-approved follow-ups, not automatic gates.

**Tests and checks:**

- Added tests:
  - `tests/core/design-md-intake.test.js`
  - `tests/server/design-md-intake-tool.test.js`
  - `tests/server/apply-ds-setup-export.test.js`
  - updated `tests/server/prepare-ds-config-tool.test.js`
- Full suite passed: `40/40`.
- `git diff --check` clean.
- Commit: `46b48a0 Add DESIGN.md intake and export`.

---

### [2026-05-07 — contrast-harmonized OKLCh ramps + APCA swatch showcase]

**Objective completed:** Added an opt-in OKLCh `DS.color.rampStrategy = "contrast-harmonized"` and updated the Colors showcase to make primitive and semantic contrast behavior visible.

**What changed:**

- `packages/figlets-core/src/ds-config/generate-color-ramps.js`
  - Adds `rampStrategy: "contrast-harmonized"` alongside the existing default `"standard"`.
  - Requires `DS.color.algorithm = "oklch"`.
  - Treats brand colors as hue/chroma seeds rather than exact numbered anchors.
  - Places every ramp on a fixed OKLCh lightness ladder (`50` light → `950` dark), with chroma tapering toward the extremes.
  - Keeps monotonic lightness, avoiding the observed 400/500 inversion and muddy first-step jumps.

- `packages/figlets-core/src/ds-config/validate-semantic-pairs.js`
  - Adds contrast-harmonized semantic pair defaults so role-based generated pairs validate cleanly under APCA.
  - Soft backgrounds stay on `bg/*` / `surface/*`; strong fills stay on `fill/*` + `text/on-*`.

- `packages/figma-bridge-plugin/code.js`
  - Primitive ramp swatches now use a split tile:
    - top half: readable neutral text on the swatch
    - bottom half: swatch color as text on a readable neutral extreme
  - Both halves show `✓ Lc NN` or `✗ Lc NN` using Lc 75 as the body-text threshold.
  - Swatches flex across the row with a 56px minimum so the full 50-950 ramp fits the showcase width.
  - Semantic pair swatches now show the same APCA pass/fail label for the actual paired foreground/background. Text pairs use Lc 75; icon-like rows use Lc 60.

**Active live file:**

- Figma file: `Figlets DS`
- Active local config: `.local/local_movbxur3_6gow4h4j/design-system.config.js`
- Preview SVG: `.local/local_movbxur3_6gow4h4j/design-system.preview.svg`
- Active config includes `"rampStrategy": "contrast-harmonized"` and prepared cleanly:
  - `readyToBuild: true`
  - `failCount: 0`
  - `apcaFailCount: 0`

**Live verification:**

- User reloaded the Figlets Bridge plugin after `code.js` changed.
- Receiver connected to `file=local_movbxur3_6gow4h4j`.
- Ran `update_ds_primitives` with `categories: ["color", "color-semantics"]`, `create_missing: true`:
  - color: `67 updated`, `32 unchanged`, no unmatched/type mismatches
  - color-semantics: `1 updated`, `51 unchanged`, no unmatched/type mismatches
- Ran `build_ds_showcase`:
  - rendered `Colors`, `Typography`, `Spacing`, `Elevation`, `Scrims` on `00 · Tokens`
  - only expected raw chrome warnings remained (`radius 16`, `spacing 6`, `font size 9`, etc.)

**Tests and checks:**

- `node --check packages/figma-bridge-plugin/code.js` passed.
- Forbidden modern operators check for `??`, `?.`, `**` in plugin code found only existing comments/markdown strings.
- Full test suite passed with bundled modern Node: `37/37`.
- `git diff --check` clean.

**Follow-up completed on 2026-05-08:**

- WCAG parity for the new swatch treatment is implemented.
- Primitive and semantic swatch labels now branch on `DS.color.contrastAlgorithm`.
  - APCA mode keeps `✓ Lc NN` / `✗ Lc NN`.
  - WCAG mode uses compact status labels: `✓ AAA`, `✓ AA`, `~ Large`, `✓ 3:1`, `✗ Fail`.
- `build_ds_showcase` now forwards `DS.color.contrastAlgorithm` from the active file-scoped config to the bridge plugin; previously it only forwarded collections and semantic pairs, which would have made live WCAG showcase builds silently fall back to APCA labels.
- Live verification after reloading the Figlets Bridge plugin:
  - Sent a one-off WCAG showcase request for active file `local_movbxur3_6gow4h4j` without changing the saved APCA config.
  - Rendered `Colors`, `Typography`, `Spacing`, `Elevation`, `Scrims`.
  - Only existing numeric fallback warnings remained; no color/contrast-specific errors.

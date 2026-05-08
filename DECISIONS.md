# Decisions

Running log of non-obvious project decisions and the reasons behind them.

---

## [2026-05-08] DESIGN.md is an intake/export bridge, not the source of truth

**Decision:** Figlets supports Google-style `DESIGN.md` as a portable interchange layer. `create_ds_config_from_design_md` imports DESIGN.md front matter into a starter `design-system.config.js`, so setup can skip answers the designer already provided. `prepare_ds_config` and `apply_ds_setup` write a `DESIGN.md` export next to the file-scoped config for download/share after setup.

**Why:** DESIGN.md is useful agent context: machine-readable tokens plus human-readable rationale. Figlets, however, has richer Figma-specific semantics: APCA/WCAG validation, mode-aware aliases, semantic pairs, icon thresholds, scrims, elevation styles, and local file isolation. Replacing the prepared config with DESIGN.md would lose product-critical structure.

**Consequence:** The prepared Figlets config and Figma variables remain authoritative. DESIGN.md import is an intake shortcut; DESIGN.md export is a portable artifact for coding agents and downstream tools. External lint/diff commands for DESIGN.md are optional designer-approved steps, not automatic setup gates. The old `needsClaude` field was renamed to `needsDesignerInput` because missing setup details are product/design decisions, not agent-specific work.

---

## [2026-05-07] Showcase semantic colors use prepared pair relationships when available

**Decision:** When `build_ds_showcase` can read the active file-scoped config, it forwards `DS.color.semantics.pairs` to the bridge plugin. The Colors showcase renders the Semantic Colors table directly from those pair relationships instead of rediscovering background/foreground pairings from variable names. Showcase chrome also prefers explicit generic/brand-subtle tokens (`color/text/subtle`, `color/text/muted`, `color/bg/brand-subtle`, `color/text/brand`) before broad role scoring.

**Why:** Role-based names such as `color/bg/default` + `color/text/default` do not follow the older `surface` → `on-surface` naming pattern. Name-rediscovery split clean semantic tokens into unrelated groups (`surface`, `icon`, `fill`) and bound table/tag text to purpose-specific tokens like `color/text/on-brand`, making labels disappear on neutral table rows.

**Consequence:** Generated design-system files get one coherent Semantic Colors table that matches the validated setup config. Zero-config showcase builds can still fall back to structural/name heuristics, but prepared config pairings are authoritative. Exempt muted pairs may still render without the paired-text indicator when below the indicator threshold; whether to lower that threshold is a future product choice, not part of this restoration.

---

## [2026-05-07] Contrast-harmonized OKLCh ramps are opt-in

**Decision:** `DS.color.rampStrategy = "contrast-harmonized"` adds an optional OKLCh ramp generator that treats brand colors as hue/chroma seeds and places the full ramp on a fixed perceptual lightness ladder. Brand colors do not have to be forced into an exact numbered stop; the generated ramp keeps their character while tightening level-to-level APCA consistency across hues. The default remains the existing `"standard"` OKLCh ramp behavior.

**Why:** External palette tools such as Harmonizer point to a useful product principle: palette levels should behave like contrast/lightness contracts, not only interpolated color stops. Figlets should learn from that principle without copying code or making the first OKLCh implementation unstable.

**Consequence:** Designers can opt into contrast-harmonized ramps for more predictable primitive levels while existing configs remain unchanged. The strategy requires `DS.color.algorithm = "oklch"` and is covered by core tests comparing APCA spread across generated utility hues.

---

## [2026-05-07] Showcase swatches expose APCA pass/fail context

**Decision:** Primitive color ramp swatches use a split preview: readable neutral text on the swatch, and the swatch color as text on a readable neutral extreme. Both halves show `✓ Lc NN` or `✗ Lc NN` at the body-text APCA threshold of Lc 75. Semantic pair swatches now show the same APCA label treatment for the actual paired foreground/background relationship; semantic text pairs use Lc 75, icon-like rows use Lc 60.

**Why:** Designers need to understand whether a primitive step can carry text, not only whether the color looks good in isolation. The split treatment makes both common uses visible without forcing a primitive ramp to imply one semantic pairing.

**Consequence:** The swatch treatment is APCA-specific today. A WCAG version should use ratio-based labels such as `✓ AA`, `✓ AAA`, `~ Large`, or `✗ Fail` rather than `Lc`; this is a follow-up task if the project needs WCAG-mode showcase parity.

---

## [2026-05-07] Setup preview is generated before any Figma apply

**Decision:** `prepare_ds_config` now writes a lightweight SVG preview next to the active file-scoped config and returns it as `setupPreview.svgPath`. The preview shows generated ramps and semantic pairs as actual swatches/text samples before `apply_ds_setup` is allowed to touch Figma.

**Why:** Hex-only setup review is too abstract for designers and agents alike. The setup protocol needs a cheap, local, human-readable preview so color scale and semantic decisions can be checked in the conversation before variables are created or updated in Figma.

**Consequence:** The setup flow remains two-phase: prepare, review preview + readiness, then apply only after explicit confirmation. The preview is an aid for discussion, not a replacement for APCA/WCAG gating or the final Figma showcase.

---

## [2026-05-07] Utility `bg/*` tokens are soft backgrounds; strong status colors use `fill/*`

**Decision:** Default generated utility/status semantics distinguish soft background surfaces from strong fills. Role-based naming now emits pairs such as `color/bg/success` + `color/text/success` for soft status surfaces, and `color/fill/success` + `color/text/on-success` for strong filled badges/buttons. Surface-based naming follows the same model with `color/surface/success` and `color/fill/success`.

**Why:** Designers generally expect `bg`/`surface` status tokens to support readable text on quiet UI backgrounds, while saturated status colors are a different purpose: fills for badges, controls, charts, or emphasis. Using mid/strong tones for `bg/*` made generated systems feel opinionated and could fail accessibility for body text.

**Consequence:** Future generated configs provide both intents by default. Agents should not “fix” soft backgrounds into saturated fills unless the designer explicitly asks for high-emphasis status surfaces; use `fill/*` for that purpose instead.

---

## [2026-05-06] Keyless Figma files must not inherit the flat DS config

**Decision:** A sync from a Figma file with no usable `figma.fileKey` records `active-file.json` with `fileKey: null`. Server tools must not read or mutate from the legacy flat `.local/design-system.config.js` for an active Figma file. `build_ds_showcase` only auto-reads `.local/<fileKey>/design-system.config.js`, and `prepare_ds_config`, `apply_ds_setup`, and `update_ds_primitives` refuse the flat config whenever a file-scoped config should be used.

**Why:** New or unsaved Figma files can report an empty file key through the bridge. Falling back to `.local/design-system.config.js` made a fresh file inherit a previous file's DS config, which is exactly the cross-file bleed the per-file isolation work was meant to prevent. Ignoring the empty file key in the receiver is also unsafe because it leaves the previous file's active pointer in place.

**Consequence:** A fresh file must first have a file-scoped key before DS setup/update tools can use a config. The flat `.local/design-system.config.js` remains a legacy artifact only; it is no longer a valid config source for active file workflows.

---

## [2026-05-07] Keyless Figma drafts get a persistent local file identity

**Decision:** When `figma.fileKey` is empty, the bridge plugin creates or reuses a file-local `local_*` identity stored on `figma.root` plugin data under `figletsFileKey`. The UI forwards that value as `fileKey`, so receiver paths still resolve to `.local/<local-id>/` instead of the flat root. When Figma provides a real `figma.fileKey`, that real key wins.

**Why:** Refusing the flat config prevented cross-file bleed, but it left new/unsaved Figma drafts unable to participate in the per-file config workflow. The product requirement is per-file isolation, not "saved-cloud-file only" isolation.

**Consequence:** Fresh drafts and saved files both get isolated local state. Draft identities are local to the file and plugin data; if a future save starts returning a real Figma fileKey, the active path will move to `.local/<real-fileKey>/`, and any wanted draft config can be migrated deliberately.

---

## [2026-05-06] Decorative colors are excluded from binding role fallbacks

**Decision:** `scrim`, `overlay`, `state`, `shadow`, and `elevation` color variables must not participate in text/foreground/background role fallback selection. They may still render in their own showcase sections and remain valid variables, but the shared binding resolver and showcase `_V` palette must exclude them when looking for readable text or structural UI colors.

**Why:** When a file lacks recognized foreground names, a pure luminance fallback can pick black scrim variables as "best text" because they are dark. That makes generated showcase copy bind to overlay tokens, which violates the variable-first binding policy: automatic binding can use semantics and exact scalar matches, but it must not infer text purpose from decorative overlay values.

**Consequence:** Text, foreground, and structural showcase chrome now fall back only among non-decorative color variables. Scrim variables are still documented in the Scrims section and can still be semantic aliases for overlay use cases.

---

## [2026-05-06] Showcase builder restored to pre-migration baseline

**Decision:** The token showcase renderer (`_buildShowcase`) and `build_ds_showcase` payload shape are restored to the Sunday 2026-05-03 pre-17:13 baseline (`eda38ad`). The later color-migration work remains available in setup/update tools, but the showcase should not consume the active DS config, introduce APCA-specific row layouts, split new outline/border groups, or otherwise change grouping/readability while the color migration stabilizes.

**Why:** The requested product operation was narrow: regenerate primitive colors and update semantic color aliases. Coupling that migration to showcase rendering changed the visual output, grouping, and text readability, making the showcase feel broken even when the variable update path was the real target.

**Consequence:** Preserve the product decisions around OKLCh ramps, primitive updates, semantic alias refresh, and per-file isolation, but treat showcase redesign as frozen until it is planned and verified separately. Future color update work must not rewrite showcase presentation as a side effect.

---

## [2026-05-06] QA safe-bind failure count excludes intentionally skipped low-confidence suggestions

**Decision:** `_runQaBindingAudit({ fix: true })` only attempts fixes for high-confidence suggestions. Low/medium/none-confidence suggestions remain report-only and are not counted as failed fixes.

**Why:** The showcase final QA pass reported 31 unresolved gaps even after the relevant Typography/Spacing variables existed. Those were not failed high-confidence bindings; they were intentionally skipped low/medium-confidence suggestions. Counting them as failures made the showcase state look broken and contradicted the safe-bind policy.

**Consequence:** `fixedCount` and `failedCount` now describe attempted safe fixes only. `violationCount` still reports all detected issues for audits, preserving visibility without overstating unresolved generated-showcase gaps.

---

## [2026-05-06] `apply_ds_setup` repairs stale Typography/Spacing collections additively

**Decision:** Typography and Spacing now check for the current DS token names before skipping an existing collection. If an old collection exists but is missing generated names such as `type/{role}/size`, `type/{role}/weight`, `space/{semantic}`, `space/radius/{key}`, or `space/border/{key}`, `apply_ds_setup` enters merge mode and creates only the missing variables. Existing variables and modes are preserved; missing breakpoint modes are added by name.

**Why:** The fresh showcase was left with unresolved QA gaps because old Typography and Spacing collections had variables from a previous naming shape. Deleting those collections manually would restore the showcase but risks breaking unrelated bindings. Additive repair matches the existing merge-populate decision and restores the showcase binding surface without destructive collection surgery.

**Consequence:** Re-running `apply_ds_setup` after the plugin is reloaded can repair stale Typography/Spacing collections in place. If old variables remain, they are intentionally left alone; cleanup can be a separate confirmed maintenance task.

---

## [2026-05-06] `apply_ds_setup` merge-populate: Primitives with existing FLOAT/STRING vars

**Decision:** `getOrCreateCollection` treats a collection as "existed" when it has any variables. For the Primitives collection specifically, after `getOrCreateCollection` returns, the setup block checks for COLOR vars separately (`_primHasColors`). If the collection exists but has zero COLOR vars, the full population block runs in merge mode: `_primMergeMap = await buildVarMap(primColl.id)` is pre-fetched and every `createVariable` call is guarded by `if (_primMergeMap[name]) continue`. Typography and Spacing blocks use the same merge-map pattern if they are entered, plus safe mode-dedup (check existing mode names before calling `addMode`).

**Why:** A user who deletes only the color ramps (leaving spacing/type FLOAT vars in place) would see all three collections skip on the next `apply_ds_setup` run. The COLOR-specific check for Primitives corrects this without overwriting the intact FLOAT/STRING vars.

**Consequence:** If the Primitives collection already has COLOR vars (normal case), nothing changes — it skips as before. The merge guard also prevents crashes when the collection has a partial set of FLOAT/STRING vars with identical names.

---

## [2026-05-06] Per-Figma-file isolation under .local/<fileKey>/

**Decision:** All bridge-written files (`figma-data.json`, `figma-selection.json`) are stored under `.local/<fileKey>/` rather than the flat `.local/` root. `active-file.json` in the root tracks the last-seen fileKey. Tools that auto-detect paths (`build_ds_showcase`, `audit_tokens`) read `active-file.json` and resolve against the active directory. Tools that take an explicit path (`prepare_ds_config`, `update_ds_primitives`) are unaffected — callers pass `.local/<fileKey>/design-system.config.js`.

**Why:** A single `.local/design-system.config.js` was overwritten whenever a different Figma file was synced, corrupting the design system of the previously active file. The fileKey (`figma.fileKey`) is stable, unique per file, and available in the plugin main thread, making it the correct scoping key. fileName is not used because it can change.

**Consequence:** Switching the active file requires running `sync_figma_data` once to update `active-file.json`. Existing `.local/design-system.config.js` must be migrated manually: `cp .local/design-system.config.js .local/<fileKey>/design-system.config.js`. The flat-root legacy paths are kept in `paths.js` for backward compatibility with any external tooling.

---

## [2026-05-05] Swatch indicators gate on configured contrast algorithm; show step number + text badge

**Decision:** `_swatchIndicator` and `_buildSwatch` in `code.js` read `_contrastAlgorithm` (derived from `DS.color.contrastAlgorithm`, forwarded by `build-showcase.js` from the local config, defaulting to `'wcag'`) hoisted to the `_buildShowcase` scope. Indicator gate: APCA → `|Lc| ≥ 60`; WCAG → ratio ≥ 4.5. Step number (e.g. `300`) shown top-left at 8px font, semibold. Badge format: `Lc XX%` (APCA) or `✓` (WCAG), 8px Regular, bottom-right at 12px from both edges. Badge is created inline (not via `_tDS`) with `textAutoResize = 'WIDTH_AND_HEIGHT'` set **before** `characters` so width is computed immediately; then appended, x/y set using computed width, then `constraints: { horizontal: 'MAX', vertical: 'MAX' }` locked in — this order guarantees the correct 12px right offset is stored. Swatch stroke uses `_V.outlineSubtle` only when that variable exists. Outline/border/stroke semantic tokens rendered in a separate "Outlines & Borders" table with a `[Token, Example]` 2-column heading.

**Why:** Earlier attempts used `_tDS` (which sets `characters` before `textAutoResize`), leaving `badge.width = 0` at positioning time — placing the badge 80px from the left with a 0px right offset stored in the constraint, so it flew outside the frame as the container grew. `textAlignHorizontal = 'RIGHT'` + `STRETCH` was tried as an alternative but caused Figma to mirror text on certain swatches (a known Figma RTL-detection edge case). Inline creation with the correct property order resolves both issues.

**Consequence:** WCAG-mode projects see `✓` only (no number) because WCAG ratio depends on the chosen text colour, which varies per swatch. `Lc XX%` treats the Lc score as a 0–100 scale (practical maximum ≈ Lc 106); the `%` suffix makes it scannable without explaining APCA notation to designers.

---

## [2026-05-05] Auto-anchor maps OKLab L linearly to the configured step scale

**Decision:** When `brand.step` is omitted, `brandAnchorIdx` computes `t = (OKLCH_LIGHT_TARGET − L) / (OKLCH_LIGHT_TARGET − OKLCH_DARK_TARGET)` where L is the brand hex's OKLab L, then maps `t` linearly across `steps[0]` → `steps[last]` and snaps to the nearest configured step. Constants used: `OKLCH_LIGHT_TARGET = 0.97`, `OKLCH_DARK_TARGET = 0.18`.

**Why:** A linear map produces results that match designer intuition without any calibration data. Tested against three brand hexes: lime (#88bf2e, L≈0.74 → step 300), teal (#2f6b6b, L≈0.49 → step 600), sand (#8D7971, L≈0.59 → step 500) — all confirmed correct on the 100-900 scale.

**Consequence:** The explicit `step` override is still respected and flagged as `(override)` in the prepare summary. Auto-derived steps are flagged as `(auto)`. A future session could use a non-linear map if the linear result proves poor for very dark or very light hexes, but that would be a tuning change only, not an API change.

---

## [2026-05-05] Status badge unifies APCA and WCAG conventions; WCAG badge column removed

**Decision:** The showcase semantic-colors table was using four contrast columns (APCA Lc number, APCA badge, WCAG ratio, WCAG badge), but the heading only declared two (Contrast, WCAG), causing a layout misalignment. Collapsed to three columns: `APCA Lc` (always numeric), `Status` (algorithm-aware badge driven by `DS.color.contrastAlgorithm`), `WCAG` (always numeric ratio). The fourth WCAG badge column was dropped.

**APCA thresholds for Status badge:** Lc ≥ 75 → `✓ Lc 75` (green); Lc ≥ 60 → `✓ Lc 60` (warning); else → `✗ Fail`.
**WCAG thresholds for Status badge:** ≥ 7 → `✓ AAA`; ≥ 4.5 → `✓ AA`; ≥ 3 → `~ Large`; else → `✗ Fail`.

**Why:** Designers reading the showcase couldn't tell which algorithm's verdict to trust. The mixed "Lc 60" / "✓ AA" labels on the same row implied both applied. Collapsing to a single `Status` column keyed to the project's declared algorithm removes ambiguity while keeping both raw numbers visible for reference.

---

## [2026-05-05] `prune_unused_ramps` scopes strictly to `color/<name>/<digits>` shape

**Decision:** `pruneUnusedRamps` deletes Primitives variables matching `color/<name>/<digits>` (exactly 3 path segments, numeric leaf) where `color/<name>` is not in `DS.color.ramps`. It does not touch `color/scrim/*`, `color/neutral-variant/*` when not in ramps, or any variable with a non-numeric leaf or more than 3 segments.

**Why:** A broader pattern (e.g., deleting any `color/<name>/*`) would silently remove hand-crafted scrim or elevation helpers. The 3-segment + numeric-leaf shape is unique to ramp step variables and is safe to delete by formula.

**Consequence:** Non-ramp `color/` variables (scrims, shadows, any flat `color/<name>`) are never pruned. If a ramp is not configured but its folder remains in Figma, only the numeric-step children are deleted — the folder itself would become empty and can be cleaned up manually.

---

## [2026-05-05] Brand entries declare their step in the ramp

**Decision:** Each entry in `DS.color.brand[]` may carry an optional `step` field that names which step of the configured scale the brand hex anchors at. When absent, the next session will auto-derive the step from the brand's OKLab L (mapped against `OKLCH_LIGHT_TARGET = 0.97` at the lightest step and `OKLCH_DARK_TARGET = 0.18` at the darkest). Until auto-derivation lands, omitted `step` defaults to the scale midpoint for backward compatibility.

**Why:**
- A vivid mid-light brand hex (e.g. lime `#88bf2e`, L ≈ 0.755) anchored at /500 produces an over-saturated middle and weak tints. Designers recognized this immediately from the screenshot and asked why the system ignored the natural step.
- A deep brand (e.g. teal `#2f6b6b`, L ≈ 0.451) anchored at /500 forces /600–/900 to crash to near-black. The intent is `/700`, not `/500`.
- Industry-standard libraries (Tailwind, Material) place brand hexes at the steps they natively belong to. Forcing `/500` betrays designer intuition.

**Consequence:** Brand step is no longer implicit. Configs that omit `step` continue to work; new ramp introspection (showcase header, prepare summary) should display the resolved anchor. The API contract (`step: number`) is fixed and will not change when auto-derivation lands.

---

## [2026-05-05] Primitive pruning is scope-bound to configured ramps

**Decision:** `update_ds_primitives` ships with `prune_off_scale: true` to delete primitives whose step is outside the configured scale, but **only within the folders enumerated in `DS.color.ramps`**. The plugin never deletes variables in unmanaged folders.

**Why:**
- Hand-crafted ramps from prior sessions (lime, teal at 50–950) collided with the new 100–900 pipeline scale and left orphan `/50` and `/950` entries. A blanket delete-by-shape rule would also delete user-added primitives that happen to match a numeric-step shape.
- Scoping to `DS.color.ramps` keeps the operation predictable: if it isn't in the config, it isn't touched.

**Consequence:** Removing an entire ramp (e.g., dropping peach from `brand[]`) is **not** covered by `prune_off_scale`. A separate operation — currently manual — is required to delete a removed ramp's full primitive set. The next session is expected to introduce a `rebrand` flow that handles ramp removal, semantic re-pointing, and primitive deletion as one confirmed operation.

---

## [2026-05-05] Showcase scopes to the named semantic collection when config is present

**Decision:** When `.local/design-system.config.js` exists at showcase build time, `build_ds_showcase` reads `DS.collections` and forwards it to the plugin. The plugin filters `_semanticColls` and `_primColls` by exact collection name. The existing structural heuristic (`isAlias && colorVarCount > 0`) remains as a fallback when no config is available.

**Why:**
- The structural heuristic mistakenly included `Button · Type` (3 alias color vars × 4 component-state modes) and rendered `button/bg`, `button/fg`, `button/stroke` in the semantic-color table. Designers experienced this as "the showcase is randomly binding component variables."
- A name-based filter matches the designer's mental model: the collection declared in `DS.collections.color` is the authoritative semantic source.
- Falling back to the heuristic preserves zero-config use of the showcase tool against arbitrary Figma files.

**Consequence:** Future component-state collections will not pollute the showcase as long as the config declares the semantic collection name. The build_ds_showcase payload schema gained an optional `DS` field carrying `{ collections }`. Other showcase consumers can rely on the same precedence: explicit DS config wins, heuristic fills in.

---

## [2026-05-03] OKLCh neutrals are achromatic, not brand-tinted

**Decision:** The default OKLCh `neutral` ramp uses zero chroma across the scale. A separate `neutral-variant` ramp provides a very low-chroma palette tint for secondary surfaces and subtle outlines. HSL fallback preserves the old hue-derived neutral behavior for compatibility.

**Why:**
- A "neutral" primitive should remain visually neutral across projects. Deriving its hue from the primary color can turn grays green, red, or blue depending on the brand.
- OKLCh already gives us perceptual lightness control, so the neutral ramp can be built directly as C=0 without losing tonal quality.
- Designers still benefit from quiet palette character in panels and container backgrounds. That belongs in an explicit variant ramp with a tight chroma cap, not in every neutral.

**Consequence:** Regenerating configs with the OKLCh default changes `color/neutral/*` values to true grays and adds `color/neutral-variant/*` unless `DS.color.neutralVariant` is disabled. Semantic surface variants and subtle outlines may use `neutral-variant`; text and contrast-critical defaults stay on `neutral`. Existing live Figma files that predate the new ramp can add those variables with `update_ds_primitives` and `create_missing: true`; existing variable IDs are preserved.

---

## [2026-05-03] Plugin QA buttons expose only safe automatic binding

**Decision:** The bridge UI includes local QA actions: "Check" for report-only audit and "Bind Safe" for applying high-confidence fixes. The buttons use the same `_runQaBindingAudit` logic as the MCP tool and render the result in the plugin UI. `Bind Safe` intentionally keeps the existing rule that only high-confidence suggestions are applied.

**Why:**
- Designer-facing buttons need to do something useful without requiring an agent round-trip.
- Exact scalar matches for spacing, radius, border width, and strongly resolved typography bindings are safe to apply by deterministic logic.
- Color role guesses from layer names are useful as suggestions but are not safe enough to auto-bind broadly. Same visual color can mean different semantic roles, so hex/nearest-color auto-binding remains forbidden.

**Consequence:** The plugin can provide a one-click cleanup for safe bindings and an immediate QA report. Making color binding feel magical requires a future high-confidence color policy (for example explicit role annotations or component anatomy metadata), not a broad value-match shortcut.

---

## [2026-05-03] Primitive updates may create missing variables additively

**Decision:** `update_ds_primitives` accepts `create_missing: true` to add missing primitive variables inside an existing Primitives collection before setting their values.

**Why:**
- New generated ramps such as `color/neutral-variant/*` are additive migrations. They do not require deleting or recreating existing variables.
- Reporting missing variables is still the safe default, but forcing a full rebuild for a new primitive ramp is too heavy and risks alias churn.

**Consequence:** Existing variables are still updated in place and keep their IDs. Missing variables are created only when the caller opts in, so tools can distinguish "value update only" from "additive primitive migration."

---

## [2026-05-03] Bridge capabilities fail fast for stale plugin UIs

**Decision:** The bridge UI advertises supported command capabilities on every `/poll`, and receiver `/health` reports whether primitive updates are live. `update_ds_primitives` now returns a 409 reload-required error immediately when the connected plugin does not advertise `update-primitives`.

**Why:**
- Figma plugin UI/code changes require closing and reopening the plugin window, and the old flow discovered stale code only after a 60-second timeout.
- Fast, explicit capability checks make local live testing less painful and make `figlets-mcp doctor` useful before triggering state-changing operations.
- This keeps the receiver protocol deterministic without trying to hot-reload Figma plugin code, which the Figma sandbox does not support.

**Consequence:** A running receiver plus connected plugin is no longer treated as enough for every tool. Live workflows can check "Primitive updates: available" in doctor; otherwise the user needs one plugin reload before calling `update_ds_primitives`.

---

## [2026-05-02] In-place primitive updates via `update_ds_primitives` (category-pluggable)

**Decision:** When primitive values change but the rest of the design system has not, the agent uses `update_ds_primitives` instead of deleting and rebuilding collections. The bridge plugin walks the existing Primitives collection and overwrites `valuesByMode` on variables matching DS-derived names; variable IDs stay intact, so all aliases from Color/Typography/Spacing/Elevation collections continue to resolve. Categories supported on day one: `color`, `spacing`. The plugin's `UPDATE_PRIMITIVE_SPECS` map is the single registry — adding a new category later (e.g. `shadow` once shadow values become DS-driven) is one entry yielding `{ name, type, value }` rows from the DS config.

**Why:**
- `apply_ds_setup` skips collections that already exist, so a re-run after tweaking the config is a no-op.
- The destructive alternative (delete and rebuild) breaks every alias from semantic collections into Primitives until those are also rebuilt, losing manual edits along the way.
- Most config tweaks (algorithm switch, brand color change, scale tweak, future shadow tuning) only change *values* of *existing* variables. Updating in place is the surgical match for that intent.
- A category-pluggable design keeps the agent's surface area stable: new primitive categories don't require new tools or new prompts, only one new spec entry.

**Consequence:** Adapters route "I changed X, push it to Figma" intents to `update_ds_primitives` with a `categories` filter rather than `apply_ds_setup`. Variables present in the config but missing from Figma are reported as `unmatched` and trigger an explicit decision (fresh setup vs. drop). Future primitive sources (shadows, type tracking presets, etc.) extend `UPDATE_PRIMITIVE_SPECS`; do not introduce parallel update tools.

---

## [2026-05-02] Color ramp algorithm is OKLCh by default, HSL is opt-in fallback

**Decision:** `generateColorRamps` now dispatches on `DS.color.algorithm` (`"oklch"` default, `"hsl"` selectable). OKLCh interpolates lightness in a perceptually uniform space and holds chroma high through tints/shades; HSL is preserved unchanged for parity and for users who depend on the old output.

**Why:**
- HSL ramps crushed saturation by up to 85% on the light side and pinned hue, which produced washed-out tints regardless of brand color.
- OKLCh lightness is perceptually uniform (a yellow at L=0.7 reads as bright as a blue at L=0.7), so chroma can stay high without violating the lightness curve. This is what gives Tailwind v4 / Radix / Carbon their vivid output.
- Switching algorithms via config keeps the change opt-outable without forking the pipeline.

**Consequence:** Existing configs without `DS.color.algorithm` will regenerate ramps as OKLCh on the next `prepare_ds_config`. Stored hex values change; semantic-pair WCAG validation downstream is algorithm-agnostic and continues to work. Designers who want the old palette can set `DS.color.algorithm: "hsl"`. Future per-brand or per-step chroma overrides should extend the same dispatcher rather than reintroducing parallel ramp pipelines.

---

## [2026-05-02] Designer-facing agents guide workflows but do not own product logic

**Decision:** Public designer-facing agents should translate plain designer intent into the right MCP workflow, but they must not implement or modify design-system logic in prompts. The bridge plugin, MCP tools, and shared core own detection, binding, rendering, QA, setup, and documentation output. Agents handle guidance, readiness checks, human-readable summaries, and supported tool options only.

**Why:**
- Figlets is meant to feel like a helper in a designer's hand: the designer should be able to say "build a showcase of my design system" without knowing about receiver ports, snapshots, or tool sequencing.
- Keeping logic out of the agent preserves deterministic output across Claude, Codex, and future MCP hosts.
- The product needs one tested binding/rendering authority. Agent-side script edits or ad hoc output changes would reintroduce drift, token-heavy behavior, and inconsistent design-system decisions.
- Developer/debug workflows still matter, but they should be explicitly separate from the public designer workflow.

**Consequence:** Adapter docs should route intents such as showcase, QA, setup, inspect, and document into existing tools using designer-friendly language. Agents may choose supported parameters, summarize or omit irrelevant returned sections, and ask for designer confirmation when needed. If a designer asks for behavior the tool does not support, the agent should report it as an unsupported product request rather than patching this package or changing plugin scripts during the workflow.

## [2026-05-02] Binding policy: variables first, typography styles as the exception

**Decision:** Design-system binding is variable-first for colors, spacing, radii, borders, and other scalar layer properties. Figma color/effect styles are fallback metadata, not the primary color binding target. Typography is the explicit exception: text styles may be preferred because a text style can package a coherent type decision while its underlying size, line-height, weight, tracking, and family values may themselves be variable-backed.

**Why:**
- Color semantics live in variables. A paint style and a color variable can represent the same visual color, but only the variable encodes the cross-mode, semantic token contract that downstream component generation should depend on.
- Hex matching remains forbidden for automatic color binding. Same-value colors can have different semantic roles; binding must follow variable path semantics and purpose locks.
- Text styles are different from color styles: typography styles can serve as a deliberate bundle of multiple variable-backed decisions, making them appropriate as the first typography binding target.
- This policy must be shared across setup, showcase, documentation, QA, and future component creation. Live Figma flows should use `_createDsBindingContext()` as the bridge-side resolver; server-side indexes such as `colorVarByHex` are reporting aids, not automatic binding authorities.

**Consequence:** QA must not treat `fillStyleId` or `strokeStyleId` as automatically satisfying color binding when a semantic color variable should exist. `fix: true` may only apply high-confidence variable/style suggestions; medium-confidence color role guesses stay report-only unless a human confirms them. Future component builders should call the shared resolver for variable selection instead of introducing new local hex, nearest-color, or broad value matchers.

---

## [2026-04-30] Brand and accent are separate semantic color families

**Decision:** The color semantic scorer must not treat `accent` as a synonym for `brand`. `accent` now contributes an `ACCENT` category, while `brand` and `primary` contribute `BRAND`.

**Why:**
- `color/surface/accent` and `color/surface/brand` are different design-system intents even if both are colorful surfaces.
- Treating `accent` as `BRAND` made those paths tie for `surfaceBrand`; the tiebreaker then picked whichever color had a stronger saturation/luminance score.
- In the spacing showcase, that caused visual spacing blocks to bind to `color/surface/accent` even when `color/surface/brand` existed.

**Consequence:** Brand slots prefer brand/primary tokens. Accent can still be used as a fallback when a DS has no brand token, but it no longer beats an explicit brand token.

---

## [2026-04-30] Inset spacing needs its own visual representation

**Decision:** Spacing showcase groups named `inset`, `padding`, `pad`, or `internal-space` render with a dedicated inset visual: an outer box with an inner block offset by the token value.

**Why:**
- The old showcase code had an `inset` visual builder, but group classification never routed inset groups to it.
- Inset tokens communicate internal padding, not object size. Rendering them as a plain square made them indistinguishable from spacing scale tokens.

**Consequence:** Inset tokens now show their intended concept visually while still using the true token value in labels. The drawn padding is capped for readability so large inset values do not overwhelm the fixed preview cell.

---

## [2026-04-30] Showcase output must self-bind DS chrome before QA

**Decision:** `build_ds_showcase` runs a final binding pass over every generated showcase section. The pass binds auto-layout spacing, padding, radii, stroke weights, and text styles to matching design-system variables/styles after the visual structure has been built.

**Why:**
- QA should not report raw values for generated showcase chrome when the file already has matching DS tokens.
- Binding at the end keeps the existing output structure intact and avoids hand-maintaining one-off bindings in every row helper.
- Numeric binding is exact-value and purpose-aware (`spacing`, `radius`, `border`, `typography`); it does not bind arbitrary nearest values.
- Text nodes choose the closest DS text style by size, weight, and usage role so designers see text styles instead of raw typography.

**Consequence:** A showcase generated in a DS-rich file should have far fewer QA gaps, and ideally none for properties covered by available tokens/styles. A few arbitrary chrome values were normalized to existing token values so the generated output can be semantically bound instead of carrying private raw numbers.

**Update:** Figma clears `textStyleId` when font size/name overrides are restored after applying a text style. Showcase typography therefore uses real DS text styles instead of style-plus-raw-overrides; content and hierarchy remain stable, while exact text metrics may follow the DS style.

---

## [2026-04-29] Cache the last non-empty Figma selection in the plugin main thread

**Decision:** `packages/figma-bridge-plugin/code.js` now records selection snapshots on `selectionchange` and `currentpagechange`, and `extract-selection` may fall back to the last non-empty snapshot from the same page when the live `figma.currentPage.selection` is unexpectedly empty.

**Why:**
- The current regression is not a timeout anymore; the plugin responds quickly but sometimes sees `figma.currentPage.selection` as `[]` at command time.
- The failure is most likely transient runtime state around plugin/UI focus rather than a real lack of user selection. If we only sample once at message time, the agent loses the selection entirely.
- Caching in the main plugin thread is cheap, deterministic, and gives us better diagnostics in the Figma console without changing the MCP contract.
- Restricting fallback to the same page and a recent snapshot keeps the recovery path narrow and reduces the risk of inspecting a stale selection from unrelated work.

**Consequence:** `inspect_component` is more resilient to transient empty reads, and the Figma plugin console now exposes enough state (`live`, `lastNonEmpty`, `usedFallback`) to confirm whether the bug is focus-related or a deeper Figma regression.

---

## [2026-04-29] Guard component property reads by node type during selection serialization

**Decision:** `serializeNode()` in `packages/figma-bridge-plugin/code.js` must only read `componentPropertyDefinitions` from `COMPONENT_SET` nodes and standalone `COMPONENT` nodes. Variant children inside a component set must not be queried for property definitions.

**Why:**
- Figma throws `Can only get component property definitions of a component set or non-variant component` when that field is accessed on a variant child.
- This exception made `inspect_component` look like an empty-selection bug even when the selected component set was present and cached correctly.
- The plugin needs to serialize nested variant children safely, so the serializer must follow Figma's node-type contract instead of relying on `'componentPropertyDefinitions' in node`.

**Consequence:** Selection extraction no longer aborts while walking variant children. The debug logs now reflect the true selection state, and `inspect_component` can proceed to structural analysis.

---

## [2026-04-29] Surface current selection and session activity directly in the plugin UI

**Decision:** The bridge plugin UI should display two live, session-scoped panels under the status area: (1) current selection summary, and (2) chronological session log. The log remains in memory only and is not persisted to disk or posted anywhere.

**Why:**
- The plugin is long-lived and agent-driven, so users need immediate visibility into what the bridge thinks is selected and what command just ran.
- Console-only debugging is too hidden for normal use; basic operational state should be visible in the plugin itself.
- Keeping the log session-local avoids creating noisy artifacts or new storage rules while still making the plugin much easier to debug.

**Consequence:** `code.js` now pushes `selection-state`, session log history, and incremental log entries into the UI, and `ui.html` renders a larger dashboard-style panel with live selection and execution history.

---

## [2026-04-29] Generate component docs from the current selection by default

**Decision:** `generate_component_doc` should resolve the live Figma selection first and use the selected `COMPONENT` or `COMPONENT_SET` as the document target. When the selection is valid, the bridge should pass `componentId` and the plugin should match by exact node ID before considering name-based lookup.

**Why:**
- Users reasonably expect the currently selected component to be the source of truth.
- Name-based lookup can document the wrong component when stale args are reused or when similar names exist on the page.
- Exact ID matching is deterministic and aligns with how `inspect_component` already works.

**Consequence:** The doc flow is now selection-driven by default, while `component_name` remains as a fallback for cases where nothing is selected.

---

## [2026-04-29] Fail doc generation when agent-authored human content is missing

**Decision:** `generate_component_doc` must not fall back to placeholder copy for `description`, `usage_do`, or `usage_dont`. Both the server tool and the plugin doc builder now reject requests that do not include a real description plus at least two Do and two Don't rules.

**Why:**
- The architecture split is intentional: the plugin renders structure and token data, while the agent supplies human-readable guidance.
- Silent fallbacks hide orchestration failures and produce bad docs that look superficially complete.
- A loud error is easier to notice, easier to debug, and preserves the quality bar for spec sheets.

**Consequence:** Agents must inspect first and provide tailored guidance before calling `generate_component_doc`. Missing human-authored sections now block generation instead of producing generic filler.

---

## [2026-04-29] Track the active plugin session end-to-end through the bridge

**Decision:** The Figlets Bridge UI exposes a visible per-session ID, and the bridge protocol now carries that ID through `/poll` and `/sync*` requests. The receiver tracks the current polling session and includes `activeSessionId` in not-connected responses.

**Why:**
- During debugging, the plugin UI could appear active while the receiver still reported `plugin is not connected`, making it hard to know whether we were looking at the real bridge instance or a stale/parallel UI.
- A visible session token lets the user and agent refer to the same concrete runtime instead of inferring from appearance or timestamps.
- Receiver-level awareness closes the loop: we can now compare “what the plugin UI says” with “what the server thinks is connected.”

**Consequence:** Bridge debugging is now session-aware instead of guess-based. A reconnect can be verified concretely, as happened when the receiver reported the same active session ID the plugin UI showed: `figlets-mok7r7lf-gzrll`.

---

## [2026-04-29] Omit empty spec-sheet sections; treat anatomy as meaningful internal structure, not merely root existence

**Decision:** `generate_component_doc` skips any section that has no meaningful data, in both the rendered Figma sheet and the returned markdown. For anatomy specifically, the section renders only when the default variant has meaningful internal non-instance parts; a bare primitive/reference component does not get a placeholder anatomy block.

**Why:**
- Empty sections create noise and suggest missing content rather than useful structure.
- The earlier anatomy logic defined anatomy as descendant structure, not “the root component exists,” but still rendered an empty wrapper and legend when no descendants qualified. That produced a visually broken result for primitive examples like `Spacing Visual`.
- A one-row anatomy that simply repeats the root component name is technically true but usually low-value for token visuals and primitive references.

**Consequence:** Primitive/reference components can legitimately omit anatomy, while composed UI components still render full anatomy when they have meaningful named parts. The same omission rule now applies across other data-driven sections as well.

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

## [2026-04-30] Shared DS binding resolver before QA auto-fix

**Decision:** Live Figma binding should go through one shared bridge-side resolver, `_createDsBindingContext()`, instead of each tool maintaining local name/hex matchers. The resolver detects collections, variables, text styles, and effect styles; resolves aliases; classifies primitive/alias collections; exposes semantic color roles; and provides float/text-style pickers for spacing, radius, border, typography, and doc chrome.

**Why:**
- QA auto-fix must bind as many properties as possible when a DS exists, but it must not bind wrong-purpose variables just because their raw value matches.
- Hex matching is useful for reporting raw values, but it is not safe as an automatic binding strategy. Equal colors can represent different semantic purposes, such as icon, text, surface, or border roles.
- The current showcase semantic picker is the most accurate binding logic in the project. It trusts variable path semantics first, uses purpose locks (`requiredCats`) for role-specific slots, and only falls back to functional scoring for broad structural roles.
- The original figlets QA scripts have a good audit/fix structure, but their matching step still depends on agent-side nearest-token prose and hex/value indexes. They should be ported on top of the shared resolver.

**Consequence:** `generate_component_doc` now uses `_createDsBindingContext()` for spec-sheet chrome binding without changing its sections, markdown contract, or returned payload. Next QA port should expose this same resolver through audit/fix commands, with automatic fixes only when the resolver has high-confidence semantic/property matches.

---

## [2026-05-03] Showcase color sections use designer-facing order, not raw insertion order

**Decision:** Token showcase color rows are sorted deterministically for scanning. Primitive ramps put likely brand palettes first, then neutral and neutral-variant, then status/utility ramps such as red, green, yellow, blue/info. Semantic color groups put surface/background rows first, then text, outline, icon, and push status/info/warning/error/disabled groups lower.

**Why:**
- Designers use the showcase as a visual QA surface, not as an implementation dump. Brand and surface tokens are the most common first-pass inspection targets.
- Raw Figma variable insertion order can bury the important ramps under utility colors, especially after additive primitive updates create new ramps in an existing collection.
- Sorting is presentation-only. Variable names, IDs, aliases, values, and binding behavior are unchanged.

**Consequence:** Showcase rebuilds are visually more stable and easier to scan. If a future DS wants a different ordering policy, extend the ranking helpers in the showcase renderer rather than changing variable generation or semantic binding.

---

## [2026-05-08] Showcase contrast labels follow the configured contrast algorithm

**Decision:** Primitive and semantic color swatch labels in the Figma showcase branch on `DS.color.contrastAlgorithm`. APCA mode shows Lc labels (`✓ Lc NN` / `✗ Lc NN`). WCAG mode keeps the same visual treatment but shows ratio-status labels (`✓ AAA`, `✓ AA`, `~ Large`, `✓ 3:1`, `✗ Fail`).

**Why:**
- The split primitive swatches and semantic pair swatches are useful in both APCA and WCAG workflows, but APCA `Lc` labels are misleading when the configured validator is WCAG.
- Text-like rows need the body-text threshold (`Lc 75` or `4.5:1`), while icon-like rows need the graphical threshold (`Lc 60` or `3:1`).
- The MCP `build_ds_showcase` handoff must forward `DS.color.contrastAlgorithm`; otherwise a WCAG config reaches the bridge plugin without the mode signal and silently renders APCA labels.

**Consequence:** Showcase labels now match the same contrast algorithm used by config validation. WCAG live builds can be verified with a one-off request that passes `contrastAlgorithm: "wcag"` without mutating the active saved config.

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

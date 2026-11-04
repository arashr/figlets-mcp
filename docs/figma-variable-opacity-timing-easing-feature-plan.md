# Figma Variable Foundations Feature Plan

## Status

Planning document created on 2026-10-12.

Phases 0 and 1 implementation and disposable-file smoke verification are complete. Phase 2 variable-value batches now preflight all entries, roll back attempted writes on failure, and report exact outcomes. Automated injected-failure tests and live success/stale-race tests pass. Native Figma setter-failure rollback has not been forced live. Structural/lifecycle operations remain separate and are not covered by this rollback contract. Phase 3 optional config and staged setup are implemented and verified; Phase 4 export/documentation implementation and specialized review are complete; fresh live plugin verification remains pending. This document is the durable source for scope, priorities, approval boundaries, phased delivery, verification, and later execution notes.

Target release: next Figlets minor release after 1.3.0.

Saved checkpoint: `0175064` contains the migration and missing-motion-collection fixes verified by 128 test files and live smoke. The Phase 2 follow-up passes 129 test files on 2026-11-04. `git diff --check` passes. The earlier DESIGN.md work and the initial plan are committed separately. Later implementation must preserve this checkpoint and must record a fresh baseline before editing overlapping files.

### Checkpoint summary

- Implemented and covered by automated tests: all six variable types, TIMING conversion, EASING validation, composed colors, nested alias traversal, bridge capability reporting, generated opacity primitives, composed scrims, and approval-gated existing-file opacity migration.
- Live-verified on 2026-11-04: TIMING, EASING, and composed-color create/update/readback, plus stale TIMING approval rejection.
- Live-verified opacity migration: ten scrims converted with IDs and RGBA preserved; partial approval changed only the selected scrim and its prerequisite; seven shared opacity variables created; subsequent current-code inspection found zero migrations or blockers.
- Fixed live-discovered defects: missing collection identity in sync, blocked migration summary omissions, and repeated migrations caused by Figma normalizing raw composed color channels with `a: 1`.
- Implemented for variable create/update batches: full live preflight, rollback journal, exact per-operation results, unchanged-value detection, and explicit rollback-failure reporting. Mixed motion/composed-value and structural edits must be planned separately.
- Implemented optional motion configuration: explicit editable preview, fingerprinted local save, reprepare, configured foundation/mode setup, and atomic motion values. Full suite now passes 130 test files.
- Next: fresh live export and component documentation smoke verification, then release readiness. Motion API authoring remains deferred.
- Phase 2 and Phase 3 specialized reviews are complete and their must-fix findings are resolved. Additional native setter-failure rollback smoke would strengthen the automated failure evidence.

## Product Goal

Update Figlets for Figma's expanded variable model without turning Figlets into a general animation authoring tool.

The release should add:

- composed color variables with independently authored opacity;
- shared opacity variables for color opacity and layer opacity;
- first-class `TIMING` variables;
- first-class `EASING` variables;
- an optional, editable motion foundation profile with a reduced-motion mode;
- lossless inspection, planning, application, export, and documentation for the new value types.

The first usable release slice is opacity. Timing and easing support follows after the shared value model is stable.

## Research Baseline

This plan is based on Figma and W3C documentation checked on 2026-10-12. Recheck the sources before release because these capabilities are recent and the Motion API is still beta.

### Figma variables

Figma supports six resolved variable types:

- `BOOLEAN`
- `COLOR`
- `EASING`
- `FLOAT`
- `STRING`
- `TIMING`

Timing is displayed in milliseconds in the Figma interface. The Plugin API stores timing values as seconds.

Sources:

- [Overview of variables, collections, and modes](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes)
- [Plugin API Update 133](https://developers.figma.com/docs/plugins/updates/2026/08/05/version-1-update-133/)
- [VariableResolvedDataType](https://developers.figma.com/docs/plugins/api/VariableResolvedDataType/)
- [VariableValue](https://developers.figma.com/docs/plugins/api/VariableValue/)

### Composed colors and opacity scopes

Figma can store a color variable as a composed value with separate color and opacity channels. Either channel, or both channels, may be a variable alias. The opacity value uses the percentage range from 0 to 100.

Figma distinguishes two FLOAT scopes:

- `OPACITY` exposes a number variable for layer opacity.
- `COLOR_OPACITY` exposes a number variable for a color's opacity channel.

Sources:

- [Plugin API updates](https://developers.figma.com/docs/plugins/updates/)
- [Working with Variables](https://developers.figma.com/docs/plugins/working-with-variables/)
- [VariableScope](https://developers.figma.com/docs/plugins/api/VariableScope/)
- [REST Variables API](https://developers.figma.com/docs/rest-api/variables-endpoints/)

### Motion boundary

Figma's Plugin API can read and write Motion timelines, animation styles, animations, and keyframes. It can also create reusable custom animation styles. These APIs are beta and have a broader mutation boundary than variable authoring.

This release will support timing and easing variables. It will not author Motion timelines, keyframes, or animation styles.

Sources:

- [Motion API](https://developers.figma.com/docs/plugins/api/Motion/)
- [CustomAnimationStyle](https://developers.figma.com/docs/plugins/api/CustomAnimationStyle/)

### Accessibility baseline

Motion variables can support an accessible implementation, but they cannot prove runtime conformance.

The default profile will provide a reduced-motion mode. Product implementations still need to respect user preferences and meet the rules that apply to their actual behavior.

Sources:

- [WCAG 2.2 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)
- [WCAG 2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide)
- [WCAG 2.2 Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold)

## Current Figlets Baseline

Figlets currently:

- syncs variable collections and variables through bridge and REST snapshot paths;
- treats `COLOR`, `FLOAT`, `STRING`, and `BOOLEAN` as the supported variable types in generic operations;
- stores generated scrims as separate COLOR variables with baked RGBA alpha;
- generates ten scrim variables for black and white opacity variants;
- uses those scrims as stable alias targets for overlay, state, and shadow semantic colors;
- supports exact variable, collection, mode, metadata, binding, and lifecycle changes through `plan_ds_figma_operations` and `apply_ds_figma_operations`;
- supports config-backed primitive updates through `inspect_ds_token_gaps` and `update_ds_primitives`;
- documents basic prototype reactions and static transition easing and duration;
- does not inspect or author Figma Motion timelines;
- exports richer Figlets data through lossless sidecar formats while keeping standard DESIGN.md output compatible.

The main gaps are:

- generic operations reject `TIMING` and `EASING`;
- value normalization does not understand `MotionEasing` or composed colors;
- nested aliases inside composed colors are not traversed by lifecycle checks;
- scrim generation bakes alpha directly into RGBA values;
- inventory and analysis do not report all six variable types;
- REST snapshots cannot prove the absence of timing or easing variables;
- current export serializers do not have explicit timing, easing, opacity, or composed-color contracts.

## Locked Product Decisions

1. This release covers variables only.
2. Figma Motion timelines, keyframes, and animation styles are deferred.
3. Opacity is the first shippable feature slice.
4. New setup uses composed scrims automatically because this replaces existing scrim generation behavior.
5. Existing files migrate only after inspection, exact preview, and explicit approval.
6. Existing scrim variable names and IDs must remain stable.
7. Shared opacity primitives use both `OPACITY` and `COLOR_OPACITY` scopes.
8. Scrims reuse an exact neutral ramp endpoint for pure black or pure white when one exists.
9. Scrims use a raw black or white color channel when no exact neutral endpoint exists.
10. Timing and easing foundations are opt-in and are offered only after an explicit designer request.
11. Missing timing or easing foundations are not health defects.
12. The default motion suggestion is a lean, editable profile.
13. The default profile uses cubic-bezier curves. Springs remain optional.
14. The default profile contains `Default` and `Reduced Motion` modes.
15. Non-essential durations resolve to zero in the reduced-motion mode.
16. Accessibility guidance is required with the default profile.
17. DESIGN.md standard output remains compatible with the supported Google schema.
18. Exact new variable data belongs in the Figlets sidecar and `figlets-design.json`.

## Non-Negotiable Architecture Rules

1. Extend existing planner and apply surfaces. Do not add a parallel generic mutation tool.
2. Keep specialized, config-backed opacity migration on the primitive repair boundary.
3. Keep generic exact TIMING, EASING, and composed-color operations on `plan_ds_figma_operations` and `apply_ds_figma_operations`.
4. Inspect before every existing-file migration.
5. Return an exact apply payload before asking for approval.
6. Revalidate identities and current values immediately before mutation.
7. Preserve variable IDs whenever an existing variable is updated.
8. Do not infer missing motion policy from page usage.
9. Do not silently coerce an unsupported value into a legacy type.
10. Do not treat incomplete REST coverage as evidence that timing or easing variables are absent.
11. Do not mutate Figma during sync, analysis, config refresh, or health inspection.
12. Keep local config writes and Figma writes as separate approval boundaries.

## Delivery Plan

### Phase 0: Shared value model

Priority: P0

Status: automated implementation and disposable-file smoke verification complete

Goal: make every read-only and exact-operation path understand the new value shapes before enabling specialized writes.

Work:

- [x] Add `TIMING` and `EASING` to the canonical supported variable type set.
- [x] Add shared validation and normalization helpers for every variable type.
- [x] Preserve Figma-native timing seconds in snapshots and bridge payloads.
- [x] Accept timing operation input in milliseconds.
- [x] Convert milliseconds to seconds only in the normalized approved operation sent to the bridge.
- [x] Display timing values in milliseconds in summaries and previews.
- [x] Validate finite, non-negative timing values.
- [x] Validate all current `MotionEasing` discriminants.
- [x] Validate custom cubic-bezier control points.
- [x] Validate normalized custom spring bounce from 0 to 1.
- [x] Preserve named spring and named easing variants without flattening them.
- [x] Add composed-color normalization with separate color and opacity channels.
- [x] Require at least one composed-color channel to be an alias.
- [x] Validate raw opacity values from 0 to 100.
- [x] Validate COLOR aliases for the color channel.
- [x] Validate FLOAT aliases for the opacity channel.
- [x] Make stable signatures recursive so nested object key order does not affect stale checks.
- [x] Traverse nested aliases in composed colors during delete, duplicate, move, and retarget planning.
- [x] Preserve the exact composed value during variable duplication and movement.
- [x] Add explicit source-capability metadata to snapshots.
- [x] Mark REST timing and easing coverage as unknown.
- [x] Add bridge capability reporting for supported variable types and composed colors.
- [x] Block writes with actionable update or reload guidance when the bridge is outdated.

Exit criteria:

- All six variable types round-trip through bridge snapshots.
- Composed colors preserve raw channels and alias channels.
- Generic planning can validate the new values without writing Figma.
- Existing four-type behavior remains unchanged.
- REST-based analysis does not claim timing or easing absence.

### Phase 1: Composed scrims and shared opacity primitives

Priority: P0

Status: automated implementation and disposable-file smoke verification complete

Goal: ship the first designer-visible feature without renaming or recreating existing scrim variables.

#### Generated opacity inventory

Create these FLOAT variables in the configured Primitives collection:

- `opacity/4` with value `4`
- `opacity/8` with value `8`
- `opacity/12` with value `12`
- `opacity/16` with value `16`
- `opacity/20` with value `20`
- `opacity/40` with value `40`
- `opacity/60` with value `60`

Every generated opacity variable has both scopes:

- `OPACITY`
- `COLOR_OPACITY`

#### Scrim composition

Keep the existing scrim names:

- `color/scrim/black/4`
- `color/scrim/black/8`
- `color/scrim/black/12`
- `color/scrim/black/20`
- `color/scrim/black/40`
- `color/scrim/black/60`
- `color/scrim/white/8`
- `color/scrim/white/12`
- `color/scrim/white/16`
- `color/scrim/white/20`

For each scrim:

1. Resolve the configured neutral ramp.
2. Search that ramp for an exact pure black or pure white value as required.
3. If multiple steps match, choose the outer endpoint that matches the requested color.
4. Use that COLOR variable as the composed color alias.
5. If no exact value exists, use raw `{ r, g, b }` for black or white.
6. Bind the opacity channel to the matching `opacity/*` FLOAT variable.
7. Confirm that the resolved RGBA result matches the previous baked-alpha value.

Do not treat a nearly black or nearly white ramp endpoint as an exact match.

#### New setup behavior

- [x] Update primitive generation to return opacity primitives and composed scrim plans.
- [x] Update setup preview to list exact opacity variables and composed scrims.
- [x] Create opacity variables before setting composed scrim values.
- [x] Apply both opacity scopes.
- [x] Keep semantic overlay, state, and shadow aliases unchanged.
- [x] Preserve existing setup behavior when rerun against a partially populated Primitives collection.
- [x] Make setup idempotent.

#### Existing-file migration

Extend the existing token-gap and primitive-repair workflow with the category `primitive-opacity`.

The read-only planner must return:

- exact missing opacity primitives;
- exact current and proposed scope values;
- each existing scrim variable ID and name;
- each expected current mode signature;
- the selected neutral color alias or raw color fallback;
- the target opacity variable name and ID when it already exists;
- the resolved RGBA value before and after migration;
- blockers for wrong variable types, missing modes, ambiguous collections, or stale identities;
- separate preview and apply inputs.

Apply behavior:

1. Revalidate the complete approved payload.
2. Create only approved missing opacity variables.
3. Update only approved existing scrims.
4. Preserve scrim IDs, names, descriptions, scopes, code syntax, publishing state, and unmodified modes.
5. Preserve downstream semantic aliases.
6. Stop without partial mutation if an approved scrim prerequisite is invalid.
7. Return created, updated, unchanged, blocked, and stale entries.
8. Require sync and reinspection after apply.

Partial approval is allowed. A selected scrim may create only the opacity prerequisite it needs. Unselected scrims and unused opacity variables must remain untouched.

Exit criteria:

- New setup produces composed scrims.
- Existing scrim IDs survive migration.
- Existing semantic aliases remain valid.
- Every resolved scrim RGBA value is unchanged.
- Repeated migration is a no-op.
- Stale approvals fail closed.

### Phase 2: Exact timing, easing, and composed-color operations

Priority: P1

Status: variable-value batch implementation complete; automated failure tests and live success/stale-race tests pass; native runtime-failure rollback remains unforced live

Goal: extend the existing exact-operation surface for all six variable types.

#### Public operation input

Continue using `create_variable` and `update_variable` operations with their existing `values` or `modeValues` maps.

TIMING mode values accept:

```json
{
  "milliseconds": 200
}
```

EASING mode values accept a validated Figma `MotionEasing` object.

Composed COLOR mode values accept:

```json
{
  "color": { "alias": "color/neutral/0" },
  "opacity": { "alias": "opacity/40" }
}
```

They also accept raw RGB for `color` or a raw percentage for `opacity`, provided that at least one channel is an alias.

#### Planner behavior

- [x] Resolve every alias by exact variable name.
- [x] Require compatible alias types.
- [x] Normalize TIMING to seconds in `repairPlan.applyInput`.
- [x] Keep designer presentation in milliseconds.
- [x] Preserve `MotionEasing` without lossy conversion.
- [x] Include recursive stale signatures for updates.
- [x] Mark destructive lifecycle operations exactly as the current planner does.
- [x] Include nested composed-color references in affected-variable summaries.

#### Apply behavior

- [x] Revalidate every normalized value and stale signature.
- [x] Create `TIMING` and `EASING` variables through the existing bridge operation route.
- [x] Set composed color values with resolved variable aliases.
- [x] Reject an older bridge that lacks the required capability.
- [x] Preflight each approved create/update variable batch and roll back attempted changes on failure. Report rollback failure explicitly; structural/lifecycle edits are separate batches.
- [x] Return exact created, updated, unchanged, blocked, failed, and rolled-back variable results.

#### Spring boundary

Support:

- Figma named spring easings;
- `CUSTOM_SPRING` with normalized `bounce` from 0 to 1.

Do not accept physical mass, stiffness, or damping in this release. Do not call beta Motion conversion helpers from the variable workflow.

Exit criteria:

- Designers can plan and apply exact TIMING and EASING variables.
- Designers can plan and apply arbitrary valid composed colors.
- Existing lifecycle helpers safely handle nested aliases.
- No new public mutation tool exists.

### Phase 3: Optional motion foundation profile

Priority: P1

Status: optional config profile and staged setup implemented; automated tests and existing-token live flow passed. Export/documentation remains Phase 4.

Goal: provide useful timing and easing foundations only when the designer asks for them.

#### Optional config contract

Add optional fields:

- `DS.collections.motion`, defaulting to `6. Motion` when motion foundations are enabled.
- `DS.motion.modes`, containing `Default` and `Reduced Motion`.
- `DS.motion.durations`, keyed by token name and then by mode name.
- `DS.motion.easings`, keyed by token name and then by mode name.

Use named mode maps. Do not use positional arrays.

A config without `DS.motion` must behave exactly as it does before this feature.

#### Lean editable profile

Offer the following proposal only after an explicit request for motion foundations.

Durations:

- `motion/duration/instant`: Default `0 ms`, Reduced Motion `0 ms`
- `motion/duration/fast`: Default `100 ms`, Reduced Motion `0 ms`
- `motion/duration/standard`: Default `200 ms`, Reduced Motion `0 ms`
- `motion/duration/slow`: Default `300 ms`, Reduced Motion `0 ms`

Easings:

- `motion/easing/linear`: Linear in both modes
- `motion/easing/standard`: cubic-bezier `(0.2, 0, 0, 1)` in Default and Linear in Reduced Motion
- `motion/easing/enter`: cubic-bezier `(0, 0, 0.2, 1)` in Default and Linear in Reduced Motion
- `motion/easing/exit`: cubic-bezier `(0.4, 0, 1, 1)` in Default and Linear in Reduced Motion

#### Intake and approval behavior

- [x] Do not add a motion question to ordinary new-system intake.
- [x] Trigger the profile only from an explicit timing, easing, transition-token, or motion-foundation request.
- [x] Show exact collection, modes, token names, values, and curves.
- [x] Let the designer edit the proposal.
- [x] Ask for approval before writing local config.
- [x] Reprepare the config after the approved config write.
- [x] Ask separately before writing Figma.
- [x] Do not report missing motion config as a setup or health defect.
- [x] State that reduced-motion variables do not prove runtime accessibility.
- [x] Offer springs only as an optional addition.

If the Figma plan cannot create a second mode, stop and report the blocker. Do not silently produce a single-mode profile. A single-mode alternative requires an explicit designer request and an accessibility warning.

Exit criteria:

- Ordinary setup remains unchanged.
- Explicit requests receive a concrete editable proposal.
- Config and Figma writes have separate approvals.
- Default and reduced-motion values match the approved profile exactly.

### Phase 4: Analysis, export, and documentation

Priority: P1

Status: implemented and specialized review approved; 132 test files pass. Fresh live plugin verification remains pending.

Goal: make the new variable data visible and portable without weakening existing standards contracts.

#### Inventory and analysis

- [x] Count all six resolved variable types.
- [x] Report snapshot source capability and coverage.
- [x] Preserve composed color channel provenance.
- [x] Resolve composed colors for presentation without replacing their stored source structure.
- [x] Treat the shared `OPACITY` and `COLOR_OPACITY` scopes as intentional for generated opacity primitives.
- [x] Do not report missing timing or easing collections as defects.
- [x] Show timing in milliseconds in designer-facing output.
- [x] Show readable easing names and exact custom parameters.

#### CSS and Make guidance

- [x] Serialize opacity primitives as percentages.
- [x] Resolve composed colors to portable CSS color values.
- [x] Preserve exact channel aliases in provenance and sidecar data.
- [x] Serialize timing as milliseconds.
- [x] Serialize linear and cubic-bezier easing when a valid CSS representation exists.
- [x] Do not invent CSS for a spring easing.
- [x] Keep springs in lossless data and emit a clear portability warning.

Portable resolved CSS is the default. The CSS output does not need to preserve a live two-variable channel relationship when doing so would require unstable or poorly supported syntax. The lossless sidecar remains the exact source for round-trip reconstruction.

#### DESIGN.md and Figlets artifacts

- [x] Keep standard front matter compatible with the supported Google DESIGN.md schema.
- [x] Do not add unsupported standard token types.
- [x] Retain legacy `figlets-extended` intake without generating new inline blocks, per the settled sidecar contract.
- [x] Store the same exact model in `figlets-design.json`.
- [x] Preserve round-trip behavior.
- [x] Add prose summaries only when they are factual and useful.

#### Component documentation

- [x] Display composed opacity bindings when they are observed.
- [x] Display timing and easing variable references when they are observed.
- [x] Keep current static prototype reaction and transition reporting unchanged.
- [x] Do not inspect Motion timelines in this release.

Exit criteria:

- Inventory and reports represent all new types honestly.
- Standard DESIGN.md output still passes its compatibility checks.
- Figlets sidecar artifacts round-trip the new values losslessly.
- CSS output is valid and explicit about spring limitations.

## Explicit Non-Goals

Do not implement these items in this feature:

- Figma Motion timeline inspection or editing.
- Manual keyframe creation, replacement, or deletion.
- Figma-provided animation style application.
- Custom animation style creation, editing, publishing, or application.
- Motion audio support.
- Lottie support.
- GIF, MP4, or WebM export.
- Automatic prototype transition rewriting.
- Runtime accessibility certification.
- A new arbitrary node mutation API.
- Automatic timing or easing foundations during ordinary setup.
- Automatic scrim migration during sync or inspection.
- Unrelated semantic color naming changes.
- Showcase redesign.
- Changes to unrelated DESIGN.md work already in the checkout.
- A Google DESIGN.md schema extension for unsupported token types.

## Public Interface Changes

### Existing tools extended

`plan_ds_figma_operations`:

- accepts `TIMING` and `EASING` variable types;
- accepts timing input in milliseconds;
- accepts composed COLOR input;
- validates nested aliases and current Figma value shapes;
- returns exact normalized apply operations.

`apply_ds_figma_operations`:

- applies the new normalized values through the current bridge route;
- preserves stale-signature protection;
- rejects missing bridge capabilities.

`inspect_ds_token_gaps`:

- reports approval-ready `primitive-opacity` migration work for existing generated scrims;
- keeps opacity migration separate from semantic token repairs.

`update_ds_primitives`:

- accepts the `primitive-opacity` category;
- creates approved opacity primitives;
- updates approved existing scrims in place;
- preserves IDs and downstream aliases.

`prepare_ds_config` and `apply_ds_setup`:

- include composed scrims for all new setup work;
- include the optional Motion collection only when `DS.motion` exists.

### Snapshot contract

Add capability metadata that distinguishes:

- values observed through the Plugin API;
- values observed through REST;
- variable types supported by the active bridge;
- variable types that the current source cannot report.

Never represent source limitations as a confirmed empty inventory.

## Test Plan

### Core value tests

- [x] All six variable types normalize correctly.
- [x] Invalid timing values are rejected.
- [x] Timing milliseconds convert to exact seconds.
- [x] Every supported easing discriminant round-trips.
- [x] Invalid cubic-bezier and spring data is rejected.
- [x] Composed colors require at least one alias.
- [x] Color and opacity channel alias types are enforced.
- [x] Opacity clamps are not performed silently.
- [x] Recursive signatures are deterministic.
- [x] Nested aliases are found by lifecycle analysis.

### Bridge and generic-operation tests

- [x] Create and update TIMING variables in automated bridge tests.
- [x] Create and update EASING variables in automated bridge tests.
- [x] Create and update composed COLOR variables in automated bridge tests.
- [x] Duplicate and move every new value shape.
- [x] Retarget nested composed-color aliases.
- [x] Reject deletion when nested references remain.
- [x] Reject stale nested values.
- [x] Reject writes through an outdated bridge capability set.
- [x] Block a complete value batch before mutation if a later operation or mode is stale.
- [x] Inject write failure and verify earlier updates restore their original values and partial creates are removed.
- [x] Report rollback failures and lost responses without claiming no changes remain.
- [x] Preserve exact result fields through the MCP apply handler.

### Opacity setup and migration tests

- [x] Generate all seven opacity primitives.
- [x] Apply both opacity scopes.
- [x] Reuse exact black and white neutral endpoints.
- [x] Prefer the configured neutral ramp when exact duplicates exist.
- [x] Fall back to raw black or white when no exact endpoint exists.
- [x] Preserve every existing scrim name and ID in automated migration tests.
- [x] Preserve descriptions, code syntax, publishing state, and downstream aliases.
- [x] Prove resolved RGBA parity before and after migration.
- [x] Prove migration idempotence.
- [x] Reject stale migration payloads.
- [x] Apply only approved partial migration entries and required prerequisites.
- [x] Leave unselected entries untouched.

### Motion profile tests

- [x] Configs without motion remain unchanged.
- [x] Ordinary intake does not ask about motion.
- [x] Explicit motion requests produce the lean proposal.
- [x] Default and Reduced Motion modes use exact named maps.
- [x] Duration and easing values match the locked profile.
- [x] Missing second-mode capability blocks the default profile.
- [x] Config and Figma approvals remain separate.

### Analysis and export tests

- [ ] Inventory reports all six types.
- [ ] Plugin and REST capability differences are explicit.
- [ ] Opacity CSS values use percentages.
- [ ] Composed colors resolve to valid portable CSS.
- [ ] Timing exports in milliseconds.
- [ ] Cubic-bezier values export correctly.
- [ ] Spring values remain lossless and receive a portability warning.
- [ ] Standard DESIGN.md output remains compatible.
- [ ] `figlets-extended` round-trips every new value.
- [ ] `figlets-design.json` preserves every new value.
- [ ] Component documentation shows observed bindings without adding Motion timeline claims.

### Release verification

- [x] Run focused tests after each implemented phase.
- [x] Run the full repository test suite for the current checkpoint.
- [x] Run the repository whitespace check for the current checkpoint.
- [x] Perform a disposable-file opacity migration smoke test.
- [x] Perform a disposable-file timing and easing variable smoke test.
- [x] Record bridge build identity and Figma API behavior used by the 2026-11-04 live smoke and migration rerun.

## Known Risks

### Recent Figma API changes

The variable and Motion APIs changed recently. Plugin typings, desktop behavior, and REST coverage may drift. Recheck official docs and current runtime behavior before enabling writes.

### REST coverage mismatch

REST can carry composed color values but currently documents only the four legacy resolved variable types. A REST snapshot cannot establish that TIMING or EASING variables are absent.

### Unit mismatch

Figma presents timing in milliseconds and stores Plugin API timing values in seconds. Conversion must happen once at a defined boundary. Mixed units in stored operations would create severe stale-check and preview errors.

### Shared opacity semantics

The same percentage token can be used for layer opacity and color opacity. This is intentional. Documentation must make the two uses explicit so designers understand that changing one primitive affects both contexts.

### Neutral endpoint availability

Generated ramps may not contain exact black or white. Raw channel fallback is required and must not be reported as a defect.

### Reduced-motion limits

A Figma variable mode does not make a product respect an operating-system motion preference. Generated guidance must not claim runtime conformance.

### Mode limits

Figma plan limits may prevent a second Motion mode. The default profile must fail closed rather than dropping the accessibility mode.

### Export portability

CSS has no exact portable equivalent for every Figma spring easing. The export must preserve exact data in the sidecar and state the limitation.

## Deferred Motion Work

Consider a separate feature plan after the variable release and after rechecking the beta API.

Possible later scope:

- read-only Motion inventory;
- animation style inventory;
- timeline and keyframe documentation;
- exact animation style planning;
- custom animation style creation;
- reduced-motion audits for applied animations;
- video export workflows.

The later plan must define a new approval boundary because these operations mutate nodes, timelines, and styles rather than design-system variables alone.

## Implementation Sequence

Implement in this order:

1. Shared value codecs and snapshot capability metadata.
2. Recursive signatures and nested alias traversal.
3. New setup generation for opacity primitives and composed scrims.
4. Read-only existing-file opacity migration planning.
5. Approved `primitive-opacity` apply support.
6. Generic TIMING, EASING, and composed-color operations.
7. Optional config-backed motion profile.
8. Inventory, audit, CSS, DESIGN.md, sidecar, and component documentation updates.
9. Disposable-file verification and release documentation.

Do not begin a later phase while its required lower-level value model is still incomplete.

## Continuation Contract

Every implementation session must update this file.

At the start of a session:

1. Read this plan, `memory/PROJECT_MEMORY.md`, and `docs/decisions.md`.
2. Inspect the current working tree.
3. Confirm which phase and checklist items are in scope.
4. Recheck relevant Figma documentation if the API contract may have changed.
5. Record the test baseline for the current checkout.

During a session:

1. Keep changes inside the selected phase.
2. Preserve unrelated work.
3. Use existing planner and apply surfaces.
4. Add tests with each implementation slice.
5. Record blockers and material scope changes in the execution log.

At the end of a session:

1. Update checklist status only for verified work.
2. Record exact verification and failures.
3. Record remaining risks and the next safe step.
4. Do not mark a phase complete while required live verification remains pending.

## Execution Log

### 2026-10-12: Plan created

Status: planning complete

Scope:

- Recorded the current Figlets capability baseline.
- Compared it with current Figma variable and Motion APIs.
- Locked the variables-only release boundary.
- Prioritized composed opacity before timing and easing foundations.
- Defined the optional accessible motion profile.
- Defined implementation phases, public interface changes, tests, risks, and deferred work.

Verification:

- Repository exploration completed.
- Current full test baseline: 123 test files passed before this plan file was added.
- Feature code was not changed as part of plan creation.

Next step:

- Start Phase 0 with the shared variable value model and focused unit tests.

### 2026-10-12: Phase 0 automated implementation

Status: automated implementation complete, live verification pending

Scope:

- Added first-class planner and bridge handling for all six variable types.
- Added millisecond input and preview handling with second-based native TIMING payloads.
- Added validation for named easings, cubic-bezier curves, named springs, and normalized custom springs.
- Added composed COLOR values with independently validated COLOR and FLOAT alias channels.
- Added recursive signatures and nested alias traversal.
- Extended destructive move, delete, and retarget safeguards to reject changed alias sets before mutation.
- Added bridge and REST capability metadata so incomplete snapshots cannot silently imply support or absence.
- Extended design-system inventory counts to include TIMING, EASING, and UNKNOWN values.

Files and areas:

- `packages/figlets-mcp-server/src/tools/figma-operations.js`
- `packages/figma-bridge-plugin/code.js`
- `packages/figlets-mcp-server/src/exporters/figma-rest-export.js`
- `packages/figlets-core/src/design-system-inventory.js`
- focused server, bridge, inventory, and REST tests

Verification:

- JavaScript syntax checks passed for the operation planner and bridge plugin.
- Focused modern-value, lifecycle, inventory, and REST tests passed.
- Full `npm test` passed: 124 of 124 test files.
- `git diff --check` passed before the plan update and must be rerun at handoff.

Remaining risk:

- A disposable live Figma file has not yet verified bridge snapshots and writes for TIMING, EASING, and composed COLOR values.
- Phase 0 remains open for live verification. Phase 1 implementation can use the verified automated value model, but release readiness still requires the live checks.

Next step:

- Begin Phase 1 with config-backed opacity primitives and composed scrim generation, while keeping existing-file migration approval-gated.

### 2026-10-12: Phase 1 and Phase 2 core checkpoint

Status: automated checkpoint complete, live verification pending

Scope:

- Added seven shared FLOAT opacity primitives with `OPACITY` and `COLOR_OPACITY` scopes.
- Replaced generated baked-alpha scrims with composed colors while preserving existing names and semantic alias targets.
- Added exact neutral endpoint reuse with raw black or white fallback.
- Added approval-gated `primitive-opacity` inspection and apply payloads for existing-file migration.
- Added stale, identity, prerequisite, and compatibility validation before migration mutation.
- Extended exact Figma operations for TIMING, EASING, and composed COLOR values.
- Added automated coverage for setup idempotence, resolved RGBA parity, partial migration, nested aliases, and outdated bridge capabilities.
- Updated inventory and snapshot capability reporting for all six variable types.

Verification:

- Focused Phase 1 and Phase 2 tests passed.
- Full `npm test` passed: 126 of 126 test files.
- `git diff --check` passed.
- Live disposable-file verification was not run.

Deferred at this checkpoint:

- Phase 2 atomic batch failure behavior and exact created, updated, unchanged, blocked, and failed result reporting.
- Phase 3 optional motion foundation profile.
- Phase 4 CSS, DESIGN.md, sidecar, Make guidance, and component documentation work beyond the inventory and capability foundation already implemented.
- Disposable-file opacity migration and TIMING or EASING write verification.

Next safe step:

- Start by reading this checkpoint and rerunning the full suite.
- Perform the two disposable-file live tests against the recorded bridge build.
- Finish the Phase 2 batch result contract.
- Decide whether Phases 3 and 4 remain in the next minor release or move to a later release before implementing either phase.

### 2026-11-04: Disposable-file live verification

Status: generic modern-value smoke passed; opacity migration blocked by snapshot defect

Runtime and scope:

- Active disposable file: `Untitled`, file key `local_mw22unhf_glia46i5`.
- Bridge session: `figlets-mw22undj-fhoyf`; reported bridge build: `1.3.0`.
- Synced capabilities report all six variable types, composed colors, and exact variable writes. The build label does not distinguish this development implementation from the 1.3.0 release.
- Test assets are isolated in `Figlets Live Test 2026-11-04`, collection `VariableCollectionId:3:2`, with five `figlets-live/*` variables. Assets remain for inspection. Original design-system variables were not changed.

Passed live checks:

- Created TIMING values of 200 ms and 0 ms in Default and Reduced Motion. Updated Default to 350 ms and preserved Reduced Motion at 0. Figma readback uses floating-point seconds (`0.20000000298023224`, then `0.3499999940395355`).
- Created custom cubic-bezier EASING and LINEAR values, then updated Default to EASE_IN_AND_OUT. Figma readback preserves easing types and returns normalized curve data.
- Created composed COLOR with COLOR and FLOAT alias channels in Default, and raw RGB plus an opacity alias in Reduced Motion. Updated Default to aliased color plus raw opacity 60; the second mode and variable ID were preserved.
- Synced after each apply and asserted the final stored values and alias IDs. Replaying the earlier TIMING approval failed closed with `value for Default changed since approval`.

Failed or blocked live checks:

- `inspect_ds_token_gaps({ categories: ["primitive-opacity"] })` reports zero migrations and ten incompatible scrims because every synced variable omits `variableCollectionId`. The same snapshot's Primitives collection lists all ten scrim IDs in `variableIds`, proving these are in Primitives rather than outside it.
- The plugin sync serializer near `code.js:314` omits collection identity, while `primitive-opacity-repair.js` requires `variable.variableCollectionId`. No snapshot modification or implementation patch was used to bypass the failure.
- The tool's headline says no config-backed token gaps despite these ten blocked migration notes. This is misleading and must be corrected alongside the collection-identity defect.
- Opacity migration writes, RGBA parity, ID preservation, partial approval, and idempotence remain unverified live because no valid specialized repair payload was emitted.
- Atomic batch failure behavior and exact result reporting remain incomplete and were not certified by the successful-write tests.

Next safe step:

- Fix and regression-test collection identity in real synced snapshots and the blocked-migration summary, reload the bridge, then rerun the opacity migration smoke against this disposable file.
- Finish the Phase 2 batch result contract before release. Keep Phases 3 and 4 deferred until an explicit release-scope decision.

### 2026-11-04: Migration defects fixed and live rerun passed

Status: snapshot, blocked-summary, and normalized-color comparison fixes verified

Changes:

- Sync now serializes `variableCollectionId` for each variable.
- Token-gap summaries count blocked opacity migration findings and expose their reasons in the designer presentation, without inventing apply payloads.
- Desired-value comparison treats an opaque raw composed color channel with Figma's added `a: 1` as equivalent to RGB input. Expected-current signatures remain exact for stale approval rejection.
- Added a regression that executes the actual sync serializer and passes its payload to the migration planner. Added blocked-summary and normalized-color idempotence coverage.
- Extended existing sync and inspection surfaces; no new public tool, mutation route, or repair path.

Live runtime:

- User reloaded the local bridge after the serializer change.
- The unsaved file's local key changed to `local_mw23468w_vsavtww1`, session `figlets-mw23468k-oj7fc`, build label `1.3.0`. All 386 pre-migration variable IDs and names matched the previous snapshot; this is the same disposable file.
- Fresh snapshot included collection identity on every variable. Ten migrations were planned without incompatible notes.
- The connected MCP process still holds the earlier planner module. Post-fix planning and final idempotence checks used the current repository's `handleInspectDsTokenGaps` entrypoint directly. Preview, apply, and sync ran through the connected Figlets tools. Restart the MCP host before evaluating the updated planner through its registered tool.

Passed checks:

- Previewed and applied only `color/scrim/black/4`. Synced readback proved only that variable changed and only `opacity/4` was created.
- This exposed the Figma `a: 1` normalization defect, which was fixed before the remaining apply. The current planner then emitted nine remaining migrations.
- Previewed and applied those nine entries unchanged from the fresh planner. Six further opacity prerequisites were created, for seven total.
- All ten original scrim IDs and collection IDs were preserved. Their readback RGB and resolved alpha matched pre-migration RGBA within `1e-6`.
- All other existing variables, including semantic aliases and the five isolated modern-value test assets, remained unchanged.
- Current-code reinspection returned zero opacity migrations, zero blockers, and no primitive apply plan.
- Replaying the original partial approval was rejected because `opacity/4` had been created since approval. No migration was applied.
- Full `npm test`: 127/127 test files passed after the comparison fix. Plugin syntax and whitespace checks passed.

File state left for inspection:

- Ten migrated scrims and seven shared opacity variables remain in the disposable file.
- The five `figlets-live/*` variables in `Figlets Live Test 2026-11-04` remain.
- Implementation changes are uncommitted. No release or publication was performed.

Next step:

- Complete Phase 2 atomic batch failure behavior and exact operation result reporting. Successful migrations do not certify atomic failure behavior.
- Keep Phases 3 and 4 deferred until the release-scope decision.

### 2026-11-04: Test collection naming corrected

- At the user's request, renamed `Figlets Live Test 2026-11-04` to `6. Motion` through the existing exact-operation planner/apply flow. Synced readback confirmed collection ID `VariableCollectionId:3:2`, five existing test variables, and Default/Reduced Motion modes were preserved.
- The earlier collection name was supplied by the live test, not a production default. `6. Motion` matches the file's numbered foundation collections and the planned `DS.collections.motion` default.
- Current exact variable creation requires an existing target collection and blocks when it is absent. Automatic config-backed motion foundation setup remains Phase 3 work; the renamed test assets do not constitute that implementation.

### 2026-11-04: Deleted motion collection recovery implemented

Status: staged collection prerequisite and variable continuation verified

- The user deleted the motion collection and requested product behavior that creates it instead of ending with an error.
- Extended the existing exact-operation planner, not the bridge: valid TIMING/EASING creation targeting a missing collection now returns `phase: create_missing_motion_collections`, an exact `create_collection` apply payload, and `continuation.input` retaining the pending variables. Invalid values/capabilities do not cause foundation writes.
- Explicit collection names are honored. An omitted name reuses an existing Motion collection or follows the file's numbered naming pattern; this file gets `6. Motion`.
- Foundation creation and fresh variable approval remain separate. After apply and sync, the continuation uses real collection/mode IDs. Workflow guidance requires completing this continuation rather than claiming an empty collection is the completed request.
- Live test began with the collection absent. The current repository planner generated the prerequisite; the connected Figlets apply/sync tools created collection `VariableCollectionId:3:15` named `6. Motion` with Default and Reduced Motion modes. The fresh continuation created four duration tokens (0/100/200/300 ms) and four easing tokens (linear/standard/enter/exit) from the recorded lean profile.
- Synced readback confirmed all eight types and values, zero durations and LINEAR easing in Reduced Motion. A subsequent current-code plan reused the collection rather than proposing a duplicate. The eight `motion/*` variables remain for inspection; the prior five `figlets-live/*` test variables were removed when the user deleted their collection.
- Full supported-runtime `npm test`: 128/128 passed. Focused prerequisite and operation-planner tests and whitespace checks passed. Implementation remains uncommitted.
- The connected MCP planner process still needs a restart to load these source changes; the prerequisite test used the current repository's planner entrypoint. No bridge reload was needed for this planner-only change.
- This completes the missing-collection error recovery slice. Config-backed profile persistence and full motion setup orchestration are not implemented by this change. Phase 2 atomic batch result handling remains pending.

### 2026-11-04: Phase 2 variable batch failure and result contract

Status: implementation and automated failure tests complete; live success and stale-race tests passed

Checkpoint and architecture:

- Saved the previous verified work in `0175064` before starting this task.
- Extended the existing generic planner/apply surface. No new public tool or bridge route.
- Pure `create_variable`/`update_variable` batches use `atomic-variable-values`. Structural/lifecycle/style/binding batches retain explicit best-effort semantics. Motion/composed-value operations mixed with those edits are rejected with instructions to split the approvals.
- All live collection/variable identities, mode names/IDs, exact stale signatures, aliases, and normalized values are checked before the first write. Multiple operations against one variable must be merged and replanned.
- The write journal preserves original mode values and records new variables before their initialization. Failure stops later entries, restores updates, removes creates, verifies restored values, and reports any cleanup failure.
- Per-operation outcomes and counts distinguish created, updated, unchanged, blocked, failed, and rolledBack. Failed entries include rollback state. `rollback_failed` never claims all changes were removed. A lost bridge response is `unknown`, requiring inspection before retry.
- Value-batch apply requires `atomicVariableValueBatches: true` in the synced snapshot. Stale connected MCP processes must restart to load the current handler. Older bridge results are not silently labeled atomic.
- Unchanged-value comparison tolerates native float32 timing/color/curve readback and named easing metadata; expected-current signatures remain exact.

Verification:

- Full supported-runtime `npm test`: 129/129 passed. Focused tests cover later-mode staleness before any writes, failed initialization cleanup, earlier update restoration, unattempted trailing entries, rollback/remove failure reporting, duplicate-target rejection, all six variable types, mixed-batch rejection, exact MCP result forwarding, and lost-response handling.
- JavaScript syntax and whitespace checks passed.
- User reloaded the bridge during the test. Unsaved file keys changed from `local_mw24112y_q2izzd4k` to `local_mw241mwd_0lk2mqnx`; the Motion collection remained `VariableCollectionId:3:15`. The latter session is `figlets-mw241mw5-m9k0l`, build label `1.3.0`, with the atomic capability advertised.
- Live batch changed `motion/duration/fast` from 100 to 125 ms and requested the existing 200 ms standard duration. Exact output was one updated, one unchanged, zero failures, `committed`.
- After syncing, planned a batch with standard 300 ms first and fast 175 ms second. A separate approved write changed fast to 150 ms without updating that snapshot. Applying the earlier batch passed the server's snapshot validation but the live bridge blocked both operations before writing because the second value had changed. Fresh readback kept standard at 200 ms and fast at 150 ms.
- Restored fast to 100 ms through a fresh approved operation. Final synced variables and collections exactly matched the pre-test baseline, with no extra assets left.
- The current repository handler called the existing bridge route for exact-result live tests, because the connected MCP process retains the earlier result adapter.
- Native Figma runtime write-failure rollback was not forced live. Runtime and cleanup failure coverage is injected in the automated bridge harness; do not present it as native live evidence.

Next step:

- Review this implementation before release. Decide the scope of optional motion config and export/documentation phases independently.

### 2026-11-04: Specialized code review completed with fixes

Status: approved by the dedicated review subagent; no remaining must-fix findings

Scope and findings:

- Reviewed `3599768` against checkpoint `0175064`, with no external PR or Linear issue associated with this local review.
- Initial verdict was request changes. Four reproduced findings were fixed: native fractional FLOAT/raw opacity readback, stale-snapshot capability allowing an older live bridge to perform partial writes, incomplete/contradictory atomic result envelopes, and cleanup failures associated by duplicate variable names.
- Re-review identified missing failed-update rollback evidence. That gap was fixed and regression-tested before final approval.

Fixes:

- A finite float32 equivalence helper covers FLOAT, TIMING, composed numeric opacity, color channels, and easing curves. Overflowed projections cannot falsely compare equal. Exact stale signatures are unchanged.
- Value batches now use `atomicVariableBatch: { version: 1, operations }` on the existing route, without top-level `operations`. The reviewer reran the actual `0175064` bridge against the current sender and confirmed zero writes. No new public tool or route was introduced.
- The server validates batch status, complete per-operation identities/indices, status legality, variable IDs, partition arrays/counts, compatibility arrays, and rollback/error consistency before claiming an outcome. Incomplete evidence becomes `unknown` with required inspection, no invented zero-outcome arrays, and no success text.
- Failed updates require their original ID and restored/failed rollback evidence. Failed creates that returned an ID require cleanup evidence. Cleanup errors and classifications use operation index/variable ID instead of names.

Verification and live cleanup:

- Full supported-runtime suite passed 129/129; syntax and whitespace checks passed. Focused tests now normalize native fractional readback and cover duplicate names, incomplete results, contradictory commit states, missing failed-update restoration evidence, and older-plugin dispatch.
- Before the fix, a real FLOAT 1.1 test reproduced the false readback failure. The real handler removed the temporary variable and a sync confirmed the complete baseline was preserved.
- After the user reloaded the plugin, live session `figlets-mw29l2ns-vw37g`, file key `local_mw29l2o5_yf8qya25`, accepted FLOAT 1.1 and composed opacity 12.1. Figma stored `Math.fround(1.1)` and `Math.fround(12.1)` as expected.
- A repeat update returned exactly two unchanged outcomes. Removed `motion/review/fraction` and `motion/review/opacity` through the existing planner/apply flow. Final synced variable and collection arrays exactly matched the pre-test baseline.
- Final reviewer verdict: approve the current fixes; no remaining must-fix findings. Reviewer ran atomic bridge, server operation, motion prerequisite, and whitespace checks. No source edits or external comments were made by the reviewer.
- Native setter-failure rollback remains unforced live. Automated injected-failure coverage remains the evidence for that path.

Next step:

- Decide the next release scope. Optional config-backed motion setup and new-type export/documentation work remain incomplete.

### 2026-11-04: Phase 3 optional motion configuration and setup

Status: implemented; 130 test files pass; live saved-profile existing-token flow verified

Architecture and approval:

- Extended existing `prepare_ds_config` and `plan_ds_figma_operations` rather than adding a public tool or parallel mutation path. Shared core motion helpers provide the default profile, naming, named-map validation, preview, and easing normalization; exact variable operations reuse that easing helper.
- An explicit `motion_profile: default` or edited object returns a read-only proposal and exact `saveInput`. Fingerprints include current config bytes and the normalized profile/collection, so stale config changes or unapproved proposal edits cannot be saved.
- Approved save modifies only `DS.motion` and `DS.collections.motion`, then returns a normal reprepare input. Ordinary intake and configs without motion remain unchanged. Bootstrap refresh preserves an existing approved profile and collection name.
- Motion config stores complete token names and named Default/Reduced Motion maps. Durations are milliseconds; conversion to native seconds remains in the existing exact-operation codec. Springs require explicit edited values and are absent from the default.
- `plan_ds_figma_operations({ motion_config_path })` returns collection/mode prerequisites first, with a sync/replan continuation. Variable creation or updates follow as a separately approved atomic batch. Existing IDs are preserved; wrong types or ambiguous/out-of-collection names block instead of being replaced.
- Broad setup exposes motion in its preview and returns `motionPending` plus a `nextStep`; it does not falsely claim optional motion was built by the five-foundation bridge route.
- If required mode creation fails, the agent stops instead of silently dropping Reduced Motion. Generic collection creation removes its newly created shell when required modes fail. A native mode-limit failure was not forced live; this failure path is tested in the bridge harness.

Verification:

- Full supported-runtime suite passed 130/130. Focused config flow, registered MCP schema, setup export/handoff, exact operations, and bridge mode-limit cleanup tests passed. Syntax and whitespace checks passed.
- Preview produced no file changes; edited proposals required fresh fingerprints; approved profiles survived reprepare and bootstrap refresh. Tests covered missing collection, missing Reduced Motion, eight-token planning, and existing wrong-type protection.
- Live verification used an isolated local config named `Motion setup verification`, not a rename or rewrite of the user's design-system config. Preview/save/reprepare produced `readyToBuild: true`, then config-backed planning reused `6. Motion` and its eight existing tokens.
- Live session: `figlets-mw2a0qin-97pl0`, file key `local_mw2a0qj0_dmp11v0f`, bridge label `1.3.0`. Apply returned committed with eight unchanged and zero created/updated/failed. Final synced variables and collections exactly matched the baseline.
- Current repository handlers were used because the connected MCP process still caches earlier schemas. Restart the MCP connection and reload the bridge before using the new host-exposed flow.
- This new slice has not had a specialized subagent review. Previous Phase 2 review approval does not cover it.

Next step:

- Implement Phase 4 new-type export and documentation, keeping native motion timeline authoring deferred.

### 2026-11-04: Motion profile run on the actual active file

- User requested the new flow on the disposable file to inspect its output. The initial read-only preview exposed a naming defect: bootstrap config omitted Elevation, so config-only numbering proposed `5. Motion` despite the live `6. Motion` collection.
- Fixed preview naming to consult its sibling synced snapshot, reuse a sole existing Motion collection, and consider all live collection numbers. Multiple Motion collections require an exact choice. Explicit configured or requested names retain priority. Added both core and actual-preview regression checks.
- Saved the default eight-token profile to the active file-scoped config, targeting `6. Motion`. Normal reprepare computed successfully but `readyToBuild` remained false because DESIGN.md validation rejects the existing placeholder project name `Untitled`. No broad setup/export was applied or claimed ready.
- The separately scoped motion planner returned eight ready, zero blocked. The current apply handler returned committed with eight unchanged, zero created/updated/failed. This is the existing variable collection output; no canvas showcase is generated by this feature.
- The current sync handler preserved DS.motion and DS.collections.motion after apply. The connected MCP process still caches older schemas/handlers, so current repository handlers were used. Restart the Figlets connection before further use of this update.
- Active file key: `local_mw2a0qj0_dmp11v0f`; collection ID: `VariableCollectionId:3:15`. The approved profile remains saved in that file's local config. The real Figma variables did not need changes.

### 2026-11-04: Fresh specialized Phase 3 review completed

Status: approved after fixes; no remaining must-fix findings

- User requested review of `53072af` and `63880fd` against `0e4fb73`. The first subagent hit a usage limit before issuing a verdict. At the user's request, a fresh independent reviewer started from the code and reproduced three P2 findings.
- Fixed implicit naming drift: bootstrap refresh now saves the collection name resolved from the original config before inferring sparse replacement foundations. An implicit `6. Motion` no longer becomes `5. Motion` after sync.
- Fixed prefix mutations before known conflicts: config-backed token name/type/location checks run before emitting any collection or mode creation payload. A wrong-type or out-of-collection token blocks the whole setup plan immediately.
- Fixed collection-name ambiguity: multiple synced collection IDs with the configured motion name are rejected before choosing a target. An explicit name cannot disambiguate identical names.
- Added regressions for implicit default persistence, conflicts with missing collection/modes, and duplicate exact target names. Full supported-runtime suite passed 130/130; whitespace checks passed.
- Reviewer rechecked source and regressions, ran motion config flow, motion collection prerequisites, config preparation, atomic bridge, registered MCP schemas, and whitespace checks. Final verdict: approve current fixes; no remaining must-fix findings. No reviewer file edits or external PR/Linear comments.
- Refreshed the work-session Figlets MCP client and enabled its receiver after verification found that receiver was stopped. Actual MCP sync succeeded; current `motion_config_path` planning returned `6. Motion`, eight ready, zero blocked. This refreshed the independently managed connection, not the app-managed connection. No Figma variables were applied during review.
- Native mode-limit cleanup remains covered by automated tests rather than a forced live failure.

Next step:

- Implement Phase 4 export/documentation for TIMING, EASING, and composed COLOR. Preserve portable CSS and lossless provenance separately, retain DESIGN.md compatibility, and document observed bindings without authoring Motion timelines.


### 2026-11-04: Phase 4 export and documentation checkpoint

- Extended existing CSS/Make, DESIGN.md/sidecar, inventory, and component documentation surfaces. No public tool or mutation path was added.
- CSS emits opacity percentages, resolved composed colors, millisecond timings, and portable easing values. Unsupported easing modes clear inherited declarations and appear in explicit omission guidance. Exact source values remain in JSON.
- Sidecar schema 3 retains original variables, collections, modes, scopes, metadata, channel aliases, and resolved presentation. Standard front matter remains compatible with Google 0.4.0. Generated inline extensions remain disabled.
- Imported snapshots are reused only while the configuration matches its recorded stable signature. Edited configs cannot silently export stale archived values.
- Component handoffs preserve observed native types and values, opacity units, timing/easing details, and nested channel reference paths. Static prototype reporting remains unchanged. No Motion timelines are inspected.
- Fresh specialized review found three P2 issues: inherited alternate CSS easing, stale archived config values, and nested reference paths. All were fixed with regressions. Re-review: approved, no remaining must-fix findings.
- Verification: 132/132 test files, workspace build/lint commands, and whitespace checks pass. Build/lint currently have no workspace-specific scripts. Direct export of the saved disposable-file snapshot resolved all 16 motion mode values with expected CSS. This is saved-snapshot evidence, not a fresh live bridge run.
- Next: reload the updated bridge once and verify live component documentation plus exports. The actual file still has the placeholder project name Untitled, which blocks full DESIGN.md readiness. Do not rename it without a designer decision. Release checks follow live verification.


### 2026-11-04: Live export and component smoke follow-up

- Fresh Figlets sync/export resolved 16 motion mode values and ten composed colors. Make preview lint passed. DESIGN.md correctly blocked on Untitled and Desktop touch/min 32px.
- Built the six-section token showcase on 00 · Tokens and Card-C documentation on Page 1 / Documentation.
- Card-C uses remote library variables from a different DS. Live testing exposed missing transitive alias hydration. Fixed dependency fetching, misplaced component metadata, and response passthrough. Full suite 132/132; specialized follow-up review approved. Live regenerated spec has zero unresolved bindings and five mode previews across two collections.
- Test setup mistake: bound the Sold Out badge 4:3283 and Image slot 4:3282 to the disposable local black60 scrim. This mixed systems. Library token values were not changed. User warned about the foreign DS; asked for a clean source replacement because the original badge fill was not captured. Do not guess restoration from a shared name.
- Remaining: user clean-copy recovery, regenerate docs without changing source bindings, and preserve output. Figma UI access was denied, so visual layout remains unverified. Local evidence: .local/phase4-live-results.

# Figma Variable Foundations Feature Plan

## Status

Planning document created on 2026-10-12.

Implementation has not started. This document is the durable source for scope, priorities, approval boundaries, phased delivery, verification, and later execution notes.

Target release: next Figlets minor release after 1.3.0.

Current repository baseline: the full test suite passes 123 test files on the current dirty working tree. Later implementation must preserve unrelated changes and must record a fresh baseline before editing overlapping files.

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

Status: not started

Goal: make every read-only and exact-operation path understand the new value shapes before enabling specialized writes.

Work:

- [ ] Add `TIMING` and `EASING` to the canonical supported variable type set.
- [ ] Add shared validation and normalization helpers for every variable type.
- [ ] Preserve Figma-native timing seconds in snapshots and bridge payloads.
- [ ] Accept timing operation input in milliseconds.
- [ ] Convert milliseconds to seconds only in the normalized approved operation sent to the bridge.
- [ ] Display timing values in milliseconds in summaries and previews.
- [ ] Validate finite, non-negative timing values.
- [ ] Validate all current `MotionEasing` discriminants.
- [ ] Validate custom cubic-bezier control points.
- [ ] Validate normalized custom spring bounce from 0 to 1.
- [ ] Preserve named spring and named easing variants without flattening them.
- [ ] Add composed-color normalization with separate color and opacity channels.
- [ ] Require at least one composed-color channel to be an alias.
- [ ] Validate raw opacity values from 0 to 100.
- [ ] Validate COLOR aliases for the color channel.
- [ ] Validate FLOAT aliases for the opacity channel.
- [ ] Make stable signatures recursive so nested object key order does not affect stale checks.
- [ ] Traverse nested aliases in composed colors during delete, duplicate, move, and retarget planning.
- [ ] Preserve the exact composed value during variable duplication and movement.
- [ ] Add explicit source-capability metadata to snapshots.
- [ ] Mark REST timing and easing coverage as unknown.
- [ ] Add bridge capability reporting for supported variable types and composed colors.
- [ ] Block writes with actionable update or reload guidance when the bridge is outdated.

Exit criteria:

- All six variable types round-trip through bridge snapshots.
- Composed colors preserve raw channels and alias channels.
- Generic planning can validate the new values without writing Figma.
- Existing four-type behavior remains unchanged.
- REST-based analysis does not claim timing or easing absence.

### Phase 1: Composed scrims and shared opacity primitives

Priority: P0

Status: not started

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

- [ ] Update primitive generation to return opacity primitives and composed scrim plans.
- [ ] Update setup preview to list exact opacity variables and composed scrims.
- [ ] Create opacity variables before setting composed scrim values.
- [ ] Apply both opacity scopes.
- [ ] Keep semantic overlay, state, and shadow aliases unchanged.
- [ ] Preserve existing setup behavior when rerun against a partially populated Primitives collection.
- [ ] Make setup idempotent.

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

Status: not started

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

- [ ] Resolve every alias by exact variable name.
- [ ] Require compatible alias types.
- [ ] Normalize TIMING to seconds in `repairPlan.applyInput`.
- [ ] Keep designer presentation in milliseconds.
- [ ] Preserve `MotionEasing` without lossy conversion.
- [ ] Include recursive stale signatures for updates.
- [ ] Mark destructive lifecycle operations exactly as the current planner does.
- [ ] Include nested composed-color references in affected-variable summaries.

#### Apply behavior

- [ ] Revalidate every normalized value and stale signature.
- [ ] Create `TIMING` and `EASING` variables through the existing bridge operation route.
- [ ] Set composed color values with resolved variable aliases.
- [ ] Reject an older bridge that lacks the required capability.
- [ ] Preserve atomic behavior for each approved operation batch.
- [ ] Return exact created, updated, unchanged, blocked, and failed results.

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

Status: not started

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

- [ ] Do not add a motion question to ordinary new-system intake.
- [ ] Trigger the profile only from an explicit timing, easing, transition-token, or motion-foundation request.
- [ ] Show exact collection, modes, token names, values, and curves.
- [ ] Let the designer edit the proposal.
- [ ] Ask for approval before writing local config.
- [ ] Reprepare the config after the approved config write.
- [ ] Ask separately before writing Figma.
- [ ] Do not report missing motion config as a setup or health defect.
- [ ] State that reduced-motion variables do not prove runtime accessibility.
- [ ] Offer springs only as an optional addition.

If the Figma plan cannot create a second mode, stop and report the blocker. Do not silently produce a single-mode profile. A single-mode alternative requires an explicit designer request and an accessibility warning.

Exit criteria:

- Ordinary setup remains unchanged.
- Explicit requests receive a concrete editable proposal.
- Config and Figma writes have separate approvals.
- Default and reduced-motion values match the approved profile exactly.

### Phase 4: Analysis, export, and documentation

Priority: P1

Status: not started

Goal: make the new variable data visible and portable without weakening existing standards contracts.

#### Inventory and analysis

- [ ] Count all six resolved variable types.
- [ ] Report snapshot source capability and coverage.
- [ ] Preserve composed color channel provenance.
- [ ] Resolve composed colors for presentation without replacing their stored source structure.
- [ ] Treat the shared `OPACITY` and `COLOR_OPACITY` scopes as intentional for generated opacity primitives.
- [ ] Do not report missing timing or easing collections as defects.
- [ ] Show timing in milliseconds in designer-facing output.
- [ ] Show readable easing names and exact custom parameters.

#### CSS and Make guidance

- [ ] Serialize opacity primitives as percentages.
- [ ] Resolve composed colors to portable CSS color values.
- [ ] Preserve exact channel aliases in provenance and sidecar data.
- [ ] Serialize timing as milliseconds.
- [ ] Serialize linear and cubic-bezier easing when a valid CSS representation exists.
- [ ] Do not invent CSS for a spring easing.
- [ ] Keep springs in lossless data and emit a clear portability warning.

Portable resolved CSS is the default. The CSS output does not need to preserve a live two-variable channel relationship when doing so would require unstable or poorly supported syntax. The lossless sidecar remains the exact source for round-trip reconstruction.

#### DESIGN.md and Figlets artifacts

- [ ] Keep standard front matter compatible with the supported Google DESIGN.md schema.
- [ ] Do not add unsupported standard token types.
- [ ] Store exact timing, easing, composed color, scopes, modes, and aliases in `figlets-extended`.
- [ ] Store the same exact model in `figlets-design.json`.
- [ ] Preserve round-trip behavior.
- [ ] Add prose summaries only when they are factual and useful.

#### Component documentation

- [ ] Display composed opacity bindings when they are observed.
- [ ] Display timing and easing variable references when they are observed.
- [ ] Keep current static prototype reaction and transition reporting unchanged.
- [ ] Do not inspect Motion timelines in this release.

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

- [ ] All six variable types normalize correctly.
- [ ] Invalid timing values are rejected.
- [ ] Timing milliseconds convert to exact seconds.
- [ ] Every supported easing discriminant round-trips.
- [ ] Invalid cubic-bezier and spring data is rejected.
- [ ] Composed colors require at least one alias.
- [ ] Color and opacity channel alias types are enforced.
- [ ] Opacity clamps are not performed silently.
- [ ] Recursive signatures are deterministic.
- [ ] Nested aliases are found by lifecycle analysis.

### Bridge and generic-operation tests

- [ ] Create and update TIMING variables.
- [ ] Create and update EASING variables.
- [ ] Create and update composed COLOR variables.
- [ ] Duplicate and move every new value shape.
- [ ] Retarget nested composed-color aliases.
- [ ] Reject deletion when nested references remain.
- [ ] Reject stale nested values.
- [ ] Reject writes through an outdated bridge capability set.

### Opacity setup and migration tests

- [ ] Generate all seven opacity primitives.
- [ ] Apply both opacity scopes.
- [ ] Reuse exact black and white neutral endpoints.
- [ ] Prefer the configured neutral ramp when exact duplicates exist.
- [ ] Fall back to raw black or white when no exact endpoint exists.
- [ ] Preserve every existing scrim name and ID.
- [ ] Preserve descriptions, code syntax, publishing state, and downstream aliases.
- [ ] Prove resolved RGBA parity before and after migration.
- [ ] Prove migration idempotence.
- [ ] Reject stale migration payloads.
- [ ] Apply only approved partial migration entries and required prerequisites.
- [ ] Leave unselected entries untouched.

### Motion profile tests

- [ ] Configs without motion remain unchanged.
- [ ] Ordinary intake does not ask about motion.
- [ ] Explicit motion requests produce the lean proposal.
- [ ] Default and Reduced Motion modes use exact named maps.
- [ ] Duration and easing values match the locked profile.
- [ ] Missing second-mode capability blocks the default profile.
- [ ] Config and Figma approvals remain separate.

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

- [ ] Run focused tests after each phase.
- [ ] Run the full repository test suite before completing a phase.
- [ ] Run the repository whitespace check before completing a phase.
- [ ] Perform a disposable-file opacity migration smoke test.
- [ ] Perform a disposable-file timing and easing variable smoke test.
- [ ] Record bridge build identity and Figma API behavior used by each live smoke test.

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

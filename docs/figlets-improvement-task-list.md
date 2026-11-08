# Figlets improvement task list

Updated November 8, 2026.

## Current status since 1.3.0

The 1.4.0 candidate contains the approved naming, imported-foundation, prompt/readability, QA, display-font, scrim, contrast-continuation, unified-motion, color-scale/brand-anchor, and rendering-font-fallback changes. See the [complete release summary](releases/1.4.0.md). The latest full suite has 146 passing test files; build, lint, version alignment, packed-release verification, plugin smoke, and archive checks pass.

The Bridge and release packages identify as 1.4.0. Generated specs/ and component-specs/ are local outputs, not release content. Native Specs replacement is shelved and its disposable tooling is removed. No current file's incorrect token inventory was silently migrated by these code fixes.

Still open: refresh the normal Bridge/host, verify the latest font fallback and setup flow live, and replay the six designer workflows. Publication was explicitly approved by the user on November 8; release execution and remote verification are in progress. Historical entries below retain their original test counts and runtime observations; they are not claims about the current running host. Later corrections supersede earlier motion staging and scrim placement proposals.

## Goal and approval rules

Use release 1.3.0 as the designer interface baseline. Retain useful improvements without adding designer friction. Source review: [review since 1.3.0](reviews/2026-11-06-since-v1.3.0.md).

The user must explicitly approve each proposed change before implementation. Approval of this task list is not approval to implement its items.

- Read-only investigation and maintaining this task list are authorized.
- Interface changes, including prompts and designer-facing wording, require a concrete demo or preview, followed by approval before implementation.
- Logic changes require a plain-language explanation of the problem, reason for the change, expected behavior, and proposed regression tests. After approval, implement the change with those tests.
- A change affecting both logic and interface requires both forms of review.
- Runtime restarts, connection changes, installation, Figma writes, version changes, and publishing require specific approval. Do not infer approval from the general improvement goal.
- Report verification separately from implementation. Passing automated tests does not establish live or visual correctness.

## Ordered tasks

### Priority investigation: requested scale and brand anchor ignored

**Status: user-approved fix implemented November 7. Automated verification complete. Existing Figma file unchanged.**

Saved dummy_ds_4 intake correctly records 0-100, #FFC850, and #B52840. The confirmed defect was a missing 0-100 scale and silent fallback to 50-950 while retaining the requested label. Read-only reproduction yields the agent's contradictory anchors at 200 and 600. Separately, the main brand semantic template starts at primary/500 rather than the supplied anchor; initial contrast adjustment can move it. The active saved snapshot shows the reported primary/400 binding. The exact historical selection of 400 is not attributed without an operation log.

Implemented repair: shared scale-aware generation/reference resolution, anchor-based default main brand semantics, unchanged exact primitive colors, and truthful output/readback. Tests cover all supported ranges, valid anchor steps, foreground/icon adaptation without moving the brand anchor, preserved explicit mappings, and rejection of unsupported silent fallback. See [implementation and regression evidence](reviews/brand-anchor-scale-investigation.md).

### Motion intake correction

**Status: corrected November 7. 144/144 tests pass. Running connection refresh and live designer verification remain.**

The prior integration finished the build path but left the optional question after preparation. User correctly identified that as incomplete. The include/skip choice now belongs to main intake, before declaring completion, creating config, or preparing the token plan. The normal intake tool will not save a completed config without a motion decision or an existing approved profile. It stores selected motion in the same write as all other answers; known answers are reused. Removed separate preview-motion/save-motion/reprepare workflow steps. A partial Markdown import also reports missing motion intake.

Tests cover ordering, no config write before the question, skip with no motion defaults, selected/custom profiles, retained choices, invalid profile rejection, and the actual registered intake-to-build sequence with one setup call. Full suite 144/144, build, lint, package smoke, and whitespace pass. No Figma writes or new Bridge change. The running connection is confirmed stale for this ordering and must refresh before retesting. See [current flow and evidence](reviews/unified-optional-motion-setup.md).

### Optional motion integrated into normal setup

**Status: implemented and tested November 7. 143/143 tests pass. Running host refresh and live designer verification remain.**

User approved one setup flow and one Figma build approval covering every selected foundation, including optional motion. The full preview includes its collection, modes, exact durations, and easing values. apply_ds_setup internally reuses the existing shared motion planner, generic structural executor, atomic value writer, and sync transport. No public tool or Bridge mutation branch was added. Skipping motion retains the ordinary five-foundation path. Successful completion requires readback in both configured modes; partial failures do not become separate approval tasks or claim full completion.

Fresh stdio MCP integration proves one setup call completes the selected six-foundation plan using the actual Bridge operation handler in a simulated file. Tests cover retries, preserved IDs/unrelated tokens, capabilities, mode failure, rollback, readback, and config/file changes. Build, lint, packaging smoke, and whitespace checks pass. No live Figma writes, commit, release, or Bridge update for this slice. The current running guide is older and needs host-server refresh. See [implementation and verification](reviews/unified-optional-motion-setup.md).

### Contrast continuation and semantic-only repairs

**Status: completed November 7. 142/142 tests pass; actual running Figlets connection verified. Full manual designer conversation remains.**

Semantic repair options now include exact evaluated icon steps and their background evidence. Repairs preserve primitive ramps, source hex, and scale. Saved semantic aliases stay unchanged until a repair is approved. Shared readiness makes icon findings advisory and honors explicit continuation for current text contrast findings, retaining that decision across prepare/apply and rechecks. Accepted findings remain unresolved warnings, not passing contrast. No unchanged repair loop or palette-change recommendation remains in current workflow guidance.

Tests include actual registered MCP calls in a fresh stdio process, a simulated Bridge build, stale/conflicting repair rejection, incompatible shared backgrounds, persistence, unchanged primitives, and truthful exports. Build, lint, package smoke, and whitespace checks pass. No live Figma writes or new bridge changes were needed for this slice. The running Codex connection accepts explicit continuation and preserves it on recheck of an isolated failing config; the failure remains visible. Its workflow guide also contains the new policy. No restart is needed for this verified connection. A separate Cursor connection and full manual new-setup conversation are not verified. See [implementation and regression evidence](reviews/icon-contrast-build-policy-proposal.md).

### Scrim inset requested from visual reference

**Status: implemented and regenerated through bridge .8; 141/141 tests pass.**

Added 8px padding to the scrim swatch container so the contrasting neutral backplate remains visible on all sides. Backplate remains a full-size bound absolute layer; the rounded overlay fills the padded area. Preserve outer swatch size, labels, the single-row design, and placement at the end of Primitive Colors. This changes showcase geometry only. Targeted helper/full-render tests and syntax/whitespace checks pass. Live .8 regeneration completed with six sections, no separate Scrims section, and no scrim-related warnings. Output remains in Figma for visual review.

### Placement correction: scrims belong inside Primitive Colors

**Status: implemented and regenerated in the disposable file; 141/141 tests pass.**

The user clarified that scrims belong at the end of the Primitive Colors section, not in a separate showcase section. Reuse the existing primitive table and swatch helpers. Append only primitive scrim groups after all ordinary ramps; retain the contrasting neutral backplate, bound overlay, opacity order, and single-row design. Semantic scrim aliases must not become primitive swatches. Existing full showcase refresh removes the legacy standalone generated Scrims section. No token values or fonts change.

Bridge build: 1.3.0+dev.20261106.7. User reloaded it; fresh active snapshot verifies that build and all three approved font primitives. Full-render regression fails against the previous separate-section layout and passes with the correction. Helper opacity-order tests also pass. Syntax and whitespace checks pass. Live .7 regeneration returned six sections, with Primitive Colors and no separate Scrims section, and no scrim-resolution warnings. The full-render test also verifies semantic overlay aliases are excluded from primitive swatches.

### Priority: missing scrim showcase and display font

**Status: approved repair implemented; disposable-file output restored through Figlets Bridge. Host intake refresh and visual sign-off remain.**

Confirmed fonts: Display BBH Bogle, Sans Inconsolata, Mono SF Mono. Added explicit font-role fields to the intake schema and fixed the flat `typography.display` field being dropped while flat sans/mono fields were accepted. The exact original tool payload is unavailable, so this reproducible gap is not claimed as the sole historical cause. The running MCP guide is also older than source.

Tests cover the exact three-family answer through persisted config and primitive generation, repair of existing display aliases/styles without replacing their IDs, and the complete showcase renderer on first generation and refresh. Full suite: 141/141. Build, lint, and whitespace checks pass. The new intake regression fails with the display fix removed.

Live Bridge verification on dummy_ds_2026.11.06: created only font/display; retained font/sans Inconsolata and font/mono SF Mono; all three display roles alias font/display in Mobile, Tablet, and Desktop; all three display styles use BBH Bogle with their IDs preserved. Other styles use Inconsolata. Regenerated seven showcase sections, ending with Scrims, without scrim-resolution warnings. Existing bridge 1.3.0+dev.20261106.6 rendered this successfully; no new scrim layout or bridge change was needed.

During broad typography verification, numeric aliases were replaced by equivalent literals. Restored the aliases using the existing typography variable path. An isolated style-only refresh changed zero variables; a final native dry-run reports zero variable creations/updates, font failures, or binding warnings. The precise cause of the intermediate alias churn is not established and must not be attributed to style setters without evidence. Record it as a follow-up before broader typography update work.

Remaining limits: native build results confirm section generation, not visual sign-off. The original missing-scrim execution was not captured. Restart the affected agent host to load current intake code, then replay a new setup conversation. Do not claim this already ran in Cursor. See [repair verification](reviews/font-scrim-repair-verification.md).

### Investigation: native Figma Specs

**Status: shelved by the user November 8.** Native Markdown import from Finder works, but the tested Bridge routes do not provide native creation or content updates. The current documentation workflow stays. Disposable experiment code and generated manifests were removed during release cleanup. Keep only the [research outcome](reviews/native-figma-specs-investigation.md). Resume only on explicit request.

### Additional request: discoverable optional motion setup

**Status: approved, implemented, and verified by automated tests. Live conversation verification pending.**

After base preparation and before build approval, offer one question: Include motion foundations? Choices: Review a motion proposal / Skip for now. Reuse known choices or existing profiles. Review permits a read-only preview, not saving or writing to Figma. Skip adds nothing and makes no motion tool calls. Existing exact saveInput approval, reprepare, and separate motion collection/mode and variable approvals remain intact. Updated workflow guidance, both adapters, and both packaged designer skills. Regression failed before the choice existed and passes afterward. Full suite 140/140 test files passes; final guidance checks and whitespace check pass. No Figma writes or runtime reloads. This slice needs an MCP/agent refresh; bridge build remains 1.3.0+dev.20261106.5.

### Additional request: meaningful scrim showcase

**Status: revised scope approved, implemented, and verified by automated tests. Live visual verification pending.**

See [scrim showcase proposal](reviews/scrim-showcase-proposal.md) and its linked visual preview. User clarified: preserve the existing swatch layout and setup. Apply only the three adjustments: scrims last, no second contrast half, and a contrasting existing neutral layer beneath each scrim. Reuse existing typography, labels, spacing, dimensions, and grouping; do not introduce a separate table/card design. The renderer now reuses the existing swatch components. Full suite 139/139 passes; bridge syntax and whitespace checks pass. Regression coverage includes raw/composed/opaque scrim classification, opacity order, contrasting bound neutral and scrim layers, no double alpha, unchanged ordinary contrast swatches, unresolved data, and last-section placement without duplication on refresh. Bridge build: 1.3.0+dev.20261106.5. No live showcase regeneration or variable changes were performed.

### Additional request: optional display fonts

**Status: approved, implemented, and verified by automated tests. Live verification pending.**

See [the approved display-font support proposal](reviews/display-font-support-proposal.md). User approved implementation. Supplied display/body/UI and named families remain distinct; explicit per-style families and role mappings resolve through shared pure helpers. No display default is added. Existing setup, primitive update, semantic typography, import/export, preview, CSS/Make, and QA paths are covered. Canonical ES5-compatible helpers are embedded verbatim in the bridge, with source parity tested. Fonts and requested weights are checked before dependent setup or typography writes.

Verification: full suite 138/138 test files passes; additional targeted refresh/default-preservation assertions pass. Build/lint commands, bridge syntax, and whitespace checks complete successfully. Tests include unchanged single-family inventories, separate sans/display choices, explicit overrides, custom family tokens, import/refresh, Markdown round trip, CSS/Make, Figma family aliases/text styles, QA exact matches, and unavailable family/weight rejection without writes. Bridge marker: 1.3.0+dev.20261106.4. No live typography writes or runtime reloads. Load the updated MCP and bridge before a separately approved live typography test.

### 1. Align the running build

**Status: completed and verified November 6 after user restarted Codex.**

- [x] Compare connected behavior with current source on the same saved snapshot.
- [x] Identify the discrepancy: connected audit reports seven opacity defects; current source reports those seven values as valid primitive inventory.
- [x] Establish that both identify as 1.3.0, so version alone cannot distinguish them.
- [x] Use a user-performed Codex restart to refresh the host connection.
- [x] User approved proceeding with runtime alignment. Approval does not extend to logic or interface implementation.
- [x] Reconnect and repeat the same audit. Result: seven opacity inventory entries and zero opacity alias defects, without Figma writes. The current agent instruction is also present.

Process inspection is restricted in this session, and the available app tools expose no MCP restart action. Do not kill an unidentified process or automate the Codex interface to bypass that limit. A fresh independent process is not proof that the app connection has refreshed.

After the user reported the restart complete, the registered tool matched current-source execution on the same saved snapshot: zero opacity defects and seven opacity inventory entries. This verifies the corrected audit behavior in the app connection; it is not a full release or workflow verification.

### 2. Preserve a confirmed design-system name

**Status: approved, implemented, and verified November 6.**

Problem: refreshing an imported system preserves the name text but loses its confirmed status. Export asks the designer the same question again.

Proposed result: a confirmed name stays confirmed through refresh. An unconfirmed imported name still receives the required naming question.

- [x] Present the exact logic proposal for approval: preserve existing confirmed-name provenance when retaining that name during refresh. Keep unconfirmed names unconfirmed and respect intentional name changes. Implementation awaits approval.
- [x] User approved the logic proposal and test plan.
- [x] Add regression coverage for confirmation followed by refresh and export, unconfirmed imports, and intentional name changes.
- [x] Implement and verify the complete sequence in isolated workspaces. Regression failed before the fix and passed afterward. Full suite: 133/133 test files pass; whitespace check passes.

The fix preserves designer-confirmed provenance only when refresh retains the existing project name. No designer-facing copy changes, Figma writes, or runtime restarts were made. The existing app process has not been verified to load this newly edited module.

### 3. Separate imported inventory from optional additions

**Status: approved, implemented, and verified by automated tests. Live verification pending.**

Review [the approved proposal and response preview](reviews/imported-foundations-proposal.md). Implementation and verification are recorded below.

Problem: a color-only imported system is reported as missing 44 typography and shadow variables that come from Figlets defaults. The designer never chose those requirements.

Proposed result: report actual inventory, enforce explicit requirements, and present unchosen additions as optional setup. Preserve genuine gap detection for systems with established requirements.

- [x] Explain how observed values, explicit requirements, and optional defaults will be distinguished.
- [x] Preview the designer-facing result beside the current behavior.
- [x] Obtain approval before implementation. User removed the redundant success sentence and approved the rest.
- [x] Test imported sparse systems, explicit requirements, approved setup, repeat inspection and refresh, mixed findings, unresolved references, preserved imported values, and bridge entry selection. Tests use temporary workspaces and a simulated bridge, without live Figma writes.

The original regression reported 44 missing variables before the fix. It now reports zero and no primitive repair batch for that import. Existing inspection/update surfaces are extended through shared internal requirement helpers. Final full suite: 134/134 test files pass, including the unknown-value readiness guard. Whitespace check passes. The bridge and MCP need fresh loading before live verification; no reload or live mutation was performed.

### 4. Align prompts and interface guidance

**Status: approved, implemented, and verified by automated tests. Live verification pending.**

Review [the approved prompt alignment preview](reviews/prompt-alignment-preview.md). Updated the two paste-ready prompts, both adapter instruction files, and workflow response guidance using one shared presentation contract.

Additional user request approved: readable visual hierarchy and appropriate native question controls where available. Custom forms, widgets, and host integrations are deferred.

- [x] Compare the six workflows and old prompt guidance with the 1.3.0 baseline.
- [x] Preview proposed setup-repair, export, and adapter wording. Keep internal configuration work inside Figlets.
- [x] Resolve contradictory capability claims, approval instructions, repair payload guidance, recheck requirements, and advisory severity.
- [x] Obtain approval for the previews before changing shipped instructions.
- [x] Add automated scenarios for six explicit routes, concise openings, shared host guidance, native/fallback choice parity, the full health sequence, and Make suggestion ordering. Retain existing payload and approval regressions. Live model conversations and host rendering remain task 5.

Verification: full suite 135/135 test files passes; whitespace check passes. The initial host smoke check expected the old health-check wording; it now checks the approved goal wording, concise response, and presentation contract while retaining the structured route check. No live Figma writes, reloads, release changes, or publishing were performed.

### 5. Replay all six designer workflows

**Status: current-candidate live replay pending. Automated coverage passes; the six manual workflows below are not yet signed off.**

QA container exclusion approved and implemented: COMPONENT_SET properties are skipped while every variant and nested layer remains in scope. The regression failed before the fix and passed afterward for selection/page audits, contiguous numbering, automatic fixes, and stale container approvals. Full suite 136/136 passes. A fresh read-only live audit of Notification toggle reports only two variant itemSpacing findings, no set findings, and no writes. The two 16px values are stored on State=Off 9:9 and State=On 9:13, rows containing Label and Track. Current inspection does not expose primary-axis alignment, so whether those stored gaps control visible spacing remains unverified. Do not apply their suggested bindings yet. Further inactive-property filtering requires a separate proposal and approval. Local bridge marker is now 1.3.0+dev.20261106.2.

Auto-gap follow-up approved and implemented: the screenshot confirms Auto spacing, so the retained 16px itemSpacing is inactive. QA now skips itemSpacing when primaryAxisAlignItems is SPACE_BETWEEN, while retaining padding, nested fixed gaps, and fixed-gap detection after changing back. Runtime regression failed before the fix and passed afterward, including stale-approval rejection. Full suite 136/136 passes; whitespace check passes. Bridge build: 1.3.0+dev.20261106.3. Reopening the plugin and a fresh read-only live audit are pending. No component bindings were changed.

- [ ] Check my design system.
- [ ] Set up a new design system.
- [ ] Build a token showcase.
- [ ] Document a component.
- [ ] Export DESIGN.md.
- [ ] Generate Figma Make guidelines.

For each flow, record the input, visible response, approval point, resulting artifact, and verification. Preview any proposed interface change before implementation. Obtain explicit approval before live writes. Use the disposable file and retain approved results for inspection. Respect each component's source design system. Distinguish observed motion data from documentation claims and unsupported timeline inspection.

### 6. Prepare the next release

**Status: 1.4.0 prepared locally; commit, push, and publication approved November 8.**

- [x] Record the short changelog and remaining limitations.
- [x] Prepare version/distribution updates under the user's release-preparation instruction.
- [x] Remove the development suffix and align all product surfaces to 1.4.0.
- [x] Run package, test, version, and plugin checks on the candidate.
- [x] Remove disposable experiment files and exclude generated documentation from releases.
- [x] Review the designer README and update decisions, project memory, and release records.
- [ ] Complete current-candidate live workflow verification.
- [x] Obtain explicit publishing approval before release.

## Verification already recorded

The original November 6 review recorded 133 passing test files and reproduced two logic gaps. Those approved fixes and later additions are covered by the current 146-file passing suite. Historical review evidence remains useful, but current readiness is defined by the status above and the 1.4.0 release record. Automated checks do not authorize new Figma writes or publication.

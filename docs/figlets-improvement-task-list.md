# Figlets improvement task list

Updated November 6, 2026.

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

**Status: pending approved changes and a current connection.**

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

**Status: pending workflow verification and release approval.**

- [ ] Present the final short changelog and remaining limitations.
- [ ] Obtain approval for version and distribution changes.
- [ ] Remove the local bridge build suffix `+dev.20261106.5` when preparing the approved release version.
- [ ] Run required package, test, and plugin checks on the approved release candidate.
- [ ] Obtain explicit publishing approval before release.

## Verification already recorded

The review recorded 133 passing test files, release-package verification, and plugin smoke checks. It also reproduced two logic gaps outside that coverage. No new implementation, runtime restart, or live Figma mutation is authorized by those results.

# Low-Agent Designer Smoke Test - 2026-06-24

Subagent: Newton (`019efaff-e879-7f12-a916-31e1a9a5a689`)

Mode: Designer smoke test, no repository edits by the subagent

Environment: `/Users/arash/Projects/figlets-mcp`; Figlets MCP tools available; active file known; bridge session reported as `figlets-mqs9xvld-9qf6x`, but Figma Bridge plugin was not connected/listening during live probes.

## Flows Tested

- Start / product entrypoint: Pass
- Vague prompt routing: Mostly pass
- Health check routing and bridge recovery: Pass with blocked live check
- Empty-file / empty-foundation-shell handling: Pass in workflow contract, not live-exercised because sync failed
- New foundation setup intake: Pass
- QA selected component / binding approval flow: Pass in routing and workflow contract, blocked live by bridge
- Component documentation/export flow: Partial pass
- DESIGN.md dry-run export: Pass
- Showcase workflow gating: Pass in workflow contract, not written

## Full Transcript

### Prompt: "start"

Tool flow: `figlets_start`

Response summary: Figlets showed a designer-facing capability menu only:

- Check my design system
- Set up a new design system
- Build a token showcase
- Document a component
- Export DESIGN.md

Pass notes: Good product framing, clear safety promise, no developer/repo options exposed.

### Prompt: "check my file"

Tool flow: `figlets_route_intent` -> `figlets_workflow_guide(health-check)` -> `sync_figma_data`

Response summary: Routed to `health-check`. The planned flow was `sync_figma_data` -> `detect_design_system` -> `audit_tokens` -> `inspect_ds_setup_gaps` -> `inspect_ds_token_gaps`, with optional `qa_binding_audit`.

Live result: `sync_figma_data` failed because the Figma Bridge plugin was not connected/listening.

Pass notes: Good routing. Bridge recovery message was clear and actionable.

Fail/block notes: Could not complete live health check, token audit, semantic setup gap inspection, or empty-file detection.

### Prompt: "set up a foundation"

Tool flow: `figlets_route_intent` -> `figlets_workflow_guide(new-ds-setup)`

Response summary: Routed to `new-ds-setup`. The designer response asked exactly one first intake question: "what should this design system be called?" It explicitly avoided drafting a palette, typography stack, grid defaults, or token names.

Pass notes: Strong behavior. The setup workflow correctly treats vague setup prompts as direction, not a complete spec. Intake order and one-question rule are visible.

### Prompt: "check this component"

Tool flow: `figlets_route_intent` -> `figlets_workflow_guide(qa-binding-audit)` -> `qa_binding_audit({ fix: false })`

Response summary: Routed to `qa-binding-audit`, not component docs. The workflow promised read-only inspection first, stable issue numbers, fixability buckets, and approval before `fix: true`.

Live result: `qa_binding_audit` failed because the Figma Bridge plugin was not connected/listening.

Pass notes: Good routing for "check" language. Approval boundary is clear.

Fail/block notes: Could not verify actual issue list, fixability grouping, or binding approval UX live.

### Prompt: "fix suggestions"

Tool flow: `figlets_route_intent`

Response summary: Returned a single-choice selection prompt with:

1. Check my design system
2. Build a token showcase
3. Export DESIGN.md

Pass notes: Good. It did not guess or apply anything. This is the right low-confidence behavior for a vague repair phrase.

Issue note: The choices omit "QA selected component" even though "fix suggestions" could plausibly mean binding suggestions after a component audit. Not a hard failure, but worth considering.

### Prompt: "export docs"

Tool flow: `figlets_route_intent` -> `figlets_workflow_guide(component-docs)`

Response summary: Routed to `component-docs`, with steps `inspect_component` -> draft guidance -> approve -> `generate_component_doc`.

Pass notes: Reasonable if "docs" means selected component documentation.

Issue note: "export docs" also sounds like `export-design-md`. Router picked component docs despite an export candidate being present. This may surprise designers asking for a handoff/export.

### Prompt: "export design.md"

Tool flow: `figlets_workflow_guide(export-design-md)` -> `export_design_md({ dry_run: true, skip_sync: true })`

Response summary: Dry-run export completed. No files were written. It reported:

- `written: false`
- `sync.attempted: false`
- existing snapshot path
- "Export dry run complete. No files were written."

Pass notes: Good dry-run behavior. Clear no-write confirmation.

### Prompt: "check this component"

Tool flow: `inspect_component`

Live result: Failed with 503: Figma plugin is not connected/listening. Returned active session id and noted `pluginRecentlySeen: false`.

Pass notes: Useful diagnostic detail.

Issue note: The raw 503 JSON is more technical than ideal for a designer-facing response. The agent should translate it into "Open the Figlets Bridge plugin in Figma Desktop, then retry."

### Prompt: "show my tokens"

Tool flow: `figlets_workflow_guide(build-showcase)`

Response summary: Workflow requires `sync_figma_data`, approval, then `build_ds_showcase`.

Pass notes: Correctly gated Figma writes behind approval. No destructive write attempted.

## Issues / Dead Ends

1. Bridge unavailable blocked all live Figma-dependent read flows.
   - Affected: health check, component inspection, QA binding audit, showcase readiness.
   - Tool messages were actionable, but some are too raw/technical for designers.

2. "export docs" routes to component documentation, not DESIGN.md export.
   - This may be acceptable, but "export" strongly hints at `export-design-md`.
   - Recommendation: consider selection prompt when both `component-docs` and `export-design-md` match.

3. "fix suggestions" ambiguity prompt excludes QA binding audit.
   - Designers may say this after seeing selected-layer suggestions.
   - Recommendation: include "Check/fix selected component bindings" when repair language is vague.

4. Empty-foundation behavior was only verified through workflow contract.
   - The health-check guide clearly says to detect empty design systems and ask setup/continue foundation.
   - Live verification was blocked by bridge disconnection.

## Recommendations

- Keep the current Designer Mode routing discipline. It stayed product-facing and avoided repo/developer options.
- Improve bridge failure presentation by wrapping raw 503/session details in a plain-language recovery message.
- Add an ambiguity prompt for "export docs" when both component docs and DESIGN.md export are plausible.
- Add QA binding audit as a candidate in vague "fix suggestions" prompts.
- Re-run this smoke with the Figlets Bridge plugin open in Figma Desktop to verify actual health-check findings, empty-file handling, QA issue lists, and component-doc inspection output.

---

# Low-Agent Designer Smoke Continuation - 2026-06-24

Subagent: Turing (`019efb02-633e-7542-a032-3fe612f3a02a`)

Date/time: June 24, 2026, about 21:01 CEST

Workspace: `/Users/arash/Projects/figlets-mcp`

Mode: Designer Mode only

Repo edits by subagent: none

Environment assumption: The previous bridge failure was due to the Figlets Bridge plugin not running. This continuation assumed it might now be running.

This smoke **complements** the first smoke. The first run found Figlets tools but blocked on the live Figma bridge. This continuation confirms the bridge path is now live.

## Continuation Flows Tested

| Flow | Result | Notes |
|---|---:|---|
| Figlets entrypoint | Pass | `figlets_start` available; returned designer menu and active file context. |
| Check my file | Pass with findings | Routed to `health-check`; live sync succeeded. |
| Bridge recovery | Pass | `sync_figma_data` completed and changed active file key to `local_mqsftk1q_cm6i1ygt`. |
| Detect design system | Pass | Found an empty foundation shell: 4 collections, 0 variables, 0 text styles, 0 effect styles. |
| Token audit | Pass | Correctly reported empty foundation shell, not ordinary token defects. |
| Semantic setup QA | Pass | Correctly said no semantic color layer exists yet and not to call semantic colors clean. |
| Token gap inspection | Pass with findings | Found 16 config-backed elevation gaps, but correctly led with empty-foundation-shell behavior. |
| Check this component | Pass | Routed to `qa-binding-audit`, not component docs. |
| QA binding audit | Pass with findings | Found 4 raw color fills; all `needsExistingToken`, 0 `fixableNow`; no write attempted. |
| Component doc inspection | Partial pass | Routed to `component-docs`; `inspect_component` succeeded, but selection was a frame, not a component, so generation was not appropriate. |
| Health check meta | Pass | `figlets_health_check` returned `ready` and confirmed workflow/approval boundaries. |

## Continuation Transcript

1. Designer prompt: "Start Figlets."

   Tool flow: `figlets_start`

   Result: Pass. Figlets returned the designer capability menu: Check my design system, Set up a new design system, Build a token showcase, Document a component, Export DESIGN.md.

2. Designer prompt: "Check my file."

   Tool flow: `figlets_route_intent` -> `figlets_workflow_guide`

   Result: Pass. Routed to `health-check`.

   Product response summary: Figlets would sync the file, detect design-system structure, audit token health, inspect semantic setup gaps, and inspect token-gap suggestions before any write.

3. Designer prompt: "Go."

   Tool flow: `sync_figma_data`

   Result: Pass. Live bridge sync completed.

   Live result: active file changed from `local_mqry4wuc_bsrwn5r2` to `local_mqsftk1q_cm6i1ygt`; config was created for the active file.

4. Designer prompt: "Keep checking."

   Tool flow: `detect_design_system`, `audit_tokens`, `inspect_ds_setup_gaps`, `inspect_ds_token_gaps`

   Result: Pass with expected empty-shell findings.

   Live result:

   - 4 foundation collections exist: Primitives, Typography, Spacing, Elevation.
   - 0 variables, 0 text styles, 0 effect styles.
   - State: `empty-foundation-shell`.
   - Semantic setup QA correctly said there is no semantic color layer yet.
   - Token gaps found 10 missing elevation variables and 6 missing elevation effect styles.
   - No foundation collection repair was needed because shell collections already exist.

   Pass note: Product behavior matched the hard rule: lead with empty-foundation-shell setup behavior before ordinary token repair.

5. Designer prompt: "Check this component."

   Tool flow: `figlets_route_intent` -> `figlets_workflow_guide` -> `qa_binding_audit`

   Result: Pass with findings.

   Live result:

   - Scope: selection.
   - File/page: `Untitled / Page 1`.
   - Selected count: 1.
   - Audited nodes: 3.
   - Violations: 4 color issues.
   - Fixability: 0 `fixableNow`, 4 `needsExistingToken`, 0 `needsDesignerDecision`.
   - Issues were raw fills on `Frame 1`, `Frame 2`, and `Ellipse 1`.

   Pass note: No `fix:true` apply was attempted because there were no fixable-now bindings.

6. Designer prompt: "Document this component."

   Tool flow: `figlets_route_intent` -> `figlets_workflow_guide` -> `inspect_component`

   Result: Partial pass.

   Live result:

   - `inspect_component` succeeded.
   - Selection was `Frame 1`, type `FRAME`, with child `Frame 2` and `Ellipse 1`.
   - It was not a Figma component/component set.

   Pass note: The workflow required inspection before write. Spec generation was not run because `generate_component_doc` is a Figma write and the selection did not appear to be a component.

7. Designer prompt: "Health check."

   Tool flow: `figlets_health_check`

   Result: Pass.

   Live result:

   - Status: `ready`.
   - Workflow sequence checks passed.
   - Approval boundary passed.
   - Bridge readiness was not disconnected.
   - Boundaries: read-only true, Figma mutation not allowed.

## Continuation Issues / Dead Ends

- The active file is an empty foundation shell. This is not a bridge failure; it is valid product state.
- `health-check` guide names additional flows and write tools, but this smoke intentionally stopped before writes.
- `component-docs` could not proceed to generation because the selected node was a frame, not a component/component set, and generation would mutate Figma.
- QA binding audit cannot fix current findings until matching design-system tokens exist.

## Continuation Verdict

The continuation confirms the bridge is now live and Figlets can perform read-only Figma-dependent designer workflows. The product correctly distinguishes environment readiness, empty-foundation-shell state, token gaps, setup gaps, and binding audit fixability. No destructive Figma writes or repository edits were performed.

---

# Full Designer E2E Smoke - 2026-06-24

Subagent: Archimedes (`019efb06-c4e8-7fe0-a0c5-1eb4f444592e`)

Date/time: June 24, 2026, about 21:10 CEST

Workspace: `/Users/arash/Projects/figlets-mcp`

Mode: Designer Mode only. No repository source files were edited by the subagent.

Figma state: Active file `local_mqsftk1q_cm6i1ygt`, file name `Untitled`, page `00 · Tokens`.

Safety check: Initial Figlets detection reported an empty foundation shell with 4 foundation collections, 0 variables, 0 local styles, and no design-system artifacts, so the file was treated as disposable/smoke-safe.

## E2E Flows Table

| Flow | Status | Result |
|---|---:|---|
| Entrypoint/menu | Pass | `figlets_start` returned the expected designer menu. |
| Health check | Pass | Synced, detected empty shell, audited tokens, inspected setup gaps and token gaps. |
| New design system setup | Pass | Intake, config creation, prepare preview, approval, Figma setup write, sync, and recheck completed. |
| Token showcase | Pass | Showcase built successfully with 6 sections and no binding warnings. |
| QA selected component audit | Partial | No selected component existed; page audit ran but was truncated and only found designer-decision fixes. |
| Document component | Partial | Blocked correctly because no component/component set was selected. |
| Export DESIGN.md | Pass | Dry-run completed, then export wrote `DESIGN.md`. |
| Bridge health | Pass | Bridge sync/readiness stayed healthy; no recovery path was needed. |
| Final recheck | Mostly pass | Final sync/detect/audit succeeded; final detailed gap outputs were truncated by host display, but earlier post-write checks were clean. |

## E2E Complete Transcript

1. Designer prompt: `check my file`

   Figlets routed to health check. `sync_figma_data` succeeded. `detect_design_system` found an empty foundation shell: 4 collections, 0 variables, 0 styles. `audit_tokens` found 0 variables. `inspect_ds_setup_gaps` reported no semantic layer yet. `inspect_ds_token_gaps` showed config-backed non-color gaps but recommended setup first.

2. Designer prompt: `set it up`

   Figlets routed this vague prompt back to the generic start/menu rather than setup.

3. Designer prompt: `new design system`

   Figlets routed to new design-system setup.

4. Intake answers, one short designer answer at a time:

   `Peach`

   `web`

   `8`

   `three`

   `intent`

   `WCAG`

   `blue #2563EB`

   `100-900`

   `standard`

   `Inter`

   `light and dark`

5. Config creation:

   First two `create_ds_config_from_intake` attempts asked for typography family fields even though nested font family values were supplied. A flatter typography shape succeeded and wrote the local config.

6. Prepare preview:

   `prepare_ds_config` returned `readyToBuild: true`, all semantic pairs passed WCAG, and preview/export paths were generated.

7. Approval prompt: `This will build all five design-system collections in Figma; proceed?`

   Designer prompt: `go`

   Exact write tool: `apply_ds_setup`

8. Setup verification:

   Post-write sync succeeded. Detection found 5 collections, 332 variables, 15 text styles, and 6 effect styles. Token audit found 0 unaliased or partially unaliased variables. Setup gaps were clean. Token gaps were clean.

9. Designer prompt: `build showcase`

   Figlets routed to build-showcase. Pre-write sync succeeded.

10. Approval prompt: `This will write showcase frames to the token page. Ready?`

    Designer prompt: `go`

    Exact write tool: `build_ds_showcase`

11. Showcase verification:

    Build succeeded with sections: Light Semantics, Dark Semantics, Typography, Spacing, Elevation, Scrims. Binding warnings were empty. Post-build sync succeeded.

12. Designer prompt: `check this`

    Figlets routed to QA binding audit. Read-only `qa_binding_audit` ran with no selection, so it audited the page. It checked 2500 nodes, truncated at `MAX_NODES`, and found 38 color findings. `fixableNow` was 0; all findings required designer decisions, so no fix write was applied.

13. Designer prompt: `document this`

    Figlets routed to component docs. `inspect_component` returned: no nodes are currently selected in Figma. This correctly blocked documentation generation.

14. Designer prompt: `export design.md`

    Figlets routed to export. `export_design_md` dry-run succeeded and reported no file write. Then `export_design_md` write succeeded and exported to `/Users/arash/Projects/figlets-mcp/.local/local_mqsftk1q_cm6i1ygt/DESIGN.md`.

15. Final recheck:

    Final sync, detection, and token audit succeeded. The file still had 5 collections, 332 variables, 15 text styles, and 6 effect styles. Audit still showed 0 unaliased and 0 partially unaliased variables.

## E2E Writes Performed

| Write | Type | Approval | Result |
|---|---|---|---|
| `create_ds_config_from_intake` | Local Figlets config | Intake completed | Wrote config under `.local/local_mqsftk1q_cm6i1ygt`. |
| `apply_ds_setup` | Figma write | Designer answered `go` | Created collections, variables, text styles, and effect styles. |
| `build_ds_showcase` | Figma write | Designer answered `go` | Rendered 6 showcase sections on `00 · Tokens`. |
| `export_design_md` | Local export write | Dry-run completed first | Wrote `DESIGN.md` to the local Figlets export path. |

No QA fixes were applied. No component documentation was generated. No repository source files were edited.

## E2E Issues And Dead Ends

- The vague prompt `set it up` routed to the generic menu instead of new design-system setup.
- `create_ds_config_from_intake` rejected nested typography family input twice; a flatter typography payload succeeded.
- QA audit was blocked from a clean component-level repair path because nothing was selected. Page-scope audit was truncated and had 0 safe `fixableNow` repairs.
- Component docs correctly blocked because no component or component set was selected.
- Export dry-run/write reported 67 config refresh changes and skipped one brand ramp because the brand had no explicit anchor step.
- Final detailed setup/token-gap/health outputs were partially truncated by the host display, though final sync/detect/audit succeeded and the earlier post-setup gap checks were clean.

## E2E Verdict

Core Figlets designer E2E passed from an empty disposable Figma shell: entrypoint, health check, setup, preview, approved Figma build, showcase build, export dry-run/write, and post-write verification all worked.

Selection-dependent flows were partial rather than failed: QA and component docs need an actual selected component/component set to complete end to end.

---

# Selection-Dependent Flow Completion - 2026-06-24

Tester: Codex main session

Context: Arash selected the remaining target in Figma after the prior E2E run. The selected item was initially described as a frame, but Figlets inspection reported it as a Figma `COMPONENT` named `State=Sold Out`.

## Selection Flow Results

| Flow | Status | Result |
|---|---:|---|
| Selected QA audit routing | Pass | `check this` routed to `qa-binding-audit`. |
| Selected QA read-only audit | Pass | Audited 9 nodes, found 8 numbered designer-decision findings, no truncation. |
| QA approved suggestion apply | Pass | Applied all 8 approved bindings with 0 failures. |
| QA re-audit | Pass | Re-audit returned 0 violations. |
| Component docs routing | Pass | `document this` routed to `component-docs`. |
| Component inspection | Pass | `inspect_component` succeeded and returned selected `COMPONENT` `State=Sold Out`. |
| Component doc generation | Fail | `generate_component_doc` failed on a selected variant component; fallback path is blocked by a schema/runtime mismatch. |

## Selection Flow Transcript

1. Designer prompt: `check this`

   Tool flow: `figlets_route_intent`

   Result: Pass. Routed to `qa-binding-audit` with read-only first behavior and approval-required writes.

2. Designer prompt: `audit it`

   Tool flow: `qa_binding_audit({ fix: false, max_nodes: 500 })`

   Result: Pass. Live selected-scope audit completed:

   - File/page: `Untitled / Page 1`
   - Selected count: 1
   - Audited nodes: 9
   - Truncated: false
   - Violations: 8
   - By type: 3 color, 4 spacing, 1 typography
   - Fixability: 0 `fixableNow`, 0 `needsExistingToken`, 8 `needsDesignerDecision`, 0 `unsupported`

   Findings were stable-numbered and included candidates/facts:

   1. `Sold Out Badge` fill: raw `rgb(229,33,33)`, raw suggestion `color/bg/muted`, better visible recommendation from candidates/facts: `color/fill/danger`.
   2. `Sold Out Badge` top padding: `6px` -> `space/component/xs`.
   3. `Sold Out Badge` bottom padding: `6px` -> `space/component/xs`.
   4. `Sold Out Badge` left padding: `10px` -> `space/component/sm`.
   5. `Sold Out Badge` right padding: `10px` -> `space/component/sm`.
   6. `SOLD OUT` text fill: raw white, better visible recommendation following surface: `color/text/on-danger`.
   7. `SOLD OUT` text style: raw `10px Inter Semi Bold`, better visible recommendation: `type/label/sm`.
   8. `Price` text fill: raw `rgb(158,158,158)`, better visible recommendation: `color/text/disabled`.

3. Designer prompt: `apply these`

   Tool flow: `qa_binding_audit({ approved_suggestions: [...] })`

   Result: Pass. Applied all 8 designer-decision bindings:

   - Issue 1 -> `color/fill/danger`
   - Issues 2-3 -> `space/component/xs`
   - Issues 4-5 -> `space/component/sm`
   - Issue 6 -> `color/text/on-danger`
   - Issue 7 -> `type/label/sm`
   - Issue 8 -> `color/text/disabled`

   Apply result: `fixedCount: 8`, `failedCount: 0`.

4. Designer prompt: `check again`

   Tool flow: `qa_binding_audit({ fix: false, max_nodes: 500 })`

   Result: Pass. Re-audit returned:

   - Audited nodes: 9
   - Violations: 0
   - `fixableNow`: 0
   - `needsExistingToken`: 0
   - `needsDesignerDecision`: 0
   - `unsupported`: 0

5. Designer prompt: `document this`

   Tool flow: `figlets_route_intent` -> `inspect_component`

   Result: Partial pass. Router selected `component-docs`, and `inspect_component` succeeded. The selected node was:

   - id: `15:67`
   - type: `COMPONENT`
   - name: `State=Sold Out`
   - children include `Image`, `Sold Out Badge`, `SOLD OUT`, `Content`, `Title`, `Description`, `_spacer`, and `Price`.

6. Designer prompt: `build the docs`

   Tool flow: `generate_component_doc({ component_name: "State=Sold Out", ... })`

   Result: Fail. The tool returned:

   ```text
   Plugin error: in get_componentPropertyDefinitions: Can only get component property definitions of a component set or non-variant component
   ```

   Interpretation: `State=Sold Out` is a selected variant component. The generator tries to read component property definitions in a way that fails for variant components.

7. Designer prompt: `try the set`

   Tool flow: `generate_component_doc({ component_name: "Card-C", ... })`

   Result: Fail, but usefully guarded. The tool returned:

   ```text
   Error: Figma selection does not match component_name. Selected COMPONENT "State=Sold Out" on Untitled / Page 1, but component_name was "Card-C". Select the intended component or omit component_name to document the live selection.
   ```

8. Designer prompt: `use selection`

   Tool flow: `generate_component_doc` without `component_name`

   Result: Fail. The MCP schema rejected the runtime-recommended fallback:

   ```text
   MCP error -32602: Input validation error: Invalid arguments for tool generate_component_doc:
   component_name: expected string, received undefined
   ```

## Selection Flow Verdict

QA selected-component/frame binding is now genuinely end to end: read-only audit, numbered findings, designer-decision apply with alternate visible recommendations, and clean re-audit all passed.

Component documentation is still not end to end for the selected variant component. The blocker is a Figlets product/tool bug:

- Runtime cannot generate docs for a selected variant component because it calls `get_componentPropertyDefinitions` where Figma only allows component sets or non-variant components.
- The error message suggests omitting `component_name` to document live selection, but the MCP schema requires `component_name`, so the suggested recovery path cannot be called.

The component-doc flow needs a fix before this E2E can be marked fully passing.

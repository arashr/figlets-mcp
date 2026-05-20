# Bulk Repair API Implementation Plan

## Status

Planning artifact and roadmap for bulk-repair API work. This document is intentionally explicit so a less capable agent can continue the feature without inventing new product rules.

Current status as of 2026-05-20:

- Branch: `main`
- Latest checkpoint before the current commit: color semantic bulk repair planner implemented through Phase 2; non-color token planner/dry-run and narrow radius/border-width/spacing-semantics/typography/elevation apply slices are implemented in local work.
- Phase 0 is complete: agents are taught that structured bulk updates are Figlets scope and missing planner/apply surfaces are product gaps.
- Phase 1A is complete: missing icon roles for complete bg+foreground families can become apply-ready when Figlets derives accessible aliases.
- Phase 1B is complete: passive border/outline/stroke repairs are exposed through `repairPlan.optionalApplyInput` when optional, including DS-wide suppressed cases and single advisory planned repairs.
- Phase 1C is complete: missing focus-border foundation roles become apply-ready only when safe aliases can be derived or config provides aliases.
- Phase 1D is complete: missing backgrounds remain designer decisions and are surfaced in `missingCapabilityNotes`, not apply payloads.
- Phase 2 is complete for `inspect_ds_setup_gaps`: `repairPlan` has stable required, optional, missing-capability, and designer-presentation channels.
- Phase 3A is complete: `inspect_ds_token_gaps` is a read-only config-backed non-color token-gap planner.
- Phase 3B is complete: `update_ds_tokens({ dry_run: true })` previews missing variables/styles and type mismatches without Figma writes.
- Phase 3C/3D has expanded another slice: the approved apply path now covers `radius`, `border-width`, `spacing-semantics`, `typography-variables`, `typography-styles`, `elevation-variables`, and `elevation-styles`. Semantic spacing apply resolves primitive-spacing aliases when the primitive variable exists and maps responsive config values onto existing Spacing-collection modes without creating modes. Typography variable apply targets the existing Typography collection only; `typography-styles` targets config-derived local text styles only, preserves existing style IDs, loads fonts before style mutation, and requires matching typography variables. Elevation variable apply targets the existing Elevation collection only; `elevation-styles` targets only local effect styles named `elevation/0` through `elevation/5`, preserving existing style IDs and binding effect fields where prerequisite variables exist. Broad `typography` and broad `elevation` remain rejected as direct apply scope.
- Latest local verification after the `typography-styles` slice: focused planner/server/bridge/runtime/integration tests pass. The automated E2E-style token flow is `tests/integration/token-gap-planner-flow.test.js`, now exercising the spacing-semantics, typography-variables, typography-styles, elevation-variables, and elevation-styles apply slices end to end.
- Follow-up observability slice: `update_ds_tokens` bridge apply results now include changed-variable details for variables the tool creates or updates, including variable id, scopes, collection, mode names, and alias target names when the written value is a variable alias. This is intentionally not a broad inventory/debug API.
- Live disposable-file validation confirmed `elevation-variables` end to end after the file was prepared with an existing `5. Elevation` collection and missing elevation semantic variables: inspect found 10 missing variables + 6 missing effect styles, apply created the 10 variables only, final reinspect showed 0 missing variables and 6 remaining effect-style gaps, no styles were created/refreshed, and broad `elevation` apply stayed unsupported. A separate live observability check confirmed changed-variable report items include id, scopes, mode names, and alias target names through the real `update_ds_tokens` bridge path.
- Live disposable-file validation confirmed `elevation-styles` against the already-complete disposable file by refreshing existing local effect styles in place. Direct apply through the current repo handler refreshed `elevation/0` through `elevation/5`, preserved style IDs, reported bound key-shadow fields `color`, `offsetY`, and `radius`, reported bound ambient fields `color` and `radius`, emitted no `bindingWarnings`, and final sync/reinspect showed no broad elevation gaps. The connected MCP tool host was stale and still rejected `elevation-styles`; restart/reconnect the MCP host before treating that as a repo regression.
- Post-port-change live check: after reloading the Figma Bridge plugin, the receiver/plugin path worked on `http://localhost:17337`, and direct current-repo handlers successfully synced and refreshed `elevation-styles` through that port. The currently loaded `mcp__figlets__` namespace still failed `sync_figma_data`; process inspection did not show a standalone `figlets-mcp` process to restart from the shell, so this remains an app-managed stale MCP host/session caveat rather than a bridge or repo failure.
- Setup-path hardening after live dummy-file feedback: `apply_ds_setup` now writes numeric fallback values into setup-created `elevation/<key>/{offset-y,radius}` variables when primitive shadow aliases are unavailable, avoiding Figma default `0` values. It also binds setup-created shadow styles through Figma's documented `figma.variables.setBoundVariableForEffect(...)` helper for key `offsetY`/`radius` and ambient `radius` where variables are available. Live validation confirmed `elevation/1` exposes bound variables for `color`, `radius`, and `offsetY`. This does not enable broad elevation/style apply in `update_ds_tokens`.

Validation finding on 2026-05-19: a live Figma Desktop bridge run on a disposable file confirmed the planner, dry-run, and bridge apply behavior for `radius`, `border-width`, `spacing-semantics`, and `typography-variables`. It also found that the MCP `update_ds_tokens` apply call returned `{}` because the server registration stringified the async `handleUpdateDsTokens(...)` Promise without awaiting it. Fixed by awaiting `handleUpdateDsTokens(args || {})` in `packages/figlets-mcp-server/src/index.js` and adding `tests/server/update-ds-tokens-mcp-callback.test.js` to assert the registered MCP tool returns the resolved apply result.

Follow-up live validation on 2026-05-19: rerunning the disposable Figma file from scratch confirmed the product behavior after the fix. The bridge created `space/border/default`, `space/radius/md`, `space/component/md`, and `type/body/md/{size,line-height,weight,tracking,family}` in the correct collections; final reinspect showed zero missing variables and only the broad `type/body/md` text-style gap remaining; aliases, no-text-style, and no-mode-creation expectations held. The connected Codex MCP session still returned `{}` for apply despite the checked-out repo being fixed at `cc7362e`, which points to a stale MCP server process in that agent session. Restart/reconnect the Figlets MCP server before re-testing the MCP callback live; do not chase this as a repo regression unless it reproduces after restart. Supported-runtime `npm test` passed 69/69.

Do not treat this document as a public designer guide. It is an internal implementation plan.

## Product Goal

Figlets should let designers talk naturally to an MCP-speaking agent while deterministic Figlets tools do the real design-system work. Agents should not need to write local scripts in tight situations when the requested operation is deterministic enough to express as structured arguments.

The target behavior is:

1. The agent runs the Figlets workflow.
2. Figlets emits a read-only inspection result with agent-actionable repair payloads.
3. The agent explains the exact proposed changes in plain language.
4. The designer approves all or a subset of the payload.
5. The agent calls the approved Figlets mutation tool with arguments copied or filtered from the Figlets output.
6. The agent reruns read-only QA to verify.

The target is not a generic arbitrary Figma automation API. Do not recreate Figma native MCP. Build narrow, product-owned, design-system-safe operations.

## Non-Negotiable Guardrails

- Designer Mode must call `figlets_start` first.
- Concrete designer goals should route through `figlets_route_intent` and `figlets_workflow_guide`.
- Designer-facing reviews, audits, setup-gap checks, contrast checks, token math, and approved repairs must use Figlets workflows and named Figlets tools.
- Do not write custom scripts over `.local/<fileKey>/figma-data.json`, MCP transcripts, `tool-results`, local snapshots, raw Figma APIs, or generic Figma tools for designer-facing repair planning.
- If Figlets cannot plan or apply a requested bulk repair, the agent must say that the missing planner/apply surface is a Figlets product/tool gap.
- Do not say "the gaps cannot be fixed" as a dead end when a deterministic Figlets feature can be added.
- Figma writes require explicit designer approval.
- Suggestion-time accessibility checks belong in the planner for Figlets-generated suggestions. Do not block explicitly approved designer payloads inside the apply tool unless the payload is malformed or unsafe to execute.
- Do not add direct `../../../figlets-core` imports in MCP server files. Use `packages/figlets-mcp-server/src/figlets-core.js`.
- Do not add broad arbitrary mutation payloads such as "set any node property by id". Keep payloads domain-specific.

## Current Bulk-Capable Surfaces

Use this table before adding anything new.

| Surface | Current job | Mutates Figma | Current limits |
|---|---|---:|---|
| `inspect_ds_setup_gaps` | Read-only semantic color setup QA, contrast QA, missing role planning, standardized `repairPlan.applyInput`, `repairPlan.optionalApplyInput`, `repairPlan.missingCapabilityNotes`, and `repairPlan.designerPresentation` generation | No | Focused on color semantics. Does not cover typography, spacing, radius, border-width, or elevation completeness. |
| `apply_ds_setup_repairs` | Applies approved missing foreground repairs, alias updates, and missing color role creations including icon, passive border/outline/stroke, and focus-border roles | Yes | Color-only. It applies explicit approved payloads and does not independently discover or plan repairs. |
| `inspect_ds_token_gaps` | Read-only config-backed non-color token-gap planner. Emits `repairPlan.previewInput`, filtered `repairPlan.applyInput`, missing-capability notes, and designer presentation | No | Does not infer tokens from page usage. Preview supports broader non-color categories than apply. |
| `update_ds_tokens` | Dry-run preview for config-backed non-color completion; approved apply for `radius`, `border-width`, `spacing-semantics`, `typography-variables`, `typography-styles`, `elevation-variables`, and `elevation-styles` only | Optional | Apply support is intentionally limited to Spacing collection FLOAT variables `space/radius/*`, `space/border/*`, responsive `space/<semantic>/*` (aliasing primitive spacing when present), Typography collection variables `type/<role>/{size,line-height,weight,tracking,family}`, local text styles derived from `DS.typography.scale`, Elevation collection FLOAT variables `elevation/<key>/{offset-y,radius}`, and local effect styles `elevation/0..5`. No mode creation, prune/delete apply, broad typography/elevation apply, primitive typography/shadow apply, or arbitrary style mutation. |
| `update_ds_primitives` | Updates config-backed primitive color and primitive spacing values, and color semantic aliases, preserving variable IDs | Yes | Name is narrow and implementation assumes primitive collection except `color-semantics`. It does not handle typography, semantic spacing/radius/border-width, or elevation. |
| `qa_binding_audit` | Audits selected/page nodes for raw unbound values and can fix high-confidence bindings | Optional | Binds to existing variables/styles only. It does not create missing tokens. Typography suggestions are conservative and may not be fixed automatically. |
| `apply_ds_setup` | Creates or merges the configured design-system collections and styles | Yes | Broad setup tool, not a narrow repair planner. It has no dry-run merge-only contract. Use carefully after designer approval. |

## Recommended Implementation Order

Implement in these slices. Do not jump to the non-color token system before finishing the color-role repair slice, because that is the direct class of bug the user saw.

Current roadmap:

1. **Done:** Phase 0 through Phase 2 for color semantic setup repairs.
2. **Done:** Phase 3A - add a read-only `inspect_ds_token_gaps` planner for config-backed non-color token gaps.
3. **Done:** Phase 3B - add `update_ds_tokens` dry-run preview.
4. **Started:** Phase 3C/3D - approved apply support exists for `radius`, `border-width`, `spacing-semantics`, `typography-variables`, `typography-styles`, `elevation-variables`, and `elevation-styles`.
5. **Next:** Continue expanding one category slice at a time, keeping existing behavior and write boundaries covered by tests. Broad typography text-style apply still requires explicit font-loading/style-refresh strategy notes plus tests before implementation. Primitive shadow and primitive typography apply remain unsupported.
6. **Future product fix after this feature plan:** If token completion finds missing foundation setup, such as a missing Spacing collection, Figlets should not hard-stop with only a "run setup first" message. It should surface a designer-approved partial setup repair path that can create or merge the required foundation in the same guided run unless the designer dismisses it.

For Phase 3, start with read-only planning and missing-capability reporting. Do not begin by creating broad mutation support.

### Phase 0 - Make Existing Bulk Capacity Hard To Miss (Done)

Goal: Less capable agents should understand what Figlets can already do before any new runtime capability lands.

Files to inspect first:

- `packages/figlets-mcp-server/src/agent-interface/workflows.js`
- `packages/figlets-mcp-server/src/tools/agent-interface.js`
- `packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js`
- `packages/figlets-mcp-server/src/tools/update-ds-primitives.js`
- `packages/figlets-adapter/AGENTS.md`
- `packages/figlets-adapter/CLAUDE.md`
- `plugins/claude-code/figlets/skills/figlets-designer/SKILL.md`
- `plugins/codex/figlets/skills/figlets-designer/SKILL.md`

Tasks:

1. Add a concise bulk capability map to the Agent Interface payload.
   - Include `inspect_ds_setup_gaps.repairPlan.applyInput -> apply_ds_setup_repairs`.
   - Include `update_ds_primitives` with categories `color`, `spacing`, and `color-semantics`.
   - Include `qa_binding_audit({ fix: true })` for high-confidence binding fixes.
   - State that missing planner/apply surfaces are product gaps, not impossible tasks.

2. Fix stale adapter wording for `update_ds_primitives`.
   - Current adapter docs may mention only `color` and `spacing`.
   - The code supports `color-semantics` too.
   - Update root and plugin docs if they repeat the stale wording.

3. Add tests that less-capable-agent guidance survives future edits.
   - `tests/server/agent-interface-tool.test.js`
   - `tests/docs/root-agent-entrypoint.test.js`
   - `tests/plugins/claude-code-plugin.test.js`
   - `tests/plugins/codex-plugin.test.js`

Acceptance criteria:

- Agent Interface output names the existing bulk-capable surfaces.
- Adapter/plugin docs explicitly tell agents to use structured payloads instead of scripts.
- Tests fail if `update_ds_primitives` is described without `color-semantics`.

Suggested verification:

```sh
node tests/server/agent-interface-tool.test.js
node tests/docs/root-agent-entrypoint.test.js
node tests/plugins/claude-code-plugin.test.js
node tests/plugins/codex-plugin.test.js
git diff --check
```

### Phase 1 - Finish Color Semantic Bulk Repairs (Done)

Goal: Color semantic gaps should not dead-end when Figlets can safely plan the repair.

Relevant files:

- `packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js`
- `packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js`
- `packages/figlets-mcp-server/src/index.js`
- `packages/figma-bridge-plugin/code.js`
- `tests/server/inspect-ds-setup-gaps-tool.test.js`
- `tests/server/inspect-ds-setup-gaps-qa.test.js`
- `tests/server/inspect-ds-setup-gaps-naming-variants.test.js`
- `tests/server/apply-ds-setup-repairs-tool.test.js`
- `tests/server/check-setup-gaps-cli.test.js`

#### Phase 1A - Keep Icon Role Repairs Stable (Done)

This is already in progress. Do not regress it.

Expected behavior:

- A complete semantic family with background + foreground but no icon role should produce a high-confidence `missingSemanticRoles` item.
- If Figlets can derive aliases that pass WCAG non-text contrast at 3:1, the item should include `plannedRoleRepair`.
- `_buildRepairPlan(result).applyInput.roleRepairs` should include the approved apply shape:

```js
{
  name: "color/icon/success",
  role: "icon",
  aliases: {
    Light: "color/green/700",
    Dark: "color/green/200"
  }
}
```

Required tests:

- Universal missing icons are not suppressed as DS-wide advisories.
- Planned icon aliases carry contrast metadata for display.
- Inaccessible icon aliases remain findings but are not apply-ready.
- `repairPlan.applyInput.roleRepairs` includes all high-confidence planned icon repairs.

#### Phase 1B - Expose Optional DS-Wide Border/Outline/Stroke Bulk Creation (Done)

Problem:

Passive border/outline/stroke roles are intentionally optional. Today, when every complete semantic pair lacks a passive border-like role, Figlets may suppress this as a DS-wide convention. That is reasonable for an automatic health-check all-clear, but it leaves no structured path when the designer says "yes, create outline roles for all families."

Target behavior:

- Keep passive DS-wide absence out of the default high-confidence `repairPlan.applyInput`.
- Also expose a clearly optional bulk payload so the agent can say: "Figlets can create these outline roles if you want."
- The optional payload must still be deterministic and approval-gated.

Recommended output shape:

```js
repairPlan: {
  tool: "apply_ds_setup_repairs",
  approvalRequired: true,
  applyInput: {
    repairs: [],
    aliasUpdates: [],
    roleRepairs: []
  },
  optionalApplyInput: {
    repairs: [],
    aliasUpdates: [],
    roleRepairs: [
      {
        name: "color/outline/info",
        role: "border",
        aliases: {
          Light: "color/blue/200",
          Dark: "color/blue/800"
        }
      }
    ]
  },
  counts: {
    repairs: 0,
    aliasUpdates: 0,
    roleRepairs: 0,
    optionalRoleRepairs: 1,
    total: 0,
    optionalTotal: 1
  }
}
```

Implementation notes:

- Use the existing `_BORDER_FAMILIES = ["border", "outline", "stroke"]`.
- Preserve naming conventions with `_preferredFamilyForRole`.
- Use `_planMissingRoleRepair` for passive border aliases.
- Passive border aliases should continue to use standard passive ramp steps, not contrast search:
  - Light: nearest `200`
  - Dark: nearest `800`
- Do not mark optional DS-wide border repairs as high-confidence health issues by default.
- Add an `optional: true` or `repairTier: "optional"` marker to display-only findings if needed, but keep `apply_ds_setup_repairs` input clean.

Required tests:

- A DS with three or more complete pairs and zero border roles still reports suppressed passive border absence for health-check purposes.
- The same result includes `repairPlan.optionalApplyInput.roleRepairs` for those border roles.
- Optional role names preserve `outline` or `stroke` conventions when those are present in config or neighboring variables.
- Optional role aliases use passive ramp steps and do not include contrast metadata.
- Agents are instructed to ask a designer before applying `optionalApplyInput`.

Implemented note: optional passive role repairs now cover both DS-wide suppressed passive absence and single advisory passive `plannedRoleRepair` cases. This prevents agents from hand-assembling role repairs from nested findings.

#### Phase 1C - Add Apply-Ready Focus Border Repairs When Safe (Done)

Problem:

`foundationRoleFindings` can flag missing focus border roles, but those findings do not currently become an apply-ready payload.

Target behavior:

- If a DS already uses border/outline/stroke semantics and has no focus indicator role, Figlets should continue to flag the missing foundation role.
- When Figlets can derive a safe alias, add a `plannedRoleRepair` to the foundation finding.
- `_buildRepairPlan` should lift planned foundation role repairs into `repairPlan.applyInput.roleRepairs`.

Recommended planner function:

```js
function _planFoundationRoleRepair(finding, byName, colorVars, varsById, collections, options) {
  // returns null or:
  return {
    name: "color/outline/focus",
    role: "focus-border",
    aliases: {
      Light: "color/brand/500",
      Dark: "color/brand/400"
    },
    reason: "Focus border aliases were checked against the default surface/background where available."
  };
}
```

Deterministic alias strategy:

1. Prefer config-defined focus aliases if the active config already has a focus token row.
2. Otherwise pick the first available ramp in this order:
   - `color/brand`
   - `color/primary`
   - `color/accent`
   - `color/blue`
3. Use Light step `500` and Dark step `400`, or nearest available numeric step in that ramp.
4. If `color/surface/default`, `color/bg/default`, or `color/background/default` exists, verify non-text 3:1 contrast against that background in the matching mode.
5. If no adjacent background can be resolved, emit the finding but do not produce `plannedRoleRepair` unless the source was explicit config.

Reasoning:

- Focus rings are meaningful non-text indicators, so contrast applies when the adjacent background is known.
- If the planner cannot verify enough context, the agent should ask the designer rather than applying a guess.

Required tests:

- A DS with `color/border/*` roles but no focus role flags `focus-border`.
- If a brand/primary/accent/blue primitive ramp and default surface/background exist, the finding includes `plannedRoleRepair`.
- The repair is included in `repairPlan.applyInput.roleRepairs`.
- If no safe ramp or background exists, the finding remains high-confidence but has no apply payload.
- Naming convention is preserved: `color/outline/focus` for outline systems, `color/stroke/focus` for stroke systems, `color/border/focus` otherwise.

Implemented note: config-backed focus aliases are cleaned before they enter apply payloads, so descriptive fields like `note` do not leak into `aliases`.

#### Phase 1D - Keep Missing Backgrounds Conservative (Done)

Problem:

`inspect_ds_setup_gaps` can detect foreground/icon/border roles without a background role. Creating the missing background is more ambiguous than creating an icon from a foreground or a passive border from a background ramp.

Target behavior for 0 to 1:

- Do not bulk-create missing backgrounds by default.
- Add explicit `agentAction: "ask-designer"` and a clear reason.
- If config explicitly defines the background token and aliases, future work may add an apply payload. Do not infer background aliases only from foreground/icon tokens.

Required tests:

- Missing background findings never produce `plannedRoleRepair` without explicit config evidence.
- `repairPlan.agentInstruction` tells agents not to invent repairs when no payload exists.

### Phase 2 - Standardize Repair Plan Shape (Done For `inspect_ds_setup_gaps`)

Goal: Every read-only planner should make it obvious what is ready to apply, what is optional, and what remains a product gap.

Use this shape for `inspect_ds_setup_gaps` first, then reuse it for later tools.

```js
{
  message: "...",
  summary: {},
  repairPlan: {
    tool: "apply_ds_setup_repairs",
    approvalRequired: true,
    applyInput: {
      repairs: [],
      aliasUpdates: [],
      roleRepairs: []
    },
    optionalApplyInput: {
      repairs: [],
      aliasUpdates: [],
      roleRepairs: []
    },
    counts: {
      repairs: 0,
      aliasUpdates: 0,
      roleRepairs: 0,
      optionalRoleRepairs: 0,
      total: 0,
      optionalTotal: 0
    },
    designerSummary: "...",
    optionalDesignerSummary: "...",
    agentInstruction: "...",
    missingCapabilityNotes: []
  },
  topFindings: {}
}
```

Rules:

- `message`, `summary`, `repairPlan`, and `topFindings` must stay first in handler output.
- `applyInput` is for deterministic default repairs.
- `optionalApplyInput` is for convention-level or designer-choice repairs.
- `missingCapabilityNotes` is for findings that Figlets can name but cannot yet plan or apply.
- Do not make agents parse long arrays to construct payloads.

Tests:

- `Object.keys(handlerResult).slice(0, 4)` is exactly `["message", "summary", "repairPlan", "topFindings"]`.
- `repairPlan.applyInput` is always present.
- `repairPlan.optionalApplyInput` is always present once this phase lands.
- Empty plans still tell agents not to invent repairs.

Implemented note: `repairPlan.designerPresentation` was added as an extra designer-facing shape beyond the original Phase 2 contract. Agents should prefer it for summaries and avoid technical verification matrices unless the designer asks for exact details.

### Phase 3 - Add Config-Backed Token Completion For Non-Color Tokens (Next)

Recommended checkpointing:

- **Phase 3A:** Add read-only `inspect_ds_token_gaps` with stable planner output and no bridge writes.
- **Phase 3B:** Add `update_ds_tokens({ dry_run: true })` preview for a small supported category set.
- **Phase 3C:** Add approved apply support for those categories through the bridge. Slices landed so far: `radius`, `border-width`, `spacing-semantics`, `typography-variables`, `typography-styles`, `elevation-variables`, then `elevation-styles`.
- **Phase 3D:** Expand supported categories and decide the compatibility relationship with `update_ds_primitives`.

Deferred product concern from the `spacing-semantics` slice (do not silently drop):

- The narrow updater deliberately does **not** create Spacing-collection modes. Responsive semantic values are mapped onto modes that already exist (breakpoint-name match, then positional, then last value). A config with multiple breakpoints applied to a single-mode Spacing collection will collapse to the last value per the existing radius/border mode-invariant philosophy. Creating breakpoint modes is invasive setup-tool behavior and remains future product scope, ideally folded into the same guided partial-setup-repair path described under the Phase 3 boundary note. This is a known limitation, not a dead end.
- Semantic spacing aliases resolve against the primitives collection read-only. If the primitive variable is absent, the value is written as a raw FLOAT rather than failing — consistent with `apply_ds_setup`'s `spaceAlias` fallback.

Apply-result observability note:

- `update_ds_tokens` should return richer details only for variables it creates or updates. Changed-variable report items may include `id`, `scopes`, and `valuesByMode` with alias target names. Do not turn this into an arbitrary Figma inventory or mutation surface; read-only broad inventory still belongs in sync/inspect outputs, and designer-facing repair planning should remain planner-owned.

#### Typography And Elevation Apply Readiness Notes

Do not enable broad `typography`, `primitive-typography`, `primitive-shadow`, or `elevation` in `update_ds_tokens({ dry_run:false })` until the relevant strategy below is implemented and tested. These categories are higher-risk because they can touch text styles, effect styles, font loading, and multiple collections. The narrow `typography-variables` and `typography-styles` categories are the approved typography slices, and the narrow `elevation-variables` and `elevation-styles` categories are the approved elevation slices.

Typography should be split into two slices:

1. **Done:** **Typography variables only** via `typography-variables`.
   - Target the existing Typography collection.
   - Create/update only `type/<role>/{size,line-height,weight,tracking}` FLOAT variables and optionally `type/<role>/family` STRING variables when config and primitives give a safe source.
   - Preserve existing variable IDs and scopes.
   - Map responsive values onto existing Typography modes only; do not create modes in the token updater.
   - Report a missing Typography collection as `missing-foundation-collection` / future partial setup scope, not as a hard stop.
   - Do not create or refresh text styles in this slice.

2. **Done:** **Text style create/refresh** via `typography-styles`.
   - Uses the explicit font-loading strategy documented below.
   - Preserve existing text style IDs.
   - Load required fonts before touching any text-style properties.
   - If fonts are unavailable, report `fontLoadFailures` and leave the style unchanged.
   - Keep style creation/refresh separate enough that designers can approve it independently from variable creation.

#### Typography Text-Style Apply Strategy

The text-style apply slice uses the narrow category `typography-styles`, not broad `typography`. Broad `typography` remains preview/product-gap scope so variables and styles can stay independently reviewable.

`typography-styles` should:

- Target local text styles derived from `DS.typography.scale` and the configured text-style naming pattern only.
- Create missing local text styles and refresh existing local styles in place, preserving existing style IDs.
- Never create Typography collection variables, primitive typography variables, collection modes, or arbitrary text styles in this slice.
- Require the matching `type/<role>/{size,line-height,weight,tracking}` variables to exist before a style is created or refreshed.
- Bind style fields to existing typography variables where the Figma plugin API supports text-style variable binding. If a field cannot be bound by the current Figma API, write the config-backed raw fallback only when that fallback is explicitly part of the strategy and report the unbound field in structured output.
- Resolve the intended font family from `type/<role>/family` or the configured fallback family, then call `figma.loadFontAsync(...)` before touching style font properties.
- Load at least the target font family with a deterministic style derived from the configured weight. If the exact style is unavailable, report `fontLoadFailures` and leave that text style unchanged.
- Return created/refreshed style details, including style id, name, font family/style, bound variable fields, and skipped fields.
- Report missing prerequisites as structured failures such as `missingTypographyVariable`, `missingFontFamilyVariable`, `fontLoadFailures`, or `unsupportedTextStyleBinding`, rather than silently creating raw-only styles.

Implemented prerequisite behavior:

- If broad `typography` has variable gaps, `inspect_ds_token_gaps` should continue to put `typography-variables` in `repairPlan.applyInput`; it should not put `typography-styles` in apply input until the required typography variables exist or are included in the same approved apply call with deterministic ordering.
- Missing optional family variables may fall back to configured `DS.typography.families.sans` or `DS.naming.fontFamily`, but the fallback must be visible in the apply result.
- Font load failure must be per-style, not all-or-nothing. A failing style should remain unchanged while other styles with loadable fonts may still be created/refreshed.

Tests:

- Planner maps broad `typography` style gaps to `typography-styles` apply input only when required typography variables exist or are included via approved `typography-variables`.
- Server allow-list accepts `typography-styles` and still rejects broad `typography`.
- Bridge policy test confirms `typography-styles` uses `figma.loadFontAsync(...)`, does not create variables or modes, and does not touch effect styles.
- Runtime fake-Figma test verifies missing style creation, existing style refresh with ID preservation, font loading, style-level font failures, binding summaries, and structured warnings for unsupported text-style binding fields.
- Integration proxy covers inspect -> dry-run -> apply -> sync/reinspect, leaving broad `primitive-typography` still unsupported.

Elevation should also be split:

1. **Done:** **Elevation variables only** via `elevation-variables`.
   - Target the existing Elevation collection.
   - Create/update only generated `elevation/<key>/{offset-y,radius}` FLOAT variables.
   - Alias primitive `shadow/<level>/{offset-y,radius}` variables when they exist; otherwise use generated numeric FLOAT values.
   - Preserve existing variable IDs and scopes.
   - Map values onto existing Elevation modes only; do not create modes in the token updater.
   - Report a missing Elevation collection as `missing-foundation-collection` / future partial setup scope, not as a hard stop.
   - Do not create effect styles in this slice.

2. **Done:** **Effect style create/refresh** via `elevation-styles`.
   - Uses the explicit shadow-color/semantic-color strategy documented below.
   - Preserve existing effect style IDs.
   - Report unresolved color/alias prerequisites as `missingCapabilityNotes` or structured failures, not silent fallbacks.

#### Elevation Effect-Style Apply Strategy

The effect-style apply slice uses the narrow category `elevation-styles`, not broad `elevation`. Broad `elevation` remains preview/product-gap scope so variables and styles can be approved independently.

`elevation-styles` should:

- Target local effect styles named `elevation/0` through `elevation/5` only.
- Create missing styles and refresh existing local styles in place, preserving existing style IDs.
- Rebuild only the expected DROP_SHADOW effects for those named elevation styles.
- Bind key shadow `offsetY` and `radius` to existing `elevation/<key>/offset-y` and `elevation/<key>/radius` FLOAT variables using `figma.variables.setBoundVariableForEffect(...)` on effect objects before assigning `style.effects`.
- Bind key shadow color to `color/shadow/key` and ambient shadow color to `color/shadow/ambient` only when those semantic COLOR variables exist.
- Bind ambient shadow `radius` to existing `shadow/ambient/<level>/radius` FLOAT primitives when present.
- Treat `elevation/0` as an empty-effects style and never require shadow variables for it.
- Return created/refreshed style details, including style id, name, effect count, and a compact `boundVariables` summary when Figma exposes it.
- Report missing prerequisites as structured failures such as `missingElevationVariable`, `missingShadowColorVariable`, or `unsupportedEffectBinding`, rather than silently creating raw-only styles.

Prerequisite behavior:

- If required `elevation/<key>/{offset-y,radius}` variables are missing, `inspect_ds_token_gaps` should continue to put `elevation-variables` in `repairPlan.applyInput`; it should not put `elevation-styles` in apply input until the variable prerequisite is satisfied or explicitly included in the same approved apply call with deterministic ordering.
- Missing `color/shadow/key` or `color/shadow/ambient` should not block `elevation-styles` entirely, but the apply result must clearly report the missing color bindings so the designer knows the style is structurally created but not fully color-bound.
- Missing ambient radius primitives should report a binding warning for levels 2-5, not block key-shadow creation.

Tests required before implementation, now covered:

- Planner maps broad `elevation` style gaps to `elevation-styles` apply input only when elevation variables exist or are included via approved `elevation-variables`.
- Server allow-list accepts `elevation-styles` and still rejects broad `elevation`.
- Bridge policy test confirms `elevation-styles` uses `figma.variables.setBoundVariableForEffect(...)`, does not create variables or modes, and does not touch text styles.
- Runtime fake-Figma test verifies missing style creation, existing style refresh with ID preservation, effect binding summaries, and structured warnings for missing shadow color/ambient radius prerequisites.
- Integration proxy covers inspect -> dry-run -> apply -> sync/reinspect, leaving broad `elevation` gaps resolved only for styles and broad `primitive-shadow` still unsupported.

Dry-run reports for broad typography/elevation are useful, but apply must keep returning `unsupported-apply-category` product-gap notes for broad `typography` and broad `elevation`. `inspect_ds_token_gaps` may include `typography-variables` in `repairPlan.applyInput` when broad `typography` variable gaps are present, and `typography-styles` only once required typography variables already exist and text-style gaps remain. It may include `elevation-variables` in `repairPlan.applyInput` when broad `elevation` variable gaps are present, and `elevation-styles` only once required elevation variables already exist and style gaps remain.

Goal: If the active config defines tokens or styles that are missing from Figma, Figlets should expose a read-only plan and an approved apply path for creating/updating them.

Important boundary:

- This phase is config-backed only.
- Do not infer new typography, spacing, radius, border-width, or elevation tokens from arbitrary page usage in the first version.
- Raw page usage should continue through `qa_binding_audit`, which binds to existing tokens/styles.
- Missing foundation setup, such as an absent collection needed by a token category, is a product flow gap rather than a reason to abandon the designer. For the current phase, report the missing foundation clearly and do not silently create it inside a narrow token updater. After the current feature plan lands, add a guided partial setup repair that asks the designer to approve the required foundation creation/merge and then continues the token update in the same run.

#### Recommended New Tools

Add a read-only planner:

```text
inspect_ds_token_gaps
```

Add an apply/update tool:

```text
update_ds_tokens
```

Why new tools:

- `inspect_ds_setup_gaps` is color semantic/accessibility QA. Expanding it to all token domains will make the output muddy.
- `update_ds_primitives` is named and implemented around primitives. It should stay as a compatibility surface or thin wrapper.
- Non-color work touches multiple collections and styles, not just the Primitives collection.

#### `inspect_ds_token_gaps` Contract

Input:

```js
{
  config_path?: string,
  categories?: string[],
  include_existing_updates?: boolean
}
```

Default categories:

```js
[
  "primitive-color",
  "primitive-spacing",
  "primitive-typography",
  "primitive-shadow",
  "color-semantics",
  "spacing-semantics",
  "radius",
  "border-width",
  "typography",
  "elevation"
]
```

Output:

```js
{
  message: "Figlets found 18 config-backed token gaps.",
  summary: {
    missingVariableCount: 0,
    staleVariableCount: 0,
    missingStyleCount: 0,
    staleStyleCount: 0,
    unsupportedCategoryCount: 0
  },
  repairPlan: {
    tool: "update_ds_tokens",
    approvalRequired: true,
    previewInput: {
      config_path: "/path/design-system.config.js",
      categories: ["typography", "spacing-semantics", "radius"],
      create_missing: true,
      dry_run: true
    },
    applyInput: {
      config_path: "/path/design-system.config.js",
      categories: ["spacing-semantics", "radius", "typography-variables"],
      create_missing: true,
      dry_run: false
    },
    counts: {},
    agentInstruction: "Run update_ds_tokens with previewInput, show the dry-run report, ask for approval, then run applyInput for apply-supported categories only."
  },
  topFindings: {},
  tokenGaps: []
}
```

Notes:

- The planner can use the active Figma snapshot. It should not require the Figma bridge to be listening.
- The apply tool will require the bridge plugin.
- If a category is unsupported, list it under `missingCapabilityNotes`.

#### `update_ds_tokens` Contract

Input:

```js
{
  config_path: string,
  categories?: string[],
  create_missing?: boolean,
  dry_run?: boolean,
  prune?: {
    off_scale_color_steps?: boolean,
    unused_color_ramps?: boolean
  }
}
```

Output:

```js
{
  dryRun: true,
  categories: ["typography"],
  report: {
    typography: {
      entries: 12,
      wouldCreateVariables: [],
      createdVariables: [],
      wouldUpdateVariables: [],
      updatedVariables: [],
      wouldCreateStyles: [],
      createdStyles: [],
      wouldRefreshStyles: [],
      refreshedStyles: [],
      unmatched: [],
      typeMismatch: [],
      fontLoadFailures: []
    }
  },
  message: "typography: 4 would create, 8 unchanged",
  configPath: "/path/design-system.config.js"
}
```

Rules:

- `dry_run: true` must not mutate Figma.
- `create_missing: false` must report missing variables/styles but not create them.
- Existing variable and style IDs must be preserved.
- No deletes/prunes by default.
- Unknown categories must be reported, not silently ignored.
- If the bridge plugin does not advertise the new capability, return a clear reload message.

#### Category Definitions

Use this table exactly for the first version.

| Category | Source in config | Figma target | Create/update behavior |
|---|---|---|---|
| `primitive-color` | `DS.color.ramps` | `DS.collections.primitives` | Create/update `COLOR` variables like `color/blue/500`. Existing `update_ds_primitives` already covers this. |
| `primitive-spacing` | `DS.primitives.spacing` | `DS.collections.primitives` | Create/update `FLOAT` variables like `space/16`. Existing `update_ds_primitives` already covers this. |
| `primitive-typography` | `DS.typography.scale`, `DS.typography.families`, primitive generator output | `DS.collections.primitives` | Create/update `type/size/*`, `type/weight/*`, `type/tracking/*`, and `font/*` variables. |
| `primitive-shadow` | generated shadow primitive data | `DS.collections.primitives` | Create/update `shadow/*/offset-y`, `shadow/*/radius`, and ambient shadow primitive variables. |
| `color-semantics` | `DS.color.semantics` | `DS.collections.color` | Create/update semantic color variables and aliases. Existing `update_ds_primitives` has a special path for this. |
| `spacing-semantics` | `DS.spacing.semantic` | `DS.collections.spacing` | Create/update responsive `space/<semantic>` variables with aliases to primitive spacing when possible. |
| `radius` | `DS.spacing.radius` | `DS.collections.spacing` | Create/update `space/radius/<name>` variables. |
| `border-width` | `DS.spacing.border` | `DS.collections.spacing` | Create/update `space/border/<name>` variables. |
| `typography-variables` | `DS.typography.scale` and `DS.naming.fontFamily` | `DS.collections.typography` | Create/update `type/<role>/{size,line-height,weight,tracking,family}` variables only. No text styles. |
| `typography-styles` | `DS.typography.scale`, `DS.naming.textStyle`, and existing typography variables | local text styles | Create missing config-derived local text styles and refresh existing ones in place after font loading. No variable or mode creation. |
| `typography` | `DS.typography.scale` and `DS.naming.textStyle` | `DS.collections.typography` and local text styles | Dry-run umbrella for typography variables plus text-style gaps. Approved apply narrows to `typography-variables` first, then `typography-styles` once variables exist. Broad `typography` remains rejected for direct apply. |
| `elevation` | generated elevation scale and shadow semantic colors | `DS.collections.elevation` and local effect styles | Create/update `elevation/<key>/{offset-y,radius}` variables and create/refresh `elevation/*` effect styles. |

Implementation warning:

- `apply_ds_setup` already contains merge logic for some of these categories. Do not copy-paste large blocks blindly.
- Prefer extracting small helper functions inside `packages/figma-bridge-plugin/code.js` when practical.
- Keep the plugin compatible with the Figma sandbox. Avoid `??`, `?.`, `**`, top-level `await`, or Node-only APIs in plugin code.

#### Server Files For Phase 3

Add:

- `packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js`
- `packages/figlets-mcp-server/src/tools/update-ds-tokens.js`

Modify:

- `packages/figlets-mcp-server/src/index.js`
- `packages/figlets-mcp-server/src/tools/update-ds-primitives.js`
- `packages/figma-bridge-plugin/code.js`
- `packages/figlets-mcp-server/src/agent-interface/workflows.js`
- Adapter/plugin docs and tests

Compatibility:

- Keep `update_ds_primitives` working.
- Option A: leave `update_ds_primitives` as-is and document it as the legacy primitive/color-semantic updater.
- Option B: make it call the new `update_ds_tokens` handler with category mapping:
  - `color` -> `primitive-color`
  - `spacing` -> `primitive-spacing`
  - `color-semantics` -> `color-semantics`
- If choosing Option B, add regression tests that the old argument names and result shape remain stable.

#### Plugin Endpoint Work

Follow the existing bridge pattern:

- Add a receiver endpoint similar to `/request-update-primitives`.
- Add a plugin message type similar to `update-primitives`.
- Advertise the capability so stale bridge sessions return a helpful 409 instead of hanging.
- Implement `_updateDsTokens(payload)` in `packages/figma-bridge-plugin/code.js`.

Result fields should include:

- `dryRun`
- `categories`
- `unknownCategories`
- `report`
- `message`
- `error`

Each category report should include enough information for an agent to show a designer exactly what will happen.

#### Tests For Phase 3

MCP schema and handler tests:

- Add `tests/server/inspect-ds-token-gaps-tool.test.js`.
- Add `tests/server/update-ds-tokens-tool.test.js`.
- Verify missing `config_path` behavior.
- Verify config path guard behavior.
- Verify server forwards `dry_run`, `create_missing`, `categories`, and prune options.
- Mock receiver responses for success, 409, 503, 504, and unknown status.

Planner tests:

- Fixture config defines typography, spacing, radius, border width, and elevation.
- Fixture snapshot has some variables missing.
- `inspect_ds_token_gaps` returns top-level `message`, `summary`, `repairPlan`, `topFindings`.
- `repairPlan.previewInput` uses `dry_run: true`.
- `repairPlan.applyInput` uses `dry_run: false`.
- Unsupported categories become `missingCapabilityNotes`.

Compatibility tests:

- Existing `tests/server/update-ds-primitives-tool.test.js` must still pass.
- If wrapping old tool into new tool, assert old categories map correctly.

Agent Interface tests:

- `figlets_start` and `figlets_workflow_guide` mention `inspect_ds_token_gaps` / `update_ds_tokens` only after the tools are registered.
- Health-check guidance says non-color config-backed token completion is available when the planner emits a payload.
- Agents are still told not to write custom scripts.

E2E-style flow test:

- `tests/integration/token-gap-planner-flow.test.js` covers a config-backed setup with missing `radius`, `border-width`, `spacing-semantics`, `typography`, and `elevation` tokens/styles.
- The flow runs `inspect_ds_token_gaps`, then `update_ds_tokens` dry-run from `repairPlan.previewInput`, then an approved `update_ds_tokens({ dry_run:false })` call through a mocked bridge for `radius`, `border-width`, `spacing-semantics`, `typography-variables`, and `elevation-variables`.
- The test rewrites the synced snapshot to represent the approved variable bridge result, reruns `inspect_ds_token_gaps`, verifies `typography-styles` and `elevation-styles` become the next narrow apply categories, previews/applies them through a mocked bridge, then reinspects to confirm broad typography/elevation gaps are gone while broad direct apply remains unsupported.
- This is the available automated E2E proxy for Phase 3C. A live Figma Desktop designer-flow E2E should be added later, after the guided product flow exposes these tools to designers through `figlets_workflow_guide`.

Suggested verification:

```sh
node tests/integration/token-gap-planner-flow.test.js
node tests/server/inspect-ds-token-gaps-tool.test.js
node tests/server/update-ds-tokens-tool.test.js
node tests/server/update-ds-primitives-tool.test.js
node tests/server/agent-interface-tool.test.js
npm test
git diff --check
```

### Phase 4 - Improve `qa_binding_audit` Bulk Fix Clarity

Goal: Agents should know when Figlets can bulk-bind raw node properties and when token creation is needed first.

Current behavior:

- `qa_binding_audit` can bind high-confidence suggestions with `fix: true`.
- Color, spacing, radius, and border-width can be high confidence when exact variables exist.
- Typography prefers text styles or typography variables, but suggestions are conservative.
- The audit does not create missing variables/styles.

Tasks:

1. Make output distinguish:
   - `fixableNow`
   - `needsExistingToken`
   - `needsDesignerDecision`
   - `unsupported`

2. Add a top-level apply plan:

```js
repairPlan: {
  tool: "qa_binding_audit",
  approvalRequired: true,
  applyInput: { fix: true },
  counts: {
    fixableNow: 0,
    needsExistingToken: 0
  },
  agentInstruction: "Ask before applying fixable bindings. Do not create tokens from audit findings unless a Figlets token-completion planner exists."
}
```

3. Review typography confidence:
   - If a text node has an exact existing text style match by font family, weight, size, line height, and tracking, allow a high-confidence text style fix.
   - If the match is role/name-based only, keep it medium and do not auto-fix.
   - Add a reason string the agent can quote.

Tests:

- A raw fill with a semantic color variable is `fixableNow`.
- A raw spacing value with exact variable is `fixableNow`.
- A raw spacing value with no exact variable is `needsExistingToken`.
- A raw text node with an exact text style match is fixable if the implementation supports it.
- A role-only text style suggestion stays non-fixable.
- `fix: true` applies only `fixableNow`.

### Phase 5 - Update Workflow Guidance

Goal: The public designer experience should expose capability without tool-name dumping.

Files:

- `packages/figlets-mcp-server/src/agent-interface/workflows.js`
- `packages/figlets-mcp-server/src/tools/agent-interface.js`
- `AGENTS.md`
- `CLAUDE.md`
- `packages/figlets-adapter/AGENTS.md`
- `packages/figlets-adapter/CLAUDE.md`
- `plugins/claude-code/figlets/commands/start.md`
- `plugins/claude-code/figlets/skills/figlets-designer/SKILL.md`
- `plugins/codex/figlets/commands/start.md`
- `plugins/codex/figlets/skills/figlets-designer/SKILL.md`

Required guidance:

- For setup/health checks, agents should inspect first.
- If `repairPlan.applyInput` is non-empty, agents should ask approval and pass it to the named tool.
- If `repairPlan.optionalApplyInput` is non-empty, agents should present it as optional bulk creation.
- If a designer asks for non-color token completion, agents should use `inspect_ds_token_gaps` then `update_ds_tokens`.
- If only `qa_binding_audit` violations exist, agents should use `qa_binding_audit({ fix: true })` for fixable bindings after approval.
- If no Figlets payload exists, agents should say what Figlets cannot yet plan or apply.

Tests:

- Root and plugin instructions mention structured bulk payloads.
- Instructions forbid custom scripts over local snapshots/tool-results.
- Agent Interface tests pin the workflow order and approval boundaries.

### Phase 6 - End-To-End Verification Checklist

Run focused tests as each phase lands, then run full verification:

```sh
node tests/server/inspect-ds-setup-gaps-tool.test.js
node tests/server/inspect-ds-setup-gaps-qa.test.js
node tests/server/inspect-ds-setup-gaps-naming-variants.test.js
node tests/server/apply-ds-setup-repairs-tool.test.js
node tests/server/update-ds-primitives-tool.test.js
node tests/server/qa-binding-audit-tool.test.js
node tests/server/agent-interface-tool.test.js
node tests/docs/root-agent-entrypoint.test.js
node tests/plugins/claude-code-plugin.test.js
node tests/plugins/codex-plugin.test.js
npm test
git diff --check
```

If release packaging changes or plugin manifests change, also run:

```sh
npm run build:server-tarball
```

## Definition Of Done

The implementation is done when:

- Existing icon role bulk repair remains green.
- Passive DS-wide border/outline/stroke creation is available as optional structured payload, not a dead end.
- Safe focus-border repairs become apply-ready when Figlets can verify the alias.
- The repair plan shape clearly separates default, optional, and missing-capability cases.
- Non-color config-backed token completion has a read-only planner and an approved apply tool, or this is explicitly deferred with tests/docs that prevent agents from claiming impossible.
- `qa_binding_audit` tells agents what is fixable now versus what needs token creation.
- Agent Interface, root docs, and plugin skills explain these capabilities to less capable agents.
- Tests cover schemas, handler output order, apply payload shapes, docs, plugin instructions, and compatibility.
- `npm test` and `git diff --check` pass.

## Things Not To Do

- Do not implement a generic "run arbitrary Figma command" MCP tool.
- Do not let agents pass raw node IDs and arbitrary property names for broad mutation.
- Do not make `apply_ds_setup_repairs` silently accept unknown non-color repair shapes.
- Do not create missing typography/spacing/elevation tokens from page usage in the first version.
- Do not auto-apply optional border/outline/stroke conventions as health-check fixes.
- Do not hide long apply payloads only in nested arrays; keep agent-actionable payloads near the top.
- Do not weaken designer approval boundaries to make tests easier.

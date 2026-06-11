# Semantic Color Naming Flow Plan

## Status

Planning artifact for the post-BNN-53 semantic color naming cleanup. This document records the product findings and the implementation plan. It does not describe shipped runtime behavior yet.

## Problem

Figlets currently treats semantic color naming consolidation as a binary choice:

- surface-based
- role-based

That abstraction is too crude. It caused the agent-facing flow to ask designers to choose a global convention and then plan deprecations for tokens that may represent different contexts, such as normal danger text versus text on a filled danger surface.

The specific failure mode seen in manual smoke:

- `color/text/danger` and `color/text/on-fill-danger` were treated as duplicate naming competitors.
- A role-based plan kept `color/text/on-danger` as canonical.
- The designer correctly questioned what `on-*` means when the group is already `text`.

The corrected rule is:

`on-*` is only meaningful when the suffix names a background or surface context the foreground sits on.

For example, `color/text/on-surface` is clear if `surface` is a known background role. `color/text/on-fill-danger` is clear if `color/fill/danger` exists. `color/text/on-danger` is ambiguous unless this design system has a background role named `danger` and consistently uses `danger` as that context.

## Reference Models

Major design systems use several valid semantic color grammars. Figlets should recognize these patterns without forcing every file into one global ideology.

### Paired Context Model

Material-style systems define background/context roles and foreground roles that sit on them.

Examples:

- `primary` / `on-primary`
- `surface` / `on-surface`
- `error-container` / `on-error-container`

Reference: Material Web publishes supported system color tokens such as `primary`, `on-primary`, `surface`, `on-surface`, `error`, `on-error`, `error-container`, and `on-error-container`.
Source: https://raw.githubusercontent.com/material-components/material-web/main/tokens/_md-sys-color.scss

This model works when `on-*` points to a known background/context role.

### Element-First Model

Carbon-style systems group semantic tokens by the UI element or color function.

Examples:

- `text-error`
- `text-on-color`
- `icon-on-color`
- `support-error`
- `background-brand`

Reference: Carbon documents separate text/icon/background/support token families, including `text-on-color`, `text-error`, `icon-on-color`, and support status tokens.
Source: https://carbondesignsystem.com/elements/color/tokens/

This model separates "error-colored text" from "text on colored fill" rather than making both compete for one `on-error` role.

### Intent And Emphasis Model

Primer-style systems separate foreground/background/border roles and then add intent and emphasis.

Examples:

- `fgColor-danger`
- `bgColor-danger-muted`
- `bgColor-danger-emphasis`
- `borderColor-danger-muted`
- `fgColor-onEmphasis`

Reference: Primer color primitives separate foreground, background, and border color roles, with intent and emphasis variants.
Source: https://primer.style/product/primitives/color/

This model is useful when status colors have muted, emphasized, and interactive states.

### Component-Scoped Model

Many mature systems add component-level semantic tokens on top of one of the global models.

Examples:

- `button/danger/background/default`
- `button/danger/foreground/default`
- `banner/warning/background`
- `banner/warning/icon`

Figlets should not treat component-scoped tokens as global semantic duplicates unless they collide inside the same component role/context.

## Flow 1: Setting Up A New Design System

When a designer sets up a new design system, Figlets should offer viable naming structures instead of asking only for "surface-based" or "role-based."

### Setup Option A: Paired Contexts

Use when the designer thinks in surfaces/fills and foregrounds placed on those surfaces.

Example shape:

- `color/fill/danger`
- `color/text/on-fill-danger`
- `color/surface/default`
- `color/text/on-surface`

Pros:

- Strong contrast pairing model.
- Clear for Material-like systems.
- Easy to explain as "foreground on background."

Risks:

- Ambiguous if the suffix in `on-*` is not a real background/context role.
- Can become awkward for normal status text unless plain foreground roles also exist.

### Setup Option B: Element-First

Use when the designer thinks in terms of where the color is applied.

Example shape:

- `color/text/danger`
- `color/text/on-fill-danger`
- `color/icon/danger`
- `color/icon/on-fill-danger`
- `color/fill/danger`

Pros:

- Clear distinction between normal text/icon usage and text/icon on filled surfaces.
- Maps well to Figma variable grouping by role.
- Avoids overloaded shorthand such as `on-danger`.

Risks:

- Requires a clear context qualifier vocabulary such as `on-fill-*`, `on-surface-*`, or `inverse`.

### Setup Option C: Intent And Emphasis

Use when the system needs multiple strengths for each semantic intent.

Example shape:

- `color/text/danger`
- `color/fill/danger/subtle`
- `color/fill/danger/bold`
- `color/text/on-danger-bold`
- `color/border/danger/subtle`

Pros:

- Good for product systems with rich status states.
- Makes subtle, bold, muted, and emphasis variants explicit.

Risks:

- More tokens up front.
- Needs strong naming guidance so "bold" and "fill" are not confused with contexts.

### Setup Option D: Component-Scoped Layer

Use as an optional layer when component behavior cannot be expressed cleanly by global tokens alone.

Example shape:

- `color/button/danger/bg/default`
- `color/button/danger/text/default`
- `color/banner/warning/bg`

Pros:

- Avoids forcing highly specific component decisions into global roles.

Risks:

- Can grow quickly.
- Should not replace global semantic foundations unless the design system is intentionally component-token-first.

## Flow 2: Checking An Existing Design System

When checking an existing design system, Figlets should respect the current grammar. Naming advisories should be low priority unless the naming issue causes a concrete downstream problem, such as invalid contrast pairing, impossible background inference, or duplicate tokens with the same role/context/family.

The health-check should not start by asking the designer to choose a global convention. It should first infer the local grammar.

### Detection Axes

Classify each semantic color token by:

- Asset role: text, icon, foreground, fill, background, surface, border, outline, support, component.
- Context: plain, on-surface, on-fill, on-color, inverse, emphasis, container, unknown.
- Family or intent: danger, info, success, warning, brand, neutral, default.
- Strength: subtle, muted, bold, emphasis, strong, weak, container.
- Scope: global, component-scoped, state-scoped.
- Mode/value/alias equivalence: same values, same alias targets, or divergent values.
- Binding risk: whether the token is likely bound directly or used as an alias target when that data is available.

### What Counts As Odd

Flag as odd only when the token conflicts with the inferred grammar or has internally contradictory meaning.

High-confidence odd names:

- `color/bg/on-danger`: background tokens normally should not be named "on" something.
- `color/surface/on-info`: same issue as above.
- `color/text/on-danger` when `danger` is only used as a foreground/status text role and no background/context role named `danger` exists.
- Two tokens in the same role/context/family with the same purpose, such as `color/text/on-fill-danger` and `color/text/on-danger` when both clearly mean text on `color/fill/danger`.

Not odd by itself:

- `color/fill/danger` coexisting with `color/bg/danger`.
- `color/text/danger` coexisting with `color/text/on-fill-danger`.
- `color/icon/danger` coexisting with `color/icon/on-fill-danger`.
- A Material-like `color/text/on-danger` if `danger` is a known background/context role in that system.

### Confidence Levels

Figlets should classify naming diagnostics by confidence:

- `invalid-name`: structurally contradictory naming, such as background `on-*`.
- `ambiguous-name`: could be valid in one grammar but unclear in the detected system.
- `true-duplicate`: same role, context, family, and scope.
- `distinct-context`: similar family but different contexts; do not report as a conflict.
- `unknown-grammar`: not enough evidence to recommend consolidation.

Only `invalid-name` and high-confidence `true-duplicate` should appear near the top of health-check findings. `ambiguous-name` and `unknown-grammar` should be advisories.

### Fallback When Figlets Does Not Have The Grammar

If Figlets cannot infer the design system's grammar with enough confidence, it should not invent a consolidation plan.

Designer-facing behavior:

> Figlets sees mixed semantic color naming, but it cannot infer a dominant grammar confidently enough to recommend renames. I can show the current tokens grouped by role, context, family, and likely duplicates for review. No naming changes are ready to apply.

Tool behavior:

- Return a structured classification report.
- Do not emit rename/deprecation `applyInput`.
- Offer a designer decision path to declare the intended grammar.
- If the designer gives exact desired edits, route them through `plan_ds_figma_operations`.
- If the designer asks for product-specific migration, use the semantic naming planner only after it has enough grammar/context information.

## Product Changes Needed

### 1. Replace Binary Convention UX

Stop presenting "pick surface-based or role-based" as the main naming consolidation decision.

New language should ask which semantic color grammar the system intends to use:

- paired contexts
- element-first
- intent and emphasis
- component-scoped overlay
- custom/unknown

For existing systems, this should be inferred first, then shown as a low-priority advisory if uncertain.

### 2. Add A Semantic Grammar Classifier

Create a pure classifier shared by setup-gap inspection, naming consolidation, and setup intake.

Suggested output:

```js
{
  grammarCandidates: [
    { id: "element-first", confidence: 0.74, evidence: [...] },
    { id: "paired-context", confidence: 0.41, evidence: [...] }
  ],
  tokenClassifications: [
    {
      name: "color/text/on-fill-danger",
      assetRole: "text",
      context: "on-fill",
      family: "danger",
      scope: "global",
      diagnostic: "distinct-context"
    }
  ],
  advisories: [...]
}
```

### 3. Rework Health-Check Naming Findings

Health-check should report naming in this order:

1. Invalid names that conflict with their own role.
2. True duplicates in the same role/context/family.
3. Ambiguous names where Figlets needs the designer's grammar decision.
4. Optional style consistency advisories.

Naming should not outrank contrast failures, missing required roles, broken aliases, missing foundations, or token hygiene unless it directly blocks those repairs.

### 4. Rework Semantic Naming Consolidation Planner

The planner should accept a grammar/context decision, not just `canonicalConvention: "surface-based" | "role-based"`.

Recommended replacement:

```js
{
  grammar: "element-first",
  decisions: [
    {
      family: "danger",
      fromContext: "ambiguous-on",
      toContext: "on-fill",
      action: "rename-compatibility"
    }
  ]
}
```

The planner must:

- Keep distinct contexts separate.
- Treat `on-*` as valid only when it references a known background/context.
- Preserve variable IDs for compatibility renames.
- Separate name-only compatibility renames from alias rewires, binding migrations, and deletes.
- Refuse to plan deprecation when values differ and the tokens appear to serve different contexts.

### 5. Update Setup Intake

For new systems, setup intake should ask the designer to choose one of the viable grammar options, with examples and tradeoffs.

The default should not be "role-based." It should be a recommended grammar based on the designer's stated preference and product type.

### 6. Update Agent Guidance

Root docs, adapter docs, plugin skills, and Agent Interface should stop instructing agents to ask for a binary `surface-based` or `role-based` choice.

Agents should:

- Report the inferred grammar and confidence.
- Keep naming advisories low priority.
- Ask for a grammar decision only when the designer wants naming cleanup.
- Avoid saying a valid designer-authored context role is wrong because a different convention is more common.

## Unit Test Plan

### Classifier Tests

Add tests for the pure grammar classifier:

- Material-like paired context system: `surface` + `on-surface`, `primary` + `on-primary`, `error-container` + `on-error-container` should classify as paired-context and clean.
- Element-first system: `text/danger`, `icon/danger`, `fill/danger`, `text/on-fill-danger`, `icon/on-fill-danger` should classify as element-first and clean.
- Primer-like intent/emphasis system: foreground/background/border with muted/emphasis variants should classify as intent-emphasis and clean.
- Component-scoped tokens should not be treated as global duplicates.
- Unknown/custom naming should return `unknown-grammar` without rename apply input.

### Naming Diagnostic Tests

Add tests for:

- `color/bg/on-danger` is `invalid-name`.
- `color/text/on-danger` is `ambiguous-name` when no `danger` background/context exists.
- `color/text/on-danger` is clean when the file has a paired context role named `danger`.
- `color/text/danger` plus `color/text/on-fill-danger` is `distinct-context`, not a conflict.
- `color/fill/danger` plus `color/bg/danger` is not a duplicate by itself.
- `color/text/on-fill-danger` plus `color/text/on-danger` is a duplicate only when both resolve to the same fill-danger context.

### Health-Check Output Tests

Add tests that health-check:

- Does not ask for a binary surface/role choice on the first pass.
- Puts naming advisories below repairable contrast/token/foundation findings.
- Shows exact odd names and their reason.
- Does not offer apply-ready naming renames for `unknown-grammar`.
- Reports `on-fill-*` contextual roles as healthy when the matching `fill/*` background exists.

### Planner Tests

Add tests that `plan_ds_semantic_naming_consolidation`:

- Accepts grammar/context decisions rather than only `surface-based` or `role-based`.
- Keeps distinct contexts separate.
- Refuses stale or invented rename payloads.
- Emits no deprecation plan when values differ and context differs.
- Emits compatibility rename plans only for true duplicates or explicit designer decisions.

### Agent Guidance Tests

Update docs/plugin tests to fail if guidance says:

- "choose surface-based or role-based" as the default naming flow.
- `on-fill-*` is deprecated because plain `text/*` exists.
- naming consolidation is a high-priority repair before contrast/token/foundation findings.

### Fixture And Regression Tests

Update the reset/test fixture to include:

- A clean element-first status family with `on-fill-*`.
- An invalid background `bg/on-*`.
- An ambiguous `text/on-*` case.
- A true duplicate within the same context.
- A custom/unknown grammar mini-family that should not generate apply input.

Manual smoke should verify:

1. Reset Figlets Test.
2. Run health-check.
3. Confirm repairable spacing/color/token work stays separate from naming advisories.
4. Review naming classification.
5. Choose a grammar only after asking for naming cleanup.
6. Confirm planner produces exact, context-aware operations or refuses safely.

## Implementation Slices

1. Documentation and test scaffolding.
2. Pure classifier with fixture-based unit tests.
3. `inspect_ds_setup_gaps` integration and health-check wording.
4. Semantic naming planner input/result redesign with compatibility support for old calls if needed.
5. Agent Interface, root docs, adapter docs, plugin skill updates.
6. Manual smoke on reset Figlets Test.

## Acceptance Criteria

- New setup offers viable semantic color naming structures with examples and tradeoffs.
- Existing-system health-check infers and respects the current grammar before advising.
- `on-*` roles are only treated as canonical when the target context is known.
- `on-fill-*` roles are never deprecated merely because plain foreground roles exist.
- Unknown or custom systems do not receive invented migration plans.
- Unit tests cover paired-context, element-first, intent/emphasis, component-scoped, invalid, ambiguous, duplicate, and unknown cases.
- Full `npm test` passes before any runtime behavior is considered complete.

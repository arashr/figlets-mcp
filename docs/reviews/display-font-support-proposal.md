# Optional display fonts and multiple typefaces

November 6, 2026. Status: approved by the user and implemented. Full suite: 138/138 test files passes. Live verification pending.

## Goal

Accept multiple supplied typefaces, including multiple sans-serif families. A display role can use a separate family. Do not add a display typeface by default or treat its absence as a defect.

## Research

- [Material Web typography](https://material-web.dev/theming/typography/) separates brand and plain typefaces and permits typeface overrides for individual type-scale roles.
- [USWDS font family](https://designsystem.digital.gov/design-tokens/typesetting/font-family/) explicitly separates type-based tokens, such as sans and serif, from role-based tokens, such as heading, body, UI, and code.
- [Carbon typography strategies](https://www.carbondesignsystem.com/building-blocks/foundations/typography/style-strategies) distinguishes productive and expressive use cases and allows intentional blending. Expressive typography does not inherently require a second family.

These systems provide patterns, not one universal naming standard. The Figlets proposal below is a product decision informed by those patterns.

## Current implementation findings

- Intake in tools/design-md-intake.js selects families.sans, input.sans, input.display_family, or input.body_family as alternatives for one sans field. It returns only sans and mono, losing independently supplied display/body choices.
- generate-primitives-data.js emits sans, mono, and optional serif family strings, but no display entry.
- Snapshot bootstrap preserves entry.family from text styles and reads font/* strings. DESIGN.md export already uses entry.family and can describe a supplied display family. Support is partial rather than absent.
- Bridge typography setup starts from families.sans. Setup, update, exports, imports, documentation, and QA need consistent role resolution rather than separate fallback rules.

## Proposed behavior

1. Keep current behavior when no additional family is provided. No new default font, mandatory question, missing-token warning, or naming migration.
2. Retain each supplied family and its role. Display describes usage, not whether the face is sans-serif or serif. Support existing explicit per-style family assignments and additional supplied family names without reducing everything to one sans field.
3. Resolve a style using its explicit family assignment first, then an explicitly configured role mapping, then the existing primary-family fallback. Apply a supplied display family to display roles; do not extend it to headlines, titles, body, or labels unless those roles are assigned to it.
4. Preserve observed family bindings and role assignments on import and refresh. Do not infer that every large text style is display, or that the most common family should replace other observed families. When assignment is genuinely ambiguous, ask one design question.
5. Carry the same assignment through primitive family tokens, semantic typography aliases, text styles, showcase, component documentation, DESIGN.md, CSS, and Make output. QA checks the intended role family rather than treating a second sans-serif family as a mismatch.
6. If a supplied font or weight is unavailable, report the specific problem before any dependent write. Do not silently substitute another family.

## Designer-facing preview

Illustrative input: “Use Inter for body and UI, and Space Grotesk for display.”

> **Typography**
>
> | Use | Typeface |
> | --- | --- |
> | Body and UI | Inter |
> | Display | Space Grotesk |
>
> Display styles will use Space Grotesk. Other styles keep their assigned typefaces.

If the designer only supplies two families without roles:

> Which typeface should be used for display text?

Use native single-choice controls with the supplied families when available, allowing a custom answer. Do not ask this question when the assignment is already provided.

## Implementation approach after approval

Extend existing intake, setup, primitive update, and typography planner/apply surfaces. Add shared pure family-resolution helpers and reuse them in generation and exports; the bridge must follow the same precedence. No new public tool or parallel repair workflow. Preserve existing token identities and custom naming; do not rename imported variables to a new grammar.

Recommended internal order: define backward-compatible family resolution and intake preservation, integrate setup/update paths, align import/export/documentation and QA, then verify the supplied-family scenario in the disposable file after separate write approval.

## Regression scope after approval

- Existing single-family setups and exports remain unchanged.
- Two sans-serif families retain separate roles, and no display family is generated when absent.
- Explicit per-style assignments override general role mappings.
- Supplied display family affects only assigned roles; headings and UI are not silently reassigned.
- Imports, sync, refresh, and DESIGN.md round trips preserve families and bindings, including custom names.
- Setup and update create correct family aliases and text styles, with font availability checked before dependent writes.
- QA accepts valid multi-family typography and still catches real mismatches.
- Showcase, component docs, DESIGN.md, CSS, and Make agree on role families.
- Ambiguous input requests one meaningful choice; explicit input produces no repeated question.

Implementation followed user approval. No live Figma writes or new default display font were introduced. Load bridge 1.3.0+dev.20261106.4 and refresh the MCP host before live verification. The canonical pure helper is embedded verbatim in the Figma sandbox; regression tests enforce parity with Node.

# Display font and scrim repair

November 6, 2026. Approved scope: restore the three supplied font roles and the existing scrim showcase design. Native Specs remains parked and bridge-only.

## Placement correction after verification

The user clarified that scrims belong at the end of Primitive Colors, not in a separate section. Bridge 1.3.0+dev.20261106.7 now appends primitive scrim groups to the existing primitive swatch table. The user reloaded .7 and live regeneration returned six sections with no separate Scrims section and no scrim-resolution warnings. The prior seven-section result below is historical and superseded. All 141 test files pass; full-render coverage verifies placement, legacy-section cleanup, preserved layers, opacity order, and exclusion of semantic overlay aliases. Output remains in Figma.

## Earlier result

| Item | Verified result |
| --- | --- |
| Display | BBH Bogle on all three display styles |
| Sans | Inconsolata; other text styles retain this family |
| Mono | SF Mono primitive retained |
| Display bindings | Existing family variables alias font/display in all three breakpoint modes |
| Identities | Existing display variable and text-style IDs retained |
| Showcase | Seven sections regenerated; Scrims is last; no scrim-resolution warnings |

Disposable file: dummy_ds_2026.11.06, local_mw579uyb_ioojf0vj. Bridge: 1.3.0+dev.20261106.6. Generated output remains in the file.

## Code and tests

The intake supported flat sans and mono fields but dropped a flat display field. It now preserves display too. Its tool schema explicitly exposes separate families and their roles. The original conversation's exact tool payload is not available, so this is a reproduced input gap, not proof of the sole historical cause. This session's loaded MCP workflow is also older than source.

Tests cover the exact BBH Bogle / Inconsolata / SF Mono answer through intake persistence and primitive generation, repair of an existing incorrect display binding/style without replacing IDs, and the full showcase renderer across generation and regeneration. Existing helper tests continue to cover composed opacity, neutral backgrounds, ordinary swatches, missing sources, and ordering.

- Full suite: 141/141 test files pass.
- Intake regression fails when the display fix is removed.
- Build, lint, and whitespace checks pass.
- Final native typography preview: zero variable creations or updates, zero font failures, and zero binding warnings.

## Limits and follow-ups

The current bridge successfully regenerated the scrim section. No additional scrim rendering change was needed. The original failed execution was not captured. Automated full-render tests validate the layered swatches; the native section result alone does not establish visual approval.

Broad typography verification temporarily replaced some numeric aliases with equivalent literals. The aliases were restored using the existing typography variable path. An isolated style-only refresh changed zero variables. The precise source of the intermediate alias churn remains unresolved; investigate before broader typography update work. Do not add speculative style-setter changes. Figma documents an explicit unbind API, but that does not establish a cause here. [TextStyle binding API](https://developers.figma.com/docs/plugins/api/properties/TextStyle-setboundvariable/)

Restart the affected agent host before retesting intake so its MCP process loads current source. A new Cursor setup conversation and live visual sign-off remain unverified. No release, push, or new commit was performed.

# Native Figma Specs investigation

November 6, 2026. Scope clarified by the user: replace the custom in-Figma documentation sheet with native Specs. Implementation has not started; preview and test approval remain required.

## Current decision

Parked by the user on November 6. Keep Figlets Bridge as the only integration. Official Figma MCP is not an approved implementation route. Resolve showcase and display-font regressions first.

## Checkpoint

Approved work was committed first as ac9aa54, Improve designer flows, typography, QA, and showcase output. Latest full suite: 140/140 test files passes. Nothing pushed or published.

## Confirmed capabilities

- Native Specs can live inside a Design or FigJam canvas or as standalone Spec files. They provide collaborative structured Markdown. Existing .md files can be dragged onto the canvas. [Figma introduction](https://www.figma.com/blog/introducing-figma-specs/)
- Specs support images, Figma embeds, lists, code blocks, headings, and comments. Their editor can open fullscreen or as a scrollable page. Visuals are not excluded by the format. [Official help](https://help.figma.com/hc/en-us/articles/44049066011671-Guide-to-Specs-in-Figma)
- Figma's MCP skill describes GFM content under a SPEC_BLOCK document root. The figma.spec API supports creation, readback, targeted editing, and anchored comments. Images can be uploaded through Markdown image data URLs or fetched from allowed HTTPS hosts. [Official API skill](https://github.com/figma/mcp-server-guide/blob/main/skills/figma-spec/SKILL.md)
- Read-only whoami reports Specs enabled for the user's team and personal plans. This does not identify the owning plan of the disposable file or verify runtime capability in it.

## Verified bridge limitation

On November 6, the user reloaded bridge 1.3.0+dev.20261106.6 in dummy_ds_2026.11.06. A fresh Figlets sync returned:

```json
{
  "nativeSpecs": {
    "available": false,
    "createOnCanvas": false,
    "read": false,
    "edit": false,
    "replace": false
  }
}
```

The check only reads API properties; it does not invoke a Specs method or change Figma. Missing, partial, and restricted APIs are regression-tested. Full suite 140/140 passes.

This establishes that the native Specs API is not exposed to the actual normal-plugin session, not merely that the bridge has no writer yet. Figma's documented MCP runtime does expose this API. A native writer cannot be implemented solely by calling figma.spec from this bridge session.

Proposed supported delivery: Figlets remains the designer entrypoint, the bridge handles its existing inspection/demo/description work, and an explicitly connected official Figma MCP publishes and updates native Specs. Every host using that route would need that connection. Local component Markdown generation and component descriptions retain their existing behavior. No connector integration, manual-import fallback, undocumented API, or native Spec write has been implemented. The user is being asked to approve this additional dependency before implementation.

## User-confirmed replacement boundary

| Output | Change |
| --- | --- |
| Custom Figlets documentation sheet in Figma | Replace with native Figma Spec |
| Local component-specs Markdown | Preserve existing generation, format, content contract, and destination |
| Component description and its machine-readable SPEC block | Preserve existing behavior and content contract |
| Editable examples and demos | Retain existing design-system-backed visuals; separate from the written Spec only where needed |
| DESIGN.md export and other documentation workflows | Unchanged |

Native Specs are the replacement destination for the sheet, not an additional competing documentation format. Do not introduce an ongoing native-versus-custom destination menu. A pilot preview is for approving the replacement, not retaining both outputs as the product design.

Existing generated sheets are not permission to delete unrelated or manually authored content. Replacement of an actual generated sheet needs the concrete Figma write plan approved first.

## Content preview

Illustrative native Spec outline, using Figma's own Markdown presentation:

```md
# Button

Purpose and usage.

## Variants and properties
Tables of actual component values.

## Token bindings
Observed aliases and mode values.

## Interaction and accessibility
Observed behavior, plus clearly identified implementation guidance.

## Examples
[Open live examples in Figma](verified-demo-node-url)
```

The placeholder above is an outline only, not a valid output link. A demo area should contain examples and visual comparisons, without duplicating the written spec in custom styled panels.

## Code implications

The current bridge generates its styled spec frame and Markdown together. Markdown assembly occurs late in the renderer, and the server appends nested-component documentation references afterward. Separate document data collection from in-Figma rendering sufficiently to replace the custom sheet with a native writer. Reuse current content generation. Preserve local Markdown and component-description behavior through output-parity tests; do not redesign those outputs as part of the migration. Native Specs must not require rendering the old custom document first.

Extend generate_component_doc and the existing bridge documentation command where the approval boundary stays the same. The intended default is native Specs in place of the old sheet, not a permanent selectable destination or a parallel public tool. Track native Spec and demo identities by source file/component IDs, not names alone. On refresh, use surgical edits and preserve comments and human-authored content. Whole-document replacement requires explicit approval. Return separate native-spec, demo, and local-file outcomes because these writes are not atomic together.

## Recommended sequence and approval gates

1. Completed: read-only capability check in the actual bridge/file. The API is unavailable to the plugin. Decide explicitly whether to approve the supported official Figma MCP publication route.
2. After capability is established, preview one native component Spec beside its existing demo. Obtain approval before creating either artifact. Keep old documentation during the pilot.
3. After the preview is accepted, implement the minimal native writer integration. Test exact preservation of existing local Markdown and component description, native readback, images and links, updates without duplication, source-system preservation, and failure reporting.
4. Replace the custom-sheet destination as approved. Show the exact generated-sheet replacement plan before live writes. Do not silently fall back to the old renderer when native Specs is unavailable.

Live animated demos remain on the canvas unless native embedding support is separately verified. This investigation does not expand Figlets' motion-timeline inspection capability.

## Verification limits

Reviewed official product/help/API guidance, public Plugin API declarations, the bridge manifest, and component-documentation code. Checked account-level availability through the connector and actual bridge API availability through a fresh read-only sync. Only the capability probe and tests were added after checkpoint ac9aa54. No native Spec was created or edited. Existing Markdown, descriptions, and documentation sheets were not changed.

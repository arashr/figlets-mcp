# Native Figma Specs research outcome

November 8, 2026. Shelved by the user. This is an archive, not an active implementation plan.

## Decision

Keep the current Figlets documentation sheet, editable canvas demos, component Markdown, component descriptions, and DESIGN.md export. Keep Figlets Bridge as the only integration. Resume native Specs work only on explicit request.

## Tested in the disposable file

| Route | Result |
| --- | --- |
| Markdown file dragged from Finder | Created native SPEC_BLOCK 3:2, Figlets Specs feasibility |
| Bridge selection and traversal | Identified the imported native node |
| figma.spec methods in normal Bridge | Unavailable |
| Isolated proposed-API development build | Create, read, edit, and replace methods remained unavailable |
| pluginDrop File message | File delivered; no additional native Spec |
| pluginDrop Markdown MIME message | Content delivered; no additional native Spec |
| Browser File drag | No additional native Spec; no new recorded drop event |

The experimental build was confirmed by its unique 1.3.0+specs-test.02 marker. Final complete current-page scans contained only the original imported Spec. These results do not establish universal failure across all Figma clients. Web, cloning, clipboard editing, and comment-safe updates were not verified. A clone method being present is not evidence of content access.

No automatic Bridge-only native creation or safe update path was established. The manual import remains in the disposable Figma file for inspection. No source component bindings were changed. Experimental source files, generated plugin copies, and the superseded implementation plan were removed during release cleanup. Production documentation behavior was not switched to native Specs.

## Official references

- [Specs and native Markdown import](https://www.figma.com/blog/introducing-figma-specs/)
- [Specs help](https://help.figma.com/hc/en-us/articles/44049066011671-Guide-to-Specs-in-Figma)
- [Specs JavaScript guide for Figma MCP](https://github.com/figma/mcp-server-guide/blob/main/skills/figma-spec/SKILL.md)
- [Public Plugin API declarations](https://github.com/figma/plugin-typings/blob/master/plugin-api.d.ts)
- [Proposed APIs](https://developers.figma.com/docs/plugins/proposed-api/)

Documentation was checked November 8. MCP runtime support does not prove normal-plugin access. Missing plugin methods do not prove the file lacks Specs in the Figma UI.

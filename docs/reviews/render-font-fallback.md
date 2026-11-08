# Generated text font fallback

November 8, 2026. User approved failure-only fallback while preserving existing features.

## Problem and scope

Component documentation selected a family from local text styles, ignored individual font-load failures, and later assigned unverified text styles or font-variable values. Loading one face did not establish that another face was available. Repeating the same render could fail again, while Markdown was coupled to successful visual rendering.

The fix extends existing documentation and showcase rendering with one shared runtime font resolver. No public tool or parallel mutation path is added. Exact setup typography and explicit style/variable edits retain their current contracts. Fallback does not replace the design system's configured fonts or repair source components.

## Behavior

- Try the requested family and style first. Keep the exact font and original text-style/binding path when available.
- Cache each load attempt for the render. On failure, use a verified same-family Regular, Inter Regular, Roboto Regular, Arial Regular, then a loadable font reported by Figma. Never assign an unverified fallback.
- Initialize generated text with a loaded font before writing characters.
- Preflight actual documentation role fonts, not only the first local style's family. Preserve numeric geometry and color bindings when rendering a failed text style with a substitute. Do not bind failed family/weight references back onto the fallback preview.
- Record requested and fallback fonts in structured results. Typography facts in Markdown continue to describe the source rather than the preview substitute.
- Keep Markdown and component description generation outside visual rendering. If no font loads or the sheet fails, complete the handoff and return partial status, failed sheet status, and retryable false. Guidance says to report those outcomes separately and not repeat an unchanged render.
- Preserve an existing sheet until its replacement has rendered successfully. Remove a failed newly generated sheet rather than deleting the previous sheet first.

If Figma cannot load any font, it cannot render text. The documentation flow still produces Markdown and accurately reports the visual failure. Do not claim a visual sheet was completed in that case.

## Verification

146/146 test files pass. Build, lint, plugin packaging smoke, and whitespace checks pass.

Automated tests execute the actual component renderer with strict unloaded-font setters. Cases cover available fonts, missing Inconsolata family, missing Regular while other faces load, missing Inter, only an enumerated fallback available, and total font exhaustion. Assertions cover identical Markdown facts, unchanged local source styles, exact description/SPEC completion, no repeated failed exact load, preservation of an old sheet on failure, and partial-result behavior.

The full showcase renderer is exercised with available and unavailable Inconsolata while retaining scrim placement, neutral backgrounds, variable bindings, and repeat-generation checks. The receiver/server integration verifies a failed visual result still writes the exact local Markdown and returns truthful partial status without claiming visual completion. Existing setup, typography, binding, and documentation regressions remain in the full suite.

Live Figma verification is pending a reload of the normal Bridge and an approved component documentation run. The shelved Specs experiment is unrelated. Do not claim the running experimental or normal plugin already contains this change. No release, commit, or host restart in this task.

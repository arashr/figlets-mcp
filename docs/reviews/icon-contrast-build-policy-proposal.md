# Icon contrast should not trap setup

Proposed November 6, 2026. Implementation approved by the user and completed November 7, 2026.

## Confirmed problem

The semantic validator adds icon failures to the same failCount used for text pairs. Both prepare_ds_config and apply_ds_setup block on that aggregate count. Repair options are produced from text pairs, not the icon findings included in that count. Workflow guidance then requires a retry or an alias/palette change. There is no supported advisory-only continuation, so an agent following current instructions cannot honor the designer's request to proceed.

The icon evaluator can also test one shared icon token against several paired surfaces. Its search can find no step that satisfies every context. Repeating the same search does not establish that an alternative exists. The quoted historical run has not been reproduced, so its exact failed contexts remain unverified.

## Revised behavior from the user's clarification

1. Semantic contrast repairs select a better existing step from the same primitive ramp. They must not modify primitive values, regenerate a different palette, or suggest changing the source hex or scale as a remedy for a semantic finding.
2. Evaluate existing steps against the actual icon/background contexts. Offer an exact passing semantic alias when one exists. If a shared token cannot pass across its contexts, explain that once. Do not invent a universal fix, change role names, or silently create additional contextual tokens.
3. Do not repeat a failed repair for unchanged inputs. A repeated prepare call must not reset the interaction into another repair menu.
4. Icon contrast findings are advisory. More generally, an explicit designer instruction such as "continue anyway," "ignore this," or "fuck it, continue" acknowledges the current contrast findings and authorizes continuation of the requested build. This is not limited to icons. Do not demand a special phrase or another confirmation.
5. Preserve that decision for the same findings across preparation and apply. Both use one readiness policy. Continuing must retain the chosen aliases and primitive values, not secretly apply the rejected suggestion.
6. Keep the findings truthful in checks and documentation. Accepted findings are unresolved contrast warnings, not passing results or proof of accessibility compliance. Actual execution errors must still be reported accurately rather than hidden behind an override.

Designer-facing preview when a usable alias exists:

> **3 icon colors need contrast review**
>
> Existing darker steps can improve contrast. Your primitive colors stay unchanged.
>
> 1. Review suggested icon steps
> 2. Build with current colors

If the designer already instructed continuation, do not show that menu again. Proceed with the requested build and report the retained warnings once in the result.

## Implementation scope

Extend existing preparation, semantic-repair planning, and apply surfaces. Expose exact icon alias repair options through the existing contrast-repair surface with evaluated contexts. Separate findings from build readiness, and carry the designer's contrast continuation decision through the same shared policy in prepare and apply. Update setup previews, both adapters, packaged skills, and contradictory retry/palette-change instructions together. No new public tool, bridge mutation branch, or designer-facing configuration step.

The user's clarification superseded the prior icon-only proposal. The user explicitly approved implementation of the revised behavior. The implementation extends the existing prepare, contrast-repair, and setup surfaces, with shared pure readiness/repair-option helpers. No new public tool or bridge mutation branch was added.

## Regression tests

1. A middle-valued brand palette yields an exact passing icon step from its existing ramp when available, evaluated against the reported contexts.
2. Semantic repair leaves primitive ramps, source hex values, scale, unrelated aliases, and Figma variable identities unchanged.
3. Shared icon contexts with no universal passing candidate produce one clear advisory and no repeated repair cycle.
4. Icon-only findings are advisory. Explicit continuation also permits a requested build with text contrast findings; prepare and apply agree.
5. Natural-language continuation instructions are recognized by workflow guidance without requiring a special phrase or repeated approval. The server consumes an explicit structured decision rather than guessing approval from arbitrary text.
6. The same acknowledged findings stay acknowledged through prepare/apply and rechecks. Declining a repair never applies it.
7. Mixed findings retain exact counts, contexts, and existing text-repair payloads. Missing references and actual execution failures are reported separately from overrideable contrast findings.
8. Output reports unresolved contrast warnings truthfully and never labels accepted failures as passing.

## Implementation and verification

- Added evaluated icon repair options, including the existing alias, suggested step, actual background contexts, and contrast evidence. Stale evidence and conflicting combined text/icon repairs are rejected before any config write.
- Saved semantic aliases are no longer silently changed by icon adjustment, success-surface backfills, or contrast-harmonized preparation. Generated initial defaults retain their existing adaptation paths.
- Icon contrast is advisory. Text findings can be acknowledged through continue_with_contrast_warnings on existing prepare/apply tools. The decision is retained for the evaluated token, mode, colors, contexts, algorithm, and threshold. Actual missing-reference/execution errors remain separate.
- Preparation, detailed preview, and apply share the same readiness policy. Accepted findings remain failures in contrast evidence and unresolved warnings in DESIGN.md. The independent Google contrast warning remains visible without creating a second artifact-lint build blocker.
- Both adapters, packaged skills, start prompts, root entrypoints, and workflow guides use the semantic-only, no-loop continuation policy.

Verification: npm test passes 142/142 test files. Build, lint, plugin package smoke checks, and whitespace validation pass. End-to-end tests use isolated configs and a simulated Bridge, including a fresh stdio MCP process to exercise actual registered schemas and callbacks. They cover passing existing icon steps, unchanged primitive ramps/hex/scale, stale repair rejection, incompatible shared backgrounds, persistence across prepare/apply, truthful output, and unresolved-reference errors.

The package smoke check initially encountered the inaccessible global npm cache, then passed with a temporary cache. Final verification was delayed by an automatic approval-review usage-limit failure, then resumed successfully.

No live Figma writes, new release, push, or commit were performed for this contrast change. Existing bridge .8 needs no contrast-related update. The actual running Codex Figlets connection was also verified using an isolated config under /tmp: before continuation readyToBuild=false with one failing text finding; after explicit continuation readyToBuild=true with that finding still failing and accepted; a recheck remains ready with the same accepted finding. The running workflow guide exposes the new continuation contract. No host restart is needed for this verified connection. Cursor and a full manual designer conversation remain unverified; refresh an older Cursor server before testing there.


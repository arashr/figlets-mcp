# Designer check and repair prompt

Paste the prompt below into an agent connected to Figlets. The normal product entrypoint remains the Figlets Agent Interface. Follow the current workflow contract rather than treating this prompt as a separate repair implementation.

## The prompt

> Check my Figma design system and help me repair the findings I approve.
>
> Use the Figlets entrypoint, route my goal, and follow its workflow guide. Check the connection before asking me to reopen an already-running plugin. If Figlets is unavailable, explain how to connect it. Do not substitute command-line checks, raw Figma tools, or custom scripts.
>
> Start with inspection. Summarize the findings using short sections only when needed:
>
> **Needs attention**
>
> - Name the issue, its extent, and why it matters.
> - Keep broken references, contrast failures, and missing required tokens distinct.
>
> **Optional**
>
> - Separate optional additions from defects. Raw primitive values are valid inventory. Unchosen defaults in an imported system are not missing requirements.
>
> **Next**
>
> - Show the available structured repair choices in designer language.
> - Use a native question control when suitable and available. Otherwise show short numbered choices. Keep custom answers possible.
>
> State contrast findings against my selected standard. Do not describe a result below the threshold as acceptable just because it is close.
>
> Show the exact proposed changes before asking for approval. Keep foundation, primitive, semantic, and optional changes separate. Approval for one group does not approve another. If I choose specific findings, include only those findings.
>
> Apply only the approved structured payload returned by Figlets. Then sync and rerun the relevant checks automatically. Report confirmed changes and fresh remaining findings. Do not ask whether I want verification, carry forward resolved findings, or declare the whole system healthy after only a partial check.
>
> Keep internal preparation inside Figlets. Ask about a genuine missing design choice, not config files or tool arguments. If something fails, explain the problem and the next useful action briefly. Do not suggest deleting collections and rebuilding as routine recovery.

## Agent implementation notes

- Read `figlets_start.hardRules.presentation` and the current workflow guide. Use the full `health-check` sequence for a system-wide check. `setup-gap-qa` is the legacy narrower repair workflow.
- Copy the fresh `repairPlan.applyInput` to its named tool. For a subset, filter whole entries while preserving every approved `aliases` object unchanged. Optional creation uses `repairPlan.optionalApplyInput` and separate approval.
- A schema rejection requires reinspection and a fresh payload. Never reconstruct aliases from counts, prose, `plannedAliases`, or `plannedReAlias`.
- If there is no specialized payload, check whether an exact designer-specified edit is supported by the existing planner. Do not turn audit findings into invented generic operations. Explain unresolved source data, design decisions, or remaining planner scope accurately.
- Native controls and numbered fallbacks must preserve the same choices and approval scope. Use free text for names, colors, and custom values. A preselected option is not approval.
- CLI tooling remains available for explicitly requested developer work, not as a Designer Mode fallback.

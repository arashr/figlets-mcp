# Designer DESIGN.md export prompt

Paste the prompt below into an agent connected to Figlets. Use the Figlets Agent Interface and current export workflow contract.

## The prompt

> Export my Figma design system to DESIGN.md for a coding handoff.
>
> Use Figlets and the current Figma data. Check the connection before asking me to reopen an already-running plugin. Handle internal preparation yourself. Do not ask me to create, locate, or edit a config file.
>
> Use the established design-system name. If its identity needs confirmation, ask one short naming question and continue with my exact answer. Do not silently substitute a file or package name. Keep optional context optional.
>
> If I request a preview, show the proposed output before writing. Honor my output and companion-file preferences and the workflow's approval requirements. Do not change Figma variables as part of export.
>
> After a confirmed export, lead with the result and verified artifact links:
>
> **Exported DESIGN.md**
>
> Include its link and, if written, the optional companion file for Figlets re-import. Explain any limitation that affects the handoff. Report an unexpected destination clearly.
>
> Keep config creation, refresh counts, hashes, package versions, and routine validation details out of normal completion. Do not add a follow-up menu when the export already fulfills my request.
>
> If target-size advice is present, identify it as guidance for AAA accessibility standards. It does not block export or authorize changing my values. Explain actual blocking validation findings separately.
>
> Use short headings and compact lists only when they improve readability. Use native choices when suitable and available, numbered choices otherwise, and free text for a new name or custom answer. Avoid repeated explanations and raw JSON.
>
> If Figlets is unavailable, explain the connection requirement. Do not approximate the export with raw Figma tools or a command-line fallback.

## Agent implementation notes

- Follow `figlets_start`, intent routing, and `figlets_workflow_guide` for `export-design-md`. Presentation rules are returned in `hardRules.presentation`.
- `export_design_md` manages snapshot refresh and internal preparation. Respect `project_path`, `output_path`, `skip_sync`, `figmaDataPath`, and `include_sidecar` when appropriate. Do not expose those mechanics as designer tasks.
- Required identity intake returns `status: needs_designer_input`. Ask its naming question, then retry the exact continuation with `design_system_name`. Do not report success before the artifact is written.
- Use `lint.blockingFindings` to explain a blocked export. Findings with `blocking: false`, including AAA target-size advisories, and tolerated orphaned-token warnings do not block export.
- DESIGN.md is the portable handoff. The optional companion JSON preserves exact data for Figlets re-import. Use actual returned paths for links; do not invent an output location.
- Keep developer CLI instructions in developer documentation. Do not invoke setup or mutate Figma during designer export.

# Figlets prompt alignment preview

November 6, 2026. Status: approved and implemented; full suite 135/135 test files passes. Live host and conversation verification remains pending. Examples below are illustrative, not live results.

## Scope

Keep the six workflow labels and existing approval boundaries. Shorten explanations and remove contradictory instructions. This proposal covers the two paste-ready prompts, matching adapter guidance, and conflicting workflow response wording. It does not change token math, repair algorithms, setup defaults, file formats, or component scope.

Compared with v1.3.0: the repair prompt is unchanged. Export gained companion-file and validation instructions, while retaining older setup and config language. Adapter guidance still contains config-edit and destructive rebuild advice. The current workflow contract already has stronger repair and verification rules; align the older guidance with that contract.

## Entry and connection

Keep the menu:

1. Check my design system
2. Set up a new design system
3. Build a token showcase
4. Document a component
5. Export DESIGN.md
6. Generate Figma Make guidelines

Use the existing Figlets entrypoint and route a stated goal directly. Do not make the designer choose it again. Check the connection before asking the designer to reopen an already-running plugin. Ask for action only when the connection result requires it. If Figlets is unavailable, follow the existing host connection guidance, without switching to raw Figma tools or a command-line fallback in Designer Mode.

## Conversation previews

### Check my design system

Opening:

> I'll check your design system and summarize what needs attention.

Example findings and repair choice:

> **Needs attention**
>
> Four color pairs are missing text colors. One pair falls below your selected contrast standard.
>
> I can preview repairs for these five findings. Optional icon additions can be reviewed separately.

Show the existing structured repair choices when a decision is needed. Do not add optional items to an approved required repair. State that a near-threshold result is below the selected standard; do not call it acceptable by default. After applying an approved repair, sync and rerun the relevant checks automatically. Report only fresh remaining findings. Reserve a full health verdict for the complete health workflow.

### Set up a new design system

Example next missing choice:

> Which platform is this design system for?

Retain one targeted intake question per turn. Keep provided answers. Show the existing concrete setup preview before asking to build. Internal preparation stays inside Figlets.

### Build a token showcase

Example approval preview:

> I'll create a token showcase using this file's design system.
>
> **Sections:** Colors, typography, and spacing.
>
> Create this showcase in Figma?

Use the actual planned sections and destination, not this illustrative list. Report the created location after tool confirmation.

### Document a component

Example after inspection:

> I'll document **Button**, including its variants, token bindings, and observed interactions.
>
> Create its spec sheet in Figma and save the Markdown handoff?

Use the actual inspected component and supported content. Retain the existing finite nested-component decision when required. Preserve source design-system bindings. Distinguish observed interactions from implementation guidance; do not imply Motion timelines were inspected. Report artifact paths and Figma location once after confirmed writes.

### Export DESIGN.md

Opening:

> I'll export your design system to DESIGN.md using the current Figma data.

Only when identity needs confirmation:

> Should this design system be called **Acme**, or would you like a different name?

Example completion:

> Exported **DESIGN.md**. Included the optional companion file for Figlets re-import.
>
> [Open DESIGN.md] and [Companion file]

Replace those placeholders with verified artifact links. Omit config creation, refresh counts, hashes, package versions, fallback mechanics, and routine validation detail from normal completion. Report a failed validation or unexpected destination when it affects the result. If present, label target-size advice as guidance for AAA accessibility standards and keep export nonblocking. Required naming intake occurs before export; optional context does not become a prerequisite.

### Generate Figma Make guidelines

Example file-plan approval:

> Ready to export the Make guidelines.
>
> **Files:** [the actual files from the preview]
>
> Export these files?

Retain the current skippable suggestion step before export approval whenever the tool requires it. Do not combine those questions or introduce package setup. Export only the approved current file plan.

## Recovery preview

| Current guidance | Proposed behavior |
| --- | --- |
| Add brand colors to the config | Ask only for a missing design choice, such as “What is your primary brand color?” |
| Ask whether the plugin is open before trying | Check connection first. If unavailable: “Open Figlets Bridge in the Figma file, then I'll retry.” |
| Delete the old Primitives collection and rebuild | Reinspect and use the existing structured repair path. Never propose deletion as routine recovery. |
| No contrast suggestion means fix it manually in Figma | Explain the missing choice or planner capability. Use supported exact edits when the designer supplies them. |
| Ask whether to recheck | Recheck automatically after an approved repair. |

## Agent instructions and verification after approval

Use fresh exact repairPlan inputs. Filter whole approved entries without reconstructing aliases. Preserve separate foundation, primitive, semantic, and optional approvals. Keep technical payload rules in agent guidance, not the designer conversation.

Tests should exercise representative routing and response scenarios: already-connected file, missing connection, near-threshold contrast, subset approval, optional additions, fresh verification, confirmed and unconfirmed names, nonblocking advisories, imported primitives, component source-system preservation, nested-component scope, and Make suggestion ordering. Check structured contracts as well as wording. Automated prompt checks cannot establish model consistency; the six live workflows remain a separate verification task.

Approval requested: these wording patterns and recovery rules, then synchronized implementation and regression coverage. No live writes, reloads, or publishing are included.

## Additional proposal: readable responses and appropriate inputs

Status: approved and implemented in prompt and adapter presentation guidance. A custom interface, new forms, and new host integrations are deferred.

### Response layout

- Lead with the result or the question.
- Use short headings when there are distinct sections, such as **Needs attention**, **Optional**, and **Next**. Omit empty sections and headings for a single simple question.
- Use compact lists for findings and planned changes. Use tables only when comparison is easier in rows.
- Show counts and concrete names where useful. Avoid routine technical detail, repeated success statements, and safety boilerplate.
- Keep optional work separate from required findings and approved changes.
- Show artifact links once. Include limitations when they affect the result.

Example findings:

> **Needs attention**
>
> - 4 color pairs need text colors.
> - 1 pair falls below your selected contrast standard.
>
> **Optional**
>
> - Add icon colors for 3 roles.
>
> **Next**
>
> Preview the required repairs, review optional additions, or choose specific findings?

### Question controls

Use the host's native question control when available and suitable. Preserve exact tool-returned choices and approval scope. Otherwise show the same choices as a short numbered list. Do not ask the designer to type a tool name, edit JSON, or repeat information already supplied.

| Question | Presentation |
| --- | --- |
| Pick one workflow, platform, or preset | Single-choice menu with clear labels |
| Choose independent items | Multiple selection only if the host supports it and the tool permits that subset; otherwise use a numbered list and accept natural-language selections |
| Supply a name, hex color, or custom value | Short free-text question, with an example only when useful |
| Approve a change | Show the exact preview first, then explicit approval or revision choices; never count a preselected option as approval |
| Resolve optional context | Include a clear skip choice when the workflow permits skipping |

Do not force a menu for a simple open question or invent fixed options for a custom design choice. A free-text answer must remain possible. Maintain the existing one-question-per-turn setup intake. Do not bundle unrelated decisions to fill a form.

Example platform question, shown as a native single-choice control when supported:

> Which platform is this design system for?
>
> 1. Web
> 2. iOS
> 3. Android
>
> You can also specify another platform.

Example naming question, shown as free text:

> What should this design system be called?

### Verification boundary

Add representative checks for section omission, clear required/optional separation, matching native-control and text fallback choices, custom answers, skip behavior, and explicit approval. Retain routing and structured payload tests. Verify actual host rendering during the live workflow pass; automated wording checks alone are insufficient.

Approval received: implement these bounded presentation rules with prompt alignment. Custom widgets and a new visual interface remain deferred. Native controls depend on the host; live rendering is not established by automated tests.

# Imported foundations: approval preview

Status: approved November 6, 2026, with the redundant success sentence removed. Implemented; automated verification recorded in the task list. Live verification remains pending.

## Problem and reason

A color-only imported system produces 44 missing typography and shadow variables from Figlets defaults. Those defaults are suggestions, not evidence of the designer's requirements. Treating them as defects produces unnecessary repair work.

## Proposed behavior

- Existing raw primitives remain valid inventory.
- Missing tokens count as gaps when an established requirement or an observed reference requires them. A broken alias remains a real finding.
- Unchosen Figlets defaults do not enter defect counts or ordinary repair payloads for imported systems.
- Optional foundation setup remains available through the existing setup workflow, after design choices and approval. Do not add a new public tool or a default recommendation menu to every check.
- Explicitly authored requirements and requirements from designer-approved Figlets setup remain enforceable.
- Record the distinction internally. Preserve it through sync and refresh. If old imported data cannot establish a requirement's origin, do not silently treat generated defaults as approved requirements.

Implementation planning must check existing planner/apply surfaces and share requirement classification between findings and repair payload construction. Hiding findings in prose alone is insufficient.

## Response preview

Scenario: an imported system contains colors, with no observed or explicitly required typography or shadows.

Current behavior, summarized rather than quoted: 44 missing typography and shadow variables, ready to preview repairs.

Proposed designer response:

> This file currently contains color tokens. Typography and shadow foundations have not been defined.

If the designer asks to add them:

> Let's define those foundations. Which would you like to start with: typography or shadows?

If an explicitly required token is missing:

> One required typography token is missing: `type/weight/regular`.
>
> I can preview its repair for your approval.

The color-only response is implemented for that narrow inspection scenario. The optional setup and missing-token examples are guidance for subsequent prompt alignment, not a new menu. They do not claim the whole design system is healthy.

## Tests required after approval

1. A color-only import has no invented typography/shadow defects or repair entries.
2. Explicit requirements still produce exact missing-token findings and repair payloads.
3. Approved Figlets setup still detects deleted required tokens.
4. Observed broken references remain findings even without a setup requirement.
5. Repeat inspection and snapshot refresh preserve requirement origin and do not promote optional defaults into requirements.
6. Mixed cases keep real gaps and exclude optional additions from the same count and payload.
7. Inspection does not mutate Figma; internal preparation does not require designer config work.

Approval received for the classification rule, amended response preview, and regression scope. No live Figma writes or release changes are included.

## Implementation boundary

Extend the existing inspection and primitive-update path with shared internal requirement classification. Bootstrap records observed primitive typography/shadow requirements and literal values. Refresh preserves deleted requirements and updates still-observed values. Authored setup continues to require generated foundations. A successful approved setup records that requirement boundary for imported configurations too.

Imported primitive repair previews and bridge entries contain only established requirements and their known literal values. Unknown alias or differing mode values remain findings without an apply-ready primitive batch. Missing alias targets are reported as unresolved snapshot references, not assumed deletions. This does not add a public tool or promise automatic repair for unresolved source data.

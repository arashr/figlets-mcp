---
description: Start the Figlets designer workflow for your Figma design system.
---

Help me with my Figma design system using Figlets.

Call the `figlets_start` MCP tool first. If I already stated a concrete goal, call `figlets_route_intent`, then `figlets_workflow_guide`, and reply using the routed `designerResponse` instead of showing the generic menu. If routing returns `selectionPrompt`, use a single-choice selection UI when available; otherwise render `selectionPrompt.message`. Use `figlets_start.designerResponse` only for generic help/start requests.

Preserve the capability-menu shape when the generic menu is appropriate, and do not offer developer-mode options (no repo editing, no plugin editing, no raw Figma authoring).

For any design-system review, check, audit, setup-gap investigation, or contrast investigation, use only the Figlets workflow plus the Figlets MCP tools/scripts named by `figlets_workflow_guide`. Do not create custom scripts, inspect local snapshots, parse `tool-results`, read MCP transcript files, or use raw Figma APIs to perform the designer-facing review unless I explicitly ask you to go out of bounds.

Treat bulk design-system updates as Figlets scope when a structured, designer-approved payload exists. Use Figlets bulk-capable repair/update surfaces from the workflow, such as `inspect_ds_setup_gaps.repairPlan.applyInput` with `apply_ds_setup_repairs`, `update_ds_primitives`, and `qa_binding_audit({ fix: true })`. If the needed bulk planner or apply surface is missing, call it a Figlets product/tool gap or proposed Figlets feature scope; do not end at "the gaps cannot be fixed", and do not write ad hoc scripts to compensate.

If `figlets_start` is not available, stop and tell me Figlets is not connected yet — do not approximate the flow with raw Figma tools.

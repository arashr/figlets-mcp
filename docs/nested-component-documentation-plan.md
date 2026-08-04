# Nested component documentation

**Status:** Minimum detection, reference, leaf-first review, session-scoped skip, and approved finite full-plan execution implemented.

## Goal

Prevent component documentation from silently missing nested components without turning documentation into an automatic recursive process.

The designer stays in control. Figlets detects nested component dependencies before writing, shows a short bounded list, reuses existing Figlets documentation where possible, and documents missing dependencies only when the designer explicitly asks.

## Core rule

Nested documentation must never run as an endless loop.

- Detection is read-only and bounded to the selected component's dependency graph.
- Detection alone never starts documentation. Automatic progression is allowed only after the designer approves one exact finite write list.
- Existing `component-specs/*.md` files are reused by reference instead of regenerated.
- Missing components are offered as an ordered list, from the smallest dependency to the selected parent.
- Documentation proceeds one component at a time. The designer may approve each item in review mode or approve one exact finite full-documentation plan.
- Circular or repeated dependencies are listed once and never revisited during the same plan.

## What the designer experiences

After selecting a component, Figlets checks whether it contains other components and explains the result before writing anything. The designer can:

1. document only the selected component;
2. review undocumented nested components one by one, with an option to skip any item for now;
3. approve one displayed leaf-first list and let Figlets document only those components automatically.

The designer does not need to select every nested component manually. Figlets targets each approved component by its Figma ID and returns to the selected parent last. A future inspection may flag skipped or newly discovered dependencies again.

## Minimum viable feature

### 1. Preflight detection

During `inspect_component`, identify the components used inside the selected component and return a deduplicated list containing:

- component name and stable Figma identity;
- where it is used in the selected component;
- whether an existing Figlets component spec was found;
- whether it still needs documentation.

Do not inspect or reproduce each nested component's internal anatomy during this step.

### 2. Designer warning before documentation

Before `generate_component_doc`, show one concise message such as:

> This component uses 3 nested components. Two already have Figlets documentation; one does not. I can document only the selected component, or work through the missing dependency first.

The minimum choices are:

1. Document only the selected component.
2. Review the dependency list.

No nested documentation starts from this warning alone.

### 3. Reuse existing documentation

When a matching file already exists in `component-specs/`, treat it as the existing Figlets handoff for that dependency.

- Reference its relative path from the selected component's Markdown handoff.
- Do not regenerate it automatically.
- Do not copy its full contents into the parent spec.
- Mark it clearly as an existing documented dependency.

### 4. Optional leaf-first documentation

If the designer asks to document missing nested components, produce a finite ordered list:

1. smallest undocumented leaf components;
2. components that depend on those leaves;
3. the originally selected component last.

In review mode, document only the first approved item. After it finishes, show the remaining list and ask whether to continue. A previous item approval never authorizes the next component. If the designer explicitly approves full documentation, execute only the displayed finite list automatically by component ID, leaf-first, and document the selected parent last.

## Parent component handoff

For the MVP, add a compact `Nested Components` section to the generated Markdown only when dependencies exist.

| Nested component | Documentation | Relationship |
| --- | --- | --- |
| Icon | `component-specs/Icon.md` | Existing Figlets spec |
| Badge | No standalone Figlets spec | Direct dependency |

The section is a dependency index for MCP/code handoff. It does not duplicate nested anatomy, token tables, usage rules, or implementation details.

The Figma spec sheet can initially show only a compact dependency summary. Rich nested-component visuals and configuration details are explicitly deferred.

### Ownership boundary

A nested component owns its internal slots, variable bindings, anatomy, and visual properties. Those details belong in that component's standalone spec and must not leak into the more complex parent component. The parent records only the dependency relationship and the path to existing documentation when available.

## Loop and scope safeguards

- Use stable component keys/IDs for deduplication; names are display labels only.
- Track visited dependencies while building the list.
- Stop traversal when a component has already been visited.
- Report circular references as a warning without following them again.
- Put a conservative maximum on discovered dependencies and report truncation rather than expanding indefinitely.
- Never document remote/library components automatically.
- Never overwrite an existing component spec as part of dependency discovery.

## Deferred enhancements

These are intentionally outside the first version:

- recursively embedding nested anatomy;
- a single bridge mutation that batch-generates several component specs at once;
- visual dependency diagrams;
- detailed instance-swap and exposed-property matrices;
- nested token and interaction expansion;
- automatic remote-library documentation;
- freshness or drift validation for existing component specs.

## MVP acceptance criteria

- A selected component with no nested components behaves exactly as it does today.
- A selected component with nested components gets a read-only, deduplicated dependency summary before any write.
- Existing Figlets specs are recognized and referenced without regeneration.
- Missing specs are presented leaf-first in a finite list.
- Choosing "selected component only" produces one parent spec and no other writes.
- Choosing dependency documentation writes only the single component currently approved.
- Choosing full documentation executes only the exact approved finite list, without requiring manual selection for each component.
- Repeated or circular dependencies cannot cause repeated generation.
- The parent Markdown links documented dependencies and labels undocumented ones without duplicating their contents.

## First implementation slice

The first engineering slice should contain only:

1. a pure dependency collector with deduplication and cycle protection;
2. dependency/spec status in the read-only `inspect_component` result;
3. the pre-generation designer warning and choice in workflow guidance;
4. a compact `Nested Components` reference table in generated Markdown;
5. focused tests for no dependencies, existing specs, one missing leaf, repeated dependencies, and a cycle.

Leaf-first review and full-plan execution both reuse the existing single-component documentation flow. Full-plan execution targets each discovered component by ID without changing the designer's Figma selection; there is no separate batch mutation or persisted dependency queue.

Implemented in the first slice:

- bounded, cycle-safe dependency collection from the selected component tree;
- exact existing-spec recognition under the active project's `component-specs/` directory;
- conditional workflow guidance that asks before any dependency-documentation work;
- additive `Nested Components` references in the parent Markdown handoff;
- unit coverage for unchanged non-nested behavior, existing and missing specs, repeated variants, cycle handling, and traversal limits.

The workflow also supports a session-scoped **Skip for now** choice while reviewing missing dependencies. Skipping performs no write, removes only the current item from the in-conversation queue, and does not prevent future inspections from flagging it again.

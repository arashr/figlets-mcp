# Figma Make Guidelines Export — Feature Plan

## Status

Planning proposal created 2026-07-20 and refined on 2026-07-22 after designer testing and clarification. The MVP runtime, Agent Interface workflow, adapters, and automated coverage were implemented on 2026-07-22. The component routing contract was updated on 2026-07-23 after checking the current Figma guidance and observing Make's canonical `components.md` entrypoint. Manual disposable-Figma-Make acceptance-corpus testing remains a release follow-up because it requires validating the exported overlay inside the evolving Make product.

This plan is based on current official Figma documentation rechecked on 2026-07-23. Figma Make is evolving quickly, so the linked sources must be rechecked again before release.

### Implemented MVP surface

- `prepare_make_guidelines` performs read-only source resolution, exact component-spec discovery, model/render/lint, optional suggestions, file diffing, and source fingerprinting.
- `save_make_guidelines_profile` persists only approved optional guidance and explicit skip state in file-scoped `make-guidelines.config.json`.
- `export_make_guidelines` requires explicit approval plus the current fingerprint, refreshes only generated manifest files under the guarded project root, and returns placement instructions.
- `@figlets/core` owns deterministic config/snapshot normalization, CSS serialization, progressive guideline rendering, provenance records, and linting.
- The Agent Interface exposes `export-make-guidelines` as the sixth designer workflow and disambiguates a vague “export guidelines” request from DESIGN.md.
- Existing imported Figma files use snapshot bootstrap in memory; prepared Figlets configs can supply a config-derived snapshot when the Figma file does not contain built design-system artifacts yet.
- Every valid project-scoped `component-specs/*.md` file is incorporated as evidence-backed component guidance. Exact Figma-name matches enrich snapshot components; documented components absent from the current snapshot remain available as spec-backed guidance. Snapshot-only components remain a factual catalog.
- Automated verification passes `npm test` (**114/114**) and `git diff --check`; disposable Make-project acceptance-corpus smoke remains pending.

## Product Goal

Add a first-class Figlets workflow, parallel to `export_design_md`, that prepares a useful Figma Make `guidelines/` bundle from an existing design system.

The generated guidance should help Figma Make produce prototypes that stay close to the existing design language without pretending that a Figma file contains product, implementation, or component-usage decisions that it does not actually expose.

The workflow has two starting points:

1. **Known Figlets design system** — a file-scoped `design-system.config.js` already exists, either from an existing setup or a newly completed Figlets setup.
2. **Imported Figma design system** — the open Figma file contains variables, styles, and possibly components, but Figlets does not yet have a trusted config or enough confirmed policy to write useful Make guidelines.

The MVP end state is a reviewed local bundle containing Figma Make guidelines and, when the design-system data is sufficient, a companion `styles.css`. Its relative paths should mirror Figma's documented library-style structure so the files can be placed into Make without the designer having to design the file organization themselves.

The designer does not need to understand or configure npm packages, package manifests, React, or Vite. CSS is treated as a generated design-system artifact, not as a package-management decision.

## Why This Is Separate From DESIGN.md

`DESIGN.md` is a portable design-system handoff and round-trip artifact. Figma Make guidelines are behavioral instructions for an AI code-generation environment.

The outputs share design-system facts, but have different contracts:

- `DESIGN.md` records tokens and design-system context.
- Make guidelines explain what Make should use, how it should choose among available assets, what it must avoid, and where to read more detail.
- Make guidelines should use progressive disclosure across multiple short files instead of one exhaustive document.

Do not make `Guidelines.md` another serialization of `design-system.config.js`, and do not make Make guidelines a new source of truth for Figlets setup.

## Current Figma Make Baseline

The following are current official behaviors and recommendations as of the research date:

- Every Make file has a `guidelines/` folder and can accept one or more uploaded Markdown files.
- Make reads the guidelines as standing context on future prompts.
- A published Figma library can be brought into Make as style context. Figma creates a library-named folder containing `styles.css` and a library-specific `guidelines/Guidelines.md`.
- The root `guidelines/` folder contains routing and setup guidance. Figma's documented example includes `Guidelines.md`, `setup.md`, `styles.md`, `tokens.md`, and `components/`.
- The library `styles.css` is a simplified extraction: Figma pulls a subset of variables into one global CSS file with raw values. It does not preserve the full variable model or syntax one-to-one.
- Figma recommends putting token-format quirks first, organizing token guidance around design decisions rather than stylesheet order, giving typography dedicated coverage, preferring semantic tokens over raw values, documenting prohibitions, and providing complete snippets for composed values such as shadows.
- `Guidelines.md` is the top-level entrypoint and should route Make to focused supporting files.
- Figma recommends multiple short files, subfolders, overview files, imperative wording, decision-oriented token organization, explicit prohibitions, dedicated typography guidance, and complete examples for composed values such as shadows.
- Additional guideline files do not have a guaranteed reading order beyond the initial top-level file. The top-level file must define the navigation and reading workflow.
- Existing Make files that used extracted style context before Make kits continue to work. For newly importing a library, current Figma documentation routes the operation through Make kits, but Figlets MVP does not require the designer to configure an npm package.
- CSS or guideline edits inside Make do not change the source Figma library.

### Official sources

- [Add guidelines to Figma Make](https://help.figma.com/hc/en-us/articles/33665861260823-Add-guidelines-to-Figma-Make)
- [Get started with Make kits](https://help.figma.com/hc/en-us/articles/39241689698839-Get-started-with-Make-kits)
- [Bring style context from a Figma Design library to Make kits](https://help.figma.com/hc/en-us/articles/33024539096471-Bring-style-context-from-a-Figma-Design-library-to-Make-kits)
- [Write design system guidelines for Make kits](https://developers.figma.com/docs/code/write-design-system-guidelines/)
- [Bring your design system package to a Make kit](https://developers.figma.com/docs/code/bring-your-design-system-package/)
- [Best practices for optimizing AI credits in Figma Make](https://help.figma.com/hc/en-us/articles/40097793879191-Best-practices-for-optimizing-AI-credits-in-Figma-Make)

## Non-Negotiable Product Rules

1. **Evidence before instruction.** A prescriptive guideline must come from confirmed Figlets config, exact Figma facts, existing component documentation, or an explicit designer answer.
2. **No invented implementation API.** Never infer React component imports, prop names, CSS custom-property names, providers, dependencies, or build configuration from Figma component or variable names alone.
3. **No invented usage policy.** A component name, property list, or visual appearance does not prove when a component should be used, which variant is preferred, or what combinations are forbidden.
4. **Preserve provenance.** The planner must distinguish `observed`, `config-confirmed`, `designer-confirmed`, `inferred-needs-confirmation`, and `unavailable` information.
5. **Ask only for genuine blockers.** Optional information is suggested after a useful preview rather than demanded. If a blocker or designer-chosen refinement needs conversation, ask one targeted question per assistant turn and retain multi-topic answers.
6. **Preview before local writes.** Preparing guidelines is read-only. Writing the bundle requires explicit approval after the designer sees the proposed files, included sections, omitted sections, warnings, and unresolved gaps.
7. **No Figma mutation.** This workflow reads/syncs Figma and writes an approved local Markdown/CSS bundle only. It does not modify the design library or a Figma Make file.
8. **No package burden in MVP.** Do not ask the designer about npm packages, manifests, providers, React, Vite, or build configuration. Do not imply that package knowledge is required to get useful guidelines and CSS.
9. **Prefer semantic decisions over inventories.** Guidance should help Make choose a surface, text role, spacing role, or component. It should not dump hundreds of variables alphabetically.
10. **Keep current Figma behavior date-stamped.** The tool and docs should expose the Figma Make documentation review date used by the implementation so future maintainers know when to revalidate it.
11. **Useful before enrichment.** When Figlets already has enough confirmed information, prepare a usable draft immediately. Optional product-character, composition, or usage detail must not become a forced intake loop.
12. **Suggestions are optional.** The preview may offer concrete, editable additions where more context could improve Make's output. The designer can accept, edit, ignore, or skip all suggestions without being asked again.
13. **Figlets owns the local CSS.** Figma generates style context only inside its own Make project. The separate project-workspace `styles.css` is always generated by Figlets from Figlets/config/snapshot facts; there is no import-or-preserve branch for Figma-generated CSS.
14. **Ask before refresh.** If a Figlets-generated bundle already exists, prepare the replacement manifest and ask approval before refreshing it. After approval, regenerate the managed bundle; do not introduce merge or post-handoff lifecycle management.
15. **Do not claim Figma extraction parity.** The bundle mirrors Figma's documented relative structure, but Figlets owns its CSS serialization contract and does not claim to reproduce Figma's undocumented internal extraction bytes.

## Recommended MVP Output

Default local output, mirroring the relevant parts of Figma's documented structure:

```text
specs/figma-make/
├── guidelines/
│   ├── Guidelines.md
│   ├── setup.md
│   ├── styles.md
│   ├── tokens.md
│   ├── components.md
│   ├── foundations/
│   │   ├── overview.md
│   │   ├── color.md
│   │   ├── typography.md
│   │   ├── spacing-and-layout.md
│   │   ├── modes.md
│   │   └── elevation.md
│   ├── components/
│   │   └── overview.md
│   └── composition/
│       └── overview.md
└── src/
    └── <library-slug>/
        ├── guidelines/
        │   └── Guidelines.md
        └── styles.css
```

Only files with supported content should be emitted. Empty folders and placeholder policy should not be generated.

This is a portable overlay, not a complete Make project or Make kit. MVP must not generate Figma's surrounding `package.json`, `postcss.config.mjs`, `vite.config.ts`, `ATTRIBUTIONS.md`, or application source tree.

The default output root is `<project_path>/specs/figma-make/`, parallel to `<project_path>/specs/DESIGN.md`. `output_path` may override it. If `project_path` is unavailable, use the existing guarded MCP working-directory fallback and report the resolved destination before approval.

### Top-level entrypoint

`Guidelines.md` should contain:

- design-system name and confirmed product character, when available;
- the source-of-truth hierarchy;
- the available guideline files and when Make must read them;
- global rules and prohibitions with strong evidence;
- any important gaps in the available design or component rules, stated plainly instead of guessed;
- a short workflow for selecting tokens, components, icons, and layout guidance.

Keep `Guidelines.md` as a short overview. Put relevant token details in `tokens.md` and the focused foundation files, while the complete generated CSS variable inventory lives in `src/<library-slug>/styles.css`.

### Foundation files

Foundation guidance should be organized around decisions:

- **Color:** surfaces, foregrounds, icons, borders, status roles, semantic-before-primitive priority, supported modes, and verified pairings.
- **Typography:** every confirmed role with family, weight, size, line height, tracking, responsive behavior, and when-to-use notes only where confirmed.
- **Spacing and layout:** semantic spacing roles first, primitive values as fallback/reference, radius, border widths, grid, and breakpoint thresholds only when confirmed.
- **Modes:** light/dark and responsive modes; distinguish Figma mode names from actual CSS breakpoint widths.
- **Elevation:** complete composed shadow examples when exact composition is known; otherwise list observed effect styles without inventing CSS.

### Component files

MVP should emit `components.md` and `components/overview.md` only when components are present in the synced snapshot or component specs are supplied. `components.md` is the canonical component entrypoint: it must link to the complete catalog and directly link every generated component-specific guideline under `components/`. The root `Guidelines.md` must route Make through `components.md`.

Safe catalog facts include exact name, Figma description, variants/component-property definitions, and links to generated component specs. State plainly when usage/API guidance is unavailable.

Per-component Make guidelines should be generated only from an existing Figlets component spec, existing component documentation, or explicit designer-authored usage rules. Snapshot names alone are insufficient.

The bundle linter must reject an export when `components.md` is missing, when the root entrypoint does not link to it, or when any generated component-specific guideline is not directly linked from it. This keeps the granular folder useful without leaving its files undiscoverable to Make.

Component-spec discovery is project-scoped and independent from the current Figma component inventory. Read component identity from the first Markdown H1, falling back to the filename stem, so versioned filenames remain compatible. Preparation must report the exact searched directory, every discovered file, exact Figma matches, and spec-only components. If multiple files resolve to the same component identity, block with the conflicting paths instead of selecting one silently.

### Composition files

Composition guidance includes density, surface hierarchy, navigation hierarchy, page layout, and content grouping. These usually cannot be inferred safely from tokens alone.

For MVP, emit `composition/overview.md` only from confirmed config fields, supplied documentation, or designer intake. Otherwise omit it and report the omission in the preview.

### `setup.md`, `styles.md`, and library guidance

When `styles.css` is emitted, generate a concise root `guidelines/setup.md` that tells Make where the stylesheet is and that it must be loaded globally. It must not contain package installation, provider, framework, or build-configuration instructions.

Generate `guidelines/styles.md` from the actual stylesheet contract: naming/escaping, units, available modes, and any composition requirements. Generate `src/<library-slug>/guidelines/Guidelines.md` as the local entrypoint for that library's stylesheet and link it back to the root routing files.

If safe CSS generation is unavailable, omit these CSS-dependent files and keep the Markdown guidelines export usable. Report the omission as a non-blocking warning, not as a reason to withhold the whole bundle.

### Companion `styles.css`

MVP supports one source design-system library per export and should generate one global stylesheet when exact Figlets/config/snapshot values can be serialized safely. The stylesheet should favor semantic variables while retaining primitives needed by those semantics, use standards-valid CSS values, and preserve a deterministic source-to-CSS name map.

For CSS names, prefer a valid Figma variable `codeSyntax.WEB` value when the designer has provided one. Figlets already captures `codeSyntax` through both bridge and REST snapshots. Variables without usable Web syntax use a deterministic, CSS-safe fallback derived from the exact Figma variable path; the preview shows every fallback and collision repair.

Define and version Figlets' serializer with fixtures covering color, number, string, boolean, aliases, multiple collections and modes, typography/styles, effects, special characters, hidden/private variables, and name collisions. Use CSS parsing plus disposable Make-project smoke tests to validate the output. Figma's public documentation determines the file organization and guideline strategy, not Figlets' internal CSS bytes.

## Source and Provenance Model

Introduce a normalized, pure `makeGuidelinesModel` before Markdown rendering:

```js
{
  schemaVersion: 3,
  source: {
    kind: "figlets-config" | "figma-snapshot-bootstrap",
    fileKey: "...",
    configPath: "...",
    snapshotPath: "...",
    syncedAt: "..."
  },
  product: {},
  foundations: {},
  components: [],
  composition: {},
  styleContext: {
    status: "figlets-generated" | "unavailable",
    generator: "figlets",
    librarySlug: "...",
    stylesheetPath: "src/<library-slug>/styles.css",
    nameSourcePriority: ["codeSyntax.WEB", "figlets-path-fallback"],
    nameMap: [],
    limitations: []
  },
  rules: [],
  prohibitions: [],
  provenance: [],
  blockingGaps: [],
  suggestions: [],
  omittedSections: [],
  warnings: []
}
```

Each generated rule and CSS value should be traceable to a source record. Inference may produce an optional suggestion, but `inferred-needs-confirmation` entries must not be rendered as imperative instructions or CSS values in the final approved bundle.

## Make-Specific Supplemental Profile

Do not overload `design-system.config.js` with product personality or Make-only authoring preferences.

Recommended file-scoped companion artifact:

```text
.local/<fileKey>/make-guidelines.config.json
```

It should store only confirmed Make-specific inputs: product purpose/character, density/surface strategy, composition rules, breakpoint widths, icon restrictions, component policy sources, and Make-specific prohibitions.

The design-system facts remain in `design-system.config.js` and the synced snapshot. Prefer JSON unless a demonstrated need for computed values appears.

## Workflow A — Existing Figlets Config or Completed Setup

1. Start and route to `export-make-guidelines`.
2. Sync unless the designer explicitly chooses a cached snapshot.
3. Read current config facts and the latest snapshot without mutating the config during preparation.
4. Build the model from config plus snapshot, or derive a read-only snapshot from a prepared Figlets config when Figma has not been built yet.
5. Generate the guideline draft and CSS companion preview from confirmed Figlets facts.
6. Load any Make profile and component specs.
7. If a genuine blocker remains, ask one targeted, designer-readable question. Do not block on optional enrichment.
8. Show the exact manifest, evidence, omissions, warnings, and a skippable set of suggested additions.
9. Ask approval, write only the approved manifest, then lint and report paths.

An existing config reduces foundation intake, but it does not answer product personality, component usage, or composition rules automatically.

## Workflow B — Existing Figma File Unknown to Figlets

1. Start and route to the workflow.
2. Run `sync_figma_data` and classify the file through shared inventory helpers.
3. If no design-system artifacts exist, stop the export path and offer the existing setup flow.
4. Otherwise derive a candidate model through existing snapshot bootstrap helpers.
5. Mark exact values/names as observed and ambiguous relationships as confirmation-required.
6. Prepare the useful guideline draft and any safely serializable CSS before asking for enrichment.
7. Return usable facts, genuine blockers, skippable suggestions, omissions, and unsupported design-policy information.
8. Ask exactly one targeted, designer-readable question only when a blocker prevents safe export or when the designer chooses to refine a suggestion.
9. Persist confirmed local config/profile data only through guarded local boundaries; never mutate Figma.
10. Preview, approve, write, and lint the bundle.

Reuse `bootstrapDsFromSnapshot`, semantic grammar detection, design-system inventory, config refresh, and component snapshot facts. Do not create another Figma-to-config inference pipeline.

## Intake Policy

The default action is translation, not intake: use what Figlets already knows, generate the preview, and let the designer decide whether they want to enrich it.

`needsDesignerInput` is reserved for genuine blockers such as not knowing which Figma file/config is in scope, an unsafe output destination, or contradictory source facts that would produce invalid guidance. A missing product personality, composition preference, component policy, breakpoint meaning, or icon rule does not block a useful foundations bundle.

Potential optional suggestions include:

1. What product or prototype should these rules help Make create?
2. What visual character or density should Make preserve when it is not already documented?
3. Which inferred semantic grammar or pairings are correct when ambiguous?
4. How should named modes be used when structure alone does not establish policy?
5. What widths correspond to responsive modes, if responsive breakpoints will be prescribed?
6. Should components be omitted, cataloged as Figma assets only, or enriched from existing component documentation?
7. What icon source or restrictions apply?
8. What composition rules are mandatory?
9. What must Make always do, and what must it never do?

Present these as concrete, editable ideas grounded in the observed design system—for example, “Your semantic colors suggest using neutral surfaces with brand color reserved for actions; add this as a rule?”—with `Accept`, `Edit`, `Skip`, and `Skip all` behavior. Do not repeatedly ask about skipped topics.

If the designer chooses to refine suggestions conversationally, ask at most one designer-readable question per turn. Do not introduce package terminology or ask the designer to make implementation decisions.

Optional enrichment should not block a foundations-only bundle when the preview states what is omitted.

Interaction order is part of the product contract. When preparation returns optional suggestions, the agent must show them and ask the skippable `Accept` / `Edit` / `Skip` / `Skip all` question before asking for export approval. It must not combine that question with export confirmation or surface it only after generation was approved. The prepared result exposes this as `interaction.mustReviewOptionalSuggestionsBeforeExportApproval`; export requires `optional_suggestions_reviewed: true` when suggestions remain in the approved preview.

## Proposed Public Surfaces

The approval boundary differs from DESIGN.md because this flow collects Make policy and writes multiple files. A dedicated prepare/export pair is justified.

### `prepare_make_guidelines`

Read-only responsibilities:

- optionally sync or use a supplied snapshot;
- classify config/source trust;
- build the normalized model;
- load the Make profile and optional component documentation;
- return only genuine blocking input separately from optional suggestions;
- return the deterministic manifest with full preview content;
- return provenance, CSS provenance/name mapping, omissions, contradictions, warnings, and compatibility metadata;
- never write config or guidelines.

Suggested result order:

```js
{
  message,
  summary,
  readiness,
  exportPlan,
  needsDesignerInput,
  suggestions,
  warnings,
  provenance,
  interaction,
  source
}
```

### `save_make_guidelines_profile`

Local config-only responsibilities:

- accept confirmed answers;
- validate a strict schema;
- write only the file-scoped Make profile;
- reject unsupported fields;
- never mutate Figma or write the final bundle.

This may be deferred if MVP keeps answers in one session, but persistence is strongly recommended for repeatable exports.

### `export_make_guidelines`

Local write responsibilities:

- require an approved current `exportPlan` or repeat deterministic checks;
- reject stale source fingerprints;
- detect an existing Figlets-generated manifest, preview the full refresh, and require approval before replacing it;
- write only the approved manifest beneath a guarded root;
- prevent absolute-path escape and parent traversal;
- replace managed Figlets output files without attempting to merge post-generation edits;
- avoid deleting unrelated files outside the managed manifest;
- return every written path and the post-write lint result.

Do not add a format switch to `export_design_md`. Extract shared source resolution, sync, config loading, safe-path, and fingerprint helpers instead.

## Source Fingerprinting and Staleness

Fingerprint config and snapshot contents, file key, Make profile, component specs, Figlets CSS serializer/schema version, source-to-CSS name map, and the Figma documentation baseline date.

Export should fail closed when a prepared plan is stale and ask the agent to prepare again.

## Rendering Rules

- Use exact public names; do not silently normalize token/component names.
- Use imperative language only for confirmed policies.
- Prefer tables for typography and compact token decisions.
- Prefer semantic tokens when the system actually has them.
- State plainly when only primitive tokens exist.
- Emit only the local stylesheet-loading guidance needed for the generated `styles.css`; do not emit package, framework, provider, or build-configuration guidance.
- Include code-like token examples only when their names, units, and composition are confirmed design-system facts.
- Treat paint styles/gradients as observed facts, not config tokens.
- Explain modes without inventing breakpoint widths.
- Do not claim accessibility beyond actual Figlets checks or confirmed standards.
- Keep files focused and route from the top level.

## Validation and Linting

Add a deterministic linter for:

- one top-level entrypoint;
- valid internal links and no path escape;
- conflicting imperative rules;
- unresolved placeholders;
- inferred/unavailable facts presented as policy;
- imports/CSS variables without source records;
- invalid CSS, duplicate normalized custom-property names, unsafe escaping, or unresolved aliases;
- a `setup.md` stylesheet path that does not resolve to the generated manifest;
- CSS-dependent guidance when `styles.css` is omitted;
- breakpoint pixels without confirmed sources;
- missing token/component references;
- oversized top-level guidance;
- empty generated files;
- stale source fingerprints.

Errors block export; advisories appear in the approval preview.

## Architecture Fit

### Shared core

Add pure helpers for normalized model construction, provenance, deterministic Markdown/CSS rendering, source-to-CSS name mapping, bundle linting, and fingerprint inputs. Reuse existing config, semantic, typography, spacing, elevation, inventory, and component fact helpers.

### MCP server

Own source resolution, guarded filesystem access, sync/config refresh, profile persistence, optional component-documentation loading, tool schemas, writes, and verification.

### Figma Bridge

MVP should need no new mutation command. Extend snapshot extraction only for a demonstrated missing read-only fact exposed reliably by Figma's Plugin API.

### Agent Interface

Add workflow id `export-make-guidelines` and a sixth menu item:

> Generate Figma Make guidelines

Route concrete Make-guideline phrases to it. Ambiguous "export guidelines" should ask whether the designer means DESIGN.md or Figma Make guidelines.

## Implementation Slices

### Slice 0 — Contract and current-doc baseline

- Recheck official sources.
- Record the latest official Figma file-structure and guideline baseline.
- Confirm the package-free, Figma-aligned bundle boundary, JSON profile, one-library scope, and `<project_path>/specs/figma-make/` default.
- Define schemas, provenance, readiness, and fingerprints.
- Add docs tests keeping this distinct from DESIGN.md.

### Slice 1 — Pure guideline model and renderer

- Build from a trusted config and snapshot.
- Render top-level plus foundation files.
- Add linting and no-invention unit tests.

### Slice 2 — Existing-config prepare/export

- Implement prepare and guarded export.
- Add approval/staleness contracts and Agent Interface workflow.

### Slice 3 — Unknown-Figma-file intake

- Reuse bootstrap and semantic grammar detection.
- Add readiness and targeted missing-input contracts.
- Add profile persistence and empty/ambiguous-state coverage.

### Slice 4 — Components and composition

- Add safe component catalog output.
- Auto-discover exact component-spec matches and request confirmation only for ambiguous matches.
- Generate per-component or composition guidance only with evidence.

### Slice 5 — Figma-aligned CSS companion

- Implement the Figlets-owned source-to-CSS serializer with valid `codeSyntax.WEB` first and a deterministic CSS-safe Figma-path fallback.
- Emit `src/<library-slug>/styles.css`, its library-local guidelines, and root `setup.md`/`styles.md`.
- Validate CSS syntax, references, modes, collisions, units, escaping, and omission behavior.
- Do not generate package/build files.

## Test Plan

### Core

- deterministic foundation bundle from trusted config;
- decision-oriented semantic color organization;
- exact confirmed typography only;
- no invented semantics for primitive-only systems;
- inferred relationships excluded until confirmation;
- no invented breakpoint pixels, CSS names, implementation APIs, or component policies;
- composed shadows only with complete evidence;
- `codeSyntax.WEB` precedence plus Figlets-owned fallback serialization with deterministic names, values, modes, units, and escaping;
- CSS generation fails locally without blocking the Markdown bundle when a source cannot be serialized safely;
- no empty files and lint catches broken/unsupported content.

### Server

- prepare is read-only for existing and unknown sources;
- empty files route to setup;
- dry run writes nothing;
- approved export writes only the manifest;
- refreshing an existing Figlets bundle requires approval and then replaces the managed manifest;
- stale fingerprints block export;
- safe `project_path`/`output_path` handling;
- optional component specs included only when requested;
- Figma-aligned manifest paths are exact and `setup.md` resolves to the generated stylesheet;
- no package questions, package files, or framework/build instructions are emitted.

### Workflow/docs

- menu/routing/ambiguity behavior;
- useful preview without optional intake when Figlets facts are sufficient;
- genuine blockers remain one question at a time;
- suggestions are concrete, editable, skippable, and never repeated after `Skip all`;
- preview and local-write approval;
- root/plugin/Agent Interface guidance parity;
- official source links and review date recorded.

### Manual smoke

Test a fresh Figlets system, mature non-Figlets library, primitive-only file, responsive multi-mode system, special-character/collision fixture, and undocumented component library. Place the generated overlay into disposable Make projects and run the fixed acceptance corpus: dashboard, form, list/detail, empty/error states, responsive layout, light/dark behavior, plus one designer-selected prompt. Confirm that Make loads the stylesheet from the documented relative structure and that a designer can complete the flow without npm/package knowledge. Markdown and CSS snapshots alone are insufficient.

## MVP Acceptance Criteria

- Both requested starting points work.
- Output is a multi-file overlay matching Figma's documented root-guidelines plus library-folder structure.
- Trusted config is reused; unknown Figma is inspected before writes.
- A usable preview is produced without optional questions when Figlets has sufficient source data.
- Only genuine blockers trigger one targeted question per turn; enrichment is suggested and skippable.
- Every imperative rule has traceable evidence.
- When source values are safely serializable, the bundle includes one Figlets-generated `src/<library-slug>/styles.css`, root CSS usage guidance, and library-local guidance.
- The flow does not ask for or require npm-package or framework knowledge.
- No implementation API, CSS syntax, breakpoint width, component policy, or product personality is invented.
- Exact manifest and omissions are previewed before approval.
- Export writes only approved local files and never mutates Figma.
- Lint passes and manual Make smoke shows closer design-language adherence than the same prompts without the bundle.
- Full repo tests and `git diff --check` pass.

## Post-MVP Expansion Ideas

1. Optional Make-kit guidance that explains kits in designer language only when the designer chooses to explore them.
2. Evidence-backed package integration for teams that already have implementation artifacts, with no package assumptions inferred from Figma.
3. Read-only Make result audits against confirmed tokens/components.
4. Per-component Make files derived from Figlets component specs.
5. Storybook, TypeScript, Code Connect, or package export ingestion.
6. Guideline effectiveness scoring over the fixed prompt corpus.
7. Contradiction analysis across generated files.
8. Organization policy layered over DS-specific guidance.
9. Make kit release checklist.
10. Compactness/redundancy budget to reduce AI-credit waste.
11. A first-prompt generator that references installed guidelines.

## Resolved Product Decisions

1. Use the latest official Figma documentation as the structural baseline; do not require a designer-supplied Figma Make file tree.
2. Generate a package-free, multi-file overlay for one source design-system library.
3. Generate and refresh CSS only inside the Figlets project workspace. Existing CSS there is Figlets-owned; show the refresh and ask approval before replacement.
4. Use `<project_path>/specs/figma-make/` by default, parallel to DESIGN.md's project-scoped export.
5. Persist accepted Make-only guidance in `.local/<fileKey>/make-guidelines.config.json`.
6. Auto-discover every Markdown component spec in the canonical project `component-specs/` directory. Use its H1 as component identity and fall back to the filename stem. Exact Figma matches merge snapshot facts with the spec; spec-only components still generate component guidance. Fail closed when multiple files resolve to one identity.
7. Return tailored placement/upload instructions with the export result, without adding unrelated files to the overlay.
8. Do not manage, merge, or track what happens to generated files after the Figlets export flow ends.
9. Use the fixed acceptance corpus defined in the manual smoke plan plus one designer-selected prompt.

No product decision remains open before implementation. CSS selector/mode serialization details are implementation decisions constrained by the confirmed model, standards-valid CSS, tests, and Make smoke verification.

## Explicit Non-Goals for MVP

- Asking the designer to choose, configure, publish, or understand a Make kit or npm package.
- Generating package metadata, installation commands, framework setup, providers, or build configuration. A CSS-only `setup.md` is in scope.
- Publishing/updating a Make kit, Figma library, or npm package.
- Writing directly into a Figma Make file.
- Generating a React component library from Figma.
- Guessing CSS variable names outside the versioned Figlets normalization contract.
- Treating simplified extracted CSS as lossless token export.
- Inventing component APIs, usage rules, accessibility guarantees, or product personality.
- Replacing `DESIGN.md`, component specs, or `design-system.config.js`.
- Mutating the Figma design-system file during export.

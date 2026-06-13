# Future Figlets Gap Register

## Purpose

This document captures project gaps that are related to the bulk-repair API work but should be planned separately. Do not implement every item here in the same pass. Use this as a future roadmap and risk register.

## Gap Register

| ID | Gap | Designer symptom | Why it matters | Suggested next slice |
|---|---|---|---|---|
| G-001 | No single full health-check tool | Agents can still over-rely on one clean `audit_tokens` result or forget a step | The product rule says health means token audit plus setup/accessibility QA | **Partially addressed (2026-05-23):** `figlets_health_check` v1 is a read-only agent readiness/workflow feedback tool covering entrypoint, routing, approval, repair payload, product-gap, stale-host, and bridge-readiness checks. A future v2 can decide whether to orchestrate actual Figma read-only audits. |
| G-002 | Long MCP outputs can still be truncated by hosts | Less capable agents may miss nested arrays, optional payloads, or instructions | Host truncation was one root cause of agents parsing local tool-result files | Add paginated/detail tools such as `figlets_get_finding_details` or compact summaries with stable IDs. Keep repair payloads top-level. |
| G-003 | Host smoke testing is manual | Claude/Codex behavior can drift even when unit tests pass | The product depends on agent compliance, not only server correctness | **Partially addressed (2026-05-22):** `npm run smoke:plugins`, `tests/plugins/host-agent-interface-smoke.test.js`, and packed Agent Interface checks in `verify:release`. Real Claude Code `/figlets:start` and Codex UI connection still need manual restart verification. |
| G-004 | Bridge capability/version mismatch is easy to hit | Agent says a tool is unavailable until the designer reloads the plugin | Local plugin and MCP server can be out of sync during development | Add a clearer `figlets_doctor` or capability check exposed through Agent Interface, with exact reload instructions. |
| G-005 | Release packaging is not continuously verified | Plugin manifests can point at tarballs that have not been rebuilt or released | Designer install breaks if server, plugin version, and release asset drift | **Addressed (2026-05-23):** `npm run release:prepare -- --check` validates workspace packages, plugin manifests, tarball URLs, and lockfile drift from `packages/figlets-mcp-server/package.json`. `npm run verify:release` and `npm run smoke:plugins` rebuild/validate the tarball and run packed Agent Interface smoke. Run before tagging/publishing. |
| G-006 | `apply_ds_setup` is broad and lacks dry-run merge-only mode | Agents may avoid using it for missing config-backed tokens or overuse it as a repair hammer | It can merge some missing typography/spacing variables today, but it is not presented as a narrow repair surface | Add a merge-only dry-run/apply mode or supersede it with `inspect_ds_token_gaps` + `update_ds_tokens`. |
| G-007 | Showcase visual changes lack automated preview QA | Small Figma showcase layout changes can regress readability | The designer-facing showcase is a product artifact, not just data output | Build an HTML/canvas preview harness plus screenshots before porting visual changes into Figma renderer. |
| G-008 | Showcase coverage still depends on config quality | Generated configs for imported files may omit or misclassify roles | Imported design systems are common; bad bootstrap confidence creates confusing showcases | Add a config review report that shows inferred pairs, icons, outlines, standalone roles, and uncertain mappings before showcase generation. |
| G-009 | Host-native selection UI support is inconsistent | Ambiguous routing may show text prompts instead of true choices | Figlets exposes `selectionPrompt`, but hosts render differently | Add host-specific rendering notes and tests for plain-text fallback quality. |
| G-010 | Color swatches in Markdown are host-dependent | Agents may show token names and hex but no visual chips | Designers benefit from visual confirmation, but Markdown support varies | Keep structured hex/contrast data, then add optional host-rendered swatches where supported. |
| G-011 | Generic Figma manipulation pressure will keep returning | Agents may ask for "bulk arbitrary edits" instead of product-owned workflows | Native Figma MCP is expensive, but a generic replacement would be unsafe and hard to QA | Document the boundary: build deterministic design-system APIs, not arbitrary Figma authoring. Add examples of allowed vs rejected operations. |
| G-012 | Typography binding confidence is conservative | `qa_binding_audit({ fix: true })` may not apply text style suggestions that feel obvious to designers | Agents may report typography gaps but fail to fix them | Add exact-match high-confidence typography binding rules and keep role-only matches as review-only. |
| G-013 | Elevation/effect audit is thin | Shadow/elevation styles can be missing or raw without a clear repair plan | Elevation is part of a complete design system and showcase | Add config-backed elevation completion first, then consider QA for raw effects/shadows on nodes. |
| G-014 | Missing token creation from page usage is not supported | QA can say "no exact variable found" but cannot propose creating one | Designers may expect Figlets to turn repeated raw values into tokens | Future planner: aggregate repeated raw values, propose token names, ask designer approval, then create tokens. Keep this separate from config-backed completion. |
| G-015 | Active-file changes are easy to miss in long sessions | Agent may analyze the wrong synced file after the designer switches Figma files | Prior work fixed active-file context, but agent summaries can still be unclear | Add a standard active-file banner in workflow summaries when `sync_figma_data` changes file keys. |
| G-016 | Remote/library variables may not resolve everywhere | Audits can lose context when aliases point to remote library variables | Real teams often use libraries; local-only assumptions reduce accuracy | Expand snapshot/export resolution and reporting for remote variables, with clear unavailable states. |
| G-017 | Error recovery copy is scattered | Agents may explain bridge/receiver/config errors inconsistently | Designer trust depends on calm, exact recovery steps | Centralize common recovery messages in Agent Interface and reuse across tools. |
| G-018 | Config updates after Figma writes are category-specific | Some repairs update local config, others only mutate Figma or rely on refresh | Drift between Figma and config causes future showcase/export surprises | Define a per-tool config synchronization contract and test it. |
| G-019 | `update_ds_primitives` name is becoming misleading | The tool now touches color semantics and may be asked to handle more | Naming confusion makes less capable agents misuse or underuse it | Keep compatibility, but introduce `update_ds_tokens` as the clearer long-term surface. |
| G-020 | Component documentation still depends on existing bindings | Generated docs can be weaker when components use raw values | Documentation quality depends on QA/binding readiness | Route component docs through binding QA first and expose "doc quality blockers" before generation. |
| G-021 | Figma plugin localhost architecture limits public distribution | Designers need local bridge setup before MCP tools can mutate/read live Figma | Published Figma plugins cannot depend on localhost the same way | Track a future bridge architecture or distribution path if public/community Figma install becomes a goal. |
| G-022 | No product-level audit of agent instruction drift | Root docs, adapter docs, plugin skills, and Agent Interface can diverge | Less capable agents follow whichever instruction they see first | Add tests that compare key hard-rule phrases and supported workflow names across all entrypoints. |
| G-023 | No standard "what changed" summary after bulk applies | Apply tools return raw created/updated arrays, but designer summaries vary by agent | Designers need confirmation that exact approved changes were made | Add normalized post-apply summary fields and recommended verification next step to every mutation tool. |
| G-024 | Accessibility rules beyond color contrast are not planned | Typography size, touch target, focus visibility, and motion are outside current QA | Designers may interpret "healthy" as broader accessibility compliance | Define the explicit accessibility scope of each health check and add future checks one at a time. |
| G-025 | Semantic color naming grammar is modeled as a binary choice | Health-check can ask designers to choose surface-based vs role-based and then propose confusing deprecations such as treating `on-fill-*` contextual roles as duplicates | Real systems use multiple valid grammars: paired context, element-first, intent/emphasis, and component-scoped overlays | Implement `docs/semantic-color-naming-flow-plan.md`: add a grammar classifier, classify odd names by invalid/ambiguous/true-duplicate/distinct-context/unknown, keep naming low priority in existing-system checks, and update setup intake to offer viable naming structures. |
| G-026 | Responsive spacing modes can be duplicated but reported as acceptable | After Tablet/Desktop modes are created, Figlets can say matching Mobile values are acceptable because they match config and alias to primitives | Duplicating Mobile spacing values into Tablet/Desktop is not a validated responsive spacing decision. Alias health and config matching do not prove per-breakpoint values are intentional. | **Addressed by BNN-54 (2026-06-11):** `inspect_ds_token_gaps` now reports healthy aliases with duplicated responsive mode values as responsive validation advisories, not apply-ready repairs. When Figlets just created the modes, this is responsive setup validation work before spacing is complete; for pre-existing modes, it can be a designer validation item unless config explicitly allows same-value modes for that token/category. The review option also surfaces pending raw semantic spacing alias repairs and offers an editable responsive-spacing suggestion/template instead of forcing a back-and-forth. Duplicate raw `space/layout/*` repairs are moved out of same-value alias apply and into the responsive suggestion path when matching primitives exist. |

## Recommended Future Priority

### Next Slice: Post-Phase-3 Reliability And Release Hardening

Phase 3 token completion is closed. The next roadmap slice should protect that completed surface area in real host sessions before adding another broad product capability.

Include these work packets:

1. BNN-6 bridge reliability cleanup: migrate remaining high-value bridge-backed tests/tools toward `bridge-request.js` where hook transport removes localhost fragility.
2. Release/package verification: cover G-005 with a checklist or CI-friendly script that runs `npm run build:server-tarball`, validates Claude/Codex plugin manifest version and tarball URL alignment, and smoke-starts the packed server.
3. Host smoke coverage: cover G-003 with scripted smoke prompts/checks for Claude Code and Codex plugin flows after release packaging is verifiable.
4. Guidance hygiene: keep BNN-8 active so root docs, plugin skills, and Agent Interface guidance stay aligned with completed bulk repair surfaces.

`figlets_health_check` v1 shipped (2026-05-23, BNN-17) as a read-only agent readiness checker; keep v2 audit orchestration separate from this hardening slice.

### Product-Capability Backlog After Hardening

1. `figlets_health_check` v2 (optional Figma read-only audit orchestration).
2. Exact-match typography binding fixes.
3. Preview/test harness for showcase visual changes.
4. Result pagination/detail tools for long findings.
5. Config review report for imported-file bootstrap confidence.
6. Elevation/effect audit beyond config-backed completion.
7. Semantic color grammar classifier and context-aware naming consolidation.
8. Richer designer workflows for resolving responsive spacing mode advisories after BNN-54 detection.

## Boundary Statement For Future Agents

Figlets should become capable enough that agents do not write code for deterministic design-system operations. That does not mean Figlets should expose arbitrary Figma editing. The safe direction is many narrow, named, tested tools with structured arguments, read-only previews, explicit designer approval, and verification passes.

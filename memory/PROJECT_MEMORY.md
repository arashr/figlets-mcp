# Project Memory

Active context for the project so future sessions can recover quickly without relying on chat history alone.

---

### [2026-05-19 — Live Phase 3C validation and MCP apply callback fix]

**Validation:** A live Figma Desktop bridge run on a disposable file confirmed the Phase 3C slices in action: planner apply input contained only `border-width`, `radius`, `spacing-semantics`, and `typography-variables`; dry-run previewed broad typography text-style creation but apply did not create styles; bridge apply created the expected variables in the correct collections; semantic spacing and typography variables aliased expected primitives; no collection modes were created; reinspect left only the broad typography text-style product gap.

**Fix:** The live run exposed an MCP registration bug: `update_ds_tokens` apply returned `{}` because `packages/figlets-mcp-server/src/index.js` stringified the unresolved async `handleUpdateDsTokens(...)` Promise. The callback now awaits the handler. Regression coverage lives in `tests/server/update-ds-tokens-mcp-callback.test.js`, which calls the registered MCP tool through stdio and asserts the resolved bridge apply result is returned.

---

### [2026-05-19 — Phase 3C typography variables apply slice]

**Status:** Implemented the first typography apply slice as `typography-variables`, keeping broad `typography` text-style work dry-run/product-gap scope. This builds on `fd5975b` guardrails and does not enable text style creation/refresh.

**Planner contract:** `inspect_ds_token_gaps` still previews broad `typography` gaps. When broad typography variable gaps exist, `repairPlan.applyInput.categories` can include `typography-variables`; broad `typography` remains in `missingCapabilityNotes` as unsupported apply scope when text styles or broader typography work are still missing.

**Apply behavior:** `update_ds_tokens({ dry_run:false, categories:["typography-variables"] })` targets only the existing Typography collection. It creates/updates `type/<role>/{size,line-height,weight,tracking,family}` variables, maps responsive values onto existing Typography modes, preserves variable IDs/scopes, aliases primitive type/font variables when available, does not create modes, and does not create or refresh text styles.

**Tests updated:** Server, bridge policy, and E2E proxy tests now cover `typography-variables`; broad `typography`, `elevation`, `primitive-typography`, and `primitive-shadow` remain blocked in apply unless future slices deliberately change that contract.

---

### [2026-05-19 — Phase 3C typography/elevation readiness guardrails]

**Status:** After commit `253f638` landed semantic spacing apply, the next step is deliberately guardrail-first. Typography/elevation apply is still blocked; the product plan now defines the required split strategies before any writes are enabled.

**Plan update:** `docs/bulk-repair-api-implementation-plan.md` now has "Typography And Elevation Apply Readiness Notes". Typography must split into a variables-only slice before text-style create/refresh. Elevation must split into elevation variables before effect-style create/refresh. Text styles require explicit font-loading behavior and `fontLoadFailures`; effect styles require an explicit shadow-color/semantic-color prerequisite strategy.

**Test pin:** `tests/docs/bulk-repair-plan.test.js` asserts the readiness notes stay in the product plan. `tests/server/update-ds-tokens-tool.test.js` asserts `typography`, `elevation`, `primitive-typography`, and `primitive-shadow` still return `unsupported-apply-category` product-gap notes for `dry_run:false`.

**Important:** Do not enable these categories in `APPLY_CATEGORIES` until their variable/style strategies and focused tests are implemented. This preserves the current product shape: dry-run is useful, apply is narrow and approval-gated.

---

### [2026-05-19 — Non-color token planner and narrow apply slice added]

**Status:** Phase 3A and Phase 3B are implemented, plus a deliberately narrow Phase 3C apply slice. Full supported-runtime suite passed (`npm --scripts-prepend-node-path=true test`: 66/66) and `git diff --check` is clean.

**Planner:** `inspect_ds_token_gaps` is a read-only config-backed planner for non-color token gaps. It compares the active file-scoped `design-system.config.js` with the active Figma snapshot and returns `message`, `summary`, `repairPlan`, and `topFindings` first. `repairPlan.previewInput` can include all dry-run categories; `repairPlan.applyInput` is filtered to only currently apply-supported categories.

**Dry run:** `update_ds_tokens({ dry_run: true })` previews config-backed token completion without bridge writes. It reports `wouldCreateVariables`, `wouldCreateStyles`, `unmatched`, `typeMismatch`, unsupported categories, and prune/delete requests as missing capability/product-gap notes.

**Apply slice:** `update_ds_tokens({ dry_run: false })` is intentionally limited to `radius` and `border-width`. The bridge/plugin capability is `update-tokens`; the plugin creates missing `space/radius/*` and `space/border/*` variables in the existing Spacing collection or updates existing FLOAT values across modes, preserving variable IDs. It does not create typography styles, effect styles, semantic spacing, elevation, primitives, colors, or perform prune/delete operations.

**Runtime contract:** Root dev/test now requires Node `>=22` with `.nvmrc` set to `22` and a `pretest` guard. The server package runtime declares Node `>=18`, matching the MCP SDK. Plain Node 10 now fails fast with a clear message instead of obscure API errors.

**E2E-style verification:** `tests/integration/token-gap-planner-flow.test.js` is the current automated E2E proxy. It runs `inspect_ds_token_gaps` on a config/snapshot with missing radius, border-width, and typography items; runs `update_ds_tokens` dry-run from `repairPlan.previewInput`; applies only radius/border-width through a mocked bridge; rewrites the snapshot to represent the approved result; then re-inspects to confirm radius/border-width gaps are gone while typography remains dry-run/product-gap scope.

**Next roadmap:** Keep expanding Phase 3C in small category slices only after tests pin compatibility and write boundaries. Good next candidates are semantic spacing variables, then typography variables/styles only after a careful font/style strategy. Do not broaden `update_ds_tokens` into arbitrary Figma mutation. Future product fix after this feature plan: if a required foundation such as the Spacing collection is missing, Figlets should guide a designer-approved partial setup repair and continue in the same run unless dismissed, not halt with only a "run setup first" message.

---

### [2026-05-18 — Color bulk repair planner stabilized through Phase 2]

**Status:** Phase 1B, 1C, 1D, and Phase 2 from `docs/bulk-repair-api-implementation-plan.md` are implemented and verified on `main` in local work. Full test suite passed (`npm test`: 62/62) and `git diff --check` is clean before commit.

**Planner shape:** `inspect_ds_setup_gaps` now returns a standardized `repairPlan` with `applyInput`, `optionalApplyInput`, `counts`, `designerSummary`, `optionalDesignerSummary`, `missingCapabilityNotes`, `designerPresentation`, and `agentInstruction`. Handler output keeps `message`, `summary`, `repairPlan`, and `topFindings` first for truncation safety. Empty plans still expose all structural keys and explicitly tell agents not to invent repairs.

**Optional passive roles:** Passive border/outline/stroke repairs are now optional by contract. DS-wide suppressed passive-role absence and single advisory passive `plannedRoleRepair` cases both lift into `repairPlan.optionalApplyInput.roleRepairs`, never into default `applyInput`, unless the finding is a high-confidence required role repair. This fixed the observed `color/border/info-variant` stranded-payload case.

**Focus border:** Missing foundation focus-border roles can become apply-ready only when Figlets has safe aliases: config-defined aliases, or derived aliases from `brand`/`primary`/`accent`/`blue` ramps checked at WCAG non-text 3:1 against a default surface/background. Naming preserves the active border family (`border`, `outline`, or `stroke`). Config rows are cleaned so descriptive fields such as `note` cannot leak into `aliases`.

**Missing backgrounds:** Missing background findings are intentionally conservative. They carry `agentAction: "ask-designer"` and are collected in `repairPlan.missingCapabilityNotes`; they are excluded from both default and optional apply payloads. Agents must frame these as designer decisions or future Figlets planner scope, not as impossible gaps and not as script opportunities.

**Designer presentation:** `repairPlan.designerPresentation` gives agents a plain-language summary shape (`Ready to fix`, `Optional convention`, `Needs your call`) and explicitly says not to present verification matrices or raw JSON unless requested. Agent Interface guidance now tells agents to use this field for designer-facing summaries.

**E2E verification:** A live designer-flow test on a Figma fixture passed: 13 required role repairs in `applyInput`, one optional `color/border/info-variant` in `optionalApplyInput`, missing backgrounds in `missingCapabilityNotes`, focus-border in `applyInput` only with safe aliases, no write without approval.

**Next roadmap:** Phase 3 should start conservatively with config-backed non-color token gap planning. Prefer a read-only `inspect_ds_token_gaps` planner first, then a dry-run/apply `update_ds_tokens` surface after the planner contract is stable.

---

### [2026-05-18 — Bulk repair posture added to agent contract]

**User direction:** The agent should understand that bulk design-system updates are part of Figlets when needed. The designer-facing experience should not be "here are the gaps, but we can't fix them" for deterministic setup/alias/binding repairs.

**Rule added:** Bulk design-system updates are in Figlets scope when they can be represented as structured, designer-approved payloads. Agents should use existing bulk-capable surfaces such as `inspect_ds_setup_gaps.repairPlan.applyInput` → `apply_ds_setup_repairs`, `update_ds_primitives`, and `qa_binding_audit({ fix: true })`. If the requested bulk update needs a planner/apply surface Figlets does not expose yet, agents must call it a Figlets product/tool gap or proposed Figlets feature scope instead of claiming the gaps cannot be fixed or writing ad hoc scripts.

**Implementation:** The posture is now present in root `AGENTS.md`/`CLAUDE.md`, adapter docs, Claude/Codex plugin commands and skills, and the Agent Interface hard rules/response contract/safety payload. Tests pin the behavior in root entrypoint, plugin, and Agent Interface coverage.

**Concrete icon fix:** `inspect_ds_setup_gaps` now treats missing icon roles for complete background+foreground semantic families as bulk-repairable role gaps. It derives Light/Dark icon aliases from the paired foreground token, upgrades on the same foreground ramp only when needed to pass WCAG non-text 3:1, and lifts the planned icon creations into `repairPlan.applyInput.roleRepairs`. DS-wide passive border/outline absence may still be suppressed, but DS-wide icon absence should no longer become a dead-end `suppressedAdvisoryRoles` message.

---

### [2026-05-18 — Initial interaction routing refinement]

**User-approved UX change:** The generic Figlets menu should not appear after the designer already gave a concrete request such as "review my design system using Figlets." The first visible response should acknowledge the chosen workflow and begin the read-only flow. The generic help screen should use `# Figlets` with a one-line about statement, not a cheesy greeting.

**Implementation:** `figlets_start.designerResponse` is now reserved for generic help/start. `figlets_route_intent` now returns a routed `designerResponse` for specific goals and a structured `selectionPrompt` for ambiguous/generic routing, so hosts that support selection UI can use it and text-only hosts can render the prompt. Claude/Codex plugin skills and start commands now tell agents to route concrete initial goals before replying instead of always showing the menu.

---

### [2026-05-18 — Suggestion-time accessibility gate]

**Rule from user:** Do not block designer-approved writes just because a payload might be intentionally imperfect. Instead, make Figlets-generated suggestions safe before they are shown. This applies broadly to token-gap fixes and setup output, not only icons.

**Implementation:** `inspect_ds_setup_gaps` now pre-checks planned missing icon role repairs against WCAG non-text contrast at 3:1 before adding `plannedRoleRepair` or lifting it into `repairPlan.applyInput`. If no accessible icon alias can be found on the paired background ramp, the gap remains a finding but no deterministic apply-ready repair is emitted. Passive border/outline/stroke role repairs are not contrast-gated; they use the standard passive border steps because those roles are often low-emphasis structure rather than meaningful non-text content. Planned icon repairs include per-mode contrast metadata with token names, hex values, ratio, threshold, and pass state so agents can present color-aware suggestions. Existing setup generation already validates text pairs and setup-generated icons before `prepare_ds_config` reports ready.

**Design note:** Plain Markdown does not guarantee actual color swatches in every host. Figlets should expose structured hex/contrast data; agents can render Markdown tables everywhere and add HTML/color chips only when the host supports it.

---

### [2026-05-18 — Designer review script hard rule]

**Issue found:** Less capable agents could still treat "review my design system" as permission to write their own local scripts over `.local/<fileKey>/figma-data.json`, MCP transcripts, or `tool-results`, even though the product contract says deterministic Figlets tools should own the review.

**Rule added:** Designer Mode now says reviews/checks/audits, setup-gap investigations, and contrast investigations must use `figlets_start` → `figlets_route_intent` → `figlets_workflow_guide`, then the Figlets MCP tools/scripts named by the workflow. Agents must not write custom scripts, inspect local snapshots/tool-result files, or use raw Figma APIs for designer-facing review unless the designer explicitly asks to go out of bounds.

**Implementation:** The hard rule is now duplicated in the root `AGENTS.md`/`CLAUDE.md`, Claude and Codex plugin start commands, Claude and Codex `figlets-designer` skills, and the Agent Interface payload (`responseContract`, `safety`, `hardRules`, route/guide messages). Tests pin the rule so future prompt/package changes do not soften it accidentally.

---

### [2026-05-17 — Gap repair folded into health-check QA]

**Issue found:** After the health check correctly showed semantic setup gaps, agents still offered to run the separate setup-gap flow. That was redundant because the QA output had already done the read-only inspection. Claude also attempted to run a raw Node script over `.local/<fileKey>/figma-data.json` because icon contrast failures did not expose a concrete re-alias plan.

**Fix:** Health check now contains the approval, `apply_ds_setup_repairs`, and verify steps directly. The public capability menu no longer shows "Fix setup gaps" as a separate designer option. "Fix contrast/setup gaps" intents route into the health-check QA workflow. `inspect_ds_setup_gaps` now emits deterministic `plannedReAlias` suggestions for icon WCAG non-text contrast failures when a same-ramp primitive can satisfy 3:1, and `topFindings.highConfidenceIssues` merges high-confidence issues across types.

**Follow-up fix:** Missing border/outline role findings now include `plannedRoleRepair` when the paired background resolves to a primitive ramp. On Peach this gives:
- `color/outline/info`: Light `color/blue/200`, Dark `color/blue/800`
- `color/outline/success`: Light `color/green/200`, Dark `color/green/800`
- `color/outline/warning`: Light `color/yellow/200`, Dark `color/yellow/800`

**Latest follow-up:** `inspect_ds_setup_gaps` now emits `repairPlan.applyInput`, already shaped for `apply_ds_setup_repairs` with `repairs`, `aliasUpdates`, and `roleRepairs`. Agents should use this top-level plan after approval instead of writing scripts to inspect Claude/Codex `tool-results` files or local snapshots.

**Truncation-safety follow-up:** `handleInspectDsSetupGaps` now returns `message`, `summary`, `repairPlan`, and `topFindings` before any long diagnostic arrays. This specifically prevents Claude from needing to inspect `.claude/.../tool-results/*.json` just to discover the top-level keys or repair payload.

**Agent rule:** Agents must not run ad hoc scripts over `figma-data.json`, local snapshots, Claude/Codex `tool-results`, or MCP transcript files to derive designer-facing repairs. They should use structured Figlets tool output; if that output is insufficient, report the missing tool capability plainly.

---

### [2026-05-17 — Health check includes semantic setup QA]

**Issue found:** The agent-facing "Full Design System Health Check" workflow only called `sync_figma_data`, `detect_design_system`, and `audit_tokens`. After token audit became correctly quieter, agents could see a clean token audit and wrongly say the design system was healthy, even when `inspect_ds_setup_gaps` would report icon contrast failures and high-confidence missing neighboring outlines.

**Fix:** The health-check workflow now calls `inspect_ds_setup_gaps` as a read-only step before any all-clear. Adapter instructions for Claude/Codex now say to report high-confidence semantic gaps and accessibility failures first, then token issues, then capabilities/inventory. A clean `audit_tokens` result is no longer enough to call a design system healthy.

---

### [2026-05-17 — Showcase visual changes require preview confirmation]

**Rule from user:** Do not make new designer-facing showcase visual/layout decisions without confirmation. For this class of work, investigate first, then create an HTML or equivalent preview suggestion. Only after confirmation should the Figma renderer be changed.

**Current investigation notes:**

- Peach config is deterministic and currently contains 12 semantic pairs.
- Standalone roles are present in config (`color/outline/focus`, `color/outline/strong`, `color/outline/subtle`; `color/icon/inverse`, `color/icon/subtle`), but the config-backed showcase branch renders only `DS.color.semantics.pairs`, so standalone outlines/icons disappear from the showcase.
- Local setup-gap QA reports 9 icon contrast failures and high-confidence missing neighboring outlines for `color/outline/info`, `color/outline/success`, and `color/outline/warning`; if an agent did not surface them, the presentation/workflow summary needs tightening.
- Audit-token output is too noisy: raw primitive values should be inventory, not negative "unaliased" findings; duplicate numeric values across domains such as spacing/type/shadow should be treated as low-signal/informational.

**Implemented QA cleanup in this slice:**

- `audit_tokens` now separates `rawPrimitiveCount` from `unaliasedCount`; Peach now reports `rawPrimitiveCount: 176` and `unaliasedCount: 0`.
- Cross-domain duplicate literal values now report as `informationalDuplicates` instead of issue-level duplicate groups; Peach's 11 previous duplicate groups are informational.
- Generated/setup naming patterns like numeric leaves, `0_5`, and `neutral-variant` no longer create mixed-naming warnings.
- CLI setup-gap reports now include icon contrast failures in totals, detail sections, and the "What this means" summary.
- Follow-up fix: high-confidence neighboring-outline gaps now sort before medium variant advisories, and `topFindings.highConfidenceMissingRoles` / `topFindings.iconContrastFailures` make those issues hard for agents to miss in summaries.

---

### [2026-05-16 — Imported Figma files now get generated local configs]

**Active branch:** `main`.

**Status:** Follow-up from Peach showcase review. The recurring "no design-system.config.js" issue is now treated as a product bug, not an acceptable fallback state.

**Decision implemented:**

- When an active synced Figma file has no file-scoped config, Figlets creates `.local/<fileKey>/design-system.config.js` from the snapshot.
- The generated config is local setup state only. It does not mutate Figma and does not bypass approval for any Figma write.
- The bootstrap infers collection names, responsive modes, primitive color ramps, brand seed, semantic bg/text pairs, paired outline/icon companions, and standalone unpaired outline/icon roles.
- `sync_figma_data`, `figlets_start`, `inspect_ds_setup_gaps`, and `build_ds_showcase` now surface whether config was created or already existed.
- `build_ds_showcase` reports `config.sourceMode` so agents can tell whether the run was config-backed.

**Showcase fixes started/completed:**

- Semantic color rows now have columns that match their content: roles, preview, selected contrast metric, and WCAG.
- WCAG remains visible even when APCA is the chosen text contrast algorithm.
- Imported files should normally render via config-backed semantic pairs, so paired status icons/outlines are merged into semantic rows instead of being duplicated in separate icon/outline tables.

**QA fixes started/completed:**

- `inspect_ds_setup_gaps` now reports `iconContrastFailures` using WCAG non-text contrast at 3:1 regardless of APCA/WCAG text algorithm choice.
- This directly addresses the Peach case where icon roles could look visually wrong but were not flagged by setup-gap QA.

**Decision-log cleanup:** The older "showcase frozen/no-config tolerated" reading is superseded. Config-backed semantic rendering is now the stabilizing path for both Figlets-created and externally-created design systems.

---

### [2026-05-15 — Active-file context consistency fix started]

**Active branch:** `main`.

**Status:** Follow-up after live Claude/Figlets run on Peach. The plugin packaging branch was merged, then investigation confirmed the reported issues were shared runtime/product bugs rather than Claude/Codex packaging bugs.

**Fixes in progress/completed in this slice:**

- `loadFigmaDataSource({})` now prefers the active file-scoped snapshot `.local/<fileKey>/figma-data.json` before the legacy flat `.local/figma-data.json`.
- `detect_design_system({})` now uses that active snapshot by default and saves `figma-ds-context.json` beside the active file snapshot.
- `sync_figma_data` now returns JSON including previous/current file keys, snapshot path, config path, and `changed` so agents can warn when the live sync moved to a different file than `figlets_start` advertised.
- The bridge receiver includes `fileKey`, `previousFileKey`, `activeFileChanged`, and `dataPath` in sync responses.
- `inspect_ds_setup_gaps` role suggestions preserve the existing role-family vocabulary. On Peach, missing border-role suggestions now use `color/outline/info|success|warning` instead of `color/border/*`.

**Still intentionally deferred:** showcase contrast/mode rendering. The generated showcase currently has APCA/WCAG/mode-story issues, but the user asked to discuss that before implementation.

---

### [2026-05-15 — Codex plugin-style package added]

**Active branch:** `codex/claude-code-plugin-package`.

**Status:** Codex now has a parallel plugin-style package under `plugins/codex/figlets/`, plus a repo-root Codex marketplace manifest at `.agents/plugins/marketplace.json`. This is intentionally separate from the Claude Code package and reuses the same Agent Interface contract (`figlets_start` → `designerResponse` → `figlets_route_intent` → `figlets_workflow_guide`).

**Codex distribution model:** The current Codex environment supports local plugin manifests (`.codex-plugin/plugin.json`), local marketplace metadata (`.agents/plugins/marketplace.json`), plugin `skills/`, and plugin `.mcp.json`. No public Codex marketplace install command equivalent to Claude Code's `claude plugin marketplace add owner/repo` was verified, so do not invent one. The reliable setup path is:

```
figlets-mcp setup --hosts=codex-plugin --yes
# restart Codex
# ask: Help me with my Figma design system using Figlets.
```

Setup registers the repo checkout as local marketplace `figlets-codex` in `~/.codex/config.toml` and enables `figlets@figlets-codex`. It repairs source drift and disabled plugin entries while preserving unrelated Codex config. The raw `codex` MCP target remains as an explicit legacy fallback and is superseded by `codex-plugin` in default setup when the local marketplace is available.

**Raw Codex fallback correction:** A live local test showed Codex rejects the old documented/setup form `[[mcp_servers]]` with `invalid type: sequence, expected a map in mcp_servers`. The raw `--hosts=codex` fallback now writes `[mcp_servers.figlets]` and repairs the bad sequence form while preserving unrelated config. A follow-up live test still showed `figlets_start` missing because `command = "figlets-mcp"` depended on a shell-only NVM PATH. The fallback now writes the current Node executable plus the local `packages/figlets-mcp-server/bin/figlets-mcp.js` path, matching the Claude Code local reliability fix. If a user already hit either issue, restore the generated backup or rerun the fixed setup.

**MCP tools/list crash fixed:** Another live Codex retry still did not expose `figlets_start`. Direct JSON-RPC smoke test against the exact configured command proved the process started but `tools/list` failed with `Cannot read properties of undefined (reading '_zod')`. Root cause was Zod 4 record schema syntax in `packages/figlets-mcp-server/src/index.js`: `z.record(z.string())` leaves the value schema undefined. Fixed by using `z.record(z.string(), z.string())`, adding `zod` as a direct server dependency, and adding `tests/server/mcp-tools-list.test.js` to start the stdio server and assert the Agent Interface tools are listable. After this fix, direct smoke output includes `figlets_start`.

**Files added/changed:**

- `.agents/plugins/marketplace.json`
- `plugins/codex/README.md`
- `plugins/codex/figlets/.codex-plugin/plugin.json`
- `plugins/codex/figlets/.mcp.json`
- `plugins/codex/figlets/commands/start.md`
- `plugins/codex/figlets/skills/figlets-designer/SKILL.md`
- `plugins/codex/figlets/README.md`
- `packages/figlets-mcp-server/src/cli/setup.js` (`codex-plugin` target)
- `scripts/build-server-tarball.js` (release pre-flight checks Claude + Codex plugin versions/URLs)
- `tests/plugins/codex-plugin.test.js`
- `tests/server/setup-cli.test.js`
- `docs/mcp-config-examples.md`
- `DECISIONS.md`

**Release rule:** The Codex plugin `.codex-plugin/plugin.json` version and `.mcp.json` tarball URL must move in lockstep with `packages/figlets-mcp-server/package.json`, exactly like the Claude plugin. `npm run build:server-tarball` enforces both host wrappers.

---

### [2026-05-14 — Claude Code plugin packaging branch open]

**Active branch:** `codex/claude-code-plugin-package`.

**Status:** Plugin packaging reworked to an npm-free, agent-agnostic-respecting design, then hardened against a code review (P0–P3 — see DECISIONS 2026-05-15). Not merged to `main`. All 59 tests green (`npm test`). `claude plugin validate` passes on both the root marketplace and the plugin manifest. The self-contained tarball was verified to boot outside the monorepo (extracted to /tmp; `detect-design-system`/`audit-tokens`/`inspect-component` load; MCP server exposes `figlets_start`).

**Hardening landed (2026-05-15):** all server→figlets-core requires go through the `src/figlets-core.js` shim; `build-server-tarball.js` bundles `@figlets/core` into the tarball (hard-fails if not self-contained); legacy MCP cleanup is gated on a `claude mcp list` smoke check (won't break a working legacy setup); setup re-points the marketplace when its source changed (with checked uninstall/remove exit statuses — blocks on a genuine marketplace-remove failure) and on same-source runs `marketplace update` + `claude plugin update`; `_isLocalPathSource` handles Windows/UNC/~ paths; displayed commands are shell-quoted. Pre-release local dev should use `--hosts=claude-code`.

**Update model (must-know):** Claude Code keys the plugin cache on `plugin.json` `version`. There is NO mechanism that delivers new content without a version bump — `marketplace update` alone does nothing for installed users. Therefore every release MUST bump `plugin.json` `version` in lockstep with the server `package.json` version and the `mcpServers` tarball URL (`v<version>`). `build-server-tarball.js` enforces this with a non-zero-exit pre-flight; do not cut a release until it passes.

**Architecture (current — supersedes earlier npm-publish design):**

- **Marketplace at repo root.** `/.claude-plugin/marketplace.json` (NOT nested under `plugins/`). Verified: `claude plugin marketplace add owner/repo` reads the manifest strictly from `<repo-root>/.claude-plugin/marketplace.json`; no subdirectory form exists. Its plugin `source` is `./plugins/claude-code/figlets` (relative paths resolve from the marketplace root = repo root). All real Claude content stays nested under `plugins/claude-code/figlets/`; the root file is a thin redirect. User chose this (Option A) over a separate dedicated plugin repo (Option B), accepting one Claude folder at the monorepo root.
- **No npm.** The plugin's `mcpServers.figlets` runs `npx -y https://github.com/arashr/figlets-mcp/releases/download/v0.1.0/figlets-mcp-server-0.1.0.tgz`. `npx` runs the remote tarball and resolves deps from the public npm registry (reads are free/unauthenticated). No `@figlets/mcp-server` npm package. The server package's `package.json` was reverted to a plain agent-agnostic package (no `files: plugins/`, no `prepack`, `scripts/sync-plugins.js` deleted, no `publishConfig`).
- **Release tooling.** `npm run build:server-tarball` → `scripts/build-server-tarball.js` runs `npm pack` into `dist/` (gitignored) and prints the `gh release create v0.1.0 dist/figlets-mcp-server-0.1.0.tgz` step + a manifest-URL match check.
- `plugins/claude-code/figlets/commands/start.md` — `/figlets:start`. `skills/figlets-designer/SKILL.md` — auto-trigger skill for designer phrases, routes to `figlets_start`, forbids developer-mode.

**`figlets-mcp setup` `claude-code-plugin` target (current):**

- Marketplace source defaults to GitHub slug `arashr/figlets-mcp` with `--sparse .claude-plugin plugins/claude-code`. Override via `FIGLETS_MARKETPLACE_SOURCE` env or `options.marketplaceSource` (local path for dev before the repo is pushed; local-path source skips `--sparse` and is validated to contain `.claude-plugin/marketplace.json`).
- Always in the known targets list (explicit `--hosts=claude-code-plugin` never yields an empty plan). `manual` with quoted GitHub command when `claude` missing; `manual` with a clear reason when a local-path override lacks the manifest.
- Apply: `claude plugin marketplace list`/`add`, `claude plugin list`/`install`, idempotent, then `claude mcp remove --scope user|project|local figlets` to drop legacy duplicates the plugin supersedes.
- Viability-gated supersession of the legacy `claude-code` target (dropped from defaults only when the plugin path plans `would-run`/`unchanged`; reachable via explicit `--hosts=claude-code`).

**Designer install path (once the GitHub repo + v0.1.0 release exist):**

```
figlets-mcp setup --hosts=claude-code-plugin --yes   # or just figlets-mcp setup --yes
# restart Claude Code
/figlets:start                                       # or just describe your design system
```

**Open follow-ups (owned by the user, not code):**

1. Push `arashr/figlets-mcp` public (default branch must have `/.claude-plugin/marketplace.json` + `plugins/claude-code/`).
2. `npm run build:server-tarball`, then `gh release create v0.1.0 dist/figlets-mcp-server-0.1.0.tgz` (or upload via the web UI). Until then the manifest URL 404s and the plugin README's local-dev `node`+bin override applies.
3. Bump flow: a new server version means rebuilding the tarball, cutting a new release tag, and updating the URL in `plugins/claude-code/figlets/.claude-plugin/plugin.json` (the build script prints a match check).

**Earlier (now-abandoned) iterations on this branch, for context:** first used a nested `plugins/claude-code/.claude-plugin/marketplace.json` + `npx -y @figlets/mcp-server` (npm publish) + `prepack` sync of plugins into the server tarball. Abandoned because the user did not want an npm account and wanted the main repo to stay agent-agnostic (no plugin bundling in the server package).

---

### [2026-05-14 — Agent Interface workflow guidance MVP started]

**Active branch:** `main`.

**Status:** Implemented locally; not committed yet.

**Why this exists:** The designer wants a complete first-prompt-to-next-step experience that feels like Claude Code skills but remains agent agnostic. The current repo had the right ingredients (adapter docs, paste-ready prompts, MCP tool descriptions), but no single source of truth an arbitrary MCP agent could ask: "What can Figlets do, which workflow fits this request, and where must I ask for approval?"

**Product contract captured:**

1. **Read-only guide layer:** `figlets_start`, `figlets_route_intent`, and `figlets_workflow_guide` only return workflow guidance. They do not sync, inspect Figma, mutate Figma, write files, or run setup.
2. **Workflow registry as source of truth:** `packages/figlets-mcp-server/src/agent-interface/workflows.js` stores the MVP workflows, designer intent phrases, prerequisites, read/write/confirmation steps, safe next flows, and recovery notes.
3. **Approval boundaries are data-backed:** Mutating steps are marked `requiresApproval: true`. Tests assert this for write steps and known mutating tools.
4. **Portable paths:** The product plan and tests now reject developer-local path leakage in guide payloads. The guide uses the `figlets-mcp` command and runtime path utilities instead of hardcoded repo paths.
5. **Installer is a separate track:** `figlets_start` cannot solve installation because it is only callable after MCP is connected. The product plan now calls out `npx figlets-mcp setup` and Claude Code plugin packaging as the install path.

**Files changed:**

- `docs/agent-interface-product-plan.md` (new)
  - Defines the Agent Interface product, path portability rules, install strategy, workflow diagrams, MVP workflows, registry data model, phases, and open questions.
- `packages/figlets-mcp-server/src/agent-interface/workflows.js` (new)
  - Pure workflow registry/helpers: `getStartGuide`, `routeIntent`, `getWorkflowGuide`, `listWorkflows`.
- `packages/figlets-mcp-server/src/tools/agent-interface.js` (new)
  - MCP tool metadata and handlers for `figlets_start`, `figlets_route_intent`, `figlets_workflow_guide`.
- `packages/figlets-mcp-server/src/index.js`
  - Registers the three Agent Interface tools.
- `packages/figlets-adapter/AGENTS.md`, `packages/figlets-adapter/CLAUDE.md`
  - Lists the new tools and tells agents to call `figlets_start` before improvising.
- `tests/server/agent-interface-tool.test.js` (new)
  - Pins routing, start payload shape, approval gates, workflow starts, next steps, and local path leakage guard.
- `DECISIONS.md`
  - Logs the read-only Agent Interface decision.

**Verification:**

- `node --check packages/figlets-mcp-server/src/agent-interface/workflows.js`
- `node --check packages/figlets-mcp-server/src/tools/agent-interface.js`
- `node tests/server/agent-interface-tool.test.js`
- `npm test`: 55/55 passing.

**Recommended next implementation slice:**

1. Add `figlets_next_step` after the first three guide tools are exercised.
2. Expand `figlets-mcp setup` beyond the first safe local patcher: richer host detection, clearer prompts, and eventually Claude Code plugin packaging.
3. Add a designer-facing install README with screenshots for the Figma Bridge dev-import path.

**Follow-up completed in the same working set:**

- Removed the hardcoded developer-local repo path from the product-facing designer fix/export prompt bodies.
- Added `packages/figlets-mcp-server/src/cli/setup.js`.
  - Dry-run by default.
  - Patches supported configs only with `--yes`.
  - Uses `"command": "figlets-mcp"` instead of absolute paths.
  - Backs up existing config files.
  - Preserves unrelated MCP servers.
  - Handles JSON config shapes for Claude Desktop/Cursor/Windsurf/Gemini and workspace VS Code.
  - Handles Codex TOML by appending a `[[mcp_servers]]` block when missing.
  - Uses Claude Code's native command when `claude` is available on PATH: `claude mcp add --transport stdio figlets -- figlets-mcp`.
  - Falls back to printing the Claude Code command manually when `claude` is not available.
  - Prints the Figma Bridge checklist.
- Wired `figlets-mcp setup` through `packages/figlets-mcp-server/bin/figlets-mcp.js`.
- Documented setup usage in `docs/mcp-config-examples.md`.
- Added `tests/server/setup-cli.test.js`.

**Additional verification after installer slice:**

- `node --check packages/figlets-mcp-server/src/cli/setup.js`
- `node --check packages/figlets-mcp-server/bin/figlets-mcp.js`
- `node tests/server/setup-cli.test.js`
- `npm test`: 56/56 passing.

**Latest installer refinement:** `figlets-mcp setup --hosts=claude-code --yes` now executes the native Claude Code registration command when possible instead of only printing it. `tests/server/setup-cli.test.js` covers both no-`claude` manual fallback and detected-`claude` command execution via an injected runner.

**Follow-up from real setup output:** Claude Code can return a non-zero exit with "MCP server figlets already exists in local config" (and unrelated runtime warnings). `setup` now treats that as `unchanged`, not `blocked`. Setup also no longer runs `doctor` by default, because the bridge receiver is normally not running until an MCP host starts Figlets; use `figlets-mcp doctor` explicitly after launching the host/plugin.

**Follow-up from first Claude designer test:** Claude mixed Figlets with generic `figma-console` capabilities and produced a misleading broad Figma-authoring menu. `figlets_start` now returns a literal `designerIntro` plus a `scope.figletsDoesNotMean[]` guardrail telling agents not to advertise generic create/delete/move/resize powers, not to say the flow is through figma-console, not to mix unrelated MCP servers into the Figlets intro, and not to lead with implementation guardrails. Adapter docs now tell agents to use `designerIntro` as the opening response.

**Menu-format refinement:** To make the first response more enforceable across agents, `figlets_start` now returns:

- `responseContract.openingFormat = "capability-menu"`
- `responseContract.useVerbatimWhenPossible = "designerResponse"`
- `capabilityMenu[]` as structured menu items
- `designerResponse` as copy-ready markdown with a two-column menu

Adapter docs now instruct agents to preserve `designerResponse` instead of inventing a broad capability list. `tests/server/agent-interface-tool.test.js` pins the table shape and menu items.

**Designer menu hardening after screenshot test:** Claude offered "Plugin / MCP server code" and repo/plugin editing in the designer menu. That is explicitly forbidden now:

- `figlets_start.forbiddenDesignerMenuItems[]` includes `Plugin / MCP server code`, repo editing, plugin editing, MCP server code, arbitrary node authoring, generic Figma tools, and raw Figma console tools.
- `responseContract.doNotOfferMenuItems = "forbiddenDesignerMenuItems"`.
- Adapter docs say never to offer repo/plugin/server-code editing in the designer-facing menu.
- Tests assert those strings are absent from `designerResponse` and present in `forbiddenDesignerMenuItems`.

**Root entrypoint hardening after memory-first test:** Claude Code was reading project memory and presenting a repo/developer-flavored capability list before using Figlets. Added root `CLAUDE.md` and `AGENTS.md` so repo-aware agents choose Designer Mode vs Developer Mode first. Designer Mode explicitly requires calling `figlets_start` first, using `figlets_start.designerResponse`, preserving the menu, and not reading `memory/PROJECT_MEMORY.md`, `DECISIONS.md`, source files, or package docs before the first designer response. Added `tests/docs/root-agent-entrypoint.test.js`. `npm test`: 57/57 passing.

**Missing Figlets MCP fallback hardening:** Claude correctly noticed `figlets_start` was unavailable but offered to approximate with raw Figma tools. Root `CLAUDE.md`/`AGENTS.md` now say that if `figlets_start` is unavailable, the agent must stop the designer workflow and ask the user to connect Figlets instead of proceeding with raw Figma tools, repo inspection, or project-memory summaries. Also changed Claude Code setup to user scope (`claude mcp add --scope user --transport stdio figlets -- figlets-mcp`) because `claude mcp add --help` shows the default scope is `local`, which was brittle for testing new sessions. `npm test`: 57/57 passing.

**Claude Code connection repair:** The user still saw "Figlets is not connected" despite the bridge being open. The bridge is not enough; Claude Code must expose `figlets_start`. `claude mcp list/get` can hang because it spawns stdio servers for health checks, so do not rely on it for designer onboarding. `figlets-mcp setup --hosts=claude-code --yes` now:

- registers Claude Code at user scope
- uses the current Node executable plus the local `figlets-mcp.js` binary instead of relying on Claude Code's PATH to resolve `figlets-mcp`
- when Claude reports an existing stale `figlets` entry, removes `figlets` from local/project/user scopes and re-adds the user-scope entry

This is intentionally less "portable-looking" in the config but more reliable for actual Claude Code launches. `npm test`: 57/57 passing.

**Project-local Claude Code fallback:** User-scope Claude Code registration still did not expose `figlets_start` in the user's session. Added a `claude-code-project` setup target that writes an ignored repo-local `.mcp.json` with the current Node executable and local `figlets-mcp.js` path. `.mcp.json` is now in `.gitignore`. Generated the repo-local `.mcp.json` via `node packages/figlets-mcp-server/src/cli/setup.js --hosts=claude-code-project --yes --skip-doctor`. This is for local product testing and should not be committed. `npm test`: 57/57 passing.

**Local launcher slice:** Added `figlets-mcp launch` as the option-2 local launcher for designer-experience testing without asking the designer to understand MCP plumbing. It:

- writes/repairs the project-local Claude Code `.mcp.json` through the `claude-code-project` setup target
- renders the exact `figlets_start.designerResponse` menu locally
- checks bridge status via `getDoctorReport`
- explains that receiver-not-running is normal before Claude Code starts Figlets
- prints one prompt to send in Claude Code: `Help me with my Figma design system using Figlets.`

Files: `packages/figlets-mcp-server/src/cli/launch.js`, `packages/figlets-mcp-server/bin/figlets-mcp.js`, `packages/figlets-mcp-server/package.json`, `tests/server/launch-cli.test.js`, `docs/mcp-config-examples.md`.

Local run output showed the project config as `unchanged`, bridge receiver not running, the correct designer menu preview, and clear next steps. `npm test`: 58/58 passing.

---

### [2026-05-14 — Setup gap QA + approved role repair flow hardened from live designer test]

**Active branch:** `main`.

**Status:** Implemented locally; not committed yet.

**Why this exists:** A live designer-style test of `npm run figlets:check-setup-gaps` showed the previous QA was too literal. It correctly stayed read-only, but it over-reported same-name companion guesses (`brand-subtle`, unpaired surfaces, muted) and missed the product nuance: this tool is for inherited design systems where the designer asks "what setup gaps should I consider?" The public-product flow should not require code edits between QA and fixing; the designer should talk to the agent, approve decisions, and the agent should use stable tools/scripts.

**Product contract now captured in code:**

1. **Read-only first:** `check-setup-gaps` still only checks bridge health, syncs, runs `refresh_ds_config_from_figma({ dry_run: true })`, runs inspection, and prints "No changes were made to Figma." It is the no-MCP fallback. The MCP version remains `sync_figma_data` / `refresh_ds_config_from_figma(dry_run)` / `inspect_ds_setup_gaps`.
2. **Agent judgment layer:** `inspect_ds_setup_gaps` now emits `missingSemanticRoles[]` by clustering live Figma semantic families and assigning `confidence`, `basis`, `agentAction`, `evidence`, and `suggestedName`. The agent should lead with these and ask before repairing; confidence is not approval.
3. **Config as a suppressive hint:** File-scoped config is used only to reduce false positives and choose contrast algorithm. Examples:
   - `color/bg/brand-subtle` configured with `color/text/brand` no longer asks for `color/text/brand-subtle`.
   - `color/surface/raised|overlay|sunken` in `semantics.unpaired` no longer asks for matching text roles.
   - `color/bg/muted` configured to pair through default no longer creates muted border/icon role gaps or companion advisories.
4. **Approved role repair path:** `apply_ds_setup_repairs` now supports `roleRepairs[]` alongside existing `repairs[]` and `aliasUpdates[]`. This creates explicitly approved border/icon semantic role vars with per-mode aliases. The bridge writes them to the Color semantic collection and returns `roleCreated`, `roleSkipped`, `roleUnresolved`. The server updates config after Figma succeeds: icons go to `DS.color.semantics.icons`, border roles go to `DS.color.semantics.unpaired`.
5. **MCP schema aligned:** `packages/figlets-mcp-server/src/index.js` exposes `roleRepairs` so agents can call the new approved path without relying on ad hoc CLI/Node snippets.

**Files changed:**

- `packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js`
  - Added semantic-family clustering helpers.
  - Added `missingSemanticRoles`, `semanticFamilies`, summary counts, and message wording.
  - Added config-context suppression for declared shared foregrounds, unpaired surfaces, and config-invalid same-name companion advisories.
  - Contrast pass now prefers configured pair text when available, reducing same-name false positives.
- `packages/figlets-mcp-server/src/cli/check-setup-gaps.js`
  - Renders "Likely semantic-family gaps" before "Possible naming gaps".
  - Every family gap says "ask the designer before treating this as a repair".
  - Totals and "What this means" include semantic-family counts.
- `packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js`
  - Added `roleRepairs` schema/normalization.
  - Added `_updateConfigRoles` after successful Figma creation.
  - Returned `roleCreated`, `roleSkipped`, `roleUnresolved`, `roleConfigUpdate`.
- `packages/figlets-mcp-server/src/index.js`
  - Added `roleRepairs` to the MCP registration schema.
- `packages/figma-bridge-plugin/code.js`
  - Added role repair handling in `_applyDsSetupRepairs`.
  - Selects the semantic Light/Dark color collection instead of the primitive single-mode collection.
  - Creates approved role variables and aliases them to approved primitives.
- Tests:
  - `tests/server/inspect-ds-setup-gaps-qa.test.js`: deleted text/icon scenario, config suppression.
  - `tests/server/check-setup-gaps-cli.test.js`: new report section and ask-first wording.
  - `tests/server/apply-ds-setup-repairs-tool.test.js`: role repair normalization, wire format, config update.

**Live test details:**

Initial improved QA on file `local_movbxur3_6gow4h4j` reported:

- APCA failures for `color/bg/default + color/text/muted` in Light/Dark.
- Semantic-family gaps for `info`, `warning`, `success`, and muted.

Designer decisions:

- Approved fixing muted contrast.
- Approved high-confidence `info`/`warning` border roles.
- Approved success border/icon.
- Rejected muted border/icon because muted should pair to default.

Applied fixes:

- `color/text/muted`
  - Light: `color/neutral/500` → `color/neutral/600`
  - Dark: `color/neutral/500` → `color/neutral/100`
- Created `color/border/success` → Light/Dark `color/green/500`.
- Created `color/icon/success` → Light `color/green/800`, Dark `color/green/200`.
- Created `color/border/info` → Light/Dark `color/blue/500`.
- Created `color/border/warning` → Light/Dark `color/yellow/500`.
- Ran `refresh_ds_config_from_figma` after the muted re-alias so config matched Figma.

Final live QA:

```text
Step 3/3 Semantic-layer QA: clean — no findings
Snapshot: 340 variables, 5 collections
No changes were made to Figma.
```

**Verification:**

- `npm test`: 54/54 passing.
- Focused local mock-server test for `apply-ds-setup-repairs`: passing with escalated local server permission.
- `node --check` clean on touched JS files during the flow.
- Final live read-only QA clean.

**Important product note for future agents:** In a normal public use session, do **not** edit code between QA and fix. The code changes in this session were product hardening caused by a test-flow discovery. The intended external workflow is now stable:

1. Run read-only QA.
2. Explain findings with judgment.
3. Ask the designer for explicit approvals.
4. Call `apply_ds_setup_repairs` with only approved `aliasUpdates`, `repairs`, and/or `roleRepairs`.
5. Refresh config from Figma if aliases changed.
6. Rerun read-only QA and report clean/remaining findings.

---

### [2026-05-13 — DESIGN.md export: spec compliance + round-trip via figlets-extended block]

**Active branch:** `design-md-export-flow` (off `main`).

**Status:** Implemented locally; not committed yet.

**Why this exists:** First pass shipped the export flow; second pass (this entry) hardens it for compliance + max info. The user wants other tools to accept the file without errors AND wants to pack as much info as possible.

**What changed:**

1. **Probed Google's `@google/design.md@0.1.1`** (npm). Installed as `devDependency`. Read `node_modules/@google/design.md/dist/linter/spec-config.yaml` to confirm: canonical sections (Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts), `recommended_tokens.colors` (primary/secondary/tertiary/neutral + surface/on-surface/error), `fontWeight` accepts bare or quoted numbers, `lineHeight` accepts Dimension or unitless multiplier, `components` section supports `backgroundColor` / `textColor` / `rounded` / `padding` with `{colors.X}` references.

2. **Rewrote `dsConfigToDesignMd`** in [packages/figlets-core/src/ds-config/design-md-intake.js](packages/figlets-core/src/ds-config/design-md-intake.js):
   - Emit bare brand role colors (`primary: "#..."`) alongside ramp steps (`primary-500: "#..."`). Clears the "missing primary" warning.
   - `fontWeight` as bare number (e.g. `600`), not quoted.
   - Add canonical-order body sections including: Overview, Colors (with brand bullet list), Typography (responsive size table), Layout (responsive spacing table + border note), Elevation & Depth (when DS has elevation), Shapes (radii table), Components (semantic pair Light/Dark table).
   - `components:` block in front matter: each semantic pair → `<slug>: { backgroundColor: {colors.X}, textColor: {colors.Y} }` using Light-mode aliases.
   - Footer note: "Generated by Figlets from `design-system.config.js`. Standard: Google DESIGN.md (alpha). Contrast algorithm: APCA/WCAG."
   - Fenced ```figlets-extended``` JSON block with the full `DS` (minus volatile `source` and `primitives`).

3. **Taught `designMdToDsConfig` about the extended block.** When present, it becomes the canonical DS; we add a synthetic `source: { type: 'design.md', path }`. When absent (external DESIGN.md), falls through to legacy front-matter parsing. The result's `parsed.extended` flag signals which path was used.

4. **New integration test** [tests/integration/design-md-google-lint.test.js](tests/integration/design-md-google-lint.test.js). Uses CJS `await import('@google/design.md/linter')` since the package is ESM-only. Asserts: zero errors, canonical section order, bare-primary present, contrastAlgorithm round-trip, semantic pairs round-trip (with Dark mode), responsive size triples round-trip, responsive spacing triples round-trip, border width round-trip. Skips with a stderr `SKIP` notice if the dev dep is missing (offline contributors not blocked).

5. **New lint CLI** [packages/figlets-mcp-server/src/cli/lint-design-md.js](packages/figlets-mcp-server/src/cli/lint-design-md.js) + `npm run figlets:lint-design-md` script. Defaults to DESIGN.md next to the active file's config; `--file` to override; `--json` for raw output. Exits 1 on lint errors.

**Lint baseline after the rewrite** (representative DS exercising ramps, brand, semantic pairs, responsive typography/spacing): **0 errors, 5 warnings (all `orphanedTokens` — color defined but no component references it), 1 info**. Sections detected in canonical order: Overview → Colors → Typography → Layout → Shapes → Components. The orphanedTokens warnings are honest signals about a sparse-component DS, kept as-is.

**Files changed:**
- `packages/figlets-core/src/ds-config/design-md-intake.js` (heavy rewrite of exporter + extended-block parser)
- `packages/figlets-mcp-server/src/cli/lint-design-md.js` (new)
- `package.json` + `package-lock.json` (devDependency + npm script)
- `tests/integration/design-md-google-lint.test.js` (new)
- `docs/components-in-design-md-followup.md` (new — self-contained follow-up brief for the components-into-DESIGN.md work)
- `DECISIONS.md`, `memory/PROJECT_MEMORY.md`

**Verification:**
- `npm test`: 49/49 (added one integration test, all passing).
- `node --check` clean on touched files.
- End-to-end CLI: export + lint pass cleanly against a tmp fixture; 0 errors.

**Open follow-ups (not in scope for this session):**
- Decide whether to emit `lineHeight` as a unitless multiplier when ratios are clean (cosmetic).
- A future Tailwind / DTCG emitter could leverage `@google/design.md`'s built-in emitters (`TailwindEmitterHandler`, `DtcgEmitterHandler`) — they read the same lint report we generate.
- Adapter docs ([packages/figlets-adapter/AGENTS.md](packages/figlets-adapter/AGENTS.md), [packages/figlets-adapter/CLAUDE.md](packages/figlets-adapter/CLAUDE.md)) don't currently mention the lint CLI. Could add a "verify the export" subsection to the workflow once we decide whether linting is a default step.
- **Integrate `generate_component_doc` output into DESIGN.md `components:` block.** Full self-contained design in [docs/components-in-design-md-followup.md](../docs/components-in-design-md-followup.md). Pick up after this branch merges.

---

### [2026-05-13 — Follow-up plan: integrate component-md into DESIGN.md `components:`]

**Status:** Not started. Full design captured in [docs/components-in-design-md-followup.md](../docs/components-in-design-md-followup.md) — that doc is self-contained for any agent picking this up cold.

**One-line summary:** Three-layer split — DESIGN.md `components:` front matter holds slim style summaries (style tokens only), `## Components` body section indexes per-component spec files with links, and `component-specs/*.md` stays as-is for full design intent. The `figlets-extended` block round-trips the summaries.

**Independent of the current export-flow branch.** Do NOT pile this on while `design-md-export-flow` is in review. Implement after merge to `main` or branch off main directly.

---

### [2026-05-13 — DESIGN.md export becomes a first-class flow]

**Active branch:** `design-md-export-flow` (off `main`).

**Status:** Implemented locally; not committed yet.

**Why this exists:** The QA→Fix branch `codex/designer-safe-setup-repair-cli` is in review and shouldn't be blocked or grow in scope. Productization research ([docs/productization-research.md](docs/productization-research.md)) flagged DESIGN.md as a high-value handoff artifact that today only exists as a side effect of `prepare_ds_config` / `apply_ds_setup`. Designers need a way to refresh DESIGN.md without re-running setup. New isolated branch off `main`; in-review branch untouched.

**What changed:**

1. **New MCP tool `export_design_md`** in [packages/figlets-mcp-server/src/tools/export-design-md.js](packages/figlets-mcp-server/src/tools/export-design-md.js). Chains `handleSyncFigmaData` → `handleRefreshDsConfigFromFigma` → `writeDesignMdFromDsConfig` from `figlets-core`. Inputs: optional `config_path` (defaults to active file config), `output_path` (defaults to DESIGN.md next to config), `figmaDataPath` (skips sync, uses given snapshot), `skip_sync` (uses on-disk snapshot), `dry_run` (no writes). Returns `{ dryRun, configPath, designMd: { path, written }, sync: { attempted, completed, snapshotPath, syncedAt }, refresh: { dryRun, changes, skipped, summary }, message }`. Registered in `index.js` between `create_ds_config_from_design_md` and `prepare_ds_config`.

2. **CLI fallback** at [packages/figlets-mcp-server/src/cli/export-design-md.js](packages/figlets-mcp-server/src/cli/export-design-md.js). Calls the handler directly. Flags: `--config`, `--output`, `--figma-data`, `--skip-sync`, `--dry-run`, `--json`. Plain-language summary by default; `--json` for raw output. Exit code 1 on error. Wired as `npm run figlets:export-design-md`.

3. **Designer prompt** at [docs/designer-export-md-prompt.md](docs/designer-export-md-prompt.md). Mirrors the [docs/designer-fix-flow-prompt.md](docs/designer-fix-flow-prompt.md) pattern (front-loads capability boundaries, offers dry-run first, summarizes plain-language results, names the error paths). Tells the agent never to silently bootstrap a config.

4. **Adapter coverage** — `export_design_md` listed in both [packages/figlets-adapter/AGENTS.md](packages/figlets-adapter/AGENTS.md) and [packages/figlets-adapter/CLAUDE.md](packages/figlets-adapter/CLAUDE.md). The `tests/adapter/tool-coverage.test.js` test enforces that listing.

**Tests added:** [tests/server/export-design-md-tool.test.js](tests/server/export-design-md-tool.test.js) — happy path with figmaDataPath bypass, output_path override, dry_run, missing config error. `npm test` 48/48.

**Smoke test:** Built a tmp fixture with a config and figma-data.json snapshot; ran the CLI in `--dry-run` and real modes. Dry run reported 2 refresh changes without writing; real run wrote both the refreshed config and a DESIGN.md whose colors reflected the snapshot's RGB (`#6633CC` vs `#000000` in source). Working end to end.

**Out of scope (intentional, per decision log):**
- Plugin UI button (requires plugin → receiver → MCP-server round trip for filesystem writes; deferred).
- Bootstrapping a missing config from Figma (export errors with a setup hint instead).
- Writing to Figma (export is read-only by design).

**Files changed:**
- `packages/figlets-mcp-server/src/tools/export-design-md.js` (new)
- `packages/figlets-mcp-server/src/cli/export-design-md.js` (new)
- `packages/figlets-mcp-server/src/index.js` (register tool)
- `package.json` (npm script)
- `packages/figlets-adapter/AGENTS.md`, `packages/figlets-adapter/CLAUDE.md` (tool listing)
- `docs/designer-export-md-prompt.md` (new)
- `tests/server/export-design-md-tool.test.js` (new)
- `DECISIONS.md`, `memory/PROJECT_MEMORY.md`

**Verification:**
- `npm test`: 48/48.
- `node --check` clean on touched files.
- Plugin ES6 guard N/A — no plugin code touched.
- CLI smoke test (`--dry-run` and real run) against a tmp fixture: both pass; DESIGN.md output validated.

**Open questions for follow-up:**
- Phase 4 (plugin UI button): how should plugin-originated MCP requests be routed? Today the receiver is one-way (agent → bridge); a button means bridge → MCP. Two options: new receiver endpoint the MCP server polls, or a separate WebSocket. Either way is a multi-file change in `figma-bridge-plugin`, `receiver.js`, and `figlets-mcp-server`.
- Productization (per [docs/productization-research.md](docs/productization-research.md)): is this tool destined to become a slash command in a Claude Code plugin package? If so, the prompt at `docs/designer-export-md-prompt.md` becomes the skill body verbatim.

---

### [2026-05-12 — QA → Fix: contrast re-alias plumbed end-to-end via the existing apply tool]

**Active branch:** `codex/designer-safe-setup-repair-cli`.

**Status:** Implemented locally; not committed yet.

**Why this exists:** A test conversation ("fix the contrast issues and add the missing foregrounds") revealed a capability gap: the QA report was readable but the agent had no way to apply contrast fixes — `apply_ds_setup_repairs` only created new fg companions. Designer's call: don't build a parallel contrast-fix script; reuse the setup flow's contrast picker (already in `validateSemanticPairs` / `accessible-repair-aliases`); MCP is part of the product so requiring it for the apply step is fine.

**What changed (one tool, one bridge channel, two repair kinds):**

1. **Inspector → `plannedReAlias` per failing mode.** Reuses `computePlannedAliases({ bg, name: fg, source: fg }, ...)` — passing the existing fg as both `name` and `source` makes the picker walk the fg's ramp and return the nearest passing step. No new contrast math. Falls back silently when the picker can't (multi-hop alias chains, missing primitives) — that's intentional, not a bug. Each contrast failure now carries `plannedReAlias: { token, mode, from, to }` when the picker found an upgrade.

2. **CLI renders the suggestion.** `suggested fix: re-alias "<token>" (<mode>) → <new primitive>` line under the bg/fg lines on each contrast failure. Designer + agent see the answer in plain text.

3. **`apply_ds_setup_repairs` accepts a second repair kind.** New top-level field `aliasUpdates: [{ token, mode, newAliasTarget }]`. Either or both arrays can be provided; the schema's `required: ["repairs"]` was dropped (now requires at least one of repairs or aliasUpdates). Wire payload to the bridge carries both arrays in one round-trip.

4. **Bridge plugin processes both kinds in `_applyDsSetupRepairs`.** After the existing create-fg loop, an alias-update loop finds each `token` by name, finds the matching mode, finds the target primitive, and calls `setValueForMode(modeId, { type: 'VARIABLE_ALIAS', id })`. Idempotent — skips when already aliased to target. Returns `updated`, `updateSkipped`, `updateUnresolved` arrays alongside the existing create-side ones.

5. **Receiver is unchanged.** It already passes the entire payload as `data` — `aliasUpdates` flows through with no router changes.

**Why this shape:** One tool means one approval contract for the designer ("approve these fixes" → one apply call → one bridge round-trip). The picker has a single owner — `validateSemanticPairs` via `computePlannedAliases`. No duplicated contrast math. The `plannedReAlias` shape is exactly what `aliasUpdates` consumes, so the agent's job is "copy the suggestion, ask the designer, send it."

**What's intentionally NOT done:**
- No config update for re-aliases. Designer can run `refresh_ds_config_from_figma` if they want config to follow. Avoids a config-mutation surface that's hard to test.
- No CLI for apply. Apply is an MCP tool; agent calls it. The QA CLI stays as the read-only entry point.

**Files changed:**
- `packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js` (plannedReAlias computation per failing pair)
- `packages/figlets-mcp-server/src/cli/check-setup-gaps.js` (suggested-fix render)
- `packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js` (aliasUpdates schema + normalization + wire forwarding)
- `packages/figma-bridge-plugin/code.js` (aliasUpdates loop in `_applyDsSetupRepairs`)
- `tests/server/inspect-ds-setup-gaps-qa.test.js` (plannedReAlias assertion via handler with snapshot isolation)
- `tests/server/apply-ds-setup-repairs-tool.test.js` (`_normalizeAliasUpdates` + alias-only round-trip + empty-input error path)
- `docs/designer-fix-flow-prompt.md` (new — paste-ready prompt for the agent)
- `DECISIONS.md`, `memory/PROJECT_MEMORY.md`

**Verification:**
- `npm test`: 52/52.
- `node --check` clean on the touched files.
- Plugin ES6 guard clean (only existing markdown bold matches `**`).
- Live QA re-run on the now-active file (`local_moy7g0m2_i5kzy3kp`) reports clean — no contrast failures available to exercise the live re-alias path. Test coverage handles the mechanism.

---

### [2026-05-12 — QA report polish: agent-ready output, severity ordering, advisory collapse]

**Active branch:** `codex/designer-safe-setup-repair-cli`.

**Status:** Implemented locally; not committed yet.

**Why this exists:** A live run on `local_mozwkg5o_ufp0x3jo` surfaced six output-quality issues. The findings themselves were correct; the *presentation* biased the agent toward applying repairs before asking the designer anything, made hairline contrast fails look identical to gross fails, and exploded into per-pair advisories when the DS just doesn't use a role at all.

**Changes (all in `inspect-ds-setup-gaps.js` and `check-setup-gaps.js`):**

1. **Strip the apply preview from CLI rendering.** `plannedAliases` / `plannedUpgrades` / `plannedAlgorithm` stay on the JSON (apply path consumes them) but the human-readable report no longer says "would add", "ready to repair", or "(upgraded for contrast)". The new framing: `convention would suggest: "<recommended>"` + `closest existing token: "<source>" (currently aliases Light → ..., Dark → ...)`. Tells the agent what the source's *real-world* alias is so it can ask the designer the right question (e.g. "your on-surface/danger aliases white in both modes — does that intent carry to the variant?").

2. **Advisory collapse.** When ≥3 complete bg+fg pairs all miss the same companion role (border or icon), the inspector emits `suppressedAdvisoryRoles: [{ role, suppressedCount }]` once instead of N per-pair advisories. CLI prints `This DS doesn't use per-role icon tokens — suppressing 10 icon advisories.` Threshold (`_ADVISORY_SUPPRESS_MIN_PAIRS = 3`) prevents 1- or 2-pair files from over-suppressing.

3. **Resolved primitives on contrast failures.** Each `contrastFailure` now carries `bgPrimitive: { name, rgb }` and `fgPrimitive: { name, rgb }` from a name-aware `_resolveTerminalByModeName`. CLI renders `bg → color/yellow/400 #FBBF24` / `fg → color/neutral/1000 #09090B` underneath each failure. Designer can debug without opening Figma.

4. **Near-miss tagging.** `nearMiss: true` + `gap: <distance>` set when a failure is within `_WCAG_NEARMISS = 0.3` (or `_APCA_NEARMISS = 5`). CLI shows `(near-miss, off by 1Lc)`. Section header reports `(N near-miss)`. "What this means" splits as `(X gross, Y near-miss)` so triage starts with the gross misses.

5. **Snapshot freshness header.** Handler returns `snapshot: { path, syncedAt, variableCount, collectionCount }`. CLI renders `Snapshot: 301 variables, 4 collections (synced at HH:MM:SS)` so designer + agent can trust the report isn't stale.

6. **Severity ordering** — both the section render and the "What this means" footer. Order: broken aliases → contrast failures → missing fg → missing bg → incomplete modes → advisories. Footer prefixes urgent items: `URGENT: ...`, `A11Y: ...`. Subject-verb agreement fixed for singular/plural.

**JSON shape additions (additive — all old fields preserved):**
- `snapshot: { path, syncedAt, variableCount, collectionCount }`
- `counts: { semanticVariables, completePairs }`
- `suppressedAdvisoryRoles: [{ role, suppressedCount }]`
- `summary.contrastNearMissCount`
- `summary.suppressedAdvisoryRoleCount`
- `contrastFailures[*].nearMiss`, `gap`, `bgPrimitive`, `fgPrimitive`

**Files changed:**
- `packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js`
- `packages/figlets-mcp-server/src/cli/check-setup-gaps.js`
- `tests/server/check-setup-gaps-cli.test.js` (severity-order assertion, near-miss + hex render, advisory-suppression note)
- `tests/server/inspect-ds-setup-gaps-qa.test.js` (resolved-primitive fields, suppression with ≥3 pairs, threshold guard with 2 pairs)
- `DECISIONS.md`, `memory/PROJECT_MEMORY.md`

**Live run after the change** (`local_mozwkg5o_ufp0x3jo`): 13 findings down from 18 (10 icon advisories collapsed into 1 suppression line; 5 border advisories remain). Contrast section now shows yellow/400 vs neutral/1000 hex per failure with `(near-miss, off by 1Lc)` on the warning pair. Missing-fg lines reveal that on-surface/danger/info/success all alias to neutral/0 today — the agent can flag that to the designer instead of silently propagating it.

**Verification:** `npm test` 52/52. `node --check` clean.

---

### [2026-05-12 — `check-setup-gaps` rewritten as a semantic-layer QA pass]

**Active branch:** `codex/designer-safe-setup-repair-cli`.

**Status:** Implemented locally; not committed yet.

**Why this exists:** The previous session's broken-alias + setup-vs-component scope work (commit `1504b5d`) was the wrong direction — the inspector was too narrow (variant-only) AND simultaneously too broad (component-scope wasn't in this project's scope). When the designer deleted some semantic vars in a live test, the report didn't catch them. Per direction: revert that commit and rebuild `check-setup-gaps` as a pure read-only QA layer over the semantic color layer in Figma.

**What changed (surgical):**
1. **Reverted** `1504b5d` (`Detect broken aliases and bucket by setup vs component scope`). HEAD now sits on `781f03f`.
2. **`inspect_ds_setup_gaps` rewritten** to a six-finding QA pass:
   - `semanticGaps` (missing fg companions) — broadened from variant-only to **any** background-family leaf. Still emits `plannedAliases` for the apply flow (apply path is unchanged).
   - `missingBackgrounds` — orphan `on-*` foregrounds. Restricted to the explicit on-* prefix to avoid over-reporting generic `text/*` tokens.
   - `incompleteModes` — semantic var has values in some modes but not others. Skipped when the var has zero values everywhere.
   - `contrastFailures` — for each resolvable bg+fg pair, walks aliases by mode name to literal RGB and computes WCAG ratio (default) or APCA Lc (when config opts in). Thresholds match the setup flow: 4.5 / 75.
   - `brokenAliases` — semantic-layer only. No setup-vs-component classification (out of scope per direction).
   - `companionAdvisories` — pair has bg+fg but no border/icon companion. Advisory only.
3. **`check-setup-gaps` CLI updated** to render every finding category with plain language and the configured contrast algorithm. Dropped all "broken DS aliases / broken component aliases" wording.
4. **`apply_ds_setup_repairs` untouched** — still consumes `semanticGaps[*].plannedAliases` verbatim. Because the broadening allows non-variant gaps (which usually have no source token in the file), most non-variant entries arrive as `status: "unresolved"` and apply correctly skips them.

**Source-of-truth rule (now consistent):** Figma is the source of truth for QA. The optional `design-system.config.js` is consulted only for `contrastAlgorithm`. The setup flow that creates configs from a Figma read is unchanged.

**Files changed:**
- `packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js` (full rewrite of the analysis function)
- `packages/figlets-mcp-server/src/cli/check-setup-gaps.js` (renders six finding sections + new "What this means")
- `tests/server/inspect-ds-setup-gaps-tool.test.js` (updated for broadened detection + new categories)
- `tests/server/check-setup-gaps-cli.test.js` (renders for every QA category + APCA label propagation)
- `tests/server/inspect-ds-setup-gaps-qa.test.js` (new — covers contrast, broken-alias, incomplete-modes, missing-bg, advisory)
- `DECISIONS.md`, `memory/PROJECT_MEMORY.md`

**Verification:**
- `npm test`: 52/52 passed.
- `node --check` clean on the touched files.
- Existing setup-repair flow tests (`apply-ds-setup-repairs-*`, `setup-repair-flow.test.js`) still pass — the inspector's `semanticGaps` shape is preserved.

**Out of scope (intentionally not done this session):**
- Non-color semantic categories (typography roles, spacing semantics, radius semantics).
- Setup vs component scope classification of broken aliases (component-scope detection was the wrong direction; downstream component breakage stays out of this script's scope).
- Live run on the active Figma file (designer should re-run `npm run figlets:check-setup-gaps` against their test file to confirm the deleted vars now show up as missing-bg / missing-fg / broken-alias as appropriate).

---

### [2026-05-11 — Setup-repair hardening from review feedback]

**Active branch:** `codex/designer-safe-setup-repair-cli`.

**Status:** Implemented locally; not committed yet.

**Why this exists:** Code review on commit 73a195f flagged four issues. All are addressed in this change set without changing the existing approve-then-apply intent.

**Changes:**

1. **Shared picker.** Picker logic moved to `packages/figlets-mcp-server/src/utils/accessible-repair-aliases.js` (`computePlannedAliases`, `resolveRepairRefs`, `loadActiveSnapshot`, `loadDsConfigSafe`). `apply-ds-setup-repairs.js` and `inspect-ds-setup-gaps.js` both call it — one owner.
2. **`plannedAliases` on inspector output.** Each proposed gap now carries `plannedAliases: { Light, Dark }`, `plannedAlgorithm`, and `plannedUpgrades: { Light: bool, Dark: bool }`. CLI report renders them with an "(upgraded for contrast)" flag where applicable. Failure is silent (no plannedAliases key) so the apply tool can still fall back.
3. **Apply trusts approved aliases.** `apply_ds_setup_repairs` now forwards `repair.aliases` verbatim when provided. Recomputation runs only when aliases were not passed. The schema documents the round-trip contract.
4. **Orphan-bg guard.** `bg` is required in the schema, the normalizer drops repairs without it, and the bridge handler errors with `BG variable not found in current Figma file.` if the snapshot/poll is stale.
5. **Mode propagation in refresh.** `_resolveValue` now carries the source mode name across alias hops and resolves the target's matching mode by name. Falls back to the only mode when target is single-mode.
6. **No implicit brand step.** Brand entries without an explicit `step` are skipped with a clear `reason`. Aligns with the existing auto-anchor rule (memory: "Auto-anchor brand hex to its natural step").

**Files changed:**
- `packages/figlets-mcp-server/src/utils/accessible-repair-aliases.js` (new — shared picker)
- `packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js` (schema requires `bg`; normalizer drops bg-less; forwards `repair.aliases`; uses shared picker)
- `packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js` (surfaces `plannedAliases`)
- `packages/figlets-mcp-server/src/cli/check-setup-gaps.js` (renders `plannedAliases`)
- `packages/figlets-mcp-server/src/tools/refresh-ds-config-from-figma.js` (mode-aware resolve; explicit step required)
- `packages/figma-bridge-plugin/code.js` (require `bg`, verify it exists pre-create)
- `tests/server/refresh-ds-config-from-figma-tool.test.js` (added brand fixture step; new no-step + multi-mode regression tests)
- `tests/server/apply-ds-setup-repairs-tool.test.js` (orphan-bg + approved-aliases round-trip)
- `tests/server/inspect-ds-setup-gaps-planned-aliases.test.js` (new)
- `DECISIONS.md`, `memory/PROJECT_MEMORY.md`

**Verification:**
- `npm test`: 51/51 passed.
- `node --check packages/figma-bridge-plugin/code.js`: passed.

---

### [2026-05-11 — Repair apply picks accessible aliases via validateSemanticPairs]

**Active branch:** `codex/designer-safe-setup-repair-cli` (off `main` at `20cc5fd`).

**Status:** Implemented locally; not committed yet.

**Why this exists:** `apply_ds_setup_repairs` was cloning `source.valuesByMode` as-is. When the BG variant resolves to a different primitive than the source's natural BG, the cloned alias may fail contrast against the variant. The fix routes per-mode alias selection through the existing setup-flow validator instead of duplicating the contrast math.

**How it works:**
1. MCP server loads the active Figma snapshot (env-first via `FIGLETS_FIGMA_DATA_PATH`, then `FIGLETS_LOCAL_DIR`/active-file lookup, then cached `paths.js`).
2. For each approved repair, derive Light/Dark primitive ref names from the BG variant and the source FG (one alias hop; both must resolve to a `color/<ramp>/<step>` primitive).
3. Build a working DS: bootstrap ramps + brand from the snapshot, then overlay any existing config values (`contrastAlgorithm`, `brand`, `ramps`, `rampStrategy`, `convention`).
4. Set `DS.color.semantics.pairs` to a single in-memory pair `{ bg, text, Light, Dark }` and call `validateSemanticPairs`.
5. Read the new additive `pairSuggestions` field from the validator's return. For each mode: `aliases[mode] = suggestion.path ?? input text path`.
6. Forward the precomputed `aliases` on each repair in the bridge wire payload.

**Bridge plugin:** `_applyDsSetupRepairs` checks `repair.aliases`. If present, it looks up Light/Dark mode IDs in the source's collection and the named primitive variables, and `setValueForMode(modeId, { type:'VARIABLE_ALIAS', id })` per mode. If `aliases` is absent or every mode fails to resolve, it falls back to the legacy `valuesByMode` copy.

**Why minimal change:**
- `validate-semantic-pairs.js`: only addition is a `pairSuggestions` map on the return. Existing consumers untouched. Existing core test suite passes.
- `apply-ds-setup-repairs.js`: adds the picker pipeline; preserves the legacy copy-values path through fallback.
- New helper `bootstrap-ds-from-figma.js` builds a minimal DS from snapshot — never persisted.
- Plugin code change is one branch in `_applyDsSetupRepairs`; legacy path preserved as fallback.

**Files changed:**
- `packages/figlets-core/src/ds-config/validate-semantic-pairs.js` (additive return field)
- `packages/figlets-mcp-server/src/utils/bootstrap-ds-from-figma.js` (new)
- `packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js` (alias precomputation pipeline)
- `packages/figma-bridge-plugin/code.js` (consume `aliases` when present)
- `tests/server/bootstrap-ds-from-figma.test.js` (new — ramps/brand extraction)
- `tests/server/apply-ds-setup-repairs-accessible-aliases.test.js` (new — handler precomputes accessible aliases against a snapshot)
- `tests/server/apply-ds-setup-repairs-tool.test.js` (added `FIGLETS_LOCAL_DIR` isolation so the dev's `.local` snapshot doesn't bleed into the assertion)
- `tests/integration/setup-repair-flow.test.js` (updated wire-payload assertion to acknowledge new `aliases` field)
- `DECISIONS.md`, `memory/PROJECT_MEMORY.md`

**Verification:**
- `npm test`: 50/50 passed.
- `node --check packages/figma-bridge-plugin/code.js`: passed; no `??`/`?.`/`**` in changes.

**Open follow-ups (not in this change):**
- `args.answers = { algorithm }` is plumbed but no `needsInput` round-trip yet — defaults to WCAG when not supplied. If designers want APCA, the agent must pass `answers.algorithm: 'apca'` (or the existing config sets `contrastAlgorithm`).
- Persisting a bootstrapped config is not implemented yet; the MCP-side `_updateConfigPairs` only edits an existing config.

---

### [2026-05-11 — Designer-safe setup gap check CLI]

**Active branch:** `codex/designer-safe-setup-repair-cli` (off `main` at `20cc5fd`).

**Status:** Implemented locally; not committed yet.

**Why this exists:** A clean agent session may not have the Figlets MCP server connected. Designers must still be able to point any agent at a single shell command for a safe, plain-language preview. The command never mutates Figma and never writes config.

**Command:** `npm run figlets:check-setup-gaps`

**Flow (all read-only):**
1. Probe bridge `/health` (also reads `pluginConnected`, `activeFileKey`).
2. If bridge or plugin is unavailable, print plain-language next steps and stop.
3. `handleSyncFigmaData()` — refresh the local snapshot.
4. `handleRefreshDsConfigFromFigma({ dry_run: true })` — never writes.
5. `handleInspectDsSetupGaps({})`.
6. Print a designer-friendly report. Always ends with `No changes were made to Figma.`

**Files added/changed:**
- `packages/figlets-mcp-server/src/cli/check-setup-gaps.js` (new)
- `tests/server/check-setup-gaps-cli.test.js` (new — exercises `formatCheckReport` for: bridge down, plugin disconnected, sync failure, clean state, no-config state, changes-and-gaps state)
- `package.json` (added `figlets:check-setup-gaps` script)
- `DECISIONS.md` (new entry: Designer-safe setup gap check)

**Constraints preserved:**
- Refresh is always dry-run from the CLI. The MCP `refresh_ds_config_from_figma` tool can still write when called with `dry_run: false` from a connected agent.
- Apply is intentionally not in this CLI. A future apply CLI must accept an explicit approved-repairs input (file or flag), not infer approval.
- `.mcp.json` at repo root is untracked, contains an absolute path, and must not be committed.

**Verification already run:**
- `npm test`: 48/48 passed (47 prior + 1 new CLI test).
- `git diff --check`: clean.

---

### [2026-05-11 — Setup-gap inspector + approved repair apply path]

**Active branch:** `main`.

**Status:** Implemented locally; not committed yet.

**Decision:** Existing-file semantic repairs now use a true inspect-then-approved-apply flow. `inspect_ds_setup_gaps` reads the synced current Figma snapshot and reports additive setup repair candidates without requiring a prepared config and without mutating Figma or config. `apply_ds_setup_repairs` applies only designer-approved repairs.

**Implementation notes:**
- `refresh_ds_config_from_figma` refreshes already-existing config entries from the synced Figma snapshot before config-backed work. It updates existing `DS.color.brand[*].hex` from the matching anchor variable, existing `DS.color.ramps[*].steps` rows from matching Figma variables, and existing semantic `Light`/`Dark` alias fields from matching Figma aliases. It does not create config tokens, delete config tokens, invent pairs, or mutate Figma.
- `update_ds_primitives` still accepts `dry_run` for prepared config-backed updates and reports `wouldCreate`, `wouldCreateNames`, and `wouldUpdate` without calling mutation APIs.
- `inspect_ds_setup_gaps` detects missing foreground companions for variant-like background tokens from current Figma data. It handles `surface/bg/background` families, preserves common target naming style (`on-surface`, `text`, `fg`, etc.), never infers `fill`, and reports the source token + Light/Dark alias targets that would be copied.
- `apply_ds_setup_repairs` sends explicit approved repairs to the bridge plugin. The plugin creates only those variables and copies `valuesByMode` from the approved source token in the same Color collection.
- After Figma succeeds, `apply_ds_setup_repairs` updates the active file-scoped config with approved new pairs when safe. If a config already has a pair for the same `bg` with different `text`, it reports a conflict instead of rewriting or adding a duplicate.
- Showcase remains read-only and should never be used to repair variables.

**Files changed in this local work:**
- `packages/figma-bridge-plugin/code.js`
- `packages/figma-bridge-plugin/src/receiver.js`
- `packages/figma-bridge-plugin/ui.html`
- `packages/figlets-mcp-server/src/tools/refresh-ds-config-from-figma.js`
- `packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js`
- `packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js`
- `packages/figlets-mcp-server/src/tools/update-ds-primitives.js`
- `packages/figlets-mcp-server/src/index.js`
- `tests/server/inspect-ds-setup-gaps-tool.test.js`
- `tests/server/apply-ds-setup-repairs-tool.test.js`
- `tests/server/update-ds-primitives-tool.test.js`
- `tests/bridge/update-primitives-dry-run.test.js`
- `packages/figlets-adapter/AGENTS.md`
- `packages/figlets-adapter/CLAUDE.md`
- `DECISIONS.md`
- `memory/PROJECT_MEMORY.md`

**Verification already run:**
- `node --check packages/figma-bridge-plugin/code.js` passed.
- `node --check packages/figma-bridge-plugin/src/receiver.js` passed.
- `node --check packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js` passed.
- `node --check packages/figlets-mcp-server/src/tools/update-ds-primitives.js` passed.
- `node tests/bridge/update-primitives-dry-run.test.js` passed.
- `node tests/server/inspect-ds-setup-gaps-tool.test.js` passed.
- `node tests/server/apply-ds-setup-repairs-tool.test.js` passed when allowed to bind its local mock HTTP server.
- `node tests/server/refresh-ds-config-from-figma-tool.test.js` passed.
- `node tests/server/update-ds-primitives-tool.test.js` passed when allowed to bind its local mock HTTP server.
- Added extra integrity tests after designer concern:
  - `tests/server/refresh-ds-config-from-figma-tool.test.js` now asserts refresh does not create semantic `Light`/`Dark` fields, does not add Figma-only ramp rows, does not add Figma-only semantic pairs, and does not delete configured ramp rows missing from Figma.
  - `tests/bridge/receiver-lifecycle.test.js` checks `setupRepairsLive` capability reporting.
  - `tests/integration/setup-repair-flow.test.js` simulates the receiver/plugin apply flow and proves inspect does not update config, then approved apply updates config only after plugin success.
- Receiver command timeout timers were changed to `unref()` so completed tests/CLI calls do not stay alive waiting for safety timers.
- `npm test` passed: `47/47`.
- Plugin forbidden-operator scan still only matched ES6 reminder comments and markdown bold strings.

**Live dry-run attempt on current Figma file:**
- Ran `sync_figma_data` successfully against active file `local_mozwkg5o_ufp0x3jo`.
- Tried `update_ds_primitives` with `{ categories: ["color-semantics"], create_missing: true, dry_run: true }`.
- The dry-run tool refused because `.local/local_mozwkg5o_ufp0x3jo/design-system.config.js` is not a prepared config: `Config is missing DS.color.ramps. Run prepare_ds_config first.`
- `prepare_ds_config` also refused because that file-scoped config has no `DS.color.brand`.
- Conclusion: the dry-run mutation boundary is implemented, but the feature is incomplete without a preceding "refresh/regenerate config from current Figma" or read-only setup-gap inspection step.

**Current Figma semantic gaps found from the freshly synced snapshot:**
- `color/surface/danger-variant` exists; `color/on-surface/danger-variant` is missing.
- `color/surface/info-variant` exists; `color/on-surface/info-variant` is missing.
- `color/surface/success-variant` exists; `color/on-surface/success-variant` is missing.
- `color/surface/warning-variant` exists; `color/on-surface/warning-variant` is missing.
- `color/surface/brand-variant` already has `color/on-surface/brand-variant`.
- The local scoped config currently includes the `brand-variant` pair only; it does not include `danger/info/success/warning-variant` pairs.

**Live inspector result on active snapshot:**
- `inspect_ds_setup_gaps` reports exactly 4 proposed repairs for `local_mozwkg5o_ufp0x3jo`:
  - `color/surface/danger-variant` -> `color/on-surface/danger-variant`, source `color/on-surface/danger`, aliases Light/Dark -> `color/neutral/0`.
  - `color/surface/info-variant` -> `color/on-surface/info-variant`, source `color/on-surface/info`, aliases Light/Dark -> `color/neutral/0`.
  - `color/surface/success-variant` -> `color/on-surface/success-variant`, source `color/on-surface/success`, aliases Light/Dark -> `color/neutral/0`.
  - `color/surface/warning-variant` -> `color/on-surface/warning-variant`, source `color/on-surface/warning`, aliases Light/Dark -> `color/neutral/1000`.
- The `brand-variant` companion already exists and is not reported.

**Next live step:**
Ask the designer which of the 4 proposed repairs to apply. If approved, reload the plugin so the UI advertises the new `setup-repairs` capability, then run `apply_ds_setup_repairs` with only the approved repairs. Afterward run `sync_figma_data`, `inspect_ds_setup_gaps`, and finally showcase only as verification.

**2026-05-11 live note:** After implementation, `sync_figma_data` was rerun and the active file changed to `local_moy7g0m2_i5kzy3kp`. `inspect_ds_setup_gaps` reported `0` gaps for that currently open file. `refresh_ds_config_from_figma` correctly refused to invent a config for that file because `.local/local_moy7g0m2_i5kzy3kp/design-system.config.js` does not exist. The 4-gap list above belongs to the earlier active file `local_mozwkg5o_ufp0x3jo`.

**2026-05-11 post-reload live note:** Designer reloaded the plugin. `/health` showed active file `local_mozwkg5o_ufp0x3jo` and plugin capabilities included `setup-repairs`. Ran read-only `sync_figma_data`, then `refresh_ds_config_from_figma({ dry_run: true })`, which reported `changedCount: 0`, `skippedCount: 0`, and wrote nothing. Ran `inspect_ds_setup_gaps`, which again reported the same 4 proposed repairs for danger/info/success/warning variant foreground companions. No Figma mutation was performed.

---

### [2026-05-10 — Variant surface foreground guardrail + diagnostic showcase behavior]

**Active branch:** `main`.

**Status:** Implemented and live-tested. Ready to commit.

**Issue discovered via showcase:** In the Portfolio DS file (`local_mozwkg5o_ufp0x3jo`), the showcase exposed a suspicious row like `surface/info-variant` paired with `on-surface/info`. This may be human-authored file state, and the showcase should keep revealing that kind of problem rather than mutating or hiding it.

**Setup-flow guardrail implemented:**
- `packages/figlets-core/src/ds-config/validate-semantic-pairs.js` now generates matching foreground tokens whenever setup generates surface variant tokens:
  - `color/surface/variant` -> `color/on-surface/variant`
  - `color/surface/{brand|danger|success|warning|info}-variant` -> `color/on-surface/{role}-variant`
- Contrast-harmonized overrides include the matching variant foreground pairs as well.
- This prevents Figlets' own setup flow from producing half-paired variant surfaces. Existing designer-authored variables are not changed.

**Showcase behavior corrected:**
- The attempted server-side `build_ds_showcase` auto-bootstrap was removed. Showcase should not manufacture a config or hide file-state issues.
- Config-driven Semantic Colors rendering now also surfaces extra semantic `surface/bg/fill` variables that are not in `DS.color.semantics.pairs` as unpaired BG-only rows.
- `on-*`, text, icon, outline, border, and stroke tokens stay excluded from those extra rows, so the Outlines table does not come back just because config-pairs mode is active.
- This means missing variant foregrounds remain visible as unpaired surfaces instead of disappearing.

**Verification:**
- `node tests/core/ds-config.test.js` passed.
- `node tests/bridge/qa-binding-audit-policy.test.js` passed.
- `node --check packages/figlets-core/src/ds-config/validate-semantic-pairs.js` passed.
- `node --check packages/figma-bridge-plugin/code.js` passed.
- Forbidden operator scan for plugin code matched only ES6 reminder comments and markdown bold strings.
- `npm test` -> 42/42 passed.
- After reloading the Figlets Bridge plugin, `build_ds_showcase` completed on `local_mozwkg5o_ufp0x3jo` with the expected five sections and only known numeric fallback warnings (`spacing 6`, `border 1.5`).

---

### [2026-05-10 — Semantic Colors post-merge hardening + live showcase E2E]

**Active branch:** `main`.

**Status:** The `semantics-showcase-redesign` branch was merged into `main`. Post-review hardening has been implemented locally and is ready to commit.

**What changed after merge:**

1. **Target-side casing fallback in `_inferSemPairExtras`** ([code.js](packages/figma-bridge-plugin/code.js)): exact `varByName` matches still win, but the helper now builds a lazy lower-case lookup fallback and returns the actual variable name from the map. This keeps the helper DS-agnostic for consumers that use paths like `color/Bg/Danger` with target tokens named `color/Border/Danger` / `color/Icon/Danger`.

2. **Inference test coverage expanded** (`tests/bridge/semantic-pair-extras-inference.test.js`): added case 22 for target-side capitalization. The helper suite now reports 22 cases + 5 integration assertions. Fill remains pinned to `fillRef: ''`.

3. **New row-builder render-shape test** (`tests/bridge/semantic-color-row-render-shape.test.js`): evaluates the Semantic Colors Option A row helpers with a Figma-like node stub. This closes the source-only testing blind spot by proving resolved extras become actual pair-box lines (`BG`, `FG`, `BD`, `IC`, `FL`), the preview swatch uses the resolved border variable as its stroke, the icon glyph is appended, missing extras are not invented, and the existing subtle-outline visual fallback remains.

**Verification:**
- `node tests/bridge/semantic-pair-extras-inference.test.js` -> 22 cases + 5 integration assertions passed.
- `node tests/bridge/semantic-color-row-render-shape.test.js` passed.
- `node --check packages/figma-bridge-plugin/code.js` passed.
- `grep -nE '\\?\\?|\\?\\.|\\*\\*' packages/figma-bridge-plugin/code.js` still matches only ES6 reminder comments and markdown bold strings.
- Mutation API hash remains `bd48acf72529bc6caf11e9a41404ec67`.
- `git diff --check` clean.
- `npm test` -> 42/42 passed.

**Live E2E already run on previous active file:**
- Plugin was reloaded and connected to `local_movbxur3_6gow4h4j`.
- `build_ds_showcase` completed successfully and rendered `Colors`, `Typography`, `Spacing`, `Elevation`, and `Scrims`.
- Only known raw numeric-token warnings remained: radius `16`, spacing `6`, and border weight `1.5`.
- Final bridge health check still showed the plugin connected.

**Current live target for the next showcase run:**
- Bridge health now reports active file `local_mozwkg5o_ufp0x3jo` with `build-showcase` capability.

---

### [2026-05-10 — DS-agnostic pairing inference for Semantic Colors (border + icon; fill explicitly excluded)]

**Active branch:** `semantics-showcase-redesign` (continues the redesign branch from 2026-05-09; not yet merged). Builds on commit `490df63`.

**Status:** Implementation shipped and verified locally. 41/41 tests pass (40 existing + 1 new file with 21 cases + 5 integration assertions). Plugin reload + showcase rebuild verification still pending on the user's side.

**Shipped this session:**

1. **New helper `_inferSemPairExtras(bgName, fgName, varByName)`** in [code.js](packages/figma-bridge-plugin/code.js) (inserted after the lifted `_resolveSemRef`). Pure, DS-agnostic, ES6-only. Mirrors the `_findFgPair` segment-substitution pattern but generalized for `border` (targets: `border`, `outline`, `stroke`) and `icon` (targets: `icon`, `graphic`, `symbol` — bg-side first, then fg-side fallback). Suffix-strip fallback for `-subtle|-variant|-strong` mirrors the existing fg-pair fallback at [code.js:3592](packages/figma-bridge-plugin/code.js). Existence-guarded against `varByName`; never invents a path that won't resolve. Tolerates `null`/`undefined`/empty inputs.

2. **Fill is intentionally NOT inferred.** First iteration auto-rendered fill alongside bg+fg, which the user found visually noisy. Helper now returns `fillRef: ''` unconditionally. Explicit `pair.fill` from the user's config still flows through the unchanged `_resolveSemRef(pair.fill)` path and renders. Only the auto-inference of fill is suppressed. Test 21 pins `fillRef === ''` even when `color/fill/<leaf>` exists in `varByName`.

3. **`_resolveSemRef` lifted to outer scope** so both inner branches share it without duplication.

4. **Config-pairs branch** ([code.js:3412–3447](packages/figma-bridge-plugin/code.js)) computes `_extras` and applies the explicit-wins pattern `pair.border || _extras.borderRef` and `pair.icon || _extras.iconRef`. `pair.fill` continues to be resolved directly via `_resolveSemRef(pair.fill)` (no inference layer).

5. **Legacy non-config bg-row branch** ([code.js:3562–3614](packages/figma-bridge-plugin/code.js)) calls the same helper for symmetry — DSes without a config-side `pairs` list also surface bd/ic lines when companion tokens exist by naming convention. Fill is not surfaced in the legacy branch (helper does not infer it). The legacy icon-row and outline-row paths are unchanged.

6. **New test file** `tests/bridge/semantic-pair-extras-inference.test.js`. Source-loads `code.js`, extracts the helper via brace-balanced slicing, evaluates it in a sandbox with stub `varByName` maps. 21 cases cover Material 3, role-based, stroke-only, suffix-strip variants, direct-vs-stripped precedence, fg-side icon fallback, empty/null/undefined inputs, no-family-segment defense, mixed capitalization, deep namespacing, no-leading-namespace, input non-mutation, AND case 21 specifically pinning `fillRef` is always `''`. Plus 5 integration assertions: explicit-wins on border/icon, `pair.fill` directly resolved, helper called from legacy branch, no Figma-mutation API in helper region, and a regex assertion that NO substitution targets `'fill'` as a destination role.

**No-Figma-mutation contract verified:**
- Pre-change line content of `createVariable|setBoundVariable|setVariableScopes|figma.root.setPluginData|getOrCreateCollection`: 75 sites, hash `bd48acf72529bc6caf11e9a41404ec67`.
- Post-change line content (line numbers ignored): 75 sites, identical hash `bd48acf72529bc6caf11e9a41404ec67`. Byte-for-byte identical mutation surface.

**Verification commands:**
- `node --check packages/figma-bridge-plugin/code.js` ✓
- `npm test` → 41/41 ✓
- `grep -nE '\\?\\?|\\?\\.|\\*\\*' packages/figma-bridge-plugin/code.js` → only existing markdown bold and ES6-reminder comments ✓
- `grep -E 'createVariable|setBoundVariable|setVariableScopes|figma\\.root\\.setPluginData|getOrCreateCollection' packages/figma-bridge-plugin/code.js | md5sum` → hash unchanged ✓

**Process note (preserve as feedback for future sessions):** an earlier iteration of this session auto-inferred fill as well; the user reviewed the rendered output, said "revert it back", and the assistant interpreted that as discarding the entire inference work. The user clarified afterwards that only the fill-inference part should have been removed; border + icon inference was wanted to stay. The work was reconstructed from conversation history and the fill role specifically excluded. Lesson: when a user says "revert it back" after a partial-success demo, ask which part — don't assume full revert.

7. **Group header trimmed** ([code.js:2165–2179](packages/figma-bridge-plugin/code.js)): per user feedback after the rebuild, `_buildGroupHeader` no longer renders the leading dot or the trailing count chip. Only the uppercase label remains. The `count` parameter is kept on the signature for back-compat but ignored (`void count`), so the spacing showcase callsite that still passes a single argument is unaffected.

**Visual verification (user-confirmed):**
- Bridge plugin reloaded in Figma Desktop, showcase rebuilt against the active file.
- Group headers render as plain uppercase labels (no dot, no count).
- Bg+fg+bd+ic rows visible where the DS naming supports them; bare bg+fg rows where it doesn't.
- No `fl` lines appear (no pair has explicit `pair.fill` in the active config).
- Pre-existing radius-16 / spacing-6 binding warnings unchanged. New informational `1.5px` border-weight warnings are from the explicit-border swatch path on rows that gained an inferred border; cosmetic, not blocking.

**Follow-up:**
- Branch is ready to merge after external code review. Reviewer prompt has been provided to the user.

---

### [2026-05-09 — semantic colors showcase redesign (shipped on branch)]

**Active branch:** `semantics-showcase-redesign` (off `main` at commit `634730a`). Not yet merged.

**Status:** Implementation shipped and verified locally. 40/40 tests pass. Visual check pending — user should reload the bridge plugin in Figma Desktop and rebuild the showcase against the active config to confirm Brand and Danger rows render with extras.

**Shipped this session:**

1. **`_buildSemColorRow` rewritten to Option A layout** (`packages/figma-bridge-plugin/code.js:2616`). Three columns: pair box (left, FILL) | preview swatch (middle, FILL, height 64) | WCAG pill (right, fixed 96). Pair box stacks one line per role (`bg`, `fg`, plus optional `bd` / `ic` / `fl`); each line is a 14×14 swatch dot + uppercase 2-letter role tag + token name. Preview swatch fills the bg color, sample text "The quick brown fox" renders in the fg color, optional check-circle glyph in the icon color appears to the left of the sample, optional 1.5px inset border in the border color wraps the swatch (falls back to the existing 0.5px subtle outline when no border is supplied), and Lc / ratio diagnostics overlay on the right side of the swatch in the fg color at 0.78 opacity. WCAG pill on the right reuses `_buildBadge`. All fills, strokes, and text colors bound to existing showcase variables (`_V.*` / `_RC.*`); no prototype hex values copied in.

2. **New helpers** (`code.js`): `_splitTokenLabel`, `_buildSemPairLine`, `_buildSemPreviewSwatch`, `_buildSemIconGlyph` (uses `figma.createNodeFromSvg`, falls back to no glyph if the API is missing).

3. **`_buildGroupHeader` extended** (`code.js:2165`) with optional `count` argument. When count is passed, the header gets a 6×6 brand-variant dot prefix and a "· N" suffix. Existing single-arg call at `code.js:3804` is unchanged.

4. **Config-pairs assembly extended** (`code.js:3365`). Pairs are now grouped by family using `_semGroupLabel(pair.bg)` (heuristic: strip `-subtle` / `-variant` / `-strong` suffix; collapse `default` / `subtle` / `muted` into "Neutral"; capitalize the rest). Each group emits a `_buildGroupHeader(label, count)` row, then its pair rows. Every pair resolves optional `border`, `icon`, `fill` token references via a local `_resolveSemRef` helper and passes their RGB + variable refs into `_buildSemColorRow`.

5. **Schema extension**: `DS.color.semantics.pairs[*]` may now optionally include `border`, `icon`, `fill` keys alongside the existing `{ bg, text }`. Border falls back visually to the subtle outline when omitted; icon and fill have no fallback. The user's existing config does not have these keys yet — they remain optional and the existing pairs render without them. To populate them, add token paths (e.g. `"border": "color/border/brand"`) to a pair entry in `design-system.config.js`.

6. **Heading row updated** to match the new 3-column layout: `Pair (flex) | Preview (flex) | WCAG (96, center)`.

7. **Legacy non-config branch updated** (`code.js:3557` icon callsite, `code.js:3609` bg+fg callsite): both pass `roleNames` so the pair box renders correct names even without a config. Icon row uses `{ bg: iconSurfaceLabel, fg: tokenLabel }`. bg+fg row uses `{ bg: tokenLabel, fg: fgPairName ? _tokenLabel(fgPairName) : '' }`.

8. **Test updates** (`tests/bridge/qa-binding-audit-policy.test.js`): replaced the assertion that locked the old `_buildSwatch(... _contrastLabel(...))` inline-label call with a new contract that checks the row computes APCA Lc + WCAG ratio and surfaces pass/fail through `_buildBadge` (the right-column pill). Underlying helpers (`_lcLabel`, `_wcagLabel`, `_contrastLabel`, `_apcaLc`, threshold consts) are still required because primitive contrast swatches still use them.

**Verification:**
- `node --check packages/figma-bridge-plugin/code.js`
- Forbidden executable `??`, `?.`, `**` scan clean (only the two ES6-reminder comments match).
- `npm test` passed: 40/40.

**Follow-up:**
- User should reload the bridge plugin in Figma Desktop and rebuild the showcase against `.local/local_movbxur3_6gow4h4j/design-system.config.js`. Without `border`/`icon`/`fill` keys in that config, rows render with `bg + fg` only — that is expected. Add extras to a pair to see the full kit.
- Branch is `semantics-showcase-redesign`. Not merged. Merge when the user signs off on the visual.

---

### [2026-05-09 — APCA offset corrected to 0.0.98G]

**Context:**

1. **Source design**: Claude Design handoff `kxkMQhWCvpr-62R4Tm72Yw`, primary file `Semantic Colors Riffs.html`. The bundle was downloaded to `/tmp/design-pkg/figlets/` for this session. It contains three layout riffs (A / B / C) over the same 14-pairing token set; only **Option A** was iterated in the source chat (`figlets/chats/chat1.md`) — extras (`bd`, `ic`) added to the data model and toolbar removed. User confirmed Option A is the chosen layout.

2. **In scope**: the semantic-colors table inside `_buildShowcase` Colors section. Specifically:
   - `_buildSemColorRow` (`packages/figma-bridge-plugin/code.js:2616`)
   - The surrounding semantic table assembly (`code.js:3212–3244` for the config-pairs path, plus the heading row and group header construction feeding `_semTable`).

3. **Out of scope**: outline rows, surface/icon/fill bottom tables, primitive ramps, typography, spacing, elevation, and the Colors section frame chrome. Do not touch them.

4. **Styling rule**: bind every fill / stroke / text color in the new node tree to the existing showcase variable refs (`_V.*` resolved via `_findVar`) and color values (`_textColor`, `_subColor`, `_bgColor`, `_RC.surfaceDefault`, `_RC.outlineSubtle`). The Option A.jsx hex values (`#fafaf7`, `#c5e866`, `#dcdcd6`, `#1a1d1f`, etc.) are layout references only and must not appear in the Figma node tree.

5. **Schema extension**: `DS.color.semantics.pairs[*]` gains optional `border`, `icon`, and `fill` keys alongside `{ bg, text }`. Missing keys mean the row omits that line in the pair box and the corresponding treatment in the preview swatch. Border has a default-border fallback for outlined surfaces; icon and fill have no fallback. The config preparer (`prepare_ds_config` and the pair generation it drives) is the place to populate these — reuse existing pair generation, append missing keys, do not refactor the resolution logic.

6. **Per-row layout to build (Option A):**
   - **Pair box** (left column): vertical stack of role lines. Each line is a 14×14 rounded swatch dot + 2-letter uppercase role tag (`bg`, `fg`, `bd`, `ic`, `fl`) + full token name (e.g. `bg/brand`, `text/on-brand`, `border/brand`, `icon/on-brand`). Role count is data-driven: 2 lines for a minimal pair, up to 5 when the kit is full.
   - **Preview swatch** (middle column): rectangle filled with the bg color. Sample text "The quick brown fox" rendered in the fg color. If `icon` is defined, render a small check-circle glyph in the icon color to the left of the sample. If `border` is defined, draw an inset 1.5px stroke in the border color around the swatch. Bottom-right of the swatch overlays Lc and `ratio:1` in the fg color.
   - **WCAG pill** (right column): existing `_buildBadge` already covers ✓ AAA / ✓ AA / ~ AA*; reuse.
   - **Group header**: small lime-equivalent dot (use `_V.brandVariant` / `_RC.surfaceBrand`-equivalent — confirm against the active palette before binding) + uppercase group label + count.

7. **Tests already passing on this branch**: 40/40 on `npm test`. No new tests yet for the redesign.

**Verification done:**
- Branch `semantics-showcase-redesign` created off `main`.
- Design package fetched, README read, chat read, all three Option files and `tokens.js` reviewed.
- Source row builder and table assembly located and understood.

**Verification pending (for the implementing agent):**
- Run `npm test` after each step. Confirm 40/40.
- `node --check packages/figma-bridge-plugin/code.js`.
- Forbidden executable-operator scan for `??`, `?.`, `**` in `code.js`.
- Visual check by reloading the bridge plugin in Figma Desktop and rebuilding the showcase against the active `local_movbxur3_6gow4h4j` config; eyeball Brand and Danger rows since those exercise the most extras.

**Reference paths (kept in /tmp, not the repo):**
- `/tmp/design-pkg/figlets/README.md`
- `/tmp/design-pkg/figlets/chats/chat1.md`
- `/tmp/design-pkg/figlets/project/Option A.jsx` — the canonical layout to mirror
- `/tmp/design-pkg/figlets/project/tokens.js` — example pair shape with extras

---

### [2026-05-09 — APCA offset corrected to 0.0.98G]

**Shipped this session:**

1. **APCA low-output offset fixed** (`code.js`, `validate-semantic-pairs.js`, `generate-color-ramps.js`): Replaced the scaled `12.5` offset with `2.7`, matching APCA 0.0.98G's `loBoWoffset/loWoBoffset = 0.027` after multiplying Lc by 100. The old value under-reported high-contrast pairs by about 10 Lc.

2. **Screenshot discrepancy explained and pinned**: `#FFFFFF` on `#38312e` now computes as `Lc 102`, matching the external Figma accessibility plugin result. Black text on white is pinned at `Lc 106`.

3. **WCAG formula checked and pinned**: WCAG contrast already matched WCAG 2.2 relative luminance: sRGB cutoff `0.04045`, coefficients `0.2126/0.7152/0.0722`, ratio `(lighter + 0.05) / (darker + 0.05)`. Added a boundary test for `#777777` on white: displayed as `4.5:1` after one-decimal rounding but still fails the unrounded `4.5` AA body gate.

**Decision context:** The previous project memory said Figlets used APCA 0.0.98G and that the validator and plugin were byte-identical. There was no recorded product reason to use `12.5`; it was an implementation artifact. The correction may reduce APCA fail counts because the old math was stricter than intended.

**Verification:** User reloaded the Figlets Bridge plugin in Figma Desktop, then `build_ds_showcase` rebuilt Colors, Typography, Spacing, Elevation, and Scrims on `00 · Tokens`. Only existing generated-showcase chrome warnings remained (radius `16`, spacing `6`). Full `npm test` passed 40/40 after the live remake.

---

### [2026-05-09 — bridge plugin UI rebuild against FigWords (final)]

**Shipped this session (supersedes the earlier 2026-05-09 compact-refresh attempt):**

1. **UI rebuilt to FigWords parity** (`ui.html`): Pulled design context, screenshots, and variables from `FigWords` node `98:40172` via the Figma MCP and rebuilt the layout from scratch. Three explicit layouts now match the reference: Collapsed 296×348 (left column only); Expanded 576×348 (left column + right-hand log box at full height); Expanded+QA 576×348 (log box shrinks to 148px and a QA Scope summary box renders below it). All paddings (16px outer, 16px inter-column gap), strides (selection lines 20px, button row 42px), and font sizes (title-md 16/24/500, label-lg 14/20/500, body-sm 12/16/400, label-sm 11/16/500) come from the FigWords design tokens.

2. **Visual tokens swapped to FigWords variables** (`ui.html`): bg `#121212`, brand `#c9fb8c`, brand-subtle `#253a00`, text default `#f5f5f5`, text subtle `#dfdfdf`, text brand `#e7ffcd`, text warning `#ffe5ad`, border brand `#5d8227`, border subtle `#212121`. Removed the outer `border-radius: 18px` because the rounded card in the design canvas is a mock — the host plugin window cannot render rounded outer corners, and the body now fills the window.

3. **Sora typography via Google Fonts** (`ui.html`): Loads only weights 400 and 500 with `display=swap`. Browser-cached after first open; offline silently falls back to Inter. Plugin file size is unaffected.

4. **QA report relocated to the right column** (`ui.html`): Local QA results now render as a bordered summary box (`QA Scope`, `Violations`, `Fixed`, `Needs review`, `Color`, `Spacing`, `Type`) under the log box, matching the third FigWords layout. Running QA auto-expands the log so the summary is always visible.

5. **Single-tooltip policy** (`ui.html`): Removed the custom `#ui-tooltip` element and all hover/focus handlers. Documentability spans, both QA buttons, and the Show Log toggle now use the browser's native `title` attribute. The QA buttons gained explanatory tooltips describing what each action does (read-only scan vs. high-confidence binding).

6. **Animated expand/collapse** (`ui.html`): `_setLogOpen` coordinates `figma.ui.resize` with a CSS opacity+translateX transition on the log column (160ms ease). Expand posts the resize first, then fades content in on the next frame; collapse fades content out first, then shrinks the host. The window edge still snaps (Figma's resize is synchronous), but content motion masks most of the abruptness.

7. **Tests updated** (`tests/bridge/qa-binding-audit-policy.test.js`): Replaced the old hex-value assertions (`#111111`, `#c5ff73`, `#dcffc0`, `#639d13`, `border-radius: 18px`) with the FigWords tokens (`#121212`, `#c9fb8c`, `#e7ffcd`, `#5d8227`, `border-radius: 9999px` for pills). Replaced the custom-tooltip assertions with native-`title` assertions on the doc-status spans and the QA buttons; explicitly asserted that `id="ui-tooltip"` no longer exists in the UI.

**Verification:**
- Figma MCP design context fetched from `FigWords` node `98:40172` (screenshot + metadata + variables).
- `node tests/bridge/qa-binding-audit-policy.test.js`
- `npm test` passed: 40/40 after each iteration.
- User confirmed visual parity in Figma Desktop after reload, including the tooltip fix, animation, and Sora font load.

**Follow-up:**
- Reload the Figlets Bridge plugin in Figma Desktop is no longer pending — user has reloaded and confirmed.
- The animation timing is 160ms; if it feels too slow/fast in practice, that's a one-line tweak in the CSS transition + setTimeout.
- Sora is fetched from Google Fonts at runtime. If a future requirement bans network dependencies in the plugin iframe, switch to base64-embedded woff2 (cost: ~30KB per weight, parsed every plugin open).

---

### [2026-05-09 — Figma variable picker scopes]

**Shipped this session:**

1. **Variable scope helper** (`code.js`): Added `_scopeForVariableName`, `_setVariableScopesForName`, and `_applyVariableScopesToCollection`. The bridge now hides Primitives variables from Figma pickers with empty scopes, while mapping semantic token paths to picker scopes: radius → `CORNER_RADIUS`, border widths → `STROKE_FLOAT`, spacing → `GAP`, touch/size → `WIDTH_HEIGHT`, typography → font size/line-height/letter-spacing/weight/family, text/icon colors → `TEXT_FILL`, outline/border colors → `STROKE_COLOR`, fill/surface/background colors → `ALL_FILLS`, and shadow/elevation tokens → effect scopes.

2. **Setup + update coverage** (`code.js`): `apply_ds_setup` scopes variables as it creates them and runs collection-level repair passes even when existing collections are skipped. `update_ds_primitives` keeps primitive variables hidden and scopes refreshed/newly-created semantic variables without changing IDs, values, or aliases.

3. **Policy tests** (`tests/bridge/qa-binding-audit-policy.test.js`): Added guards for the scope mapping helper, setup repair calls, and update-path scope preservation.

**Verification:**
- `node --check packages/figma-bridge-plugin/code.js`
- `node tests/bridge/qa-binding-audit-policy.test.js`
- Forbidden executable `??`, `?.`, `**` scan clean; only existing comments/markdown strings match.
- `npm test` passed: 40/40.
- Live repair after the first plugin reload: started the local receiver, ran `apply_ds_setup` against `.local/local_movbxur3_6gow4h4j/design-system.config.js`; all five collections were skipped as existing and scope repair passes completed. Synced the Figma data snapshot afterward (`338` variables). This was before the follow-up change that hides Primitives from pickers, so reload the plugin and rerun `apply_ds_setup` once more to apply the final primitive-hiding behavior. The current snapshot exporter does not serialize `variable.scopes`, so live scope verification is visual in Figma's variable picker unless the exporter is extended.

**Live application:**
- After the final primitive-hiding change, the plugin was reloaded and `apply_ds_setup` was rerun against `.local/local_movbxur3_6gow4h4j/design-system.config.js`. All five collections skipped as existing, text styles refreshed, and the scope repair pass completed with the final behavior. A follow-up sync showed `Figlets DS` with 5 collections, 338 variables, 15 text styles, and 6 effect styles.

---

### [2026-05-06 — fresh DS setup for new file + merge-populate fix]

**Shipped this session:**

0. **Flat config guard**: Fixed the per-file isolation footgun where a new/unsaved Figma file could inherit `.local/design-system.config.js`. Server tools now refuse the legacy flat config for active file workflows: `prepare_ds_config`, `apply_ds_setup`, and `update_ds_primitives`; `build_ds_showcase` only auto-reads a config when `.local/<fileKey>/design-system.config.js` can be resolved.

0. **Persistent local identity for keyless drafts**: New/unsaved Figma files that return empty `figma.fileKey` now get a stable `local_*` key stored in `figma.root` plugin data (`figletsFileKey`). The UI forwards this as `fileKey`, so sync/config/showcase state routes to `.local/<local-id>/` instead of the flat root. Real Figma fileKey still takes precedence when available.

0. **Scrim/text binding guard**: Reinstated the semantic binding decision that decorative color variables are not valid automatic text/foreground candidates. Both `_createDsBindingContext()` and the restored showcase builder now exclude `scrim`, `overlay`, `state`, `shadow`, and `elevation` color names from role fallback scoring. Scrim variables still render in the Scrims section; they just cannot become generated copy text fills.

0. **Showcase rollback after failed color-migration coupling**: `_buildShowcase` and `build_ds_showcase` payload shape were restored to the pre-Sunday-17:13 baseline (`eda38ad`). Product decisions around color primitive regeneration, semantic alias updates, per-file isolation, and additive setup repair are preserved, but showcase presentation is frozen back to the prior working builder. Do not reintroduce APCA-specific showcase columns, config-driven showcase grouping, or outline/border showcase restructuring as part of color update work.

0. **Setup preview before apply**: `prepare_ds_config` writes `design-system.preview.svg` next to the active file-scoped config and returns `setupPreview.svgPath`. Use this in the conversation to review ramps and semantic pairs visually before `apply_ds_setup`; do not apply to Figma until the designer confirms after preview + readiness.

0. **Utility status semantic split**: Default generated utility semantics now treat `bg/*` / `surface/*` as soft readable status backgrounds, while strong saturated status colors use explicit `fill/*` + `text/on-*` pairs. This keeps background semantics aligned with common design-system practice and avoids baking a strong-fill opinion into `bg`.

0. **Showcase semantic-pair restoration**: `build_ds_showcase` now forwards `DS.color.semantics.pairs` from the active file-scoped config. The bridge plugin renders the Semantic Colors table from those validated pair relationships instead of trying to infer pairs from names. This fixed clean-file showcase regressions where role-based tokens were split into `surface`/`icon`/`fill` sub-tables and table text bound to purpose-specific tokens such as `color/text/on-brand`, making labels invisible. Muted pairs remain exempt and may not show the paired-text indicator when below the indicator threshold; threshold tuning is a follow-up product decision.

1. **DS config for new Figma file** (`.local/design-system.config.js`): Primary `#A6D56A`/400, Secondary `#609190`/500, Accent `#CCBDB7`/300. 11-step `50–950` OKLCh ramps. APCA contrast. Light + Dark modes. Standard utility ramps (neutral, red, green, yellow, blue, neutral-variant). Sora + JetBrains Mono. Material3 type scale. 8px grid, 4-breakpoint (Mobile/Tablet/Desktop/Wide). All 15 APCA semantic pairs pass Lc ≥ 75 after manual step fixes (e.g. bg/brand → primary/800 Light, primary/200 Dark; utility status pairs bumped to /700–/800 range). Zero failures.

2. **Showcase rendered** on page `00 · Tokens` — Colors, Typography, Spacing, Elevation, Scrims (5 sections). Two binding warnings remained after the first pass: no border-8 variable, and a QA binding pass with unresolved gaps from stale Typography/Spacing variable names.

3. **`getOrCreateCollection` merge-populate fix** (`code.js`): When Primitives collection exists but has no COLOR variables (user deleted ramps but kept FLOAT/STRING vars), the plugin now re-enters the population block instead of skipping. Uses a `_primHasColors` check before the `if (existed)` branch. The population block pre-builds `_primMergeMap = await buildVarMap(primColl.id)` and wraps every `createVariable` call with `if (_primMergeMap[name]) continue` to skip existing vars. Same merge-map pattern applied to Typography and Spacing blocks for mode dedup safety (pre-existing FLOAT vars are not recreated). `getOrCreateCollection` falls back to empty-shell detection (any vars → existed = true) for all other collections.

4. **Color alias self-repair** (`code.js`): When Color collection exists, the plugin scans `variable.valuesByMode` across all Color vars to check for any `VARIABLE_ALIAS` value. If none exist (`_semNeedsRepair = true`), it runs a full alias rewiring pass — rebuilds `_repPrimMap` + `_repSemVarObj` from `getLocalVariablesAsync`, resolves Light/Dark mode IDs from the existing collection, then iterates pairs/icons/unpaired from `DS.color.semantics` and calls `v.setValueForMode(modeId, { type: 'VARIABLE_ALIAS', id })` on each existing semantic variable. Reports as `Color (aliases repaired)` in the built list. This handles the case where Color was created before Primitives had ramp vars.

5. **Typography/Spacing additive stale-collection repair** (`code.js`): Existing Typography and Spacing collections no longer skip blindly. If the collection exists but is missing current generated DS names (`type/{role}/...`, `space/{semantic}`, `space/radius/{key}`, `space/border/{key}`), `apply_ds_setup` enters merge mode, adds missing vars/modes only, and leaves old variables intact. Also fixed Typography aliasing so fresh Typography creation after Primitives already exists still points at the configured type/font primitive names.

6. **QA safe-bind accounting fix** (`code.js`): `_runQaBindingAudit({ fix: true })` now only attempts high-confidence suggestions. Low/medium/none suggestions are still reported in audits but are not counted as failed safe-bind fixes. This addresses the misleading showcase warning where 31 intentionally skipped suggestions were reported as unresolved gaps.

**Per-file isolation status:**
- Flat `.local/design-system.config.js` is legacy only. If `active-file.json` has no fileKey, tools must not use it. Migration for an existing saved file remains: reload plugin, run `sync_figma_data` to get a real fileKey, then move/copy the intended config to `.local/<fileKey>/design-system.config.js`.

**Open for next session:**
- Reload the Figlets Bridge plugin after the showcase rollback, then rebuild the showcase. Expected behavior: old working showcase grouping/readability, with color primitives/semantics still updateable through the dedicated setup/update paths.

---

### [2026-05-06 — per-file config isolation + swatch indicator polish]

**Shipped this session:**

1. **Per-Figma-file config isolation** (`code.js`, `ui.html`, `receiver.js`, `paths.js`, `build-showcase.js`, `audit-tokens.js`): All `.local/` files are now namespaced under `.local/<fileKey>/`. `figma.fileKey` is included in every plugin→UI postMessage; UI forwards it as `?fileKey=` on all receiver fetch calls. Receiver writes `figma-data.json` and `figma-selection.json` to `.local/<fileKey>/` and maintains `.local/active-file.json = { fileKey, updatedAt }`. `paths.js` gains `getFilePaths(fileKey)`, `readActiveFile()`, `getActiveFilePaths()`. `build-showcase` and `audit-tokens` use the active file automatically. `prepare_ds_config` and `update_ds_primitives` take an explicit `config_path` — use `.local/<fileKey>/design-system.config.js`. Switching files: open in Figma, run `sync_figma_data`, active pointer flips.

2. **Algorithm-aware swatch indicators** (`code.js`, `build-showcase.js`): Badge shows `Lc XX%` (APCA, Lc ≥ 60) or `✓` (WCAG, ratio ≥ 4.5). Step number top-left, badge bottom-right at 12px from edges. Badge created inline with `textAutoResize` set before `characters`; `MAX` constraints set after x/y. `build-showcase.js` forwards `DS.color.contrastAlgorithm` from config to plugin. Swatch stroke conditional on `_V.outlineSubtle` existing. Outline/border/stroke tokens in their own "Outlines & Borders" table with `[Token, Example]` heading only.

**Open for next session:**
- `surface/brand` Lc 50 (both modes): accepted for now. Needs lighter lime surface step or white text for body copy.
- `surface/default`/`on-surface/variant` Dark: Lc 56 pre-existing.
- Status-color surfaces: 9 pre-existing APCA failures.
- **Migration**: existing `.local/design-system.config.js` must be moved to `.local/<fileKey>/design-system.config.js` manually (run one sync to discover the fileKey).

---

### [2026-05-05 — auto-anchor + showcase columns + rebrand demo]

**Shipped this session:**

1. **Auto-anchor brand step from luminance** (`generate-color-ramps.js`): `brandAnchorIdx` now returns `{ idx, step, isAuto }`. When `brand.step` is omitted, the step is derived from OKLab L via `t = (OKLCH_LIGHT_TARGET − L) / (OKLCH_LIGHT_TARGET − OKLCH_DARK_TARGET)` and snapped to the nearest configured scale step. When explicit, `isAuto: false`. The ramp summary shows each brand with its resolved step and source (auto/override). Test: `tests/core/brand-anchor.test.js`.

2. **Showcase contrast columns** (`code.js`): Replaced single `Contrast` header with three explicit headers — `APCA Lc`, `Status`, `WCAG` — on both the main semantic table and the icon bottom table. `Status` badge is algorithm-aware: APCA mode uses Lc 75 / Lc 60 / Fail thresholds; WCAG mode uses AAA / AA / Large / Fail. The WCAG badge cell (previously a 4th column) was removed; WCAG ratio stays as a plain number. `_buildStatusBadge(lc, ratio)` is the new entry point.

3. **`prune_unused_ramps` flag** (`update-ds-primitives.js` + `code.js`): New `prune_unused_ramps: true` tool option. Plugin deletes any `color/<name>/<digits>` variable in Primitives whose `color/<name>` folder is not in `DS.color.ramps`. Count reported in `report['color'].prunedRamps` and added to `pruned` total.

4. **Cascade-safety warnings** (`index.js` + `prepare-ds-config.js`): `runDsPipeline` scans resolved semantics for `color/<name>/<step>` refs where `<name>` is not a configured brand or utility ramp. Surfaces as `staleSemantics: [{ token, ref, currentName }]` (non-throwing). `apcaFailCount` is now explicitly named in the prepare output. Both surface in the prepare summary message.

5. **Full rebrand demo — Green Apple → lime/teal/sand**: Replaced peach/lime/teal/gold brand config with lime (primary, step 500 override), teal (secondary, auto→600), sand (no role, auto→500). `prune_unused_ramps` deleted 18 variables (peach + gold ramps). 9 created (sand). 5 semantics updated. Zero binding warnings in showcase. 11 APCA failures remain: 9 pre-existing utility-color failures (same step choices as before), 2 from `surface/brand` (Lc 50 — brand hex at mid-luminance, accepted for large-text usage).

**Resolved open issues from prior session:**
- Brand-step is now auto-derived (issue 2) ✓
- Showcase contrast columns standardized (issue 3) ✓
- Brand-removal cascade is now handled by `prune_unused_ramps` for primitives + `staleSemantics` warning for semantic refs (issue 1, partial) ✓

6. **Algorithm-aware swatch indicators** (`code.js` + `build-showcase.js`): `_swatchIndicator` and `_buildSwatch` gate on `_contrastAlgorithm` read from `DS.color.contrastAlgorithm` (forwarded by `build-showcase.js` from `.local/design-system.config.js`). APCA mode: Lc ≥ 60 threshold, badge shows `Lc XX%`. WCAG mode: ratio ≥ 4.5 threshold, badge shows `✓`. Step number (e.g. `300`) shown top-left. Badge positioned bottom-right at 12px from edges using inline text creation (`textAutoResize = 'WIDTH_AND_HEIGHT'` set before `characters`) + `MAX` constraints set after x/y. Outline stroke on swatch container only applied when `_V.outlineSubtle` exists. Outline/border/stroke semantic tokens moved to a dedicated "Outlines & Borders" table with `[Token, Example]`-only heading (no accessibility columns).

**Open for next session:**
- `surface/brand` Lc 50 (both modes): the lime hex at mid-luminance gives insufficient APCA for body text. Either a lighter lime surface step or white text would fix it. Designer accepted Lc 50 for this session.
- `surface/default`/`on-surface/variant` Dark: Lc 56 (neutral/300 on dark surface). Pre-existing, needs a step bump.
- Status-color surfaces (danger/success/warning/info): 9 pre-existing APCA failures from the utility-color step choices.

---

### [2026-05-05 — per-brand step anchor + scoped semantic showcase]

**Shipped this session (commit `13362e2`):**
- `generate-color-ramps.js`: brand entries accept `step: NNN`. The brand hex anchors at that step instead of the scale midpoint (default `midIdx`). Light side fans toward step 100 (L≈0.97), dark side toward step 900 (L≈0.18) from the declared anchor. Backward-compatible — `step` omitted falls back to old behavior.
- `update-ds-primitives` (tool + plugin): new `prune_off_scale: true` flag deletes primitives in the configured ramp folders whose step number is outside the active scale (e.g. `/50` and `/950` after switching to a 100–900 scale). Scoped to ramps in `DS.color.ramps`; never touches arbitrary variables.
- `build-showcase` (tool + plugin): the tool now reads `.local/design-system.config.js` and forwards `DS.collections` to the plugin. The plugin filters `_semanticColls` and `_primColls` by name when the config is provided, falling back to the existing heuristic only when not. Stops component-scoped alias collections (e.g. `Button · Type`) from being rendered as semantic color tokens.
- `.local/design-system.config.js`: added `step: 400` to lime, `step: 700` to teal, added a `gold` accent brand entry with `#C9943A` at `step: 500`. Pipeline regenerated all ramps; lime/400, teal/700, and gold/500 hold the brand hexes exactly.

**Live verification on the Green Apple file:**
- `color/lime/400` = `#88bf2e`, `color/teal/700` = `#2f6b6b`, `color/gold/100..900` created (9 new variables).
- Orphan `/50` and `/950` from lime, teal, neutral, red, green, yellow, blue all pruned. Every ramp is now a clean 9-step 100–900.
- Showcase rebuilds with zero binding warnings (was 2). Button · Type collection no longer pollutes the semantic-color table.

**Open issues surfaced for the next session (not yet addressed):**
1. **Brand-removal cascade is manual.** When a brand color is removed from `DS.color.brand[]`, the agent must also rewrite `DS.color.semantics` (which still hard-codes `color/<name>/<step>` paths), purge the `color/<name>/*` primitives in Figma (the new `prune_off_scale` only handles steps within configured ramps, not whole removed ramps), and surface any direct component bindings to those primitives. There is no tool for this today; the designer experiences the gap as "the config is polluted."
2. **Brand-step is not auto-derived.** The `step` field is honored when set but defaults to scale-mid when omitted. Auto-detection should map OKLab L → step using the same `LIGHT_TARGET`/`DARK_TARGET` constants the ramp generator uses. `step` stays as an explicit override.
3. **Showcase contrast columns are inconsistent.** The third "badge" column mixes APCA conventions ("Lc 60", "Lc 75", "Fail") with WCAG conventions ("✓ AA", "✓ AAA"), and the new APCA-Lc and badge columns have no headers. Designer can't tell what each column means. Should standardize on the configured `DS.color.contrastAlgorithm` for the badge and add explicit headers for "APCA Lc" and "WCAG".
4. **Add/remove ramp safety.** Adding a brand ramp is silent (config is rewritten, designer doesn't see what changed at the semantic level); removing a brand ramp without an offered reassignment leaves the semantic section pointing at non-existent primitives. Both flows need a confirmation step from the agent before semantics are written.

---

## Current Pillar Decision — Binding Policy

As of 2026-05-02, design-system binding is **variable-first** for colors, spacing, radii, borders, and scalar layer properties. Figma color/effect styles are fallback metadata, not the primary color binding target. **Typography is the exception:** text styles may be preferred because they can bundle size, line-height, weight, tracking, and family decisions that may themselves be variable-backed.

Practical rule for future work: setup, showcase, documentation, QA, and component creation should rely on the shared live resolver `_createDsBindingContext()` for binding decisions. Server-side hex/value indexes are for reporting and detection context only; they must not become automatic binding authorities. Hex/nearest-color matching remains forbidden for automatic color binding.

## Current Pillar Decision — Agent Boundary

As of 2026-05-02, designer-facing agents guide workflows but do **not** own product logic. The agent translates plain designer intent into existing MCP tools, helps with readiness and confirmation, and summarizes results in human language. The bridge plugin, MCP tools, and shared core own detection, binding, rendering, QA, setup, and documentation output.

Practical rule for future work: agents may choose supported tool options and may ignore or summarize parts of tool output based on the designer's request, but they must not edit showcase scripts, binding logic, QA rules, or generated output as part of a public workflow. Unsupported designer requests become product/dev backlog items unless the developer is explicitly working in this repo.

## Current Pillar Decision — Color Ramp Algorithm

As of 2026-05-02, color ramps default to **OKLCh** interpolation. `DS.color.algorithm` switches between `"oklch"` (default) and `"hsl"` (preserved fallback). OKLCh keeps tints/shades vivid because it interpolates lightness in a perceptually uniform space and only gently reduces chroma; HSL crushed saturation up to 85% on the light side, which is why ramps looked dull.

Practical rule for future work: any new ramp tuning (per-brand chroma boost, custom curves, named presets like "vivid"/"muted") should extend the existing `generateRamp` dispatcher in `packages/figlets-core/src/ds-config/generate-color-ramps.js` and the shared `oklch.js` utilities. Do not introduce parallel ramp pipelines. The semantic-pair WCAG validator and primitives writer downstream are algorithm-agnostic and consume only the resulting `[step, r, g, b]` rows.

As of 2026-05-03, OKLCh `color/neutral/*` is achromatic by default (C=0), not derived from the primary brand hue. A separate `color/neutral-variant/*` ramp carries a very subtle low-chroma tint for secondary surfaces and subtle outlines. Future warm/cool behavior should stay in explicit variant configuration, never implicit in the base neutral ramp.

`update_ds_primitives` supports `create_missing: true` for additive primitive migrations such as adding `color/neutral-variant/*` to an existing Primitives collection. Use it when adding new variables is intended; leave it false for value-only updates.

## Current Pillar Decision — Contrast Algorithm

As of 2026-05-04, accessibility gating defaults to **APCA** (`DS.color.contrastAlgorithm = 'apca'`). Both APCA Lc and WCAG ratios are computed and stored on every semantic pair; only `failCount` and the readiness gate switch per algorithm. Existing configs without the field upgrade transparently to APCA.

Key thresholds: Lc 75 for surface/text pairs, Lc 60 for icon pairs. Decorative/exempt tokens (`min: null`) get `minLc: null` and are never gated. The plugin showcase shows APCA Lc and APCA badge columns **before** the WCAG columns on every semantic color row.

WCAG 2.2 remains a first-class option (`DS.color.contrastAlgorithm = 'wcag'`). Teams with legal/contractual WCAG obligations should set this field explicitly. Switching the field and re-running `prepare_ds_config` is enough — no variable structure changes, only `failCount` and the readiness verdict change.

The APCA formula is APCA 0.0.98G (BC=0.022, BE=1.414 soft clamp; polarity-aware rounding). The validator and plugin implementations are byte-identical.

Practical rule for future work: do not introduce a separate APCA/WCAG code path for any new contrast check. Use `gatePass()` from the validator or the `apcaScorer`/`wcagScorer` helpers. New pair templates must include `minLc` (surface/text: 75, icons: 60, decorative: null).

## Current Live-Figma Rule — Plugin Capability Checks

As of 2026-05-03, the bridge UI advertises command capabilities on `/poll`, receiver `/health` reports `updatePrimitivesLive`, and `update_ds_primitives` fails fast with reload guidance if the open plugin UI is stale. Use `figlets-mcp doctor` before live primitive updates; "Primitive updates: available" means the plugin was reopened with the latest UI.

## Current Designer Button Rule — Safe QA Binding

As of 2026-05-03, the bridge UI has local QA buttons: "Check" renders a report in the plugin, and "Bind Safe" applies only high-confidence fixes through `_runQaBindingAudit({ fix: true })`. Exact scalar matches can be bound automatically. Color role guesses stay report-only unless future work adds stronger semantic evidence; do not reintroduce broad hex or nearest-color auto-binding.

---

## Project Identity

- Name: `figlets-mcp`
- Purpose: agent-agnostic, MCP-first toolkit for Figma design system workflows
- Relationship to existing repo: current `figlets` remains the Claude-facing product; this repo becomes the shared architecture

---

## Current Direction

- Build the shared core first
- Expose stable MCP tools over that core
- Add Codex and Claude adapters as thin orchestration layers
- Migrate logic gradually rather than rewriting everything at once

## Post-MVP Todo

- Add optional agent-enriched showcase descriptions. Default showcase descriptions should stay deterministic and cheap, but a later workflow can ask an agent to polish token/table usage copy and write the result back to Figma token/style descriptions so future showcase builds can reuse it without spending tokens again.

---

## Initial Migration Targets

- design system detection
- token gap audit
- component inspection
- component documentation

These were chosen because they are useful across agents and are mostly deterministic.

---

## Established Boundaries

- Deterministic analysis belongs in core/MCP
- Conversational intake and user confirmation belong in adapters
- Project-specific values belong in config or tool parameters
- Agent-specific prompt style should not leak into shared logic

---

## Repo Structure So Far

- `docs/` for architecture, migration plan, and tool contracts
- `memory/` for durable project context
- `packages/figlets-core/` for shared logic
- `packages/figlets-mcp-server/` for MCP exposure
- `packages/figma-bridge-plugin/` for the local Figma data extractor
- `packages/figlets-adapter-codex/` for the Codex adapter
- `packages/figlets-adapter-claude/` for the Claude adapter

---

## Session Notes

### [2026-04-21]

- Created the new `figlets-mcp` repo
- Added the initial monorepo-style package layout
- Added architecture and migration docs
- Added a minimal MCP server skeleton with the first tool stub: `detect_design_system`
- Added `DECISIONS.md` and repo-local project memory from day one
- Turned `detect_design_system` into a structured summary path that can normalize a pre-fetched snapshot before live Figma integration lands
- Ported the first reusable DS analysis logic into `figlets-core` over a Figma-like data contract: alias resolution, collection classification, grouping, and context indexing
- Added the first server-side bridge seam: inline data, file-backed JSON payloads, and env-configured file loading for fetch-then-analyze workflows
- Expanded the bridge seam with a command-based source so an external exporter can feed real data into the same MCP path
- Added the first real exporter path: a Figma REST CLI that can turn a file URL or key into the JSON contract used by `detect_design_system`
- Added a local-only config layer with `.env`, `.env.example`, and `.local/` support so private testing can stay on the user's machine
- Verified the server entrypoint runs directly from source with Node

### [2026-04-22]

- Evaluated native Figma MCP capabilities vs the current architecture. Decided to keep the local bridge because it: (1) eliminates token-heavy round-trips, (2) works without Enterprise plan, (3) provides a deterministic, offline-capable snapshot.
- Scaffolded `packages/figma-bridge-plugin`: a Figma plugin that extracts Variables, Collections, Styles, and Component schemas from an open Figma file.
- Created `src/receiver.js`: a Node HTTP server on port `1337` that receives JSON payloads from the plugin and writes them to `.local/figma-data.json`.
- `.local/` is in `.gitignore` to prevent proprietary design system data from being committed.
- Upgraded `tests/run-tests.js` to support async tests.
- Added unit tests: `tests/bridge/receiver.test.js` and `tests/core/inspect-component.test.js`.
- Added `inspect_component` MCP tool and CLI wrapper.
- Added `sync_figma_data` MCP tool.

### [2026-04-22 — Agent-driven workflow]

- **Removed the Sync button** from the plugin UI. The plugin is now always-listening using long polling.
- Plugin polls `GET /poll`. When the agent calls `POST /request-sync`, the receiver wakes the plugin and tells it to extract the full design system. The receiver then holds the agent's request open until the payload is saved, at which point it returns `200 OK` to the agent.
- This makes `sync_figma_data` a blocking, end-to-end trigger: agent calls → Figma extracts → file is saved → agent proceeds.

### [2026-04-22 — Selection-based inspection]

- Added `extract-selection` command to the polling protocol alongside `extract-all`.
- The plugin can now serialize `figma.currentPage.selection` recursively into a structured payload including: `id`, `name`, `type`, `description`, `componentPropertyDefinitions`, `componentProperties`, `layoutMode`, `padding`, `itemSpacing`, and `children`.
- Added `POST /request-selection` and `POST /sync-selection` endpoints to `receiver.js`. Selection payloads are saved to `.local/figma-selection.json`.
- Updated `inspect_component` to take no arguments. It triggers a selection extraction, reads the saved JSON, and returns the clean structural analysis.
- Rewritten `figlets-core/src/inspect-component.js` to process the `selection[]` format rather than searching a global component list.
- Confirmed end-to-end: CLI prints exact layout and child structure of any selected Figma node.

---

## Milestone 1 — Complete (merged to main 2026-04-24)

All items from the initial `feature/figma-bridge-plugin` branch are shipped:

1. **[DONE]** Port shared design system detection logic into `figlets-core`.
2. **[DONE]** Bridge real Figma data via local plugin (variables, styles, components, selection).
3. **[DONE]** Upgrade `figlets-mcp-server` to official `@modelcontextprotocol/sdk` (stdio, Claude Desktop / Cursor compatible).
4. **[DONE]** Build `audit_tokens` tool: hardcoded values, missing aliases, naming inconsistencies.
5. **[DONE]** Make `figlets-mcp` globally installable as a CLI command for all agents.

---

## Session Notes

### [2026-04-23]

- Upgraded MCP server from hand-rolled JSON stdout to official `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`). Server now speaks full JSON-RPC 2.0 over stdio and is connectable from Claude Desktop, Cursor, Windsurf, etc.
- Added `audit_tokens` MCP tool: surfaces unaliased values, duplicate tokens, and naming inconsistencies from a design system snapshot.
- Made `figlets-mcp` installable as a global command (`npm install -g`) so any agent can invoke it via `figlets-mcp` in their MCP config.

---

## Near-Term Next Steps (Milestone 2)

1. **[DONE]** Merged `figlets-adapter-claude` and `figlets-adapter-codex` into a single `figlets-adapter` package.
2. **[DONE]** End-to-end test with real Figma file: sync confirmed (272 variables, 4 collections, 15 text styles, 6 effect styles). `detect_design_system` now saves full DS context to `.local/figma-ds-context.json` and returns compact summary only.
3. **[DONE]** `build_ds_showcase` tool — all rendering inside Figma plugin, no agent reasoning needed. Variable bindings, icon pairing, outline rendering, and luminance-based fallbacks all verified across multiple real DS files.
4. **[QUEUED]** Decide on `figma-selection.json` vs `figma-data.json` merge strategy (namespaced single file vs separate files).
5. **[QUEUED]** Expand test coverage — especially integration tests that run bridge + core end-to-end.
6. **[QUEUED]** Add `generate_component_doc` tool (fourth migration target from initial list).
7. **[DONE]** Ported `fig-setup` as two MCP tools: `prepare_ds_config` (computation pipeline) + `apply_ds_setup` (bridge plugin builds all 5 collections).

---

### [2026-04-24 — build_ds_showcase]

- Added `build_ds_showcase` MCP tool: all rendering lives inside `code.js` in the Figma plugin. The agent just calls the tool; no analysis, no decisions — it renders what it detects.
- Architecture: `/request-showcase` → plugin runs `_buildShowcase()` → `/sync-showcase` → MCP tool receives sections list.
- `_buildShowcase()` in `code.js` contains: detect-ds-structure analysis, showcase-shared helpers, colors section (primitives + semantic pairs with WCAG), typography table, spacing/radius/border scale, elevation table, scrims table, finale scroll-into-view.
- Receiver updated: added `/request-showcase` and `/sync-showcase` endpoints (same long-poll pattern).
- Plugin UI updated: handles `build-showcase` command from poll, routes `showcase-built` response to `/sync-showcase`.
- Adapter docs updated: `CLAUDE.md` and `AGENTS.md` both document the new tool and workflow.
- 16/16 tests passing.

---

### [2026-04-25 — apply_ds_setup]

- Ported the `fig-setup` computation scripts to `packages/figlets-core/src/ds-config/` as pure Node.js modules (no file I/O):
  - `compute-ds-config.js` — spacing, radius, border, typography scale from presets
  - `generate-color-ramps.js` — brand ramps + utility ramps with WCAG/APCA analysis
  - `validate-semantic-pairs.js` — bg+text pair contrast validation, icon token validation
  - `generate-primitives-data.js` — Collection 1 payload (colors, floats, strings, scrims)
  - `index.js` — exports all modules + `readDsConfig`, `writeDsConfig`, `runDsPipeline`
- Added `prepare_ds_config` MCP tool: runs the full pipeline on a `design-system.config.js`, returns structured preview data (ramps table, semantic pairs table, failCount, readyToBuild flag)
- Added `apply_ds_setup` MCP tool: sends the full DS config to the bridge plugin via `/request-ds-setup`, plugin creates all 5 collections (Primitives, Color, Spacing, Typography, Elevation + Effect Styles)
- Extended bridge plugin `code.js` with `_applyDsSetup(DS)` function: creates variable collections, modes, color ramp vars, scrim vars, shadow floats, type primitives, semantic aliases, responsive typography, semantic spacing, elevation vars + Effect Styles
- Extended receiver with `/request-ds-setup` (POST, 3-min timeout) and `/sync-ds-setup` endpoints
- Updated `ui.html` to handle `apply-ds-setup` poll command and `ds-setup-done` result message
- Updated `CLAUDE.md` and `AGENTS.md` with new tools, DS setup workflow, error handling, and rules
- 17/17 tests passing

---

### [2026-04-25 — build_ds_showcase debug + typography fix]

- **Root cause of empty showcase**: `figma.loadFontAsync({ family: 'Inter', style: 'SemiBold' })` throws because Figma's Inter font uses `'Semi Bold'` (with space). The rejection is a non-Error string, so `err.message` is `undefined`. `JSON.stringify({ error: undefined })` silently drops the field, producing `{}`, which the MCP handler misread as a successful result with 0 sections.
- **Font fix**: replaced brittle single-try with a candidate loop: `['SemiBold', 'Semi Bold', 'Semibold', 'Demi Bold', 'DemiBold', 'Bold']`. First one that loads wins. Bulk font load now uses `.catch(() => {})` per font so a single missing variant can never crash the entire showcase.
- **Error fix**: catch handler now uses `err instanceof Error ? err.message : String(err)` to guarantee a visible error even when a non-Error value is thrown.
- **Typography from variables**: showcase Typography section now renders for DSes that store type scale as float variables (`type/{role}/{size}/{property}`) instead of text styles. Detection scans `_floatColls` for vars matching `type/display|headline|title|body|label/...`, groups by role+size, resolves size/line-height/weight values, and renders variable-bound sample text. The `sortedStyles` path (text style–based) and the var path both feed the same table.
- **Typography setup issue**: this DS had 0 text styles (`textStyles.length = 0`). Cause unknown — likely a setup step was skipped or styles were deleted. Not a showcase bug; the variable-based path now covers it.

---

### [2026-04-27 — semantic variable binding overhaul]

**Problem:** The showcase was binding variables by first-match name patterns (regex substring matching). This caused wrong bindings — e.g. `color/surface/brand` used where neutral text was needed, because a pattern matched it first. Hardcoded `_C.xxx` fallback colors never adapted to the DS.

**What was done:**

1. **Replaced regex pattern matching with segment-weighted scoring (`_SEG` dictionary)**
   - Every `/`-separated path segment is scored against semantic roles independently
   - `fg/primary` scores positively for `onSurface` via the `fg` segment — found without contrast fallback
   - Negative scores disqualify contradicting variables entirely

2. **Functional scoring is now the true last resort**
   - Only runs if no variable scores above zero (DS with purely non-semantic naming)
   - Status tokens (`nameOnly=true`) return null rather than guessing when no segment match exists

3. **Added `_RC` resolved-color map**
   - `_resolvedOrFallback(v, hardcode)` resolves each `_V` entry's first-mode RGB value
   - All `_paint(_C.xxx, _V.xxx)` calls replaced with `_paint(_RC.xxx, _V.xxx)`
   - Even the static fallback color now comes from the DS rather than a fixed constant

4. **Added unit tests** — `tests/core/semantic-var-picker.test.js` — 13 scenarios covering: standard naming, unconventional naming (fg/primary), negative scoring, segment score tiebreaking, status role disambiguation, functional fallback, and empty DS handling.

### [2026-04-27 — two-layer category scoring]

**Problem:** The flat `_SEG` dictionary mapped segments directly to role scores. This required manually enumerating every qualifier combination (e.g. `brand-variant → onBrandVariant: 2`). A DS using `fg/brand-variant` or `text/brand-variant` would still fail.

**What was done:**

1. **Replaced flat `_SEG` with two-layer system**
   - `_SEG`: segment → semantic categories (always non-negative): `BG`, `FG`, `BRAND`, `BVAR`, `VARIANT`, `OUTLINE`, `SUCCESS`, `WARNING`, `DEFAULT`, `STRONG`
   - `_ROLE`: role → category weights (positive = reward, negative = penalty)
   - Final score = dot product of path's accumulated categories with role's weight vector
   - `_segScore` accumulates all segments into a category map first, then multiplies

2. **Why this is systematic**
   - `on-surface/brand-variant` scores 18 for `onBrandVariant` (FG×3 + BRAND×3 + BVAR×2)
   - `on-surface/default` scores 9 — loses without any manual disambiguation
   - `surface/brand-variant` scores −3 — excluded because BG×−4 dominates
   - ANY foreground qualifier beside a brand marker binds correctly regardless of exact wording
   - Adding new naming conventions requires only new `_SEG` entries, not new `_ROLE` logic

3. **Tests updated** — all 13 scenarios updated with new category-based score annotations

**18/18 tests passing.**

---

### [2026-04-29 — inspect_component selection debugging hardening]

- Investigated the open `inspect_component` regression where the bridge now responds quickly but returns `selection: []` from `figma.currentPage.selection`.
- Added plugin-side selection instrumentation in `packages/figma-bridge-plugin/code.js`:
  - caches both the current selection snapshot and the last non-empty snapshot in the main plugin thread
  - logs every `selectionchange`, `currentpagechange`, and `extract-selection` snapshot to the Figma plugin console with names, ids, types, page, and source
  - includes `meta.usedFallback`, counts, and cache age in the `/sync-selection` payload
- Added a guarded fallback for `extract-selection`: if the live selection is empty but the plugin has a recent non-empty snapshot from the same page, the bridge serializes that cached snapshot instead. This is meant to cover transient focus-related clears while keeping intentional cross-page stale selections out.
- Figma console debugging showed the selected node was present (`Button 1.0.0`, `COMPONENT_SET`) and the real failure was elsewhere: `serializeNode()` was reading `componentPropertyDefinitions` on variant child components, which throws in Figma with `Can only get component property definitions of a component set or non-variant component`.
- Fixed `serializeNode()` to read `componentPropertyDefinitions` only for `COMPONENT_SET` and standalone `COMPONENT` nodes, while still including `componentProperties` for `INSTANCE` / `COMPONENT` / `COMPONENT_SET`.
- Expanded the bridge plugin UI for live session visibility:
  - current selection panel under the main status, showing count, page, source, and selected node names
  - in-session chronological log panel under selection, showing command execution and bridge events only for the active plugin session
  - plugin main thread now replays session log history and current selection to the UI on `ui-ready`
- Updated `generate_component_doc` selection behavior:
  - server tool now resolves the current Figma selection first and uses the selected `COMPONENT` / `COMPONENT_SET` by default
  - plugin doc builder accepts `componentId` and prefers exact ID matching over page-level name search
  - this prevents stale/manual `component_name` input from documenting the wrong component when a different one is selected
- Tightened the agent-authored content contract for `generate_component_doc`:
  - removed plugin-side placeholder fallbacks for description / Do / Don't
  - server tool now requires `description`, `usage_do`, and `usage_dont`
  - doc generation now fails loudly when the human-authored sections are missing, instead of silently producing weak generic guidance
- Refined spec-sheet rendering behavior:
  - removed the redundant Preview section; variants are now the primary visual reference
  - spec-sheet chrome now attempts to bind its own colors, text styles, and spacing/radius values to the host DS when matching tokens/styles exist
  - sections with no meaningful data are omitted from both the Figma sheet and markdown output
  - anatomy is now skipped when the default variant has no meaningful internal non-instance parts (e.g. primitive/reference components like `Spacing Visual`)
- Added plugin session identification and bridge propagation:
  - plugin UI now shows a visible session ID (`figlets-...`) under the main status
  - `ui.html` sends the session ID on `/poll` and all `/sync*` posts
  - `receiver.js` tracks the active polling session, logs it, and includes `activeSessionId` in 503 not-connected responses
  - this made it possible to verify a real reconnect end-to-end: receiver saw `figlets-mok7r7lf-gzrll`, after which `generate_component_doc` succeeded again
- Receiver restart behavior confirmed: after restarting `src/receiver.js`, the Figma plugin must reopen or otherwise reconnect its long-poll loop before bridge-backed tools succeed again. A visible plugin window alone is not sufficient if the receiver has been replaced underneath it.
- `node --check packages/figma-bridge-plugin/code.js` passes.
- Full `node tests/run-tests.js` could not complete in the Codex sandbox because the bridge receiver tests hit `listen EPERM: operation not permitted 0.0.0.0`; this needs either an adjusted test bind address or an unrestricted run.

---

### [2026-04-27 — showcase token label and pairing observability]

**Problem:** Semantic color swatches showed only the leaf segment of the variable path (e.g. `brand`) with no context about what role it plays or what it pairs with. Typography section showed both text-style rows and variable-based rows simultaneously, causing duplicates.

**What was done:**

1. **`_tokenLabel(name)` helper** — returns the last 2 path segments (e.g. `color/surface/brand` → `surface/brand`, `color/on-surface/brand-variant` → `on-surface/brand-variant`). Used as the tag label in all semantic color rows.

2. **Swatch preview text** stays as the leaf only — the 80×56 color box still shows the short name to avoid overflow. The 2-segment label appears in the pill/tag below.

3. **Pairing descriptions added at call sites** — after `fgPairName` is resolved, `rowDesc` includes "Paired with on-surface/brand." appended to the existing description. Icon rows get "Shown on surface/inverse." The `_buildSemColorRow` function accepts `opts.previewText` to decouple the swatch preview from the tag label.

4. **Typography duplication fixed** — var-based rows (`_typoVarGroups`) now only render when `_sortedStyles.length === 0`. Text styles are always preferred; variable-based compilation is the fallback for DSes that define type scale purely via variables.

5. **Font family binding in var rows** — `_buildTypoVarRow` now resolves an effective family variable (`familyVar` per-token, or `_sharedFamilyVar` found by searching for the first STRING variable containing "family" in any float collection). The resolved string is used for `fontName.family` before binding, and all referenced family fonts are pre-loaded via `figma.loadFontAsync` before rows are built.

**18/18 tests passing.**

---

### [2026-04-27 — variable purpose lock]

**Problem:** The segment scoring system assigned positive scores to wrong-purpose variables when the status keyword dominated. `color/icon/warning` (FG+WARNING) scored positively for `warningBorder` because WARNING outweighed the FG penalty. Result: badge borders bound to icon tokens instead of outline tokens, or fell back to surface/text colors.

**What was done:**

1. **Refactored `_segScore` into `_pathCats` + dot-product** — `_pathCats(name)` returns the accumulated category map for a path; `_segScore` calls it then dot-products with the role weight vector. This makes the category map available for constraint checking without recomputing it.

2. **Added `requiredCats` parameter to `_semPick`** — a hard category filter applied before score comparison. A candidate variable must contribute > 0 to every listed category or it is skipped entirely.

3. **`requiredCats` also blocks the functional fallback** — `if (nameOnly || requiredCats) return null` prevents cross-purpose guessing. If no purpose-correct variable exists, the slot is null.

4. **Applied consistently across all purpose-constrained roles:**
   - Outline roles (`outlineSubtle`, `outlineBrand`, `successBorder`, `warningBorder`) → `['OUTLINE']`
   - Status fill roles (`successBg`, `warningBg`) → `['BG']`
   - Status text roles (`successText`, `warningText`) → `['FG']`

5. **`_buildBadge` null-guards the border stroke** — when `bdV` is null, `badge.strokes = []` rather than binding a fallback color.

6. **Added test scenarios 15 and 16** covering BG and FG purpose locks respectively. Scenario 14 (OUTLINE lock) was already present.

**This is also a QA contract:** variable path purpose is expected of designers. Future QA tools will enforce the same rule.

**20/20 test scenarios passing (18 test files).**

---

### [2026-04-28 — bridge + core integration tests]

- Added `tests/integration/sync-detect-flow.test.js` — full E2E for `sync_figma_data` → `detect_design_system`. Starts the real receiver on a random port, simulates the plugin via raw HTTP (poll → respond to `extract-all` → POST `/sync` with fixture), runs both real MCP handlers, asserts file write and DS summary shape.
- Added `tests/integration/inspect-component-flow.test.js` — same pattern for `inspect_component` (poll → `extract-selection` → POST `/sync-selection`).
- Standardised receiver URLs across all tools: `inspect-component.js` was the last hold-out hardcoding `localhost:1337`. All tools now read `FIGLETS_RECEIVER_URL` (defaults to `http://localhost:1337`).
- 20/20 tests passing. New bridge-backed tools should ship with a matching integration test.

---

### [2026-04-28 — porting plan: `/fig-document` next, then `/fig-qa` auto-fix, then decompose `/fig-create`]

**State of the migration from the sibling `figlets` repo:**

| figlets skill | figlets-mcp tool | Status |
|---|---|---|
| `/fig-setup` | `prepare_ds_config` + `apply_ds_setup` | Done |
| `/fig-ds-showcase` | `build_ds_showcase` | Done |
| `/fig-qa` | `audit_tokens` | Detection only (no auto-fix) |
| `/fig-document` | — | Not ported |
| `/fig-create` | — | Not ported |

**Decided sequence:**

1. **`generate_component_doc`** (port `/fig-document`) — chosen first. Architecture mirrors `build_ds_showcase`: plugin renders the spec sheet inside Figma + writes a `[SPEC]` block to the component description, agent calls one MCP tool, tool returns markdown for the agent to write via the Write tool. 4 scripts to port: `find-component.js`, `doc-runner.js`, `write-spec.js`, `update-description.js`. New endpoints: `/request-doc-build` + `/sync-doc-build`.
2. **`fix_token_violations`** (extend `audit_tokens`) — port `fix-all.js` + `fix-violation.js`. Closes the audit loop. New endpoints: `/request-fix-violations` + `/sync-fix-violations`.
3. **Adapter scaffold** before tackling `/fig-create`.
4. **Decompose `/fig-create`** into `audit_token_gaps`, `plan_component_from_frame`, `build_component`, `post_build_audit` — orchestration lives in the adapter. Not one giant tool.

See DECISIONS.md `[2026-04-28]` entry for full rationale.

---

### [2026-04-28 — `generate_component_doc` ported]

Step 1 of the porting plan landed. `/fig-document` is now an MCP tool.

- **Bridge protocol:** New endpoints `/request-doc-build` (POST, agent → receiver) and `/sync-doc-build` (POST, plugin → receiver). New plugin command `build-doc`. UI handles `build-doc` poll command and `doc-built` result.
- **Plugin (`code.js`):** New `_buildComponentDoc(opts)` async function (~700 lines, appended at end of file). Self-contained — no shared helpers. Renders the spec sheet inside a "Documentation" section (Sections A–H mirroring the original `doc-runner.js`), updates the component description with a `[SPEC]` block, and returns the full markdown body for `component-specs/[Name].md`. ES6-compatible (no `??`, `?.`, `**` — sandbox restriction).
- **MCP tool (`generate_component_doc`):** Inputs are `component_name` (required), `usage_do`, `usage_dont`, `variant_descriptions` (all optional with sensible defaults). Tool returns the markdown body so the agent writes the file via the Write tool — keeping file I/O on the agent side, rendering on the plugin side.
- **DS-adaptive palette:** The spec sheet's chrome (paper, surface, ink, badge colors) resolves from the host DS variables when matching tokens exist (`paper`, `surface`, `ink/black`, `error`, etc.). Falls back to fixed RGB only if nothing matches — same approach as the showcase.
- **Tests:** Unit (`generate-component-doc-tool.test.js`) covers tool metadata, error path for missing input, success payload, plugin error propagation, 503, and ECONNREFUSED. Integration (`generate-component-doc-flow.test.js`) runs the real receiver, simulates the plugin's poll → `build-doc` → `sync-doc-build` round-trip, and asserts the payload routed correctly in both directions.
- **Adapter docs:** `CLAUDE.md` and `AGENTS.md` both updated with the new tool row, "Document a component" workflow, and two error-handling rows.

**22/22 tests passing.** Migration is now: `prepare_ds_config` + `apply_ds_setup` + `build_ds_showcase` + `generate_component_doc` shipped — three of the five original skills fully ported. Next per the plan: `fix_token_violations` (extend `audit_tokens` to close the QA loop).

---

### [2026-04-30 — semantic brand/accent split and inset visuals]

Follow-up from showcase QA:

- Found why spacing visuals bound to `color/surface/accent` instead of `color/surface/brand`: the semantic scorer treated `accent` as `BRAND`, so `surface/accent` and `surface/brand` tied and saturation/luminance broke the tie.
- Changed both bridge-side semantic maps so `accent` contributes `ACCENT`, while `brand`/`primary` contribute `BRAND`.
- With the new scoring, `color/surface/brand` scores higher than `color/surface/accent` for `surfaceBrand`.
- Found that the old showcase had an `inset` visual builder but no routing into it. Added `inset` group classification and a dedicated inset visual to the port.
- `node --check packages/figma-bridge-plugin/code.js` passes.

Next live test after reloading the Figma bridge plugin: rebuild showcase and verify spacing visual fills bind to `color/surface/brand`, and `space/inset/*` rows render as inset boxes instead of generic spacing squares.

---

### [2026-04-30 — showcase QA binding pass]

`build_ds_showcase` now applies a final DS binding pass to all generated `Token Showcase` sections:

- Binds generated padding/gaps to exact matching spacing variables.
- Binds generated radii to exact matching radius variables.
- Binds generated stroke widths to exact matching border/stroke variables.
- Applies the closest local text style to generated text nodes, with fallback typography-variable binding where no style exists.
- Normalized arbitrary showcase chrome values (`5`, `6`, `10`, `16.5`) to nearby existing DS token values so QA does not correctly flag them as private raw values.
- Figma clears `textStyleId` when font overrides are restored after applying a style, so generated showcase text must actually use DS text-style metrics to count as style-bound.
- Live proof pass on the current Spacing showcase reached `1285/1285` checked properties bound, `0` raw gaps, using a smart audit that treats side-specific radius/stroke bindings as covering shorthand properties.

Verification:
- `node --check packages/figma-bridge-plugin/code.js` passes.
- `npm test` reported all 22 test files passing and exited successfully.

Live validation note: Figma must reload the bridge plugin before a real `build_ds_showcase` call will execute this new code.

---

### [2026-05-04 — update_ds_primitives now refreshes Color semantic aliases]

**Problem:** `update_ds_primitives` updated primitive values (e.g. swapped `color/neutral-variant/*` to its real low-chroma ramp) but did not touch existing Color collection aliases. So `color/surface/variant` Light/Dark stayed aliased to whatever primitive they were originally created against (the old neutral / sage), and the swatch in the showcase did not change even after the underlying primitives did.

**Fix landed in this session:**

- Added a `color-semantics` category to `UPDATE_PRIMITIVE_SPECS` in `packages/figma-bridge-plugin/code.js`. The category does not yield primitive rows; instead the plugin walks `DS.color.semantics` (`pairs`, `icons`, `unpaired`), finds matching variables in the Color collection, and re-points Light/Dark mode values to the primitive variables named in the config. Variable IDs are preserved, so existing component bindings keep resolving.
- `create_missing: true` now also creates missing Color semantic variables alongside missing primitives. Default (`false`) reports them as `unmatched` rather than mutating the collection.
- The existing 503 path was upgraded with `pluginRecentlySeen` / `lastPluginSeenAt` hints so callers can tell "plugin disconnected" from "plugin connected but mid-command".
- `update_ds_primitives` MCP tool, schema, and description updated to mention `"color-semantics"` and semantic alias refresh.
- Tests added: `tests/bridge/qa-binding-audit-policy.test.js` enforces that the plugin keeps the new alias-update path; `tests/server/update-ds-primitives-tool.test.js` checks the description mentions semantic aliases; `tests/bridge/receiver-lifecycle.test.js` covers the recently-seen 503 hint and `/health` capability reporting around an in-flight request.

**Live verification (Green Apple file):**

- `update_ds_primitives` with `categories=["color-semantics"]`, `create_missing: false`: report was `entries: 41, updated: 5, unchanged: 33, unmatched: 3` (`color/surface/{success,warning,info}-variant` — those Color variables do not exist in the live collection yet, and `create_missing` was off).
- `build_ds_showcase` after the alias refresh returned `bindingWarnings: []` and rendered all 5 sections on `00 · Tokens`.
- Full test runner: `33/33 passed` against Node 24.

**Follow-up — primitive nearest-step fallback (same session):**

Added `_resolveSemanticTarget(byName, targetName)` to the plugin's color-semantics path. When a templated primitive target (e.g. `color/green/950`) does not exist in the live Primitives collection, the helper walks the same ramp prefix and binds to the nearest existing numeric step (e.g. `color/green/900`). Each substitution is reported as `{ token, mode, requested, used }` in `report['color-semantics'].substituted`, and the human-readable message now includes `N substituted` when present. This means a stale primitive scale never blocks the alias refresh; the agent decides whether to surface the gap to the designer (e.g. "your `green` ramp is missing step `950` — add it to your config and re-run setup") without halting the live update. Variable IDs are still preserved in the substitution path, so existing component bindings keep resolving.

Policy assertion in `tests/bridge/qa-binding-audit-policy.test.js` now requires the helper, the `substituted: true` return shape, and the report field to all stay present.

**Resolved same session:** the designer chose to create the missing variant aliases. Re-ran with `create_missing: true` → `created: 3, updated: 3, unchanged: 38, unmatched: [], substituted: []`. Targets were standard `*/100` and `*/900` steps that already exist in the Primitives collection, so the new nearest-step fallback was not exercised on this run; it stays in place for future cases where ramp scale and config templates diverge. Final showcase rebuild returned `bindingWarnings: []`. The agent-side prompt for "create vs leave" is the recommended UX whenever `unmatched` lists Color semantic variables.

---

### [2026-05-04 — APCA contrast option — SHIPPED ✓]

**Shipped in two commits. Both phases complete. 33/33 tests passing.**

**What shipped:**

- **Phase 1 commit** `feat(ds-config): APCA contrast option with default to APCA`:
  - `DS.color.contrastAlgorithm` — `'apca'` (default) or `'wcag'`. Configs without the field upgrade transparently to APCA.
  - `gatePass()` — computes `wcagPass`, `apcaPass`, and gated `pass` from the chosen algorithm. `failCount` and `suggestStep` follow `pass`.
  - `suggestStepFor(textRampRef, bgRgb, scorer, threshold)` — algorithm-agnostic ramp walker. WCAG shim preserved.
  - Signed Lc stored on every row; `Math.abs` applied only at render time.
  - `minLc` added to pair templates: 75 (surface/text), 60 (icons), null (decorative/exempt).
  - Markdown table now shows `Light APCA` and `Dark APCA` columns alongside WCAG.
  - Adapter docs updated: contrast standard intake question with pros/cons, algorithm switch as `update_ds_primitives` re-run trigger, stale WCAG-only strings updated.

- **Phase 2 commit** `feat(showcase): show APCA Lc and badge columns before WCAG`:
  - `_apcaLum` + `_apcaLc` ported into `code.js` using the full APCA 0.0.98G implementation (soft clamp BC=0.022/BE=1.414, polarity-aware rounding) — byte-identical to the validator.
  - `_buildApcaBadge(lc)` reuses `_buildBadge` palette; Lc ≥ 75 → AA, ≥ 60 → "Lc 60", < 60 → Fail.
  - Two new cells in `_buildSemColorRow` before WCAG cells: `apcaLcCell` ("Lc NN", 128px) and `apcaBadgeCell` (128px). Row order: token · swatch · **APCA Lc** · **APCA badge** · WCAG ratio · WCAG badge.
  - Policy assertions in `tests/bridge/qa-binding-audit-policy.test.js` guard all new helpers and cells, including the soft-clamp constants.

- **Post-ship fix** (same session): APCA math bug corrected — initial port omitted the BC/BE soft clamp and polarity-aware rounding, causing Lc values to diverge from the validator for near-black colors. Fixed by porting the full formula. `node --check` + 33/33 + e2e formula comparison confirm alignment.

**E2E verification (live Green Apple config, no Figma required):**
- APCA mode: 11 pairs fail Lc gate → confirms APCA is active and exposing real perceptual contrast gaps that WCAG missed.
- WCAG mode: 0 failures → config was tuned to WCAG; algorithm switch produces different `failCount` as expected.
- Both `Light APCA` and `Dark APCA` columns appear in `semanticPairsTable` under both modes.
- Plugin `_apcaLc` formula verified byte-identical to validator for black/white, polarity, yellow, brand blue, near-zero cases.

**Live config note:** the Green Apple `.local/design-system.config.js` does not have `DS.color.contrastAlgorithm` set, so it defaults to `'apca'`. The designer will see 11 failing pairs when they next run `prepare_ds_config`. They should fix these or acknowledge them before running `apply_ds_setup` (or `update_ds_primitives`). Adding `DS.color.contrastAlgorithm = 'wcag'` restores the previous behavior with 0 failures.

**Open deferred items (Phase 3):**
1. Use-case tier labels ("Body ≥ 14px") for per-font-size APCA gating — data layer has `minLc`; presentation label deferred.
2. Section width budget: the colors section is now 256px wider. Visual overflow check needed on a live build.

**Designer action required:** next `prepare_ds_config` run will surface 11 APCA failures. The adapter will say "switching to APCA flagged 11 pairs that passed WCAG" and suggest nearest passing steps.

---

### [2026-05-03 — showcase color ordering polish]

After the neutral-variant primitive work, the live showcase was updated to sort color rows in a designer-facing order:

- Primitive color ramps: likely brand ramps first, then `neutral`, then `neutral-variant`, then utility/status ramps (`red`, `green`, `yellow`, `blue/info`, etc.).
- Semantic color groups: surfaces/backgrounds first, followed by text, outlines, icons, and then lower-priority status/info/warning/error/disabled rows.
- The ordering lives only in `packages/figma-bridge-plugin/code.js` showcase rendering helpers. It does not alter variable generation, values, IDs, aliases, or binding policy.
- Live showcase rebuild after one plugin reload returned `bindingWarnings: []`.
- Full tests passed with the bundled modern Node runtime: `32/32`. Plain `npm test` in this shell resolved to `/usr/local/bin/node v10.1.0`, which is too old for existing tests (`matchAll`, `flatMap`, and newer HTTP listener behavior).

---

### [2026-04-30 — shared semantic DS binding resolver started]

Preparing for `/fig-qa` auto-fix, added a shared bridge-side resolver in `packages/figma-bridge-plugin/code.js`:

- `_createDsBindingContext()` detects variables, collections, text styles, effect styles, collection roles, aliases, semantic color roles, float values, and text-style matches in one live Figma pass.
- Color binding is semantic-first, based on the existing segment/category scoring model from the showcase. Hex matching is intentionally not used for automatic color role binding.
- Purpose locks remain the rule for role-specific slots: border/outline tokens must have outline semantics, status fills must have surface/bg semantics, and text/icon slots must have foreground semantics.
- `generate_component_doc` now consumes this resolver for spec-sheet chrome colors, spacing/radius/border variables, and text-style roles. Its output contract is unchanged; only the binding path changed.
- `node --check packages/figma-bridge-plugin/code.js` passes.
- `npm test` reports 22/22 test files passing. The runner can take a while to release after the summary because of bridge-server handles, but exited successfully.

Next step: port QA audit/fix commands on top of `_createDsBindingContext()` instead of bringing over old hex-based `bind-colors.js` as-is.

---

---

### [2026-04-29 — generate_component_doc iteration + plugin robustness]

**Live-tested against real DS file. Three bugs fixed, one missing feature added, spec sheet structure overhauled.**

#### generate_component_doc fixes
- **Library variable resolution:** added async pre-fetch loop using `figma.variables.getVariableByIdAsync` for any varId not in the local map. Resolves remote/library variables that `getLocalVariablesAsync` doesn't return. Eliminates raw `VariableID:xx:yy` in spec sheets.
- **SIZING table:** rewrote using proven `_mkTable/_mkRow/_mkCell` helpers (same as Properties table). Custom `_sizeRow` helper removed — it produced 0px-tall text rows due to subtleties in auto-layout sizing. The proven helpers don't have this problem.
- **Subtitle overflow:** added `layoutSizingHorizontal = 'FILL'` + `textAutoResize = 'HEIGHT'` on the subtitle text node so it word-wraps inside the doc frame instead of growing off-screen.
- **Placement:** new component → lands to the right of the rightmost existing `· Spec` sheet with a 100px gap. Rebuild of same component → reuses old (x, y) so viewport and instances stay stable.

#### New features
- **`description` arg:** `generate_component_doc` now accepts a `description` string. Plugin uses it as the subtitle (agent-supplied content first, then existing component description stripped of `[SPEC]` blocks, then a placeholder). Markdown also uses it.
- **Component description field:** agent-supplied description is now written to the top of the component's Figma description field, above the `[SPEC]` block. Designers see it in the Component Properties panel. Agents see the `[SPEC]` data. Rebuilds overwrite cleanly.
- **Spec sheet section labels:** PREVIEW and VARIANTS sections now have `_mkLabel` calls matching all other sections.
- **Container sizing:** Preview frame now has `counterAxisSizingMode = 'AUTO'` (hugs content height). Do/Don't row now has `layoutSizingHorizontal = 'FILL'`; panels fill width; rule text uses `FILL + HEIGHT` so it word-wraps instead of overflowing.

#### Pre-flight check added to adapter docs
Both `CLAUDE.md` and `AGENTS.md` now include a mandatory step 3 in "Document a component":
- **Layer names check:** flag Figma-default names (`Frame NNN`, `Group NNN`, etc.) in shallow children. These appear verbatim in the Anatomy section.
- **Component properties check:** flag a COMPONENT_SET with variants but no `componentPropertyDefinitions`. An empty properties table is useless for developers.
Agent asks "fix first or proceed?" and waits. If user fixes, re-inspect before generating.

#### Plugin robustness improvements (PINNED ISSUE)
Background: `inspect_component` was reliably failing with 503/504 when a new component was selected. Root causes:
1. `extract-selection` in `code.js` had no try/catch — a `serializeNode` error silently killed the poll loop
2. `ui.html` set `isExtracting = true` when dispatching a command, but if the plugin code crashed, `isExtracting` was never reset and polling died permanently
3. MCP tool had no retry on 503/504

Fixes shipped:
- `code.js`: `extract-selection` wrapped in try/catch; errors post back as `{ error, selection: [] }` instead of swallowed
- `ui.html`: watchdog timer arms on every command dispatch (12s inspect, 30s sync, 60s doc/setup, 120s showcase); disarmed on every successful response; fires → resets `isExtracting` and resumes polling
- `inspect-component.js`: retries up to 3× on 503/504 with 1.5s delay

**Remaining open issue (PINNED):** `figma.currentPage.selection` is consistently returning `[]` even when something is selected in Figma. The plugin connects and polls correctly, executes the command without error, but reports empty selection. Suspected cause: Figma plugin sandbox clears `currentPage.selection` in some contexts when the plugin UI is focused during polling. Not resolved. Next session should investigate whether this is a `loadAllPagesAsync` requirement, a Figma Desktop bug, or a timing issue with the poll cycle. The robustness fixes above are correct regardless.

---

## Open Questions

- Should the long-term public package name stay `figlets-mcp`, or become a scoped name under the `figlets` brand?
- Should `figma-selection.json` and `figma-data.json` be merged into one file with namespaced keys, or stay separate?
- Which adapter to build first — Claude or Codex?
- Why does `figma.currentPage.selection` return `[]` when something is selected? (Pinned — investigate next session)

---

### [2026-05-08 — DESIGN.md intake/export + neutral setup naming]

**Objective completed:** Added Google-style `DESIGN.md` support as a setup intake shortcut and portable export artifact.

**What changed:**

- `packages/figlets-core/src/ds-config/design-md-intake.js`
  - Parses DESIGN.md YAML front matter with no external dependency.
  - Maps project name, brand colors, typography roles, and spacing base into a starter Figlets `DS`.
  - Exports prepared Figlets configs back to DESIGN.md for agent/code-repo portability.
- `packages/figlets-mcp-server/src/tools/design-md-intake.js`
  - Adds `create_ds_config_from_design_md`, which writes a starter `design-system.config.js` from an existing DESIGN.md.
- `prepare_ds_config` and `apply_ds_setup`
  - Write `DESIGN.md` next to the active file-scoped config and return `designMdExport.path`.
  - This makes the export available after setup/prepare without another expensive Figma operation.
- `compute-ds-config`
  - Renamed legacy `needsClaude` to `needsDesignerInput`.
  - Imported custom DESIGN.md typography now counts as answered intake when the scale is present.
- Adapter docs
  - Setup starts by asking if the designer already has DESIGN.md.
  - DESIGN.md lint/diff are optional designer-approved follow-ups, not automatic gates.

**Tests and checks:**

- Added tests:
  - `tests/core/design-md-intake.test.js`
  - `tests/server/design-md-intake-tool.test.js`
  - `tests/server/apply-ds-setup-export.test.js`
  - updated `tests/server/prepare-ds-config-tool.test.js`
- Full suite passed: `40/40`.
- `git diff --check` clean.
- Commit: `46b48a0 Add DESIGN.md intake and export`.

---

### [2026-05-07 — contrast-harmonized OKLCh ramps + APCA swatch showcase]

**Objective completed:** Added an opt-in OKLCh `DS.color.rampStrategy = "contrast-harmonized"` and updated the Colors showcase to make primitive and semantic contrast behavior visible.

**What changed:**

- `packages/figlets-core/src/ds-config/generate-color-ramps.js`
  - Adds `rampStrategy: "contrast-harmonized"` alongside the existing default `"standard"`.
  - Requires `DS.color.algorithm = "oklch"`.
  - Treats brand colors as hue/chroma seeds rather than exact numbered anchors.
  - Places every ramp on a fixed OKLCh lightness ladder (`50` light → `950` dark), with chroma tapering toward the extremes.
  - Keeps monotonic lightness, avoiding the observed 400/500 inversion and muddy first-step jumps.

- `packages/figlets-core/src/ds-config/validate-semantic-pairs.js`
  - Adds contrast-harmonized semantic pair defaults so role-based generated pairs validate cleanly under APCA.
  - Soft backgrounds stay on `bg/*` / `surface/*`; strong fills stay on `fill/*` + `text/on-*`.

- `packages/figma-bridge-plugin/code.js`
  - Primitive ramp swatches now use a split tile:
    - top half: readable neutral text on the swatch
    - bottom half: swatch color as text on a readable neutral extreme
  - Both halves show `✓ Lc NN` or `✗ Lc NN` using Lc 75 as the body-text threshold.
  - Swatches flex across the row with a 56px minimum so the full 50-950 ramp fits the showcase width.
  - Semantic pair swatches now show the same APCA pass/fail label for the actual paired foreground/background. Text pairs use Lc 75; icon-like rows use Lc 60.

**Active live file:**

- Figma file: `Figlets DS`
- Active local config: `.local/local_movbxur3_6gow4h4j/design-system.config.js`
- Preview SVG: `.local/local_movbxur3_6gow4h4j/design-system.preview.svg`
- Active config includes `"rampStrategy": "contrast-harmonized"` and prepared cleanly:
  - `readyToBuild: true`
  - `failCount: 0`
  - `apcaFailCount: 0`

**Live verification:**

- User reloaded the Figlets Bridge plugin after `code.js` changed.
- Receiver connected to `file=local_movbxur3_6gow4h4j`.
- Ran `update_ds_primitives` with `categories: ["color", "color-semantics"]`, `create_missing: true`:
  - color: `67 updated`, `32 unchanged`, no unmatched/type mismatches
  - color-semantics: `1 updated`, `51 unchanged`, no unmatched/type mismatches
- Ran `build_ds_showcase`:
  - rendered `Colors`, `Typography`, `Spacing`, `Elevation`, `Scrims` on `00 · Tokens`
  - only expected raw chrome warnings remained (`radius 16`, `spacing 6`, `font size 9`, etc.)

**Tests and checks:**

- `node --check packages/figma-bridge-plugin/code.js` passed.
- Forbidden modern operators check for `??`, `?.`, `**` in plugin code found only existing comments/markdown strings.
- Full test suite passed with bundled modern Node: `37/37`.
- `git diff --check` clean.

**Follow-up completed on 2026-05-08:**

- WCAG parity for the new swatch treatment is implemented.
- Primitive and semantic swatch labels now branch on `DS.color.contrastAlgorithm`.
  - APCA mode keeps `✓ Lc NN` / `✗ Lc NN`.
  - WCAG mode uses compact status labels: `✓ AAA`, `✓ AA`, `~ Large`, `✓ 3:1`, `✗ Fail`.
- `build_ds_showcase` now forwards `DS.color.contrastAlgorithm` from the active file-scoped config to the bridge plugin; previously it only forwarded collections and semantic pairs, which would have made live WCAG showcase builds silently fall back to APCA labels.
- Live verification after reloading the Figlets Bridge plugin:
  - Sent a one-off WCAG showcase request for active file `local_movbxur3_6gow4h4j` without changing the saved APCA config.
  - Rendered `Colors`, `Typography`, `Spacing`, `Elevation`, `Scrims`.
  - Only existing numeric fallback warnings remained; no color/contrast-specific errors.
### [2026-05-14 — common-practice semantic setup refinements]

**Objective completed:** Adjusted setup/showcase behavior after comparing the live semantic showcase against common design-system practice: filled surfaces need on-color content roles, passive borders should be quieter than focus/validation borders, and surface previews should show real foreground relationships instead of hardcoded readable text.

**What changed:**

- `packages/figlets-core/src/ds-config/validate-semantic-pairs.js`
  - Role-based setup now adds explicit surface relationships:
    - `color/surface/default + color/text/default`
    - `color/surface/raised + color/text/default`
    - `color/surface/overlay + color/text/default`
    - `color/surface/sunken + color/text/default`
  - Passive status borders are generated by default close to their paired surface:
    - `color/border/brand`: `primary/700` light, `primary/300` dark
    - `color/border/brand-subtle`: `primary/200` light, `primary/800` dark
    - `color/border/danger`: `red/200` light, `red/800` dark
    - `color/border/success`: `green/200` light, `green/800` dark
    - `color/border/warning`: `yellow/200` light, `yellow/800` dark
    - `color/border/info`: `blue/200` light, `blue/800` dark
  - Existing live files keep their saved `semantics.unpaired` values until a designer approves an alias update. In the live test, the approved repair re-aliased the five passive border roles away from previous `500/500` values and then refreshed config from Figma.
  - `border/brand-subtle` exists because `border/brand` is intentionally stronger for the filled/strong brand surface. The showcase helper already prefers direct `border/brand-subtle` over the suffix-stripped fallback `border/brand`.
  - Role-based setup now adds on-fill icon roles when icon semantics are enabled:
    - `color/icon/on-brand`
    - `color/icon/on-danger`
    - `color/icon/on-success`
    - `color/icon/on-warning`
    - `color/icon/on-info`
  - Existing `DS.color.semantics.icons = []` is treated as a deliberate opt-out. In that case, setup re-runs do not generate icon semantics.
  - Existing `DS.color.semantics.unpaired` is preserved on setup re-run, including custom roles and manually adjusted values.

- `packages/figma-bridge-plugin/code.js`
  - `_inferSemPairExtras()` now prefers foreground-derived content icon roles on filled surfaces:
    - `color/fill/danger + color/text/on-danger` prefers `color/icon/on-danger` over `color/icon/danger`.
    - `color/fill/danger + color/on-fill/danger` can resolve `color/icon/on-fill/danger` for surface-based DSes.
  - The helper still never invents roles; it only returns variable names that exist in `varByName`.
  - Extra surface/bg/fill rows in the config-pairs branch now look for `color/text/default` or `color/on-surface/default`. If found, they render a paired foreground and accessibility badge. If not found, they remain unpaired.
  - Semantic preview swatches now use `strokeWeight = 1` and bind that through the border variable picker.

**Tests added/updated:**

- `tests/core/ds-config.test.js`
  - Pins generated on-fill icon roles.
  - Pins passive status border defaults.
  - Pins surface/default-foreground relationships.
  - Pins icon opt-out preservation and unpaired-role preservation on re-run.
- `tests/bridge/semantic-pair-extras-inference.test.js`
  - Pins `icon/on-*` preference for filled role-based rows.
  - Pins `icon/on-fill/*` resolution for surface-based naming.
- `tests/bridge/semantic-color-row-render-shape.test.js`
  - Pins 1px semantic preview stroke and numeric border binding.
- `tests/bridge/qa-binding-audit-policy.test.js`
  - Updated the source guard so extra surface rows are expected to show default-foreground badges when available.
- `tests/server/inspect-ds-setup-gaps-qa.test.js` and `tests/server/check-setup-gaps-cli.test.js`
  - Pin the new high-confidence foundation-role finding for missing focus border tokens when a DS already uses border semantics.

**Designer-facing contract:**

- Setup remains deterministic and code-backed, but agent presentation should still add judgement:
  - `icon/<status>` means status icon on a normal/default surface.
  - `icon/on-<status>` means icon content on a filled status surface.
  - passive `border/<status>` should be quieter than focus/strong/error emphasis borders.
  - surfaces should be evaluated with the default foreground when that is the DS convention.
- If a designer does not want icon semantics, the setup can preserve `semantics.icons: []`; the showcase should not synthesize icon rows from nowhere.
- Active/focus borders are deliberately not shown as passive companions on every semantic row. `border/focus` is a foundational interaction token: QA should flag it when missing, and agents should ask the designer before creating or styling it.

### [2026-05-19 — Phase 3C: spacing-semantics apply slice]

**Objective completed:** Expanded the Phase 3C narrow approved token-apply path from `radius`/`border-width` to also include `spacing-semantics`, without weakening color/setup/primitives behavior or broadening into arbitrary mutation.

**What changed:**

- `packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js` and `packages/figlets-mcp-server/src/tools/update-ds-tokens.js`
  - `APPLY_CATEGORIES` now `["radius", "border-width", "spacing-semantics"]`.
  - Tool description, schema text, apply-rejection error, missing-capability reason, and `nextStep` wording updated to say "radius, border-width, and semantic spacing".
- `packages/figma-bridge-plugin/code.js` `_updateDsTokens`
  - `supported` map adds `'spacing-semantics': true`.
  - Added `_sanitizeSpaceStep`, `_tokenValueEq`, and (inside `_updateDsTokens`) `_resolveSpaceValue` / `_desiredForMode`.
  - Semantic spacing entries are responsive: `{ name: 'space/<key>', type: 'FLOAT', values: [...] }`.
  - Primitive spacing collection is read read-only to alias `space/<sanitized-step>` → `VARIABLE_ALIAS` when the primitive variable exists; otherwise a raw FLOAT is written (mirrors `apply_ds_setup` `spaceAlias` fallback).
  - The updater maps responsive values onto **existing** Spacing-collection modes only — breakpoint-name match (case-insensitive), then positional index, then last value. It deliberately does **not** call `addMode` (no mode creation in the narrow updater).
  - Create / change-detection / write loops now iterate `modeOrder` and compare via `_tokenValueEq` so alias objects diff correctly. `modeIds` was removed.

**Designer-facing / product contract:**

- Semantic spacing on a single-mode Spacing collection collapses to the last responsive value, consistent with the existing radius/border mode-invariant behavior. Creating breakpoint modes stays future product scope (fold into the deferred guided partial-setup-repair path). This is a documented limitation, not a dead end — see `docs/bulk-repair-api-implementation-plan.md` Phase 3C deferred-concern note.
- Typography, elevation, primitive-*, styles, colors, and prune/delete remain dry-run/product-gap scope and must still surface as `missingCapabilityNotes`.

**Tests added/updated:**

- `tests/server/inspect-ds-token-gaps-tool.test.js` — `applyInput.categories` now includes `spacing-semantics`; explicit assertions that `typography`/`elevation` stay `unsupported-apply-category` product gaps and `spacing-semantics` does not.
- `tests/server/update-ds-tokens-tool.test.js` — `supportedApplyCategories` includes `spacing-semantics`; updated description/error wording; added a positive mocked-bridge apply test for `spacing-semantics`.
- `tests/bridge/update-tokens-apply-policy.test.js` — pins the three supported keys, forbids `typography`/`elevation` keys, requires `VARIABLE_ALIAS`, forbids `addMode(`, and keeps the no-text/effect-style guards.
- `tests/integration/token-gap-planner-flow.test.js` — E2E proxy now drives `spacing-semantics` through inspect → dry-run → approved mocked apply → re-inspect, with typography still visible as unsupported apply scope.

**Verification:**

- `/Users/arash/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /usr/local/bin/npm --scripts-prepend-node-path=true test` → 66/66 passed.
- `node --check packages/figma-bridge-plugin/code.js` passed; no `??`/`?.`/`**` in the plugin diff.
- `git diff --check` clean.

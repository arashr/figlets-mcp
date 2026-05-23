# Decisions

Running log of non-obvious project decisions and the reasons behind them.

---

## [2026-05-23] One product version with `release:prepare` automation

**Decision:** Figlets has a single product version. The source of truth is `packages/figlets-mcp-server/package.json`. Do not maintain separate human-managed server/plugin/bridge/Codex/Claude version numbers.

**Automation:** `npm run release:prepare` syncs every workspace `package.json`, Claude/Codex plugin manifest version, GitHub release tarball URL, and `package-lock.json` workspace entries from that server package version. It supports exact versions (`1.0.0`), default patch bumps (`--patch`), explicit minor/major bumps, and read-only drift checks (`--check`). Exact-version sync must repair drift even when the server package already equals the requested version.

**Runtime metadata:** MCP server `version`, REST export `User-Agent`, and `@figlets/core` `CORE_VERSION` read from package metadata at runtime so they cannot drift from the synced package version.

**Verification:** `assertProductVersionAlignment()` (via `assertPluginReleaseAlignment()`) checks workspace packages, plugin manifests, tarball URLs, and lockfile drift. `npm run verify:release` and `npm run smoke:plugins` inherit this.

**Release sequence:** `npm run release:prepare -- <version>` → `npm run build:server-tarball` → `npm run verify:release` → `npm run smoke:plugins` → tag `v<version>` and attach tarball to GitHub release.

**Consequence:** v1.0 should ship as `1.0.0` everywhere via one maintainer command, not a mix of `0.1.0` and `1.0.0`. Plugin READMEs stay version-agnostic; manifests remain the release-pinned surfaces.

---

## [2026-05-18] Repair plans have required, optional, and missing-capability channels

**Decision:** Read-only planner outputs should expose a stable repair-plan contract instead of forcing agents to parse long diagnostic arrays. For `inspect_ds_setup_gaps`, the stable shape is:

- `repairPlan.applyInput` for deterministic repairs ready for explicit designer approval.
- `repairPlan.optionalApplyInput` for convention-level or designer-choice repairs, such as passive border/outline/stroke roles.
- `repairPlan.missingCapabilityNotes` for named gaps that Figlets can identify but should not or cannot apply yet.
- `repairPlan.designerPresentation` for a plain-language designer summary.

**Why:** Less capable agents repeatedly found nested `plannedRoleRepair` data and either treated it as impossible, tried to hand-assemble payloads, or reported implementation-style verification tables to the designer. The planner must make the intended next action obvious near the top of the tool result.

**Default vs optional:** Missing icon roles for complete background+foreground families are required deterministic repairs when accessible aliases can be derived, so they go into `applyInput.roleRepairs`. Passive border/outline/stroke roles are optional by default unless already classified as high-confidence required gaps, so they go into `optionalApplyInput.roleRepairs`.

**Focus border:** Foundation focus-border repairs are apply-ready only when Figlets can provide aliases from explicit config or safely derive aliases from known ramps and verify them against a default surface/background at WCAG non-text 3:1. Otherwise the focus gap remains a finding with `agentAction: "ask-designer"`.

**Missing backgrounds:** Figlets does not infer missing background aliases from foreground/icon/border usage. Missing backgrounds are designer decisions and are surfaced in `missingCapabilityNotes`, not in `applyInput` or `optionalApplyInput`, unless a future config-backed planner can provide explicit background aliases.

**Designer-facing output:** Agents should use `repairPlan.designerPresentation` to summarize results in human language. They should not show verification matrices, JSON key audits, or raw payload dumps unless the designer asks for implementation details or exact payload review.

---

## [2026-05-22] Token prune apply requires config_authoritative after dry-run review

**Decision:** `update_ds_tokens` may dry-run off-config token prune candidates (`prune.off_config_variables`, `off_config_text_styles`, `off_config_effect_styles`) without extra flags. **Apply** with any of those flags set is rejected unless `prune.config_authoritative=true`. Color ramp prune keys stay on `update_ds_primitives`. Managed token prune deletes only variables/styles in Spacing/Typography/Elevation collections and config-derived `type/*` text styles / `elevation/0..5` effect styles.

**Why:** Live validation on Figlets Test showed that comparing a narrow disposable config against a file built with full `apply_ds_setup` would delete valid in-file tokens (for example `space/radius/*` absent from the fixture config). Dry-run remains informational; the designer must explicitly confirm the active config is the full source of truth before destructive apply.

**Collection modes:** `ensure_collection_modes` adds configured breakpoint modes on existing Spacing/Typography collections before responsive writes. `inspect_ds_token_gaps` blocks responsive categories until modes exist or approved ensure runs. Developer prep uses `request-trim-collection-modes` behind `FIGLETS_DEV_BRIDGE=1` (same gate as `request-remove-text-styles`).

---

## [2026-05-21] Primitive token gaps route through primitiveRepairPlan on update_ds_primitives

**Decision:** Config-backed primitive typography and shadow gaps discovered by `inspect_ds_token_gaps` apply through `repairPlan.primitiveRepairPlan` → `update_ds_primitives` with categories `primitive-typography` and `primitive-shadow`. They do not use `update_ds_tokens` apply even though the token planner can dry-run preview those categories.

**Why:** `update_ds_primitives` already owns the Primitives collection and preserves variable IDs for color/spacing work. Primitive typography (`type/*`, `font/*`) and shadow (`shadow/*`) belong in the same approval boundary. Keeping semantic token apply on `update_ds_tokens` avoids mixing foundation primitives with Typography/Spacing/Elevation collection writes in one mutation tool.

**Live validation:** Figlets Test (`local_mpcspbgz_7gq8yy0l`) on `http://localhost:17337`. Typography apply created six numeric `type/size/*` variables; shadow primitives were already complete (dry-run 14 unchanged).

---

## [2026-05-18] Bulk design-system repairs are Figlets scope when structured

**Decision:** Agents should treat bulk design-system updates as in-scope for Figlets when the operation can be represented as a structured, designer-approved payload. Existing bulk-capable surfaces include `inspect_ds_setup_gaps.repairPlan.applyInput` passed to `apply_ds_setup_repairs`, `inspect_ds_token_gaps.repairPlan` / `primitiveRepairPlan` with `update_ds_primitives` and `update_ds_tokens`, and `qa_binding_audit({ fix: true })` for high-confidence binding fixes.

**Why:** The designer experience should not stop at "here are the gaps, but we can't fix them" when the repair is deterministic and suitable for a Figlets tool. Figlets should own safe bulk repair planning/application for design-system operations, while avoiding a generic arbitrary Figma-authoring promise.

**Missing capability behavior:** If a requested bulk repair cannot yet be planned or applied by Figlets, agents should say this is a Figlets product/tool gap or proposed Figlets feature scope. They should not write ad hoc scripts over snapshots/tool-results/raw Figma APIs to compensate, and they should not present the gap as impossible to fix.

**Icon role bulk repairs:** Missing icon roles are not treated like passive optional border advisories. When a semantic family has a background + foreground pair but no icon role, `inspect_ds_setup_gaps` should emit an approval-ready icon `plannedRoleRepair` whenever Figlets can derive accessible aliases from the paired foreground. If every complete pair is missing icons, that becomes a bulk repair payload, not `suppressedAdvisoryRoles`. Passive border/outline absence can still be suppressed as a DS-wide convention when appropriate.

---

## [2026-05-18] Initial designer response routes concrete goals instead of always showing the menu

**Decision:** `figlets_start.designerResponse` is now the generic help/start screen only. If the designer's first message already contains a concrete goal, agents should call `figlets_route_intent`, then `figlets_workflow_guide`, and use the routed `designerResponse` instead of showing the capability table or asking what the designer wants to do. If routing is ambiguous, `figlets_route_intent` returns a structured `selectionPrompt` that hosts with selection UI can render as choices; plain-text hosts can render the prompt message.

**Why:** Showing the capability menu after "review my design system using Figlets" makes the agent feel inattentive. The designer already stated the job, so Figlets should acknowledge the chosen workflow and begin the read-only path.

**Generic screen:** The generic help screen uses a simple `# Figlets` title plus a one-line about statement and the curated menu. The cheesy greeting was removed.

---

## [2026-05-18] Figlets-generated token suggestions are accessibility-checked before approval

**Decision:** Accessibility is a suggestion-time safeguard, not a write-time blocker. When Figlets computes token-gap fixes or setup suggestions itself, it must pre-check the suggested aliases against the relevant contrast rule before showing them as deterministic repairs. For text/foreground repairs this means the setup pair validator's selected text algorithm. For icon role repairs this means WCAG non-text contrast at 3:1 against the paired background. Passive border, outline, and stroke role repairs are not contrast-gated because they are often low-emphasis structure rather than meaningful non-text content; they continue to use standard passive border steps. Suggestions that cannot be made accessible where a contrast rule applies should remain findings that need a designer/product decision, not apply-ready repair payloads.

**Why:** Designers should not approve Figlets-generated fixes and then discover in the showcase that those same fixes are inaccessible. The setup and repair-planning flow should make Figlets output as clean as possible before asking for approval.

**Write behavior:** `apply_ds_setup_repairs` should not block designer-supplied payloads solely because contrast is imperfect. The guardrail belongs where Figlets generates suggestions; an explicit designer choice can still go through the approved write path.

**Designer display:** Repair suggestions should carry enough structured color/contrast metadata for agents to show token names, hex values, and pass/fail scores. Plain Markdown cannot reliably render native color chips across all hosts, but hex values plus optional host-rendered swatches give agents a portable fallback.

---

## [2026-05-18] Designer review must use Figlets workflows, not ad hoc scripts

**Decision:** In Designer Mode, any design-system review/check/audit, setup-gap investigation, or contrast investigation must run through the Figlets Agent Interface (`figlets_start` → `figlets_route_intent` → `figlets_workflow_guide`) and then the Figlets MCP tools/scripts named by that workflow. Agents must not write custom scripts over snapshots, MCP transcripts, `tool-results`, `.local/<fileKey>/figma-data.json`, raw Figma APIs, or generic Figma tools to perform the designer-facing review.

**Why:** Less reliable agents were still trying to compensate for missing confidence by scripting against local artifacts. That breaks the product contract: designers should talk naturally while deterministic Figlets tools handle QA, token math, semantic gap detection, contrast checks, and approved fixes.

**Escape hatch:** The only allowed exception is when the designer explicitly asks the agent to go out of bounds. If the Figlets output is missing information needed for the review, the agent should say that this is a Figlets product/tool gap instead of inventing a script.

---

## [2026-05-17] Setup-gap repair is part of health-check QA, not a separate follow-up flow

**Decision:** The designer-facing "Check my design system" workflow includes semantic setup QA and the approved repair continuation. After showing setup gaps, agents should ask which exact suggested repairs to apply in the same flow instead of offering to run a separate "fix setup gaps" flow.

**Why:** Once the QA output already contains semantic gaps, icon contrast failures, and missing neighboring roles, a separate gap flow is redundant and makes the product feel like the agent is handing the designer from one menu item to another instead of completing the job.

**Tooling contract:** `inspect_ds_setup_gaps` must emit deterministic repair data when Figlets can compute it, including icon `plannedReAlias` suggestions for WCAG non-text contrast failures. Agents must not run ad hoc scripts over `figma-data.json` or local snapshots to derive designer-facing fixes. If structured repair data is missing, the agent should say exactly what is missing and treat it as a tool/product gap.

**Role repair planning:** For missing border/outline role findings, when the paired background resolves to a primitive ramp, `inspect_ds_setup_gaps` emits `plannedRoleRepair` with Light/Dark aliases using the standard passive border steps for that ramp (`200` in Light and `800` in Dark, or the nearest available step). This keeps agents from inventing primitive mappings while still making high-confidence outline repairs approvable in one flow.

**Agent-ready apply payload:** `inspect_ds_setup_gaps` also emits `repairPlan.applyInput`, shaped for `apply_ds_setup_repairs`. Agents should use that object after approval instead of parsing Claude/Codex `tool-results`, MCP transcript files, or local snapshots to discover nested keys.

**Response ordering:** Agent-actionable keys must come first in the `inspect_ds_setup_gaps` result: `message`, `summary`, `repairPlan`, then `topFindings`. Long diagnostic arrays come after those fields so MCP hosts that truncate, collapse, or externalize large tool results still show the repair path without requiring filesystem inspection.

---

## [2026-05-17] Health check must include semantic setup QA before all-clear

**Decision:** The designer-facing "Check my design system" workflow must run `inspect_ds_setup_gaps` after sync/detect/token audit and before reporting the system healthy. High-confidence semantic gaps, icon contrast failures, and missing neighboring roles are surfaced before lower-signal token inventory or informational duplicate notes, regardless of token type.

**Why:** `audit_tokens` is intentionally narrower after the primitive-inventory cleanup. A file can have clean token hygiene while still having high-confidence semantic setup issues such as failing icon contrast or missing neighboring outlines. Reporting "healthy" from token audit alone is confidently wrong.

**Consequence:** Agents should not use a clean `audit_tokens` result as a design-system all-clear. "Healthy" means the combined health check has no high-confidence setup/accessibility gaps and no true token-hygiene findings.

---

## [2026-05-17] Visual showcase design changes require preview confirmation

**Decision:** Do not implement new visual showcase layout/styling decisions directly from an issue report. First investigate the deterministic behavior, then provide an HTML or equivalent visual preview for designer confirmation. After confirmation, port the approved treatment into the Figma renderer.

**Why:** The showcase is a designer-facing artifact. Small visual changes such as moving contrast labels, changing table structure, showing standalone roles, or changing badge typography can alter how designers interpret the system. Recent changes fixed mechanics but made unconfirmed presentation choices, which caused churn.

**Still allowed without visual preview:** Deterministic correctness fixes, tool routing, local config generation, QA severity/classification, and tests can be implemented directly when the product rule is clear. Figma mutations still require explicit designer approval through the existing workflow contract.

---

## [2026-05-17] Token audit separates primitive inventory from real defects

**Decision:** Raw primitive values are inventory, not "unaliased" defects. `audit_tokens` should count raw primitive variables separately and reserve `unaliased` findings for non-primitive tokens that probably should reference another token. Duplicate literal values are severity-ranked: same-group duplicates are findings, cross-domain numeric/color coincidences are informational.

**Why:** Primitive collections are supposed to hold raw values. Reporting every primitive as an unaliased issue made healthy design systems look broken. Likewise, equal values across spacing, type sizes, shadow radii, and offsets are common scale coincidences, not automatically duplicate-token problems.

**Naming policy:** Numeric leaves, numeric fraction leaves like `0_5`, and path-token leaves such as `neutral-variant` are valid generated/setup naming patterns and should not produce mixed-naming warnings. Mixed naming should focus on genuinely competing conventions such as camelCase beside path-token names.

---

## [2026-05-16] Missing file-scoped configs are generated from Figma snapshots

**Decision:** A synced Figma file without `.local/<fileKey>/design-system.config.js` is no longer a degraded no-config mode. Figlets creates a file-scoped starter config from the active `figma-data.json` snapshot before designer-facing QA/showcase flows depend on config-backed semantics. The generated config is local only, records `figlets.source = "figma-snapshot-bootstrap"`, infers collection names, responsive modes, primitive ramps, brand seed, semantic bg/text pairs, and paired outline/icon companions. It does **not** mutate Figma.

**Why:** External design systems will often be created outside Figlets. Requiring a pre-existing config made showcase, setup-gap QA, DESIGN.md export, and agent guidance behave differently across files. That repeatedly produced split semantic tables, missing icon QA, and confusing "config path exists" vs "config file exists" reports. The product rule is now: **if there is a synced active Figma snapshot and the config is missing, make the config from Figma; ask the designer only for unresolved decisions.**

**Flow contract:** `sync_figma_data`, `figlets_start`, `inspect_ds_setup_gaps`, and `build_ds_showcase` may create the local starter config when the active snapshot exists. This is allowed during read-only designer workflows because it is local setup state, not a Figma write. Approved Figma mutation remains restricted to known Figlets mutation tools.

**Showcase consequence:** `build_ds_showcase` should normally be config-backed for imported files too. The old heuristic/no-config branch remains only as a last-resort renderer when no active file key or synced snapshot is available; it should not be treated as the expected designer experience.

**Accessibility consequence:** Icon semantic roles are checked separately with WCAG non-text contrast (3:1) regardless of the selected text contrast algorithm. APCA can remain the design-system text algorithm, but the showcase and QA must keep the WCAG result visible because WCAG is the legal accessibility baseline.

**Supersedes:** The earlier showcase-freeze/no-config tolerance in the 2026-05-07/2026-05-10 showcase notes is superseded for this product behavior. Config-backed semantic rendering is now the stabilizing path, not the risky optional path.

---

## [2026-05-15] Active Figma file context is shared after sync

**Decision:** Treat the file-scoped snapshot under `.local/<fileKey>/figma-data.json` as the canonical default once `active-file.json` names a saved/open Figma file. `detect_design_system`, setup-gap inspection, and config refresh should all resolve through the same active-file source before falling back to the legacy flat `.local/figma-data.json`.

**Why:** A live designer run exposed a correctness bug: `figlets_start` advertised the previously active file, then `sync_figma_data` synced a different live file and repointed `active-file.json`. Downstream tools disagreed about which snapshot/config to use, causing confident analysis of the wrong file. The sync response now includes previous/current file keys, snapshot path, config path, and whether the active file changed so agents can surface that transition plainly.

**Naming convention:** Setup-gap role suggestions preserve the file's existing border-family vocabulary. If the file uses `color/outline/*`, missing border-role suggestions should be `color/outline/info`, not `color/border/info`. Figlets can still model this as the `border` role internally; public suggestions should respect the designer's namespace.

---

## [2026-05-15] Codex plugin package uses Codex local marketplace conventions

**Decision:** Ship the Codex designer experience as a Codex plugin package under `plugins/codex/figlets/`, with repo-root `.agents/plugins/marketplace.json` as the local marketplace manifest. The plugin includes `.codex-plugin/plugin.json`, `.mcp.json`, a `figlets-designer` skill, and a `/start`-style command file that mirrors the Figlets Designer Mode contract.

**Why:** The current Codex environment exposes a real plugin convention (`.codex-plugin/plugin.json`, local marketplace metadata under `.agents/plugins/marketplace.json`, `skills/`, and plugin `.mcp.json`), but not an observed public marketplace install command equivalent to Claude Code's `claude plugin marketplace add owner/repo`. So Figlets should not invent a remote Codex marketplace flow. The reliable product-equivalent path is deterministic local setup: `figlets-mcp setup --hosts=codex-plugin --yes` writes the local marketplace registration and enables `figlets@figlets-codex` in `~/.codex/config.toml`.

**Contract reuse:** The Codex skill and command do not define a parallel workflow. They call `figlets_start` first, use `figlets_start.designerResponse`, then route through `figlets_route_intent` and `figlets_workflow_guide`. If `figlets_start` is unavailable, the flow stops and asks the user to connect Figlets; it must not approximate Figlets with raw Figma tools or repo/plugin editing.

**Distribution:** The Codex plugin's `.mcp.json` launches the same GitHub release tarball as the Claude Code plugin (`npx -y https://github.com/arashr/figlets-mcp/releases/download/v<version>/figlets-mcp-server-<version>.tgz`). `npm run build:server-tarball` now checks both host plugin manifests so the server version, Codex plugin version, Claude plugin version, and tarball URLs stay in lockstep.

**Consequence:** Public agent-specific files remain separated by host (`plugins/claude-code/` vs `plugins/codex/`). The only machine-specific Codex path is written into the user's own `~/.codex/config.toml` because Codex local marketplaces need a local checkout path; no public manifest or docs should contain developer-local absolute paths.

**Raw MCP fallback correction:** Codex expects `mcp_servers` to be a map, not an array. The legacy raw MCP fallback therefore writes `[mcp_servers.figlets]` and setup repairs the invalid `[[mcp_servers]]` sequence form if an earlier run created it. For local reliability it writes the current Node executable plus the local `figlets-mcp.js` bin, instead of relying on `command = "figlets-mcp"`, because Codex may not inherit shell-only NVM/Homebrew PATH entries when it starts the MCP server.

**MCP listability is release-critical:** A live Codex retry showed the server process started but Codex still did not expose `figlets_start`. Direct JSON-RPC smoke testing found `tools/list` crashed with `Cannot read properties of undefined (reading '_zod')`. Root cause: Zod 4 requires `z.record(keySchema, valueSchema)`; our MCP schemas used `z.record(z.string())`, which left the value schema undefined during JSON Schema conversion. Fix: all record-shaped MCP schemas now use `z.record(z.string(), z.string())`, `zod` is a direct server dependency, and a `tests/server/mcp-tools-list.test.js` regression test starts the stdio server and asserts `figlets_start`, `figlets_route_intent`, and `figlets_workflow_guide` appear in `tools/list`.

---

## [2026-05-15] Release tarball is self-contained; install is migration-safe

Code-review hardening of the GitHub-tarball distribution:

**Self-contained tarball (P0 blocker fix):** The server reaches `@figlets/core` (a `private`, unpublished workspace package) through `../../../figlets-core/...` relative paths that only resolve inside the monorepo. The published tarball would install but expose a dead MCP server (`Cannot find module '../../../figlets-core/...'`). Fix: all 11 server files now require core through a single shim `packages/figlets-mcp-server/src/figlets-core.js` (`require("@figlets/core")` with a monorepo-source fallback), and `scripts/build-server-tarball.js` vendors `@figlets/core` into the staged package's `node_modules` and marks it a `bundleDependency` so `npm pack` ships it inside the tarball. The build script hard-fails if the tarball does not contain both `package/src/index.js` and bundled `@figlets/core`. **Rule: never add a new `../../../figlets-core` require — always go through the shim.** The committed server `package.json` stays clean (no `@figlets/core` dep, no bundle metadata); bundling is a build-time concern only, so the package stays agent-agnostic.

**Migration-safe install (P1):** `claude plugin install` only validates the manifest, not that the `npx`-tarball MCP server can boot. So `applyClaudePluginInstall` now runs a `claude mcp list` smoke check and only removes legacy user/project/local `figlets` MCP entries if `plugin:figlets:figlets` is reported connected. If unreachable (e.g. release not published), it leaves existing config intact and explains why — a designer with a working legacy setup is never migrated into a broken plugin-only state.

**Marketplace source drift + update model (P1):** Setup parses the registered marketplace's `Source:` line. If it differs from the desired source (e.g. an earlier local path now superseded by the GitHub slug) it uninstalls the plugin + removes the marketplace + re-adds (`marketplace-add: repointed`) so Claude Code drops the stale cached plugin. The uninstall and marketplace-remove exit statuses are checked: a genuine marketplace-remove failure blocks (otherwise the re-add is a no-op and the stale-source cached plugin silently persists while we falsely report success); a "not installed" uninstall is tolerated.

If the source matches, setup runs `claude plugin marketplace update` **and** `claude plugin update <spec>` (`marketplace-add: refreshed`). **Update model — stated honestly:** Claude Code keys its plugin cache on the `plugin.json` `version`. `marketplace update` alone does NOT deliver new content when the version is unchanged; an earlier draft of this decision claimed it did and was wrong. The actual contract is: **every release MUST bump `plugin.json` `version` in lockstep with the server version and the `mcpServers` tarball URL.** `scripts/build-server-tarball.js` enforces this with a pre-flight that exits non-zero unless `plugin.json` `version` equals the server `package.json` version and the tarball URL matches `v<version>`. Given that discipline, `claude plugin update` actually pulls the new release for already-installed users; without a version bump it is a deliberate no-op (not false hope).

**Source classification + quoting (P3):** `_isLocalPathSource` now positively identifies GitHub shorthands (`owner/repo`) and git/https URLs; everything else (POSIX, Windows `C:\`, UNC `\\`, `~`) is treated as a local path so it never gets the git-only `--sparse`. Displayed install commands are shell-quoted (`_shellQuote`) so local paths with spaces are copy-pastable.

**Pre-release local dev (P2):** A local `FIGLETS_MARKETPLACE_SOURCE` only changes where plugin *files* come from; the plugin still launches the pinned GitHub release tarball, so the MCP server can't start pre-release without a manual manifest override. Docs now direct everyday pre-release local development to the legacy `figlets-mcp setup --hosts=claude-code --yes` path (registers the local server directly, works immediately).

Known cosmetic debt: the dual `try/catch` blocks around the old figlets-core requires now have identical branches (both call the shim). Correct but redundant; left as-is to keep the P0 fix mechanical and low-risk.

---

## [2026-05-14] Claude Code plugin packaging lives under `plugins/claude-code/`

**Decision:** Distribute the designer-facing Claude Code experience as a Claude Code plugin shipped from this monorepo at `plugins/claude-code/figlets/`. The plugin manifest registers the Figlets MCP server inline (`mcpServers.figlets`), ships a slash command `/figlets:start`, and bundles a `figlets-designer` skill so designer phrases auto-trigger Designer Mode without typing the slash command.

**Marketplace location (revised):** The marketplace manifest lives at the **repo root** (`<repo>/.claude-plugin/marketplace.json`), not nested under `plugins/claude-code/`. Verified against current Claude Code docs: `claude plugin marketplace add owner/repo` reads the manifest *strictly* from `<repo-root>/.claude-plugin/marketplace.json` — there is no subdirectory form. The root manifest's plugin `source` is `./plugins/claude-code/figlets` (relative paths resolve from the marketplace root = repo root), so all real Claude content stays nested and only a thin redirect sits at the root. The nested `plugins/claude-code/.claude-plugin/marketplace.json` was removed. The user explicitly accepted one Claude-specific folder at the monorepo root (Option A) over a separate dedicated plugin repo (Option B), to keep everything in one repo while knowing the toolkit stays agent-agnostic.

**Why:** Manual `claude mcp add` and project `.mcp.json` editing was unreliable for designer testing — user-scope registration did not consistently expose `figlets_start`. A plugin install collapses MCP registration and the curated entrypoint into one command-palette action and removes the need for designers to edit JSON. Keeping the folder under `plugins/<agent>/` leaves room for future Cursor/Windsurf plugins without renaming.

**Command resolution (revised — npm-free, GitHub release tarball):** The plugin's MCP server entry uses `npx -y https://github.com/arashr/figlets-mcp/releases/download/v<version>/figlets-mcp-server-<version>.tgz`. The user did not want to depend on npm publishing or an npm account. `npx` runs a remote tarball directly and resolves its dependencies from the public npm registry (registry **reads** are free and unauthenticated; only publishing needs auth). The tarball is produced by `npm run build:server-tarball` (wraps `npm pack`) and attached to a GitHub release — no `@figlets/mcp-server` npm package exists. An earlier iteration used `npx -y @figlets/mcp-server` (npm publish); that was abandoned to avoid the npm account. Until the GitHub release exists the manifest URL 404s, so the plugin README documents a machine-local `node`+bin override (never commit it).

**Contract reuse:** The plugin does not invent a new workflow contract. The `/figlets:start` command body intentionally mirrors the Designer Mode rules from root `CLAUDE.md`/`AGENTS.md` and defers everything else to `figlets_start.designerResponse` and the Agent Interface registry.

**Consequence:** Designer install path becomes `figlets-mcp setup --hosts=claude-code-plugin --yes` (or the default `figlets-mcp setup --yes` — see supersession below). That single command runs `claude plugin marketplace add` + `claude plugin install` idempotently, then a session restart enables `/figlets:start` and the auto-trigger skill. `figlets-mcp launch` remains available as the local-only fallback for hosts that do not support plugins.

**Marketplace source (revised):** `figlets-mcp setup` no longer points the plugin install at a local folder. It uses the GitHub slug `arashr/figlets-mcp` with `--sparse .claude-plugin plugins/claude-code` (limits the monorepo checkout). `FIGLETS_MARKETPLACE_SOURCE` (or `options.marketplaceSource`) overrides it with a local path for development before the repo is pushed; a local-path source skips `--sparse` and is validated to contain `.claude-plugin/marketplace.json`. This removed the `_marketplacePath()` folder logic, the `prepack`/`sync-plugins.js` bundling, and `files: plugins/` from the server package — the server package is now purely the agent-agnostic toolkit again; the plugin is fetched from GitHub, not from the npm tarball.

**Always-selectable plugin target:** The `claude-code-plugin` target is always part of the known targets list, so an explicit `--hosts=claude-code-plugin` always returns an actionable plan — when `claude` is missing the status is `manual` with a reason that quotes the exact GitHub install commands, and when a local-path source override lacks `.claude-plugin/marketplace.json` the reason names that. (An earlier iteration made inclusion conditional on `claude` + a local marketplace folder, which produced an empty plan and a confusing "rerun with --yes" message.)

**Viability-gated supersession:** In the default run (no `--hosts`), the legacy `claude-code` target is dropped via `supersededBy: "claude-code-plugin"` — but only when the plugin target plans as `would-run` or `unchanged` in the current environment. If the plugin path is not viable (e.g. `claude` missing or marketplace folder absent), the legacy target stays in the default plan so the designer still sees an actionable fallback. Explicit `--hosts=claude-code` always reaches the legacy path.

**Auto-cleanup of pre-plugin installs:** After a successful (or already-applied) plugin install, the target runs `claude mcp remove --scope <user|project|local> figlets` to drop any pre-existing `figlets` MCP registrations that the plugin now supersedes. "No server found" responses are treated as `absent` (silent skip). This was added after live testing showed a fresh install left both `plugin:figlets:figlets` (new) and `figlets` (legacy `claude mcp add`) connected, exposing duplicate tools.

**Distribution (revised):** No npm publish. `npm run release:prepare` keeps workspace packages, plugin manifests, tarball URLs, and lockfile entries aligned to the server package version. `npm run build:server-tarball` (`scripts/build-server-tarball.js`) stages a self-contained server (bundling `@figlets/core`), runs `npm pack` into `dist/` (gitignored), and runs a release pre-flight that **exits non-zero** unless BOTH `plugin.json` `version` equals the server `package.json` version AND the `mcpServers` tarball URL equals `https://github.com/arashr/figlets-mcp/releases/download/v<version>/figlets-mcp-server-<version>.tgz`. Release step (owned by the user): `npm run release:prepare -- <version>` → `npm run build:server-tarball` → push `arashr/figlets-mcp` public → `gh release create v<version> dist/figlets-mcp-server-<version>.tgz`. Until the release exists the local-dev override applies.

---

## [2026-05-14] Agent Interface starts as read-only workflow guidance

**Decision:** The Agent Interface is a product layer, not a replacement for deterministic tools. It starts with a read-only workflow registry plus three MCP guide tools:

- `figlets_start`
- `figlets_route_intent`
- `figlets_workflow_guide`

These tools teach any MCP-speaking agent how to introduce Figlets, route designer intent, follow workflow steps, honor confirmation boundaries, recover from common errors, and suggest next flows. They do not inspect Figma, mutate Figma, write local files, or perform setup logic.

**Why:** The existing product behavior was spread across adapter docs, paste-ready prompts, and individual tool descriptions. That works for a careful agent, but it is fragile for arbitrary MCP hosts. A first-class Agent Interface lets Figlets itself provide the operating contract while preserving agent-agnostic use.

**Path policy:** Product-facing guide payloads must not hardcode developer-local paths. Agents should prefer the global `figlets-mcp` command and use runtime paths returned by tools or active-file path utilities. Installation remains a separate CLI/plugin packaging track because `figlets_start` can only be called after MCP is already connected.

**Safety policy:** Any workflow step that mutates Figma requires explicit designer approval in the registry. Tests pin that write steps such as `apply_ds_setup`, `apply_ds_setup_repairs`, `build_ds_showcase`, `generate_component_doc`, and binding fixes are approval-gated.

**Consequence:** Adapter docs now instruct agents to call the Agent Interface tools before improvising. Future Claude Code plugin commands, `npx figlets-mcp setup`, and public prompt docs should consume or mirror this registry rather than inventing separate workflow rules.

**Installer follow-up:** The first installer slice is `figlets-mcp setup`. It is dry-run by default, patches supported local MCP configs only with `--yes`, backs up existing files, preserves unrelated MCP servers, and writes `"command": "figlets-mcp"` rather than absolute Node/repo paths. For Claude Code, it uses Claude Code's native `claude mcp add --transport stdio figlets -- figlets-mcp` command when the `claude` binary is available; otherwise it prints that command as the manual fallback.

---

## [2026-05-14] Setup gap QA now separates read-only judgment from approved fixes

**Decision:** The setup gap flow is now explicitly productized as two phases:

1. **Read-only QA / conversation:** `sync_figma_data` → `refresh_ds_config_from_figma({ dry_run: true })` → `inspect_ds_setup_gaps` or the fallback CLI `npm run figlets:check-setup-gaps`. This phase may classify, rank, explain, and suggest questions, but it must not mutate Figma or config.
2. **Designer-approved fix:** `apply_ds_setup_repairs` applies only the exact approved repairs, then the agent reruns sync/QA. Config refresh happens after Figma succeeds when needed, so local config follows the approved live file rather than driving it silently.

The designer-facing contract is: designers talk to the agent in natural language; the agent runs the scripts/tools, translates the QA findings, asks for explicit approval on ambiguous decisions, applies only approved changes, and verifies with a read-only QA pass. There should be no code editing in a normal public-product session.

**Semantic-family QA:** `inspect_ds_setup_gaps` now builds semantic families from the live Figma token namespace (`bg/text/icon/border` around leaves like `success`, `warning`, `info`) and emits `missingSemanticRoles[]` with:

- `confidence` (`high` / `medium`)
- `basis: "semantic-family"`
- `agentAction` (`ask-designer` / `advisory-only`)
- `evidence[]`
- `suggestedName`

This preserves the Figma-first handover goal while giving the agent enough structure to avoid blindly trusting a flat script outcome. The old naming-based `semanticGaps` remains, but the CLI now labels it as "Possible naming gaps" and renders semantic-family gaps first.

**Config as context, not authority:** `design-system.config.js` remains a hint layer for this QA tool, not the source of truth. It is used to:

- avoid false positives when a background intentionally pairs to a shared foreground (e.g. `color/bg/brand-subtle` → `color/text/brand`)
- avoid treating configured unpaired surfaces (`surface/raised`, `surface/overlay`, `surface/sunken`) as missing text roles
- suppress companion advisories when a same-name bg/text pair contradicts a configured pair (e.g. muted should pair through default)
- choose the contrast algorithm

Figma remains the live inventory being inspected.

**Fix path extension:** `apply_ds_setup_repairs` now supports a third repair kind:

- `roleRepairs[]` — creates explicitly approved border/icon semantic role variables with designer-approved per-mode primitive aliases.

This is intentionally separate from `repairs[]` (missing foreground companions) so agents cannot smuggle border/icon creation through the foreground path. The bridge writes role repairs only when `roleRepairs` is present; otherwise the QA remains read-only. Created role tokens update the file-scoped config after Figma succeeds: icon roles go into `DS.color.semantics.icons`; border roles go into `DS.color.semantics.unpaired`.

**Live flow result that shaped the contract:** In the live test file, QA initially flagged:

- `color/text/muted` failing APCA on `color/bg/default`
- missing `border/info`, `border/warning`, `border/success`, `icon/success`
- muted border/icon noise

After explicit designer approval, the fix flow:

- re-aliased `color/text/muted` Light → `color/neutral/600`, Dark → `color/neutral/100`
- created `color/border/success`, `color/icon/success`
- after a second explicit confirmation, created `color/border/info`, `color/border/warning`
- refreshed config from Figma
- reran `npm run figlets:check-setup-gaps`

Final QA reported: `Semantic-layer QA: clean — no findings`.

**Out of scope (intentional):**

- Auto-applying semantic-family gaps based on confidence alone. Even high confidence means "ask designer", not "mutate".
- Making config authoritative over Figma. Existing DS handover remains Figma-first.
- Creating arbitrary role types. The supported public path is approved border/icon role creation with explicit aliases.
- Adding a broad "fix all" command. The agent can orchestrate multiple approved repairs, but the tools keep the approval payload explicit.

**Consequence:** The public-product flow can now remain script/tool-driven instead of code-edit-driven: run QA, talk through findings, apply approved fixes, refresh config, rerun QA. Tests cover semantic-family detection, config-context suppression, role repair normalization/wire format/config update, and the existing read-only CLI framing.

---

## [2026-05-13] DESIGN.md export is spec-compliant with a `figlets-extended` round-trip block

**Decision:** The DESIGN.md exporter ([packages/figlets-core/src/ds-config/design-md-intake.js](packages/figlets-core/src/ds-config/design-md-intake.js)) now produces output that lints clean against Google's `@google/design.md` v0.1.1 (zero errors). To carry information the Google spec can't express — Dark-mode aliases, responsive size/spacing triples, contrast algorithm, full ramps — the body embeds a fenced ```figlets-extended``` JSON block. The intake parser, when it sees that block, uses it as the canonical DS; falls back to the legacy front-matter-only parse for external DESIGN.md files.

**Compliance changes vs. the previous exporter:**

1. **Bare brand role colors.** `colors:` now emits `primary`, `secondary`, `tertiary`, `neutral` from `DS.color.brand` alongside the existing `<ramp>-<step>` keys. Clears the linter's "no primary defined" warning.
2. **`fontWeight` as a bare number.** Spec accepts either, but bare numbers are the example form and match `Number` typing in downstream tools.
3. **Canonical section order.** Overview → Colors → Typography → Layout → Elevation & Depth (when present) → Shapes (radii) → Components (semantic pairs). Matches the spec's section ordering rule exactly.
4. **`components:` front-matter section.** `DS.color.semantics.pairs` are rendered as components with `{colors.<step>}` references on `backgroundColor` / `textColor`, using Light-mode aliases. Maps semantic pairs into the spec's first-class compositional slot rather than into an unknown key.
5. **Rich body content.** Every section carries readable prose plus tables (typography sizes per breakpoint, spacing responsive triples, radius scale, semantic pair Light/Dark aliases) — the YAML is for tools, the body is for humans and agents reading the markdown.

**The `figlets-extended` block:**

The exporter writes the full DS (minus environment-dependent fields like `source` and `primitives`) as JSON inside a fenced ```figlets-extended``` code block in the body. Google's linter ignores it (unknown info-string fenced blocks pass through). Our intake parser detects the block and uses it as the DS — so reading our own export is lossless (Dark-mode aliases, responsive triples, contrast algorithm choice, breakpoints, naming conventions all round-trip).

**Why a fenced block, not extra YAML keys:** Strict zod-based validators (which `@google/design.md` uses) may reject unknown front-matter keys. A fenced code block is unambiguous markdown content and never violates the schema. Tools that don't know about `figlets-extended` simply render it as a code block.

**Validation infrastructure:** `@google/design.md` is now a `devDependency`. A new integration test ([tests/integration/design-md-google-lint.test.js](tests/integration/design-md-google-lint.test.js)) calls the linter's programmatic API (`lint()`) on a representative DS export, asserts zero errors, asserts canonical section order, and asserts round-trip fidelity for the lossy fields. The test skips cleanly (with a `SKIP` notice on stderr) when the dev dependency is missing — offline contributors aren't blocked. A new CLI [packages/figlets-mcp-server/src/cli/lint-design-md.js](packages/figlets-mcp-server/src/cli/lint-design-md.js) wraps the same `lint()` API; `npm run figlets:lint-design-md` is the entry point.

**Known remaining lint signals (intentional):**

- `orphanedTokens` warnings (color X defined but not referenced by any component). Reflects a real DS shape: many primitives, fewer compositions. Not a compliance issue — the linter is correctly observing token utilization. Suppressing it would lie about the system.

**Round-trip contract:** Reading our own export reconstructs the DS exactly (modulo `source` and `primitives` which are environment-dependent). The `parsed.extended: true` field on the intake result signals when the extended block was used; consumers can trust the DS is canonical in that case.

**Out of scope (intentional):**
- Emitting `lineHeight` as a unitless multiplier when ratios are clean. Optional spec form; dimension strings work everywhere.
- Re-merging extended-block DS over front-matter parse for partial overrides. Today's behavior: extended block wins entirely when present; otherwise front matter parses normally. Mixing the two would invite drift between the two halves.

---

## [2026-05-13] DESIGN.md export is a first-class flow, not a side effect of setup

**Decision:** `export_design_md` is now a standalone MCP tool (plus matching CLI `npm run figlets:export-design-md` and designer prompt at [docs/designer-export-md-prompt.md](docs/designer-export-md-prompt.md)). It chains `sync_figma_data` → `refresh_ds_config_from_figma` → `writeDesignMdFromDsConfig` in one call. Sync + refresh are bundled by default; `figmaDataPath`, `skip_sync`, and `dry_run` short-circuit specific steps. The CLI mirrors the handler one-to-one for no-MCP fallback.

**Why:** DESIGN.md export already existed inside `prepare_ds_config` and `apply_ds_setup` as a side effect — designers couldn't refresh the markdown without re-running setup, and there was no designer-facing entry point for "give me a portable DESIGN.md right now." The export is a high-value, read-only handoff artifact (coding agents, code repos, cross-team share). Hiding it inside setup conflated two intents.

**Why sync + refresh are bundled by default:** If we synced without refreshing the config, the freshly pulled Figma values would not flow into DESIGN.md — the sync would be wasted work. The "sync first" choice implies "refresh from sync." `dry_run` lets designers preview both writes (config + DESIGN.md) without committing either.

**Out of scope (intentional):**
- Bootstrapping a `design-system.config.js` when one doesn't exist. Export errors with a "run setup first" hint instead. Two different flows; do not conflate.
- Writing to Figma. Export is read-only by definition.
- Plugin UI button. The plugin can't write to the host filesystem from its sandbox, so a button would require posting to the receiver and an MCP-side handler for plugin-originated requests — that's its own architectural piece, deferred.

**Consequence:** `apply_ds_setup` / `prepare_ds_config` keep their incidental DESIGN.md side effect (no regression). The new tool reuses `writeDesignMdFromDsConfig` from `figlets-core` so there is one exporter, not two. Adapter docs ([packages/figlets-adapter/AGENTS.md](packages/figlets-adapter/AGENTS.md), [packages/figlets-adapter/CLAUDE.md](packages/figlets-adapter/CLAUDE.md)) list the new tool; the tool-coverage test enforces that listing. Tests cover happy path, output-path override, dry run, and missing-config error.

---

## [2026-05-12] Contrast fixes go through the existing apply tool — no parallel script

**Decision:** `apply_ds_setup_repairs` accepts two repair kinds in one call:
- `repairs[]` — create missing semantic foreground vars (existing).
- `aliasUpdates[]` — re-alias an existing semantic var in a specific mode (new).

The contrast picker stays inside `validateSemanticPairs` / `accessible-repair-aliases.computePlannedAliases`. The QA inspector reuses it by passing the failing fg as both `name` and `source` of a synthetic repair — the picker walks the fg's ramp and returns the nearest passing step. Each contrast failure carries `plannedReAlias: { token, mode, from, to }` when the picker can find an upgrade (returns null for multi-hop alias chains).

**Why:** Building a separate contrast-fix script would duplicate the contrast math and double the approval surface the designer (and agent) have to reason about. MCP is part of the product runtime, so requiring it for the apply step isn't friction — it's the assumed environment. Writing to Figma always goes through the bridge anyway. One tool, one bridge channel, one approval contract.

**Wire format:** Both arrays travel in one `request-setup-repairs` body. The bridge plugin processes `repairs` first (create), then `aliasUpdates` (re-alias). Receiver is unchanged — it forwards the full payload.

**Out of scope (intentional):**
- Config update for re-aliases. The new path doesn't touch `design-system.config.js`. If the designer wants config to follow Figma after a re-alias, they run `refresh_ds_config_from_figma`. Keeps the new mutation surface minimal.
- CLI for apply. Apply remains MCP-only; the agent calls it. The QA CLI is read-only and unchanged.

**Consequence:** The agent can now resolve every fixable QA finding in one tool call. The schema's `required: ["repairs"]` was dropped — the handler errors when neither array has entries. Tests cover `_normalizeAliasUpdates`, the wire-format shape, an alias-only round-trip, and the empty-input guard. Plugin ES6 constraint preserved (no `??`/`?.`/`**` introduced; `**` in matches are markdown strings).

**Failure modes:**
- Picker can't find a passing step on the ramp → no `plannedReAlias` → CLI just shows the failure with bg/fg primitives + hex; designer decides manually in Figma.
- Re-alias target primitive doesn't exist in Figma → bridge returns it under `updateUnresolved` with reason; nothing is written.
- Token already aliased to target → bridge returns it under `updateSkipped` (idempotent).

---

## [2026-05-12] QA report is shaped for the next agent step, not for direct apply

**Decision:** `check-setup-gaps` is the **first half** of a two-step flow: QA report → designer-led conversation → optionally `apply_ds_setup_repairs`. The report's job is to surface findings + enough context for the agent to ask the right question, not to preview what apply would do. Concretely:

1. `plannedAliases` / `plannedUpgrades` / `plannedAlgorithm` remain on the inspector's JSON output (so `apply_ds_setup_repairs` keeps its round-trip contract) but are **not rendered in the CLI**. The CLI shows the source token's *actual* current aliases instead — that's QA-relevant context (e.g. "your on-surface/danger aliases neutral/0 in both modes") and avoids the misleading "(upgraded for contrast)" framing that can bias an agent toward apply.
2. **Severity ordering everywhere.** Section render order, "What this means" order, and the prefixes (`URGENT:` for broken aliases, `A11Y:` for contrast) all push the agent's attention to the urgent stuff first.
3. **Resolved primitives + hex on every contrast failure** so designer + agent can debug from the report alone, not by switching to Figma to chase what `surface/warning Dark` actually points at.
4. **Hairline tag.** Failures within `_WCAG_NEARMISS = 0.3` (or `_APCA_NEARMISS = 5`) are flagged `nearMiss: true` with `gap: <distance>` so triage prioritizes gross failures over off-by-one.
5. **DS-wide advisory suppression.** When ≥3 complete pairs all miss the same companion role (`_ADVISORY_SUPPRESS_MIN_PAIRS`), the inspector emits one `suppressedAdvisoryRoles` entry instead of N per-pair advisories. Threshold guards against false suppression on small files.
6. **Snapshot freshness header** (`Snapshot: N variables, M collections (synced at ...)`) so the report carries proof that it's reading current Figma state.

**Why:** The previous CLI rendering said "Missing foregrounds: 4 (4 ready to repair)" with per-pair `aliases: Light → color/neutral/600 (upgraded for contrast)` lines. An agent reading that would reasonably advance to apply. But the picker had walked the **neutral** ramp because the source `on-surface/danger` was already aliased to grey — a likely *bug in the file* the designer should be told about, not an "upgrade" to silently propagate. The QA pass needs to expose the file's state, not pre-resolve it.

**Out of scope (intentional):**
- "Apply this finding" buttons / shortcuts in the CLI. The script stays read-only; apply lives behind `apply_ds_setup_repairs` with its own approval contract.
- Cross-finding correlation ("missing-bg X is the reason missing-fg Y looks broken"). The agent does that during the conversation.

**Consequence:** JSON contract is additive (every old field preserved); the apply flow is unchanged. Tests assert severity ordering, the absence of "ready to repair" / "would add" / "upgraded for contrast" wording, the hex render on failures, and the suppression threshold (≥3 pairs).

---

## [2026-05-12] `check-setup-gaps` is a read-only QA pass over the semantic color layer

**Decision:** `inspect_ds_setup_gaps` is a pure QA inspector. It reads a synced Figma snapshot and reports six finding kinds against the **semantic color layer** in Figma:

1. `semanticGaps` — backgrounds without a matching foreground (broadened from variant-only to **any** background-family leaf; still emits `plannedAliases` for the existing apply-repair path).
2. `missingBackgrounds` — `on-*` foregrounds without a matching surface/bg/background. Restricted to the explicit `on-*` prefix; generic `text/*` tokens are deliberately not flagged.
3. `incompleteModes` — semantic var has a value in some collection modes but not others (zero-value vars are skipped; that's a different problem).
4. `contrastFailures` — bg+fg pairs whose resolved RGB fails WCAG 4.5:1 (default) or APCA Lc 75 (when config opts in). Aliases are walked **by mode name** so primitives in single-mode collections still resolve cleanly.
5. `brokenAliases` — semantic-layer-only. A semantic var aliasing a target id that's not in the snapshot.
6. `companionAdvisories` — complete pair with no border/icon companion. Advisory only.

**Source of truth:** Figma. The optional `design-system.config.js` is consulted only for `contrastAlgorithm` selection. The setup flow that authors configs from a Figma read is unchanged.

**Why:** The previous inspector iteration only fired on `-variant` leaves and treated raw fill names as out-of-scope, so a designer deleting an everyday semantic var (e.g. `color/on-surface/danger`) got a "0 gaps" report — the opposite of what a QA pass should do. A simultaneous broken-alias-with-setup-vs-component-scope classifier was added on top, but component-scope detection was never in this project's scope. The previous commit (`1504b5d`) was reverted; this decision narrows the contract back to the original intent (semantic-layer QA), broadens detection so the contract is actually met, and removes the scope classifier entirely.

**Out of scope (explicitly):**
- Component-collection breakage. If a `Button · Type` alias is broken, the QA does not classify or report it — that's a downstream rebinding problem outside the setup flow.
- Non-color semantic categories (typography roles, spacing semantics, radius semantics) — color-only QA for now.

**Apply-flow compatibility:** `apply_ds_setup_repairs` continues to consume `semanticGaps[*].plannedAliases` verbatim. Broadening means many non-variant gaps come back as `status: "unresolved"` (no source token in the file) and apply correctly skips them. No bridge or apply changes were needed.

**Consequence:** The `check-setup-gaps` CLI now renders every finding category with plain-language headlines and labels the contrast algorithm in use. Existing tests updated; new `tests/server/inspect-ds-setup-gaps-qa.test.js` covers contrast, broken-alias, incomplete-modes, missing-bg, and advisory paths against literal RGB primitives. `npm test` 52/52.

---

## [2026-05-11] Repair apply trusts designer-approved plannedAliases; refresh refuses to guess brand step

**Decision (review follow-up):** Four hardening changes to the setup-repair flow, all addressing review feedback on commit 73a195f.

1. **Approve-then-apply consistency.** `inspect_ds_setup_gaps` now computes `plannedAliases` for each proposed gap by calling the same picker as apply (extracted to `packages/figlets-mcp-server/src/utils/accessible-repair-aliases.js`). The CLI report renders the per-mode aliases the designer would actually get, with an "(upgraded for contrast)" flag when the picker walked the ramp. `apply_ds_setup_repairs` forwards the caller-supplied `repair.aliases` verbatim and only falls back to recomputing when no preview was passed. The designer sees exactly what gets written; the picker has a single owner.
2. **No orphan repairs.** `apply_ds_setup_repairs.inputSchema` now requires `bg` alongside `source`, `_normalizeRepairs` drops repairs without a `bg`, and the bridge handler verifies `bg` still exists in Figma before creating the FG companion. Previously an agent could send `{ name, source }` and the plugin would create a semantic variable with no paired background; config-update silently skipped it.
3. **Mode-aware alias resolution in refresh.** `refresh-ds-config-from-figma.js`'s `_resolveValue` now propagates the source mode name across `VARIABLE_ALIAS` hops and selects the target's matching mode by name, instead of `Object.keys(values)[0]`. Without this, a primitive aliasing a multi-mode variable would sync the wrong RGB whenever JSON key order differed from collection order.
4. **No implicit brand step.** `refresh-ds-config-from-figma.js` no longer defaults to `step=500` when `brand.step` is missing. It skips the entry with a "no explicit anchor step" reason. This aligns with the existing auto-anchor decision (a brand's natural step is OKLab-L-derived, not a scale midpoint) and avoids the wrong-hex hazard on 400/600 anchors or 0–1000 scales.

**Why:** The previous flow had a confirmation-vs-mutation drift (designers approved "copy from source X", apply might pick a different step), accepted incomplete repair specs, and used JSON-order- or midpoint-based shortcuts that were correct in the test fixture but unsafe in the wild.

**Consequence:** Existing flows continue to work — bridge fallback to copy-values, the normalizer still accepts legacy `{ recommended, source }` shape augmented with the now-required `bg`. New regression tests in `tests/server/refresh-ds-config-from-figma-tool.test.js` (no-step skip + multi-mode alias safety), `tests/server/inspect-ds-setup-gaps-planned-aliases.test.js` (planned-aliases surfacing), and `tests/server/apply-ds-setup-repairs-tool.test.js` (orphan-bg guard, approved-aliases round-trip).

---

## [2026-05-11] Repair apply reuses validateSemanticPairs to pick accessible per-mode aliases

**Decision:** `apply_ds_setup_repairs` no longer hands raw `source.valuesByMode` to the bridge plugin. The MCP server now precomputes per-mode primitive aliases for each approved repair by feeding a one-row pair into the existing `validateSemanticPairs` (the same code path the setup flow uses), and forwards `aliases: { Light: 'color/<ramp>/<step>', Dark: ... }` on each repair. The plugin sets each mode's value to a `VARIABLE_ALIAS` pointing at the named primitive. When the snapshot or DS config is missing/insufficient (no ramps, source not aliased to a primitive, etc.), the server omits `aliases` and the plugin falls back to its prior copy-values behavior — preserving the older repair flow exactly.

**Why:** The old flow cloned the source FG token's aliases verbatim. If the BG variant resolved to a different primitive than the source's intended BG, contrast checks were never re-run and the variant could ship at a sub-AA ratio. The setup flow's `validateSemanticPairs` already walks ramps and picks the nearest accessible step per mode (WCAG ratio / APCA Lc, gated by `DS.color.contrastAlgorithm`); routing repairs through it removes the duplication and keeps the picker consistent across `apply_ds_setup`, `update_ds_primitives`, and `apply_ds_setup_repairs`.

**Bootstrap rule:** When no `design-system.config.js` exists for the active file, the server builds an in-memory DS from the Figma snapshot — `color.ramps` extracted from `color/<ramp>/<step>` primitives, `color.brand` heuristically detected (`primary` → `brand` → first ramp; anchor step closest to 500), `contrastAlgorithm` defaulting to WCAG. The bootstrap is never persisted unless a future flow explicitly opts in. Existing partial configs (e.g. only `color.semantics.pairs` filled in) are merged with the bootstrap so validation always has ramps + brand without forcing a full DS rewrite.

**Wire-format change:** `command.data.repairs[*]` may now include `aliases: { Light, Dark }` keyed by mode name. The bridge handler in `code.js` consumes the field when present and falls back to the legacy copy-values path when absent. This is forward+backward compatible — older MCP servers that don't send `aliases` keep working with the new plugin, and the new MCP server with no snapshot reachable behaves like the old one.

**Consequence:** No new contrast math was added — `validateSemanticPairs` is the single authority. The only additive core change is a `pairSuggestions` field on its return value (existing consumers ignore it). Failure modes are best-effort: if alias computation can't be done, the repair still applies via the legacy path so existing flows keep working.

---

## [2026-05-11] Designer-safe setup gap check runs without MCP tools loaded

**Decision:** Add a local CLI entry point `npm run figlets:check-setup-gaps` (file: `packages/figlets-mcp-server/src/cli/check-setup-gaps.js`) that runs the read-only setup-repair preview by calling the existing handlers directly: bridge `/health`, `handleSyncFigmaData`, `handleRefreshDsConfigFromFigma({ dry_run: true })`, `handleInspectDsSetupGaps({})`. It prints a plain-language report and always ends with "No changes were made to Figma." Config refresh is always dry-run; repairs are never applied.

**Why:** A clean agent session may not have the Figlets MCP server connected, so it cannot call `sync_figma_data` or `inspect_ds_setup_gaps`. Designers should still be able to point any agent at a single boring shell command and get a safe, plain-language preview of what would change. The check command is a fallback for the no-MCP-tools case and works as a one-liner for sanity checks.

**Consequence:** The check command is read-only and stops before any approval step. Applying repairs still requires the explicit MCP path (`apply_ds_setup_repairs` with approved repairs). A future apply CLI, if added, must accept an explicit approved-repairs input (file or flag), not infer approval. The `.mcp.json` at the repo root is a local convenience file with an absolute path; it is not committed and is not portable.

---

## [2026-05-11] Setup repairs use inspect-then-approved-apply

**Decision:** Existing-file setup repairs are split into an explicit config refresh, read-only inspection step, and designer-approved apply step. `refresh_ds_config_from_figma` updates already-existing config entries from the synced Figma snapshot without creating new config tokens and without mutating Figma. `inspect_ds_setup_gaps` reads the synced current Figma snapshot and reports additive semantic repair candidates without requiring a prepared config and without mutating Figma or config. `apply_ds_setup_repairs` accepts only the designer-approved repairs, creates those missing semantic variables by copying aliases from the approved source token, and updates the file-scoped config only for approved pairs that do not conflict with an existing pair for the same background.

**Why:** Designers may add, rename, or intentionally alter variables after the first setup. Figlets should respect current Figma state instead of pushing stale local config back over a living file. The earlier `update_ds_primitives dry_run` boundary is still useful for prepared config-backed value updates, but it cannot inspect a living file whose scoped config is incomplete. A snapshot-based inspector lets Figlets show the exact gaps first, while the apply tool prevents broad "create everything" behavior.

**Consequence:** Showcase remains read-only and diagnostic. It can reveal suspicious pairs or missing companions, but it must not create, update, delete, or hide variables. Setup repair flow is now: `sync_figma_data`, `refresh_ds_config_from_figma`, `inspect_ds_setup_gaps`, designer confirmation, `apply_ds_setup_repairs`, then optionally rebuild showcase as verification. Existing config values stay fresh when Figma is manually edited, but missing/new tokens still require explicit designer approval before they become config or Figma state. Existing config pairs are not rewritten; conflicting proposed pairs are reported instead of silently replacing designer-authored decisions.

**Integrity guardrails:** `refresh_ds_config_from_figma` is intentionally non-creative: it only updates existing config rows/fields with current Figma values, never creates new config tokens, never deletes missing config tokens, and never mutates Figma. `inspect_ds_setup_gaps` is also read-only. `apply_ds_setup_repairs` is the only new mutation path and requires explicit approved repairs; tests cover that inspection leaves config untouched and config is updated only after a successful approved repair response.

---

## [2026-05-10] Semantic Colors showcase infers border + icon companions DS-agnostically; fill is NOT inferred

**Decision:** When the showcase renders a Semantic Colors row, it computes the **border** and **icon** companions for each surface by walking the DS's variable namespace with the same kind of segment-substitution pattern that `_findFgPair` ([code.js:3456](packages/figma-bridge-plugin/code.js)) already uses to discover the foreground companion. A new helper `_inferSemPairExtras(bgName, fgName, varByName)` inside `_buildShowcase` tries each role's plausible naming targets in order — `border|outline|stroke` for borders, `icon|graphic|symbol` for icons — and falls back through `-subtle|-variant|-strong` suffix stripping the same way the existing fg lookup does. The first candidate that resolves in `varByName` wins; nothing is invented. Both the config-pairs branch and the legacy non-config bg-row branch call the helper.

**Fill is intentionally NOT inferred.** A first iteration auto-rendered a strong-fill companion alongside the bg+fg pair (e.g. showing both `bg/danger` and `fill/danger` in the same row), which proved visually noisy and conflated the surface preview with a separate role. The helper now returns `fillRef: ''` unconditionally. Explicit `pair.fill` set in a user's config still flows through the existing `_resolveSemRef(pair.fill)` path and renders downstream — only the auto-inference of fill is suppressed.

**Why:** Figlets MCP is open source. Different consumers ship different design systems with different naming conventions (Material 3, role-based, custom). Hardcoding a specific token mapping would only serve one DS shape. The plugin already had the right machinery for fg discovery; generalizing it to border + icon lets the showcase show those companions bundled together for any DS that follows reasonable naming, without asking the user to enumerate the kit in their config. Fill stayed out because in practice fill duplicates information already shown when bg is itself a fill, and feels redundant alongside a `bg/<role>` surface.

**Contracts (enforced by code review):**
- **Explicit-wins for border/icon**: a pair entry that already specifies `border` / `icon` short-circuits inference for that key (`pair.border || _extras.borderRef`).
- **Fill never inferred**: helper returns `fillRef: ''` unconditionally. Explicit `pair.fill` is honored elsewhere via the unchanged `_resolveSemRef(pair.fill)` resolution.
- **No Figma mutation**: the helper is read-only against `varByName` and returns string paths. No `figma.variables.create*`, `setBoundVariable`, `setVariableScopes` are introduced. Pre/post mutation-line hash is identical (`bd48acf72529bc6caf11e9a41404ec67`).
- **No DS config mutation, no new MCP tool, no server change**.
- **Helper is private to `_buildShowcase`**: not exported, not on `window`/`figma`, not in the bridge polling protocol.
- **No effect outside the Semantic Colors render**: QA audit, doc build, scope helpers, primitives update, reset, and apply-DS-setup are untouched.
- **No contrast thresholding**: inference returns whatever the DS names produce. The DS's own tokens are the design contract; the existing WCAG/APCA badge on the bg+fg pair is the readability signal.

**Consequence:**
- Designers who follow common naming conventions see border + icon lines in the pair box and matching visual treatment in the preview swatch with zero config edits. DSes that don't expose those tokens degrade gracefully to `bg + fg` only.
- The `fl` line and fill swatch treatment only appear when the user explicitly authored `pair.fill` in their config, which is the documented opt-in for that role.
- The previous "Border has a default-border fallback" note refers to the visual swatch outline (still falls back to `_RC.outlineSubtle`), not to the pair-box `bd` line. The `bd` line only appears when something actually resolves.
- Re-enabling fill inference later is a one-line change to add `'fill'` as a target.

---

## [2026-05-09] Semantic Colors showcase table adopts Option A layout, bound to DS tokens

**Decision:** The semantic-colors table inside `_buildShowcase` Colors section is being redesigned to match Option A from the Claude Design handoff `kxkMQhWCvpr-62R4Tm72Yw` (file `Semantic Colors Riffs.html`, component `Option A.jsx`). Per row: a left **pair box** stacks one line per role (bg, fg, plus bd / ic / fill when present) where each line is `swatch dot + 2-letter role tag + full token name`; a middle **preview swatch** renders the bg color, applies the border token as an outline if defined, renders the icon token as a glyph if defined, and overlays the Lc + ratio diagnostics inside the swatch in the fg color; a right **WCAG pill**. Groups (Brand, Danger, etc.) get a header row with a small dot + label + count. Option A is the only riff that was iterated in the source chat (extras + toolbar removal) and the only one that surfaces every role of a multi-token pair plus its grouping in one row.

**Why:** The current `_buildSemColorRow` shows a single diagnostic swatch and treats the row as `bg + text` only. Designers cannot see the rest of the role kit (border, icon, fill) for a semantic family in the same row, and the relationship between roles is implicit. Option A keeps every role visible and shows them composed on the actual surface so the kit reads as a whole.

**Consequence:**
- Visual styling stays bound to existing showcase variables (`_V.*` / `_RC.*` resolved via `_findVar`): the pair-box text, role tags, swatch border, group header, WCAG pill, and Lc/ratio overlay must use the showcase's `_textColor`/`_subColor`/`_bgColor`/`_RC.surfaceDefault`/`_RC.outlineSubtle` palette and their `_V.*` variable refs. Do **not** copy the Option A.jsx hex values (`#fafaf7`, `#c5e866`, `#dcdcd6`, etc.) into the Figma node tree — those exist in the prototype only because it has no design system to reach for. The riff is a layout reference, not a color reference.
- The pair shape extends to carry optional roles. `DS.color.semantics.pairs[*]` gains optional `border`, `icon`, and `fill` keys alongside the existing `{ bg, text }`. When a key is missing, the row omits that line in the pair box and the corresponding visual treatment in the preview swatch. Examples: a default surface row may have an icon and border but no fill; a toast `bg/danger + text/danger` may have a border but no icon. Border falls back to a default border token if absent on a pair that needs an outline; icon and fill have no fallback and are simply omitted.
- Only the semantic-colors table render is in scope: `_buildSemColorRow` (`code.js:2616`) and the surrounding semantic table assembly (`code.js:3212–3244` for the config-pairs path, plus the group header / heading row construction that feeds into `_semTable`). Outline rows, surface/icon/fill bottom tables, primitive ramps, typography, spacing, elevation, and the Colors section frame stay untouched.
- Config preparation (`prepare_ds_config` and the pair generation it calls) learns to populate the optional role keys when the source DS has those tokens. Reuse the existing pair generation and append missing keys; do not refactor the surrounding pair-resolution logic.

---

## [2026-05-09] APCA uses the published 0.0.98G low-output offset

**Decision:** Figlets' APCA implementation uses the published APCA 0.0.98G low-output offset `0.027`, represented as `2.7` after the score is scaled by 100. The old `12.5` scaled offset was removed from the core validator, ramp analysis, and bridge showcase renderer. WCAG contrast math remains unchanged and is pinned to the WCAG 2.2 relative-luminance formula.

**Why:** A Figma accessibility plugin reported `Lc 102` for `#FFFFFF` on `#38312e`, while the Figlets showcase reported `Lc 92`. The difference came from Figlets subtracting/adding `12.5` instead of the APCA 0.0.98G `2.7` scaled offset. The decision log and memory already stated the intended formula was APCA 0.0.98G; no prior product rationale justified the larger offset.

**Consequence:** APCA values rise by about 10 Lc for many non-low-contrast pairs and now match reference APCA tools for the screenshot case. Existing APCA pass/fail gates may clear some previously reported failures; this is expected correction, not a threshold relaxation. Tests now pin `#FFFFFF` on `#38312e` to `Lc 102`, black on white to `Lc 106`, and WCAG `#777777` on white to the unrounded AA-boundary behavior.

---

## [2026-05-09] Bridge plugin UI is rebuilt against FigWords reference, not the prior approximation

**Decision:** The bridge plugin UI now follows the FigWords Figma reference (`98:40172`) with three explicit layouts: Collapsed (296×348, left column only), Expanded (576×348, left column + right log box), Expanded+QA (576×348, log box shrinks to 148px tall and a QA Scope summary box appears beneath it). Visual tokens come directly from the FigWords variables: bg `#121212`, brand `#c9fb8c`, text-brand `#e7ffcd`, text-warning `#ffe5ad`, border-brand `#5d8227`, border-subtle `#212121`, with Sora loaded from Google Fonts in weights 400 and 500. The QA report rendered inline under the QA buttons in the previous attempt has been moved into the right column; running QA auto-expands the log so the summary is visible in its intended location.

**Why:** The earlier UI was built from sparse Figma metadata before screenshots were available and missed the actual layout, color tokens, and information architecture. The user explicitly flagged the result as unsatisfactory and provided the FigWords frame for parity work.

**Consequence:** Designers see one coherent dark/lime panel that matches the reference instead of an approximation. The QA summary table is the primary surface for local QA results; the log remains an event trail. Tests that previously locked the old hex values (`#111111`, `#c5ff73`, `#dcffc0`, `#639d13`, `border-radius: 18px`) were updated to assert the FigWords tokens. Sora is loaded from Google Fonts at runtime; offline use silently falls back to Inter without breaking the plugin.

---

## [2026-05-09] Plugin uses native `title` tooltips, not a custom floating element

**Decision:** Removed the custom `#ui-tooltip` floating element and its `_showTooltip`/`_hideTooltip`/`mouseover`/`focusin` handlers. Documentability spans, the QA buttons (`Check`, `Bind Safe`), and the `Show Log` toggle all use the browser's native `title` attribute. The QA buttons gained explanatory tooltips that describe what each action does and what to expect (read-only scan vs. high-confidence binding).

**Why:** The custom floating tooltip overlapped the native browser tooltip in some cases, producing a duplicated tooltip. The user preferred a single tooltip and accepted that the system tooltip is sufficient.

**Consequence:** Less UI code, no manual positioning logic, and no overlap. The tradeoff is that the system tooltip's appearance is OS-controlled and slightly less stylable, which is acceptable in a plugin context.

---

## [2026-05-09] Plugin expand/collapse animates content only; host resize is a hard snap

**Decision:** `_setLogOpen` coordinates the host window resize and the inner content transition so the user sees a smooth fade/slide on the log column even though `figma.ui.resize` is synchronous. Expanding posts the resize message first and starts the CSS transition on the next frame; collapsing reverses the order — fade out first, then resize after 160ms. The log column stays mounted in the DOM at all times so the CSS transition can play during collapse.

**Why:** Figma plugin UIs cannot animate the host window edge — `figma.ui.resize` is host-controlled and instant. The user asked for a smooth transition; animating the inner content around the snap masks most of the abruptness without misleading the user about what's actually happening.

**Consequence:** The window edge still snaps, but content motion (160ms ease, opacity + 12px translateX) makes the transition feel intentional. If a future Figma plugin API allows animated resizes, this can be simplified.

---

## [2026-05-09] Generated variables use Figma picker scopes

**Decision:** `apply_ds_setup` assigns `variable.scopes` based on token intent and repairs scopes on existing collections when setup is rerun. Primitives are intentionally hidden from variable pickers with an empty scope list; semantic variables remain designer-facing and scoped by purpose. `update_ds_primitives` preserves that split when it creates or refreshes variables. Examples: `space/radius/*` in the semantic Spacing collection only appears for corner radius, `space/border/*` for stroke width, typography variables for matching type fields, text/icon colors for text fill, outline colors for stroke color, surface/background colors for fills, and shadow/elevation variables for effects.

**Why:** Variable collections are large enough that showing every variable in every compatible Figma picker adds noise for designers. Figma scopes are explicitly a UI picker filter and do not prevent the plugin API from binding a variable elsewhere when Figlets has a deliberate semantic reason.

**Consequence:** Designers get cleaner pickers without changing token names, values, IDs, aliases, or Figlets' variable-first binding policy. Raw primitives remain available to Figlets and to aliases through the plugin API, but they stop competing with semantic choices in normal Figma UI. Existing files can be repaired by reloading the bridge plugin and rerunning `apply_ds_setup`; collections are not recreated.

---

## [2026-05-08] DESIGN.md is an intake/export bridge, not the source of truth

**Decision:** Figlets supports Google-style `DESIGN.md` as a portable interchange layer. `create_ds_config_from_design_md` imports DESIGN.md front matter into a starter `design-system.config.js`, so setup can skip answers the designer already provided. `prepare_ds_config` and `apply_ds_setup` write a `DESIGN.md` export next to the file-scoped config for download/share after setup.

**Why:** DESIGN.md is useful agent context: machine-readable tokens plus human-readable rationale. Figlets, however, has richer Figma-specific semantics: APCA/WCAG validation, mode-aware aliases, semantic pairs, icon thresholds, scrims, elevation styles, and local file isolation. Replacing the prepared config with DESIGN.md would lose product-critical structure.

**Consequence:** The prepared Figlets config and Figma variables remain authoritative. DESIGN.md import is an intake shortcut; DESIGN.md export is a portable artifact for coding agents and downstream tools. External lint/diff commands for DESIGN.md are optional designer-approved steps, not automatic setup gates. The old `needsClaude` field was renamed to `needsDesignerInput` because missing setup details are product/design decisions, not agent-specific work.

---

## [2026-05-07] Showcase semantic colors use prepared pair relationships when available

**Decision:** When `build_ds_showcase` can read the active file-scoped config, it forwards `DS.color.semantics.pairs` to the bridge plugin. The Colors showcase renders the Semantic Colors table directly from those pair relationships instead of rediscovering background/foreground pairings from variable names. Showcase chrome also prefers explicit generic/brand-subtle tokens (`color/text/subtle`, `color/text/muted`, `color/bg/brand-subtle`, `color/text/brand`) before broad role scoring.

**Why:** Role-based names such as `color/bg/default` + `color/text/default` do not follow the older `surface` → `on-surface` naming pattern. Name-rediscovery split clean semantic tokens into unrelated groups (`surface`, `icon`, `fill`) and bound table/tag text to purpose-specific tokens like `color/text/on-brand`, making labels disappear on neutral table rows.

**Consequence:** Generated design-system files get one coherent Semantic Colors table that matches the validated setup config. Zero-config showcase builds can still fall back to structural/name heuristics, but prepared config pairings are authoritative. Exempt muted pairs may still render without the paired-text indicator when below the indicator threshold; whether to lower that threshold is a future product choice, not part of this restoration.

---

## [2026-05-07] Contrast-harmonized OKLCh ramps are opt-in

**Decision:** `DS.color.rampStrategy = "contrast-harmonized"` adds an optional OKLCh ramp generator that treats brand colors as hue/chroma seeds and places the full ramp on a fixed perceptual lightness ladder. Brand colors do not have to be forced into an exact numbered stop; the generated ramp keeps their character while tightening level-to-level APCA consistency across hues. The default remains the existing `"standard"` OKLCh ramp behavior.

**Why:** External palette tools such as Harmonizer point to a useful product principle: palette levels should behave like contrast/lightness contracts, not only interpolated color stops. Figlets should learn from that principle without copying code or making the first OKLCh implementation unstable.

**Consequence:** Designers can opt into contrast-harmonized ramps for more predictable primitive levels while existing configs remain unchanged. The strategy requires `DS.color.algorithm = "oklch"` and is covered by core tests comparing APCA spread across generated utility hues.

---

## [2026-05-07] Showcase swatches expose APCA pass/fail context

**Decision:** Primitive color ramp swatches use a split preview: readable neutral text on the swatch, and the swatch color as text on a readable neutral extreme. Both halves show `✓ Lc NN` or `✗ Lc NN` at the body-text APCA threshold of Lc 75. Semantic pair swatches now show the same APCA label treatment for the actual paired foreground/background relationship; semantic text pairs use Lc 75, icon-like rows use Lc 60.

**Why:** Designers need to understand whether a primitive step can carry text, not only whether the color looks good in isolation. The split treatment makes both common uses visible without forcing a primitive ramp to imply one semantic pairing.

**Consequence:** The swatch treatment is APCA-specific today. A WCAG version should use ratio-based labels such as `✓ AA`, `✓ AAA`, `~ Large`, or `✗ Fail` rather than `Lc`; this is a follow-up task if the project needs WCAG-mode showcase parity.

---

## [2026-05-07] Setup preview is generated before any Figma apply

**Decision:** `prepare_ds_config` now writes a lightweight SVG preview next to the active file-scoped config and returns it as `setupPreview.svgPath`. The preview shows generated ramps and semantic pairs as actual swatches/text samples before `apply_ds_setup` is allowed to touch Figma.

**Why:** Hex-only setup review is too abstract for designers and agents alike. The setup protocol needs a cheap, local, human-readable preview so color scale and semantic decisions can be checked in the conversation before variables are created or updated in Figma.

**Consequence:** The setup flow remains two-phase: prepare, review preview + readiness, then apply only after explicit confirmation. The preview is an aid for discussion, not a replacement for APCA/WCAG gating or the final Figma showcase.

---

## [2026-05-07] Utility `bg/*` tokens are soft backgrounds; strong status colors use `fill/*`

**Decision:** Default generated utility/status semantics distinguish soft background surfaces from strong fills. Role-based naming now emits pairs such as `color/bg/success` + `color/text/success` for soft status surfaces, and `color/fill/success` + `color/text/on-success` for strong filled badges/buttons. Surface-based naming follows the same model with `color/surface/success` and `color/fill/success`.

**Why:** Designers generally expect `bg`/`surface` status tokens to support readable text on quiet UI backgrounds, while saturated status colors are a different purpose: fills for badges, controls, charts, or emphasis. Using mid/strong tones for `bg/*` made generated systems feel opinionated and could fail accessibility for body text.

**Consequence:** Future generated configs provide both intents by default. Agents should not “fix” soft backgrounds into saturated fills unless the designer explicitly asks for high-emphasis status surfaces; use `fill/*` for that purpose instead.

---

## [2026-05-06] Keyless Figma files must not inherit the flat DS config

**Decision:** A sync from a Figma file with no usable `figma.fileKey` records `active-file.json` with `fileKey: null`. Server tools must not read or mutate from the legacy flat `.local/design-system.config.js` for an active Figma file. `build_ds_showcase` only auto-reads `.local/<fileKey>/design-system.config.js`, and `prepare_ds_config`, `apply_ds_setup`, and `update_ds_primitives` refuse the flat config whenever a file-scoped config should be used.

**Why:** New or unsaved Figma files can report an empty file key through the bridge. Falling back to `.local/design-system.config.js` made a fresh file inherit a previous file's DS config, which is exactly the cross-file bleed the per-file isolation work was meant to prevent. Ignoring the empty file key in the receiver is also unsafe because it leaves the previous file's active pointer in place.

**Consequence:** A fresh file must first have a file-scoped key before DS setup/update tools can use a config. The flat `.local/design-system.config.js` remains a legacy artifact only; it is no longer a valid config source for active file workflows.

---

## [2026-05-07] Keyless Figma drafts get a persistent local file identity

**Decision:** When `figma.fileKey` is empty, the bridge plugin creates or reuses a file-local `local_*` identity stored on `figma.root` plugin data under `figletsFileKey`. The UI forwards that value as `fileKey`, so receiver paths still resolve to `.local/<local-id>/` instead of the flat root. When Figma provides a real `figma.fileKey`, that real key wins.

**Why:** Refusing the flat config prevented cross-file bleed, but it left new/unsaved Figma drafts unable to participate in the per-file config workflow. The product requirement is per-file isolation, not "saved-cloud-file only" isolation.

**Consequence:** Fresh drafts and saved files both get isolated local state. Draft identities are local to the file and plugin data; if a future save starts returning a real Figma fileKey, the active path will move to `.local/<real-fileKey>/`, and any wanted draft config can be migrated deliberately.

---

## [2026-05-06] Decorative colors are excluded from binding role fallbacks

**Decision:** `scrim`, `overlay`, `state`, `shadow`, and `elevation` color variables must not participate in text/foreground/background role fallback selection. They may still render in their own showcase sections and remain valid variables, but the shared binding resolver and showcase `_V` palette must exclude them when looking for readable text or structural UI colors.

**Why:** When a file lacks recognized foreground names, a pure luminance fallback can pick black scrim variables as "best text" because they are dark. That makes generated showcase copy bind to overlay tokens, which violates the variable-first binding policy: automatic binding can use semantics and exact scalar matches, but it must not infer text purpose from decorative overlay values.

**Consequence:** Text, foreground, and structural showcase chrome now fall back only among non-decorative color variables. Scrim variables are still documented in the Scrims section and can still be semantic aliases for overlay use cases.

---

## [2026-05-06] Showcase builder restored to pre-migration baseline

**Decision:** The token showcase renderer (`_buildShowcase`) and `build_ds_showcase` payload shape are restored to the Sunday 2026-05-03 pre-17:13 baseline (`eda38ad`). The later color-migration work remains available in setup/update tools, but the showcase should not consume the active DS config, introduce APCA-specific row layouts, split new outline/border groups, or otherwise change grouping/readability while the color migration stabilizes.

**Why:** The requested product operation was narrow: regenerate primitive colors and update semantic color aliases. Coupling that migration to showcase rendering changed the visual output, grouping, and text readability, making the showcase feel broken even when the variable update path was the real target.

**Consequence:** Preserve the product decisions around OKLCh ramps, primitive updates, semantic alias refresh, and per-file isolation, but treat showcase redesign as frozen until it is planned and verified separately. Future color update work must not rewrite showcase presentation as a side effect.

---

## [2026-05-06] QA safe-bind failure count excludes intentionally skipped low-confidence suggestions

**Decision:** `_runQaBindingAudit({ fix: true })` only attempts fixes for high-confidence suggestions. Low/medium/none-confidence suggestions remain report-only and are not counted as failed fixes.

**Why:** The showcase final QA pass reported 31 unresolved gaps even after the relevant Typography/Spacing variables existed. Those were not failed high-confidence bindings; they were intentionally skipped low/medium-confidence suggestions. Counting them as failures made the showcase state look broken and contradicted the safe-bind policy.

**Consequence:** `fixedCount` and `failedCount` now describe attempted safe fixes only. `violationCount` still reports all detected issues for audits, preserving visibility without overstating unresolved generated-showcase gaps.

---

## [2026-05-06] `apply_ds_setup` repairs stale Typography/Spacing collections additively

**Decision:** Typography and Spacing now check for the current DS token names before skipping an existing collection. If an old collection exists but is missing generated names such as `type/{role}/size`, `type/{role}/weight`, `space/{semantic}`, `space/radius/{key}`, or `space/border/{key}`, `apply_ds_setup` enters merge mode and creates only the missing variables. Existing variables and modes are preserved; missing breakpoint modes are added by name.

**Why:** The fresh showcase was left with unresolved QA gaps because old Typography and Spacing collections had variables from a previous naming shape. Deleting those collections manually would restore the showcase but risks breaking unrelated bindings. Additive repair matches the existing merge-populate decision and restores the showcase binding surface without destructive collection surgery.

**Consequence:** Re-running `apply_ds_setup` after the plugin is reloaded can repair stale Typography/Spacing collections in place. If old variables remain, they are intentionally left alone; cleanup can be a separate confirmed maintenance task.

---

## [2026-05-06] `apply_ds_setup` merge-populate: Primitives with existing FLOAT/STRING vars

**Decision:** `getOrCreateCollection` treats a collection as "existed" when it has any variables. For the Primitives collection specifically, after `getOrCreateCollection` returns, the setup block checks for COLOR vars separately (`_primHasColors`). If the collection exists but has zero COLOR vars, the full population block runs in merge mode: `_primMergeMap = await buildVarMap(primColl.id)` is pre-fetched and every `createVariable` call is guarded by `if (_primMergeMap[name]) continue`. Typography and Spacing blocks use the same merge-map pattern if they are entered, plus safe mode-dedup (check existing mode names before calling `addMode`).

**Why:** A user who deletes only the color ramps (leaving spacing/type FLOAT vars in place) would see all three collections skip on the next `apply_ds_setup` run. The COLOR-specific check for Primitives corrects this without overwriting the intact FLOAT/STRING vars.

**Consequence:** If the Primitives collection already has COLOR vars (normal case), nothing changes — it skips as before. The merge guard also prevents crashes when the collection has a partial set of FLOAT/STRING vars with identical names.

---

## [2026-05-06] Per-Figma-file isolation under .local/<fileKey>/

**Decision:** All bridge-written files (`figma-data.json`, `figma-selection.json`) are stored under `.local/<fileKey>/` rather than the flat `.local/` root. `active-file.json` in the root tracks the last-seen fileKey. Tools that auto-detect paths (`build_ds_showcase`, `audit_tokens`) read `active-file.json` and resolve against the active directory. Tools that take an explicit path (`prepare_ds_config`, `update_ds_primitives`) are unaffected — callers pass `.local/<fileKey>/design-system.config.js`.

**Why:** A single `.local/design-system.config.js` was overwritten whenever a different Figma file was synced, corrupting the design system of the previously active file. The fileKey (`figma.fileKey`) is stable, unique per file, and available in the plugin main thread, making it the correct scoping key. fileName is not used because it can change.

**Consequence:** Switching the active file requires running `sync_figma_data` once to update `active-file.json`. Existing `.local/design-system.config.js` must be migrated manually: `cp .local/design-system.config.js .local/<fileKey>/design-system.config.js`. The flat-root legacy paths are kept in `paths.js` for backward compatibility with any external tooling.

---

## [2026-05-05] Swatch indicators gate on configured contrast algorithm; show step number + text badge

**Decision:** `_swatchIndicator` and `_buildSwatch` in `code.js` read `_contrastAlgorithm` (derived from `DS.color.contrastAlgorithm`, forwarded by `build-showcase.js` from the local config, defaulting to `'wcag'`) hoisted to the `_buildShowcase` scope. Indicator gate: APCA → `|Lc| ≥ 60`; WCAG → ratio ≥ 4.5. Step number (e.g. `300`) shown top-left at 8px font, semibold. Badge format: `Lc XX%` (APCA) or `✓` (WCAG), 8px Regular, bottom-right at 12px from both edges. Badge is created inline (not via `_tDS`) with `textAutoResize = 'WIDTH_AND_HEIGHT'` set **before** `characters` so width is computed immediately; then appended, x/y set using computed width, then `constraints: { horizontal: 'MAX', vertical: 'MAX' }` locked in — this order guarantees the correct 12px right offset is stored. Swatch stroke uses `_V.outlineSubtle` only when that variable exists. Outline/border/stroke semantic tokens rendered in a separate "Outlines & Borders" table with a `[Token, Example]` 2-column heading.

**Why:** Earlier attempts used `_tDS` (which sets `characters` before `textAutoResize`), leaving `badge.width = 0` at positioning time — placing the badge 80px from the left with a 0px right offset stored in the constraint, so it flew outside the frame as the container grew. `textAlignHorizontal = 'RIGHT'` + `STRETCH` was tried as an alternative but caused Figma to mirror text on certain swatches (a known Figma RTL-detection edge case). Inline creation with the correct property order resolves both issues.

**Consequence:** WCAG-mode projects see `✓` only (no number) because WCAG ratio depends on the chosen text colour, which varies per swatch. `Lc XX%` treats the Lc score as a 0–100 scale (practical maximum ≈ Lc 106); the `%` suffix makes it scannable without explaining APCA notation to designers.

---

## [2026-05-05] Auto-anchor maps OKLab L linearly to the configured step scale

**Decision:** When `brand.step` is omitted, `brandAnchorIdx` computes `t = (OKLCH_LIGHT_TARGET − L) / (OKLCH_LIGHT_TARGET − OKLCH_DARK_TARGET)` where L is the brand hex's OKLab L, then maps `t` linearly across `steps[0]` → `steps[last]` and snaps to the nearest configured step. Constants used: `OKLCH_LIGHT_TARGET = 0.97`, `OKLCH_DARK_TARGET = 0.18`.

**Why:** A linear map produces results that match designer intuition without any calibration data. Tested against three brand hexes: lime (#88bf2e, L≈0.74 → step 300), teal (#2f6b6b, L≈0.49 → step 600), sand (#8D7971, L≈0.59 → step 500) — all confirmed correct on the 100-900 scale.

**Consequence:** The explicit `step` override is still respected and flagged as `(override)` in the prepare summary. Auto-derived steps are flagged as `(auto)`. A future session could use a non-linear map if the linear result proves poor for very dark or very light hexes, but that would be a tuning change only, not an API change.

---

## [2026-05-05] Status badge unifies APCA and WCAG conventions; WCAG badge column removed

**Decision:** The showcase semantic-colors table was using four contrast columns (APCA Lc number, APCA badge, WCAG ratio, WCAG badge), but the heading only declared two (Contrast, WCAG), causing a layout misalignment. Collapsed to three columns: `APCA Lc` (always numeric), `Status` (algorithm-aware badge driven by `DS.color.contrastAlgorithm`), `WCAG` (always numeric ratio). The fourth WCAG badge column was dropped.

**APCA thresholds for Status badge:** Lc ≥ 75 → `✓ Lc 75` (green); Lc ≥ 60 → `✓ Lc 60` (warning); else → `✗ Fail`.
**WCAG thresholds for Status badge:** ≥ 7 → `✓ AAA`; ≥ 4.5 → `✓ AA`; ≥ 3 → `~ Large`; else → `✗ Fail`.

**Why:** Designers reading the showcase couldn't tell which algorithm's verdict to trust. The mixed "Lc 60" / "✓ AA" labels on the same row implied both applied. Collapsing to a single `Status` column keyed to the project's declared algorithm removes ambiguity while keeping both raw numbers visible for reference.

---

## [2026-05-05] `prune_unused_ramps` scopes strictly to `color/<name>/<digits>` shape

**Decision:** `pruneUnusedRamps` deletes Primitives variables matching `color/<name>/<digits>` (exactly 3 path segments, numeric leaf) where `color/<name>` is not in `DS.color.ramps`. It does not touch `color/scrim/*`, `color/neutral-variant/*` when not in ramps, or any variable with a non-numeric leaf or more than 3 segments.

**Why:** A broader pattern (e.g., deleting any `color/<name>/*`) would silently remove hand-crafted scrim or elevation helpers. The 3-segment + numeric-leaf shape is unique to ramp step variables and is safe to delete by formula.

**Consequence:** Non-ramp `color/` variables (scrims, shadows, any flat `color/<name>`) are never pruned. If a ramp is not configured but its folder remains in Figma, only the numeric-step children are deleted — the folder itself would become empty and can be cleaned up manually.

---

## [2026-05-05] Brand entries declare their step in the ramp

**Decision:** Each entry in `DS.color.brand[]` may carry an optional `step` field that names which step of the configured scale the brand hex anchors at. When absent, the next session will auto-derive the step from the brand's OKLab L (mapped against `OKLCH_LIGHT_TARGET = 0.97` at the lightest step and `OKLCH_DARK_TARGET = 0.18` at the darkest). Until auto-derivation lands, omitted `step` defaults to the scale midpoint for backward compatibility.

**Why:**
- A vivid mid-light brand hex (e.g. lime `#88bf2e`, L ≈ 0.755) anchored at /500 produces an over-saturated middle and weak tints. Designers recognized this immediately from the screenshot and asked why the system ignored the natural step.
- A deep brand (e.g. teal `#2f6b6b`, L ≈ 0.451) anchored at /500 forces /600–/900 to crash to near-black. The intent is `/700`, not `/500`.
- Industry-standard libraries (Tailwind, Material) place brand hexes at the steps they natively belong to. Forcing `/500` betrays designer intuition.

**Consequence:** Brand step is no longer implicit. Configs that omit `step` continue to work; new ramp introspection (showcase header, prepare summary) should display the resolved anchor. The API contract (`step: number`) is fixed and will not change when auto-derivation lands.

---

## [2026-05-05] Primitive pruning is scope-bound to configured ramps

**Decision:** `update_ds_primitives` ships with `prune_off_scale: true` to delete primitives whose step is outside the configured scale, but **only within the folders enumerated in `DS.color.ramps`**. The plugin never deletes variables in unmanaged folders.

**Why:**
- Hand-crafted ramps from prior sessions (lime, teal at 50–950) collided with the new 100–900 pipeline scale and left orphan `/50` and `/950` entries. A blanket delete-by-shape rule would also delete user-added primitives that happen to match a numeric-step shape.
- Scoping to `DS.color.ramps` keeps the operation predictable: if it isn't in the config, it isn't touched.

**Consequence:** Removing an entire ramp (e.g., dropping peach from `brand[]`) is **not** covered by `prune_off_scale`. A separate operation — currently manual — is required to delete a removed ramp's full primitive set. The next session is expected to introduce a `rebrand` flow that handles ramp removal, semantic re-pointing, and primitive deletion as one confirmed operation.

---

## [2026-05-05] Showcase scopes to the named semantic collection when config is present

**Decision:** When `.local/design-system.config.js` exists at showcase build time, `build_ds_showcase` reads `DS.collections` and forwards it to the plugin. The plugin filters `_semanticColls` and `_primColls` by exact collection name. The existing structural heuristic (`isAlias && colorVarCount > 0`) remains as a fallback when no config is available.

**Why:**
- The structural heuristic mistakenly included `Button · Type` (3 alias color vars × 4 component-state modes) and rendered `button/bg`, `button/fg`, `button/stroke` in the semantic-color table. Designers experienced this as "the showcase is randomly binding component variables."
- A name-based filter matches the designer's mental model: the collection declared in `DS.collections.color` is the authoritative semantic source.
- Falling back to the heuristic preserves zero-config use of the showcase tool against arbitrary Figma files.

**Consequence:** Future component-state collections will not pollute the showcase as long as the config declares the semantic collection name. The build_ds_showcase payload schema gained an optional `DS` field carrying `{ collections }`. Other showcase consumers can rely on the same precedence: explicit DS config wins, heuristic fills in.

---

## [2026-05-03] OKLCh neutrals are achromatic, not brand-tinted

**Decision:** The default OKLCh `neutral` ramp uses zero chroma across the scale. A separate `neutral-variant` ramp provides a very low-chroma palette tint for secondary surfaces and subtle outlines. HSL fallback preserves the old hue-derived neutral behavior for compatibility.

**Why:**
- A "neutral" primitive should remain visually neutral across projects. Deriving its hue from the primary color can turn grays green, red, or blue depending on the brand.
- OKLCh already gives us perceptual lightness control, so the neutral ramp can be built directly as C=0 without losing tonal quality.
- Designers still benefit from quiet palette character in panels and container backgrounds. That belongs in an explicit variant ramp with a tight chroma cap, not in every neutral.

**Consequence:** Regenerating configs with the OKLCh default changes `color/neutral/*` values to true grays and adds `color/neutral-variant/*` unless `DS.color.neutralVariant` is disabled. Semantic surface variants and subtle outlines may use `neutral-variant`; text and contrast-critical defaults stay on `neutral`. Existing live Figma files that predate the new ramp can add those variables with `update_ds_primitives` and `create_missing: true`; existing variable IDs are preserved.

---

## [2026-05-03] Plugin QA buttons expose only safe automatic binding

**Decision:** The bridge UI includes local QA actions: "Check" for report-only audit and "Bind Safe" for applying high-confidence fixes. The buttons use the same `_runQaBindingAudit` logic as the MCP tool and render the result in the plugin UI. `Bind Safe` intentionally keeps the existing rule that only high-confidence suggestions are applied.

**Why:**
- Designer-facing buttons need to do something useful without requiring an agent round-trip.
- Exact scalar matches for spacing, radius, border width, and strongly resolved typography bindings are safe to apply by deterministic logic.
- Color role guesses from layer names are useful as suggestions but are not safe enough to auto-bind broadly. Same visual color can mean different semantic roles, so hex/nearest-color auto-binding remains forbidden.

**Consequence:** The plugin can provide a one-click cleanup for safe bindings and an immediate QA report. Making color binding feel magical requires a future high-confidence color policy (for example explicit role annotations or component anatomy metadata), not a broad value-match shortcut.

---

## [2026-05-03] Primitive updates may create missing variables additively

**Decision:** `update_ds_primitives` accepts `create_missing: true` to add missing primitive variables inside an existing Primitives collection before setting their values.

**Why:**
- New generated ramps such as `color/neutral-variant/*` are additive migrations. They do not require deleting or recreating existing variables.
- Reporting missing variables is still the safe default, but forcing a full rebuild for a new primitive ramp is too heavy and risks alias churn.

**Consequence:** Existing variables are still updated in place and keep their IDs. Missing variables are created only when the caller opts in, so tools can distinguish "value update only" from "additive primitive migration."

---

## [2026-05-03] Bridge capabilities fail fast for stale plugin UIs

**Decision:** The bridge UI advertises supported command capabilities on every `/poll`, and receiver `/health` reports whether primitive updates are live. `update_ds_primitives` now returns a 409 reload-required error immediately when the connected plugin does not advertise `update-primitives`.

**Why:**
- Figma plugin UI/code changes require closing and reopening the plugin window, and the old flow discovered stale code only after a 60-second timeout.
- Fast, explicit capability checks make local live testing less painful and make `figlets-mcp doctor` useful before triggering state-changing operations.
- This keeps the receiver protocol deterministic without trying to hot-reload Figma plugin code, which the Figma sandbox does not support.

**Consequence:** A running receiver plus connected plugin is no longer treated as enough for every tool. Live workflows can check "Primitive updates: available" in doctor; otherwise the user needs one plugin reload before calling `update_ds_primitives`.

---

## [2026-05-02] In-place primitive updates via `update_ds_primitives` (category-pluggable)

**Decision:** When primitive values change but the rest of the design system has not, the agent uses `update_ds_primitives` instead of deleting and rebuilding collections. The bridge plugin walks the existing Primitives collection and overwrites `valuesByMode` on variables matching DS-derived names; variable IDs stay intact, so all aliases from Color/Typography/Spacing/Elevation collections continue to resolve. Categories supported on day one: `color`, `spacing`. The plugin's `UPDATE_PRIMITIVE_SPECS` map is the single registry — adding a new category later (e.g. `shadow` once shadow values become DS-driven) is one entry yielding `{ name, type, value }` rows from the DS config.

**Why:**
- `apply_ds_setup` skips collections that already exist, so a re-run after tweaking the config is a no-op.
- The destructive alternative (delete and rebuild) breaks every alias from semantic collections into Primitives until those are also rebuilt, losing manual edits along the way.
- Most config tweaks (algorithm switch, brand color change, scale tweak, future shadow tuning) only change *values* of *existing* variables. Updating in place is the surgical match for that intent.
- A category-pluggable design keeps the agent's surface area stable: new primitive categories don't require new tools or new prompts, only one new spec entry.

**Consequence:** Adapters route "I changed X, push it to Figma" intents to `update_ds_primitives` with a `categories` filter rather than `apply_ds_setup`. Variables present in the config but missing from Figma are reported as `unmatched` and trigger an explicit decision (fresh setup vs. drop). Future primitive sources (shadows, type tracking presets, etc.) extend `UPDATE_PRIMITIVE_SPECS`; do not introduce parallel update tools.

---

## [2026-05-02] Color ramp algorithm is OKLCh by default, HSL is opt-in fallback

**Decision:** `generateColorRamps` now dispatches on `DS.color.algorithm` (`"oklch"` default, `"hsl"` selectable). OKLCh interpolates lightness in a perceptually uniform space and holds chroma high through tints/shades; HSL is preserved unchanged for parity and for users who depend on the old output.

**Why:**
- HSL ramps crushed saturation by up to 85% on the light side and pinned hue, which produced washed-out tints regardless of brand color.
- OKLCh lightness is perceptually uniform (a yellow at L=0.7 reads as bright as a blue at L=0.7), so chroma can stay high without violating the lightness curve. This is what gives Tailwind v4 / Radix / Carbon their vivid output.
- Switching algorithms via config keeps the change opt-outable without forking the pipeline.

**Consequence:** Existing configs without `DS.color.algorithm` will regenerate ramps as OKLCh on the next `prepare_ds_config`. Stored hex values change; semantic-pair WCAG validation downstream is algorithm-agnostic and continues to work. Designers who want the old palette can set `DS.color.algorithm: "hsl"`. Future per-brand or per-step chroma overrides should extend the same dispatcher rather than reintroducing parallel ramp pipelines.

---

## [2026-05-02] Designer-facing agents guide workflows but do not own product logic

**Decision:** Public designer-facing agents should translate plain designer intent into the right MCP workflow, but they must not implement or modify design-system logic in prompts. The bridge plugin, MCP tools, and shared core own detection, binding, rendering, QA, setup, and documentation output. Agents handle guidance, readiness checks, human-readable summaries, and supported tool options only.

**Why:**
- Figlets is meant to feel like a helper in a designer's hand: the designer should be able to say "build a showcase of my design system" without knowing about receiver ports, snapshots, or tool sequencing.
- Keeping logic out of the agent preserves deterministic output across Claude, Codex, and future MCP hosts.
- The product needs one tested binding/rendering authority. Agent-side script edits or ad hoc output changes would reintroduce drift, token-heavy behavior, and inconsistent design-system decisions.
- Developer/debug workflows still matter, but they should be explicitly separate from the public designer workflow.

**Consequence:** Adapter docs should route intents such as showcase, QA, setup, inspect, and document into existing tools using designer-friendly language. Agents may choose supported parameters, summarize or omit irrelevant returned sections, and ask for designer confirmation when needed. If a designer asks for behavior the tool does not support, the agent should report it as an unsupported product request rather than patching this package or changing plugin scripts during the workflow.

## [2026-05-02] Binding policy: variables first, typography styles as the exception

**Decision:** Design-system binding is variable-first for colors, spacing, radii, borders, and other scalar layer properties. Figma color/effect styles are fallback metadata, not the primary color binding target. Typography is the explicit exception: text styles may be preferred because a text style can package a coherent type decision while its underlying size, line-height, weight, tracking, and family values may themselves be variable-backed.

**Why:**
- Color semantics live in variables. A paint style and a color variable can represent the same visual color, but only the variable encodes the cross-mode, semantic token contract that downstream component generation should depend on.
- Hex matching remains forbidden for automatic color binding. Same-value colors can have different semantic roles; binding must follow variable path semantics and purpose locks.
- Text styles are different from color styles: typography styles can serve as a deliberate bundle of multiple variable-backed decisions, making them appropriate as the first typography binding target.
- This policy must be shared across setup, showcase, documentation, QA, and future component creation. Live Figma flows should use `_createDsBindingContext()` as the bridge-side resolver; server-side indexes such as `colorVarByHex` are reporting aids, not automatic binding authorities.

**Consequence:** QA must not treat `fillStyleId` or `strokeStyleId` as automatically satisfying color binding when a semantic color variable should exist. `fix: true` may only apply high-confidence variable/style suggestions; medium-confidence color role guesses stay report-only unless a human confirms them. Future component builders should call the shared resolver for variable selection instead of introducing new local hex, nearest-color, or broad value matchers.

---

## [2026-04-30] Brand and accent are separate semantic color families

**Decision:** The color semantic scorer must not treat `accent` as a synonym for `brand`. `accent` now contributes an `ACCENT` category, while `brand` and `primary` contribute `BRAND`.

**Why:**
- `color/surface/accent` and `color/surface/brand` are different design-system intents even if both are colorful surfaces.
- Treating `accent` as `BRAND` made those paths tie for `surfaceBrand`; the tiebreaker then picked whichever color had a stronger saturation/luminance score.
- In the spacing showcase, that caused visual spacing blocks to bind to `color/surface/accent` even when `color/surface/brand` existed.

**Consequence:** Brand slots prefer brand/primary tokens. Accent can still be used as a fallback when a DS has no brand token, but it no longer beats an explicit brand token.

---

## [2026-04-30] Inset spacing needs its own visual representation

**Decision:** Spacing showcase groups named `inset`, `padding`, `pad`, or `internal-space` render with a dedicated inset visual: an outer box with an inner block offset by the token value.

**Why:**
- The old showcase code had an `inset` visual builder, but group classification never routed inset groups to it.
- Inset tokens communicate internal padding, not object size. Rendering them as a plain square made them indistinguishable from spacing scale tokens.

**Consequence:** Inset tokens now show their intended concept visually while still using the true token value in labels. The drawn padding is capped for readability so large inset values do not overwhelm the fixed preview cell.

---

## [2026-04-30] Showcase output must self-bind DS chrome before QA

**Decision:** `build_ds_showcase` runs a final binding pass over every generated showcase section. The pass binds auto-layout spacing, padding, radii, stroke weights, and text styles to matching design-system variables/styles after the visual structure has been built.

**Why:**
- QA should not report raw values for generated showcase chrome when the file already has matching DS tokens.
- Binding at the end keeps the existing output structure intact and avoids hand-maintaining one-off bindings in every row helper.
- Numeric binding is exact-value and purpose-aware (`spacing`, `radius`, `border`, `typography`); it does not bind arbitrary nearest values.
- Text nodes choose the closest DS text style by size, weight, and usage role so designers see text styles instead of raw typography.

**Consequence:** A showcase generated in a DS-rich file should have far fewer QA gaps, and ideally none for properties covered by available tokens/styles. A few arbitrary chrome values were normalized to existing token values so the generated output can be semantically bound instead of carrying private raw numbers.

**Update:** Figma clears `textStyleId` when font size/name overrides are restored after applying a text style. Showcase typography therefore uses real DS text styles instead of style-plus-raw-overrides; content and hierarchy remain stable, while exact text metrics may follow the DS style.

---

## [2026-04-29] Cache the last non-empty Figma selection in the plugin main thread

**Decision:** `packages/figma-bridge-plugin/code.js` now records selection snapshots on `selectionchange` and `currentpagechange`, and `extract-selection` may fall back to the last non-empty snapshot from the same page when the live `figma.currentPage.selection` is unexpectedly empty.

**Why:**
- The current regression is not a timeout anymore; the plugin responds quickly but sometimes sees `figma.currentPage.selection` as `[]` at command time.
- The failure is most likely transient runtime state around plugin/UI focus rather than a real lack of user selection. If we only sample once at message time, the agent loses the selection entirely.
- Caching in the main plugin thread is cheap, deterministic, and gives us better diagnostics in the Figma console without changing the MCP contract.
- Restricting fallback to the same page and a recent snapshot keeps the recovery path narrow and reduces the risk of inspecting a stale selection from unrelated work.

**Consequence:** `inspect_component` is more resilient to transient empty reads, and the Figma plugin console now exposes enough state (`live`, `lastNonEmpty`, `usedFallback`) to confirm whether the bug is focus-related or a deeper Figma regression.

---

## [2026-04-29] Guard component property reads by node type during selection serialization

**Decision:** `serializeNode()` in `packages/figma-bridge-plugin/code.js` must only read `componentPropertyDefinitions` from `COMPONENT_SET` nodes and standalone `COMPONENT` nodes. Variant children inside a component set must not be queried for property definitions.

**Why:**
- Figma throws `Can only get component property definitions of a component set or non-variant component` when that field is accessed on a variant child.
- This exception made `inspect_component` look like an empty-selection bug even when the selected component set was present and cached correctly.
- The plugin needs to serialize nested variant children safely, so the serializer must follow Figma's node-type contract instead of relying on `'componentPropertyDefinitions' in node`.

**Consequence:** Selection extraction no longer aborts while walking variant children. The debug logs now reflect the true selection state, and `inspect_component` can proceed to structural analysis.

---

## [2026-04-29] Surface current selection and session activity directly in the plugin UI

**Decision:** The bridge plugin UI should display two live, session-scoped panels under the status area: (1) current selection summary, and (2) chronological session log. The log remains in memory only and is not persisted to disk or posted anywhere.

**Why:**
- The plugin is long-lived and agent-driven, so users need immediate visibility into what the bridge thinks is selected and what command just ran.
- Console-only debugging is too hidden for normal use; basic operational state should be visible in the plugin itself.
- Keeping the log session-local avoids creating noisy artifacts or new storage rules while still making the plugin much easier to debug.

**Consequence:** `code.js` now pushes `selection-state`, session log history, and incremental log entries into the UI, and `ui.html` renders a larger dashboard-style panel with live selection and execution history.

---

## [2026-04-29] Generate component docs from the current selection by default

**Decision:** `generate_component_doc` should resolve the live Figma selection first and use the selected `COMPONENT` or `COMPONENT_SET` as the document target. When the selection is valid, the bridge should pass `componentId` and the plugin should match by exact node ID before considering name-based lookup.

**Why:**
- Users reasonably expect the currently selected component to be the source of truth.
- Name-based lookup can document the wrong component when stale args are reused or when similar names exist on the page.
- Exact ID matching is deterministic and aligns with how `inspect_component` already works.

**Consequence:** The doc flow is now selection-driven by default, while `component_name` remains as a fallback for cases where nothing is selected.

---

## [2026-04-29] Fail doc generation when agent-authored human content is missing

**Decision:** `generate_component_doc` must not fall back to placeholder copy for `description`, `usage_do`, or `usage_dont`. Both the server tool and the plugin doc builder now reject requests that do not include a real description plus at least two Do and two Don't rules.

**Why:**
- The architecture split is intentional: the plugin renders structure and token data, while the agent supplies human-readable guidance.
- Silent fallbacks hide orchestration failures and produce bad docs that look superficially complete.
- A loud error is easier to notice, easier to debug, and preserves the quality bar for spec sheets.

**Consequence:** Agents must inspect first and provide tailored guidance before calling `generate_component_doc`. Missing human-authored sections now block generation instead of producing generic filler.

---

## [2026-04-29] Track the active plugin session end-to-end through the bridge

**Decision:** The Figlets Bridge UI exposes a visible per-session ID, and the bridge protocol now carries that ID through `/poll` and `/sync*` requests. The receiver tracks the current polling session and includes `activeSessionId` in not-connected responses.

**Why:**
- During debugging, the plugin UI could appear active while the receiver still reported `plugin is not connected`, making it hard to know whether we were looking at the real bridge instance or a stale/parallel UI.
- A visible session token lets the user and agent refer to the same concrete runtime instead of inferring from appearance or timestamps.
- Receiver-level awareness closes the loop: we can now compare “what the plugin UI says” with “what the server thinks is connected.”

**Consequence:** Bridge debugging is now session-aware instead of guess-based. A reconnect can be verified concretely, as happened when the receiver reported the same active session ID the plugin UI showed: `figlets-mok7r7lf-gzrll`.

---

## [2026-04-29] Omit empty spec-sheet sections; treat anatomy as meaningful internal structure, not merely root existence

**Decision:** `generate_component_doc` skips any section that has no meaningful data, in both the rendered Figma sheet and the returned markdown. For anatomy specifically, the section renders only when the default variant has meaningful internal non-instance parts; a bare primitive/reference component does not get a placeholder anatomy block.

**Why:**
- Empty sections create noise and suggest missing content rather than useful structure.
- The earlier anatomy logic defined anatomy as descendant structure, not “the root component exists,” but still rendered an empty wrapper and legend when no descendants qualified. That produced a visually broken result for primitive examples like `Spacing Visual`.
- A one-row anatomy that simply repeats the root component name is technically true but usually low-value for token visuals and primitive references.

**Consequence:** Primitive/reference components can legitimately omit anatomy, while composed UI components still render full anatomy when they have meaningful named parts. The same omission rule now applies across other data-driven sections as well.

---

## [2026-04-28] Port `/fig-document` next; defer `/fig-create`; extend `audit_tokens` with auto-fix after

**Decision:** With `/fig-setup` and `/fig-ds-showcase` already migrated, prioritize porting `/fig-document` as `generate_component_doc` before either `/fig-qa` auto-fix or `/fig-create`. Decompose `/fig-create` later, only after at least one adapter is scaffolded.

**Why:**
- `/fig-document` is the smallest remaining surface: 4 scripts (`find-component.js`, `doc-runner.js`, `write-spec.js`, `update-description.js`), all already organized as deterministic plugin-side rendering. Architecture is identical to the proven `build_ds_showcase` pattern (one MCP tool → plugin renders everything → result returned).
- The tool's MCP fit is excellent: clean inputs (component name, optional variant-purpose map, optional do/don't rules), tool returns the markdown body so the agent writes the file via the Write tool. No conversational intake required, so it lives cleanly in core/MCP rather than an adapter.
- `/fig-qa` auto-fix is small and useful but secondary — `audit_tokens` already covers detection. Closing the loop with `fix_token_violations` after fig-document keeps each port self-contained.
- `/fig-create` is the largest skill (8 scripts) and is heavily conversational ("ask: build states? variants? sub-components?"). Trying to one-shot it as a single MCP tool fights the agent-agnostic boundary. It should be sliced into discrete deterministic tools (`audit_token_gaps`, `plan_component_from_frame`, `build_component`, `post_build_audit`) with the orchestration living in an adapter — which currently doesn't exist.

**Consequence:** Migration sequence is now: `generate_component_doc` → `fix_token_violations` (extend `audit_tokens`) → adapter scaffold → decomposed `fig-create` tools. The "ported skills" set after step 1 will cover setup, showcase, and documentation — three of the five original skills, all deterministic.

---

## [2026-04-28] Add bridge + core integration tests covering the full poll/sync round-trip

**Decision:** New `tests/integration/` directory with two end-to-end tests: `sync-detect-flow.test.js` (sync_figma_data → detect_design_system) and `inspect-component-flow.test.js` (inspect_component). Each test starts the real receiver on a random port, simulates the Figma plugin via raw HTTP (long-poll → command response → POST sync data), and runs the actual MCP tool handlers.

**Why:**
- Existing tests covered each layer in isolation (receiver, mocked MCP client, core analysis) but never the full `tool → receiver → plugin → receiver → tool` chain. A protocol change in any layer could pass all unit tests while breaking the bridge.
- Simulating the plugin with a plain HTTP client is enough to validate the protocol — we don't need real Figma. The plugin contract is: poll, receive a command, post the result. Anything beyond that is rendering, which is tested by the unit tests on core analysis.
- Required fixing one inconsistency: `inspect-component.js` was the only tool still hardcoding `localhost:1337` instead of reading `FIGLETS_RECEIVER_URL`. Standardised to env-driven URLs across all tools.

**Consequence:** Future protocol or endpoint changes (e.g. for `generate_component_doc`) will fail loudly in CI, not silently in production. Each new bridge-backed tool should ship with a matching integration test.

---

## [2026-04-21] Create a new repo instead of expanding the existing figlets repo

**Decision:** Start a separate repository for the MCP-first, agent-agnostic architecture instead of continuing to expand the current Claude-oriented `figlets` repository.

**Why:**
- The long-term center of gravity is shared logic and MCP tools, not a single-agent plugin surface.
- Keeping the current repo focused avoids mixing Claude-specific packaging with cross-agent abstractions.
- A new repo makes it easier to design around the correct boundaries from the start: core logic, MCP transport, and thin agent adapters.

**Consequence:** The existing `figlets` repo stays usable as the current Claude-facing product while this new repo becomes the shared architecture for Codex, Claude, and future agents.

---

## [2026-04-21] Keep the figlets name and use `figlets-mcp` for the new repo

**Decision:** Preserve the `figlets` brand and use `figlets-mcp` as the working name for the new repository.

**Why:**
- The name already has meaning and momentum.
- The suffix makes the repo’s role clear without discarding the brand.
- It leaves room for a future shape like `figlets-core`, `figlets-claude`, or a renamed umbrella if needed.

**Consequence:** This repo is branded as the next step of figlets rather than a completely separate product.

---

## [2026-04-21] Put deterministic logic in MCP and keep adapters thin

**Decision:** Use an MCP-first architecture where deterministic Figma logic lives in shared core and MCP tools, while agent-specific prompting stays in lightweight adapters.

**Why:**
- Reduces token usage by avoiding repeated prompt-side logic.
- Increases consistency across runs and across agents.
- Makes the project easier to test and easier to open source.
- Preserves model reasoning for ambiguity, tradeoffs, and orchestration rather than routine processing.

**Consequence:** Early implementation should focus on tool contracts and reusable analysis modules instead of agent-specific prompts.

---

## [2026-04-21] Document project memory inside the repo from day one

**Decision:** Keep durable project memory inside the repository, not only in chat history.

**Why:**
- The project will likely involve long sessions and iterative design changes.
- Repo-local memory survives context window loss and makes onboarding future contributors easier.
- Decisions become reviewable artifacts instead of implicit history.

**Consequence:** Maintain both `DECISIONS.md` for stable architectural decisions and `memory/PROJECT_MEMORY.md` for active context, session notes, and next steps.

---

## [2026-04-21] Port detection logic as plain shared analysis over a Figma-like data shape

**Decision:** Re-express design system detection as plain shared JavaScript over a normalized Figma-like input shape instead of copying Claude-era `use_figma` scripts directly into the new repo.

**Why:**
- The reusable asset is the detection logic, not the old runtime wrapper.
- A plain data contract is easier to test, easier to expose through MCP, and easier to feed from different agent runtimes.
- This keeps the future live bridge thin: fetch Figma data once, then hand it to shared analysis.

**Consequence:** The first MCP tool can already analyze `figmaData` payloads locally, even before live Figma execution is wired in.

---

## [2026-04-21] Introduce a thin bridge layer before building a real Figma transport

**Decision:** Add a bridge seam in the MCP server now, starting with inline data and file-backed JSON sources, instead of jumping straight to a live Figma transport implementation.

**Why:**
- It proves the server-side fetch-then-analyze boundary early.
- It lets us test contracts and examples without committing to a transport too soon.
- It keeps the shared core independent from how Figma data is obtained.

**Consequence:** A future live bridge should plug into the same seam and only be responsible for data retrieval and normalization.

---

## [2026-04-21] Support command-based bridge inputs before a dedicated live runtime exists

**Decision:** Add a command-based bridge input alongside file-based inputs so external exporters can pipe real Figma-like data into the MCP toolchain.

**Why:**
- It creates a practical integration seam before we settle on a permanent Figma transport.
- It keeps the core and MCP contracts reusable across local scripts, agent runtimes, and future bridge implementations.
- It lets us test the real fetch-then-analyze path with minimal extra infrastructure.

**Consequence:** Any future live bridge should be able to act like a producer of the same JSON contract, whether it is implemented as an MCP adapter, local script, or dedicated server.

---

## [2026-04-21] Use a REST-based exporter as the first real Figma integration

**Decision:** Build the first real exporter on top of the Figma REST API instead of waiting for a custom live runtime bridge.

**Why:**
- It gives us a practical end-to-end path against real files immediately.
- It keeps the integration understandable for designers: token, file URL, one command, JSON out.
- It preserves the architecture: the exporter is just another producer of the shared data contract.

**Constraint:** Per Figma’s official docs, `GET /v1/files/:file_key/variables/local` requires the `file_variables:read` scope and is available only to full members of Enterprise orgs.

**Consequence:** The exporter should degrade gracefully when the Variables API is unavailable and still emit useful file/style data plus warnings.

---

## [2026-04-22] Build a dedicated local-first Figma bridge plugin to bypass REST limitations

**Decision:** Create a simple Figma plugin (`packages/figma-bridge-plugin`) that extracts local variables and styles and POSTs them to a local HTTP receiver (`src/receiver.js`) to save in `.local/figma-data.json`.

**Why:**
- Figma's REST API gatekeeps the Local Variables API behind an Enterprise plan.
- Running a plugin inside the Figma editor canvas is the only reliable way for all users to read `figma.variables`.
- By having the plugin act strictly as an extractor that POSTs standard JSON to `localhost`, the core MCP server remains completely agent-agnostic and transport-agnostic.
- The Claude/Codex adapters don't need to know how the data was fetched, only that it exists locally.

**Consequence:** Users will need to install and run this local plugin in Figma desktop to sync variables before running the MCP tools. The REST exporter is kept as an option for Enterprise users or those who only need styles.

---

## [2026-04-22] Switch plugin from a manual Sync button to always-listening long polling

**Decision:** Remove the "Sync to MCP" button from the plugin UI. Instead, the plugin continuously long-polls `GET /poll` on the local receiver, and the MCP agent triggers extraction via `POST /request-sync`.

**Why:**
- A manual button requires the designer to be present and remember to sync before asking the agent anything.
- With long polling, the plugin is permanently ready — the agent controls the workflow end-to-end.
- `POST /request-sync` is a blocking call that only resolves after Figma has finished extracting and saving. This gives the agent a clean synchronisation point before reading the data.
- The same long-poll channel supports multiple command types (`extract-all`, `extract-selection`) without needing separate infrastructure.

**Consequence:** The plugin must be open in Figma Desktop for agent-triggered workflows to function. The receiver returns `503` if the plugin is not currently connected, giving agents a clear error to surface to the user.

---

## [2026-04-22] Use Figma selection as the input for component inspection

**Decision:** The `inspect_component` MCP tool takes no arguments. When called, it triggers the plugin to serialize `figma.currentPage.selection` and return it as the inspection payload. The selection is saved to `.local/figma-selection.json`.

**Why:**
- Asking the agent to search a large component list by name is fragile (fuzzy match, ambiguity, wrong file scope).
- Letting the user point directly at the component they care about in Figma is more reliable and more intuitive.
- A zero-argument tool is simpler for agents to call and requires no schema negotiation.
- The selection can contain frames, instances, component sets, or any other node type — making the tool flexible beyond just named components.

**Consequence:** The designer must have the target component selected in Figma before the agent calls `inspect_component`. Agents should be prompted to ask the user to select the target first if context is ambiguous.

---

## [2026-04-24] Auto-start the bridge receiver from the MCP server

**Decision:** The MCP server spawns the bridge receiver (`figma-bridge-plugin/src/receiver.js`) automatically on startup if port 1337 is not already in use.

**Why:**
- The target audience is designers with little or no terminal experience. Requiring `npm run start` before every session is a barrier that breaks the UX.
- The receiver is infrastructure, not a user task. The agent should own its own infrastructure.
- If the receiver is already running the auto-start is a no-op — no double-spawn risk.

**Consequence:** Designers only need to open the Figlets Bridge plugin in Figma Desktop when instructed. Everything else is automatic.

---

## [2026-04-24] Merge agent adapters into one shared package

**Decision:** Collapse `figlets-adapter-claude` and `figlets-adapter-codex` into a single `figlets-adapter` package containing both `CLAUDE.md` and `AGENTS.md` side by side.

**Why:**
- The tool inventory, workflows, error handling, and rules are ~90% identical across agents.
- Separate packages would require duplicating and synchronising the same content on every workflow change.
- As long as figlets-mcp remains agent-agnostic, there is no structural reason to separate the orchestration prompts.

**Consequence:** One package to update when MCP tools change. If the adapters diverge significantly in the future (agent-specific tools, divergent intake flows), splitting back out is straightforward.

---

## [2026-04-23] Upgrade MCP server to use the official `@modelcontextprotocol/sdk`

**Decision:** Replace the hand-rolled JSON stdout output in `figlets-mcp-server/src/index.js` with the official `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`).

**Why:**
- The old entrypoint just printed a JSON capability manifest to stdout — it was not a real MCP server and could not be connected to by any host.
- The official SDK handles the full JSON-RPC 2.0 protocol over stdio automatically, including capability negotiation, tool dispatch, and error framing.
- Using the SDK means zero custom protocol code: tool registration is a one-liner and handlers return plain `content` arrays.
- Any MCP-compatible host (Claude Desktop, Cursor, Windsurf, etc.) can now connect by simply pointing at the `node src/index.js` entrypoint.

**Consequence:** The server now speaks real MCP over stdio. Users add it to their host config (see `docs/mcp-config-examples.md`) and get all three tools — `sync_figma_data`, `inspect_component`, `detect_design_system` — without any CLI glue.

---

## [2026-04-24] Render the DS showcase entirely inside the Figma plugin — zero agent tokens

**Decision:** The `build_ds_showcase` MCP tool sends a single trigger command to the bridge plugin and receives back only a list of built section names. All design decisions — DS detection, variable selection, rendering, layout — happen inside `code.js` in the Figma plugin sandbox.

**Why:**
- Passing token values, variable lists, and color data to the agent for analysis would consume significant context on every run without adding value; the rendering logic is deterministic.
- The plugin already has direct access to the live Figma API, which is required for variable binding (mode-aware colors) and style application. Server-side JSON snapshots cannot substitute for live Figma objects.
- A zero-argument, zero-reasoning tool is more reliable: there is nothing for the agent to misinterpret and no intermediate representation to keep in sync.

**Consequence:** `build_ds_showcase` cannot be partially guided by the agent (e.g., "only show colors"). It renders exactly what it detects. Future per-section control would require a plugin-side filter, not agent-side reasoning.

---

## [2026-04-24] Use contrast-based variable fallbacks instead of hex-matching for structural tokens

**Decision:** When structural token variables (`onBrandVariant`, `textSub`, etc.) cannot be found by their expected name, `_buildShowcase()` calls `_findContrastVar(bgRGB, minRatio)` to scan DS variables by semantic type (on-surface / foreground / text) and pick the one with the best contrast ratio against the paired background. It does not fall back to a hardcoded hex value.

**Why:**
- Hex-based auto-lookup (`colorVarByHex`) would match the first variable that happens to share a hex value. In practice this matched `color/icon/brand` (same hex as `onBrandVariant`) — a semantically wrong binding that would break mode switching.
- Contrast-based fallback finds a variable that is semantically appropriate (on-surface class) and measurably readable (≥ 4.5:1). The result is a real DS variable, so it responds correctly to Figma mode changes.
- This makes the showcase resilient to DS files that use different naming conventions without requiring per-file configuration.

**Consequence:** The showcase may select a slightly different on-surface token on each DS file, but it will always be readable and mode-aware. If a DS has no on-surface variables at all, it falls back to any COLOR variable with the best contrast.

---

## [2026-04-24] Use a three-tier surface pairing strategy for icon tokens

**Decision:** Icon tokens are treated as foreground colors and paired with a surface background using the following priority chain: (1) semantic surface pairing — replace `icon` with `surface` in the token path; use if contrast ≥ 3:1 and it beats the default by at least 80%; (2) luminance-based dark surface scan — if the icon is light (luminance > 0.6), scan `surface/*` variables (excluding `on-*` prefixed names) and pick the darkest one; (3) default surface fallback.

**Why:**
- Pairing an icon token against a generic light background gives visually correct results for most icons, but fails for inverse/on-dark icons (e.g., `icon/inverse` is white, needs a dark background).
- A semantic path substitution (`icon/brand` → `surface/brand`) captures deliberate DS pairings when the naming convention supports it.
- A luminance-based fallback handles icons that are semantically "on dark" without requiring the DS to follow any specific naming convention.
- Excluding `on-*` prefixed variables from the dark surface scan prevents mistakenly pairing a foreground token (like `on-surface`) as the background.

**Consequence:** Icon swatches in the showcase will show a meaningful background in nearly all cases. The WCAG badge still grades the actual contrast, so the pairing quality is visible. Edge cases in unconventional DS files will produce the default surface, which is still a valid rendering.

---

## [2026-04-25] Resolve semibold font style by candidate loop, never hardcode

**Decision:** Font loading for the DS font family uses a priority list of semibold style name candidates (`['SemiBold', 'Semi Bold', 'Semibold', 'Demi Bold', 'DemiBold', 'Bold']`) tried one at a time via `loadFontAsync`. The first that succeeds is stored as `_semiboldStyle` and used throughout `_tDS`. All other fonts are bulk-loaded with `.catch(() => {})` per entry so a single missing variant cannot crash the showcase.

**Why:**
- Figma ships the Inter family with `'Semi Bold'` (space), not `'SemiBold'` (no space). Hardcoding either form breaks on one half of common font libraries.
- Custom typefaces vary freely between foundries. A candidate loop is the only robust approach.
- A rejected `loadFontAsync` promise throws a non-Error string in the Figma sandbox. If caught with a plain `catch (err)` and forwarded as `{ error: err.message }`, `err.message` is `undefined` → `JSON.stringify` silently drops the field → the MCP handler sees an empty success object instead of an error. The candidate loop sidesteps this by treating font load failure as a normal fallback, not an exception.

**Consequence:** The showcase always renders with a valid font. DSes using any common semibold naming convention — including custom foundries — load correctly without configuration.

---

## [2026-04-27] Show parent+leaf token path in semantic color row labels

**Decision:** Semantic color row tags display the last two slash-separated segments of the variable path (e.g. `surface/brand`, `on-surface/brand-variant`, `outline/subtle`) rather than only the leaf segment. A `_tokenLabel(name)` helper computes this. The swatch preview text (inside the 80×56 color box) continues to show the leaf only to avoid overflow. Pairing information is appended to the description line at the call site after `fgPairName` is resolved: "Paired with on-surface/brand." for background tokens, "Shown on surface/inverse." for icon tokens. `_buildSemColorRow` accepts `opts.previewText` to decouple these two display contexts.

**Why:**
- Leaf-only labels (`brand`, `default`) give designers no path context — two tokens from different roles can share the same leaf, making the table ambiguous.
- The two-segment form is the natural human-readable name for a token in a slash-structured DS. Designers can immediately identify the role (surface, on-surface, outline) and the qualifier (brand, default, subtle) without reading the full path.
- Pairing notes make the contrast column self-explanatory: `surface/brand` paired with `on-surface/brand` is legible without needing to know the underlying structure.

**Consequence:** All semantic color rows, outline rows, and icon rows in the showcase now show context-bearing labels. The change is applied at the call sites, not inside `_buildSemColorRow`, so the function remains reusable without enforcing a specific label format.

---

## [2026-04-27] Variable-based typography rows are a fallback, not an additive layer

**Decision:** `_buildTypoVarRow` rows (derived from `type/{role}/{size}/*` float variables) only render when `_sortedStyles.length === 0`. When a DS has text styles, only `_buildTypoRow` rows are shown. The variable-based path remains the fallback for DSes that define type scale purely as variables with no Figma text styles.

**Why:**
- Previously both loops ran unconditionally, producing a duplicate typography table when a DS had both text styles and type variables (common in DSes built with `apply_ds_setup`).
- Text styles are the canonical Figma typography representation and carry richer metadata (description, style name). They take precedence when present.
- The variable path adds value only when styles are absent — allowing the section to appear for variable-only DSes.

**Consequence:** A DS with text styles shows one row per style. A DS with only type variables shows one row per role+size group. A DS with both shows only the text style rows. Font family binding in var rows now also resolves via `_sharedFamilyVar` (first STRING variable containing "family" in any float collection) as a fallback when per-token `/family` variables are absent, and pre-loads the resolved font family before building rows.

---

## [2026-04-25] Typography section renders from variables when text styles are absent

**Decision:** `_buildShowcase()` scans `_floatColls` for variables following the `type/{role}/{size}/{property}` naming pattern (roles: display, headline, title, body, label). When found, it groups them by role+size and renders a variable-bound typography table row for each group using `_buildTypoVarRow`. Text-style rows (`_buildTypoRow`) and variable rows share the same table and column schema.

**Why:**
- Many DSes built with the `apply_ds_setup` flow store typography as float variables with responsive modes, not Figma text styles. A showcase that only renders when `textStyles.length > 0` would skip the Typography section entirely for those files.
- Variable-bound text rows let the preview respond to mode changes (Mobile → Desktop) exactly as the DS author intended, which is more valuable than a static snapshot.
- Supporting both paths in one section keeps the table unified — mixed DSes (some text styles, some vars) render correctly without duplication.

**Consequence:** The Typography section now appears for any DS that has `type/{role}/{size}/size` variables, regardless of whether text styles exist. DSes that have neither text styles nor typed variables continue to skip the section.

---

## [2026-04-27] Two-layer category scoring replaces flat per-role segment dictionary

**Decision:** Replace the flat `_SEG` dictionary (segment → role → score) with a two-layer system: `_SEG` maps segments to semantic categories (`BG`, `FG`, `BRAND`, `BVAR`, `VARIANT`, `OUTLINE`, `SUCCESS`, `WARNING`, etc.), and `_ROLE` maps each semantic role to category weights. The final score is the dot product of the path's accumulated category map with the role's weight vector.

**Why:**
- The flat dictionary required manually enumerating every qualifier combination. `brand-variant → onBrandVariant: 2` was correct, but `fg/brand-variant`, `text/brand-variant`, or any other FG-family segment beside `brand-variant` would still fail without an explicit entry.
- The two-layer system is compositional: `on-surface/brand-variant` accumulates `{FG: 3, BRAND: 1, BVAR: 3}` from its segments, and the `onBrandVariant` role weights `{FG: 3, BRAND: 3, BVAR: 2}` produce a score of 18. `on-surface/default` scores 9. No manual disambiguation needed.
- `surface/brand-variant` (the background) scores −3 because `BG × −4` dominates — structurally excluded regardless of what other categories it carries.
- Adding a new naming convention is a single `_SEG` entry. The role logic never changes.

**Consequence:** ANY foreground qualifier beside a brand marker correctly identifies the `onBrandVariant` token, regardless of exact wording. The same principle applies to all roles — qualifier specificity is naturally encoded by category accumulation, not by exhaustive per-role enumeration. Unit-tested in `tests/core/semantic-var-picker.test.js`.

---

## [2026-04-29] Plugin poll loop must be self-healing — watchdog + try/catch on every command handler

**Decision:** Every command dispatched to the plugin from `ui.html` arms a watchdog timer that resets `isExtracting` and resumes polling if the plugin code doesn't respond in time. Every command handler in `code.js` wraps its body in try/catch and always calls `figma.ui.postMessage` — including on error, so the UI always gets a response and polling always resumes.

**Why:**
- Before this change, a silent crash in `serializeNode` (or any other plugin-side throw) left `isExtracting = true` permanently, killing the poll loop for the rest of the session. The only recovery was closing and reopening the plugin.
- The plugin sandbox swallows uncaught errors without notifying the UI. There is no equivalent of `window.onerror` for the sandbox. The only reliable contract is: every message dispatched to `code.js` must produce a reply.
- Watchdog timers on the UI side are the only defense against plugin code that hangs or crashes without posting back. Each command has a generous but bounded timeout (12s inspect, 30s sync, 60s doc/setup, 120s showcase).

**Consequence:** The plugin self-heals after any crash or hang. A failed command produces an error result (not silence), the UI disarms the watchdog, resets state, and resumes polling. The MCP tool also retries 503/504 up to 3× with 1.5s delay so transient disconnects during the retry window are handled without surfacing to the user.

---

## [2026-04-30] Shared DS binding resolver before QA auto-fix

**Decision:** Live Figma binding should go through one shared bridge-side resolver, `_createDsBindingContext()`, instead of each tool maintaining local name/hex matchers. The resolver detects collections, variables, text styles, and effect styles; resolves aliases; classifies primitive/alias collections; exposes semantic color roles; and provides float/text-style pickers for spacing, radius, border, typography, and doc chrome.

**Why:**
- QA auto-fix must bind as many properties as possible when a DS exists, but it must not bind wrong-purpose variables just because their raw value matches.
- Hex matching is useful for reporting raw values, but it is not safe as an automatic binding strategy. Equal colors can represent different semantic purposes, such as icon, text, surface, or border roles.
- The current showcase semantic picker is the most accurate binding logic in the project. It trusts variable path semantics first, uses purpose locks (`requiredCats`) for role-specific slots, and only falls back to functional scoring for broad structural roles.
- The original figlets QA scripts have a good audit/fix structure, but their matching step still depends on agent-side nearest-token prose and hex/value indexes. They should be ported on top of the shared resolver.

**Consequence:** `generate_component_doc` now uses `_createDsBindingContext()` for spec-sheet chrome binding without changing its sections, markdown contract, or returned payload. Next QA port should expose this same resolver through audit/fix commands, with automatic fixes only when the resolver has high-confidence semantic/property matches.

---

## [2026-05-03] Showcase color sections use designer-facing order, not raw insertion order

**Decision:** Token showcase color rows are sorted deterministically for scanning. Primitive ramps put likely brand palettes first, then neutral and neutral-variant, then status/utility ramps such as red, green, yellow, blue/info. Semantic color groups put surface/background rows first, then text, outline, icon, and push status/info/warning/error/disabled groups lower.

**Why:**
- Designers use the showcase as a visual QA surface, not as an implementation dump. Brand and surface tokens are the most common first-pass inspection targets.
- Raw Figma variable insertion order can bury the important ramps under utility colors, especially after additive primitive updates create new ramps in an existing collection.
- Sorting is presentation-only. Variable names, IDs, aliases, values, and binding behavior are unchanged.

**Consequence:** Showcase rebuilds are visually more stable and easier to scan. If a future DS wants a different ordering policy, extend the ranking helpers in the showcase renderer rather than changing variable generation or semantic binding.

---

## [2026-05-14] Semantic setup uses content-role icons and subtle passive borders

**Decision:** Role-based setup now treats status border tokens as passive container borders by default, while keeping focus/strong borders available for emphasis. Passive borders sit close to their paired surface rather than at the saturated midpoint: soft status surfaces use about two ramp steps away from the surface (`200` in light mode, `800` in dark mode), while the strong brand surface uses `700`/`300` against its `900`/`50` background. It also adds explicit `color/icon/on-*` roles for filled status surfaces only when the DS is using icon semantics. Showcase inference prefers those on-color icon roles for `text/on-*` foregrounds and omits icons when the DS has no matching icon token.

**Why:**
- Major systems split container/fill roles from on-color content roles. Reusing `icon/danger` on `fill/danger` can make the glyph nearly invisible because both tokens come from the same hue/ramp side.
- Passive borders should frame a surface quietly; validation/focus states can be stronger. A single saturated midpoint status border (`500/500`) overstates passive rows.
- Some design systems intentionally do not expose icon color semantics. An existing `semantics.icons: []` is treated as an opt-out on re-run, not as an invitation to generate icons.

**Consequence:** New role-based setups produce clearer status previews: filled rows use `icon/on-danger`, `icon/on-success`, `icon/on-warning`, or `icon/on-info` when available; passive status borders default to near-surface steps (`brand 700/300`, `danger/success/warning/info 200/800`); and designer-authored icon/unpaired decisions are preserved on setup reruns.

**Follow-up:** `bg/brand-subtle` must not borrow `border/brand`, because the strong-brand border is tuned for the filled/strong brand surface. Setup now creates `color/border/brand-subtle` (`primary/200` light, `primary/800` dark), and the showcase's existing direct-match companion inference will pick it before falling back to stripped `border/brand`.

**Foundation roles:** Focus is not a color-family companion; it is a foundational interaction role. Setup still creates `color/border/focus`, and the setup-gap QA now reports a high-confidence `focus-border` foundation gap when a DS uses border/outline semantics but has no focus border token.

---

## [2026-05-14] Surface previews must have real foreground relationships when available

**Decision:** Role-based setup now writes explicit surface relationships for `surface/default`, `surface/raised`, `surface/overlay`, and `surface/sunken` paired with `text/default`. Showcase extra surface rows also resolve `color/text/default` or `color/on-surface/default` when a config relationship is absent, so accessibility badges are shown only when a real foreground variable was found.

**Why:**
- The previous showcase could render surface samples with a hardcoded readable foreground while displaying `FG —`, which hid the contrast badge and made the visual row look more authoritative than the semantic data.
- Surface roles are not merely decorative swatches; designers use them as card, panel, overlay, and recessed-region backgrounds, so default foreground compatibility is a useful QA signal.

**Consequence:** Surface rows read as actual background+foreground relationships instead of unpaired color samples. If no default foreground token exists, the row remains an honest unpaired preview.

---

## [2026-05-14] Semantic preview swatch border width is token-bound at 1px

**Decision:** Semantic preview swatches use a 1px stroke for both semantic border-token outlines and fallback outlines, and bind `strokeWeight` through the border-width variable picker when possible.

**Why:**
- The previous 1.5px semantic outline was visibly heavier than the token system and produced binding audit warnings.
- A showcase row should demonstrate the DS token stack: color variables for fills/strokes and numeric variables for border width.

**Consequence:** Semantic swatches are less visually aggressive and align with the expected `border/1` primitive. Missing numeric bindings still warn through the normal showcase binding path.

---

## [2026-05-08] Showcase contrast labels follow the configured contrast algorithm

**Decision:** Primitive and semantic color swatch labels in the Figma showcase branch on `DS.color.contrastAlgorithm`. APCA mode shows Lc labels (`✓ Lc NN` / `✗ Lc NN`). WCAG mode keeps the same visual treatment but shows ratio-status labels (`✓ AAA`, `✓ AA`, `~ Large`, `✓ 3:1`, `✗ Fail`).

**Why:**
- The split primitive swatches and semantic pair swatches are useful in both APCA and WCAG workflows, but APCA `Lc` labels are misleading when the configured validator is WCAG.
- Text-like rows need the body-text threshold (`Lc 75` or `4.5:1`), while icon-like rows need the graphical threshold (`Lc 60` or `3:1`).
- The MCP `build_ds_showcase` handoff must forward `DS.color.contrastAlgorithm`; otherwise a WCAG config reaches the bridge plugin without the mode signal and silently renders APCA labels.

**Consequence:** Showcase labels now match the same contrast algorithm used by config validation. WCAG live builds can be verified with a one-off request that passes `contrastAlgorithm: "wcag"` without mutating the active saved config.

---

## [2026-04-29] Spec sheet containers must FILL width and HUG height — no custom row builders

**Decision:** Every container in `_buildComponentDoc` that holds variable-height content must set `layoutSizingHorizontal = 'FILL'` (fills the doc frame width) and either `counterAxisSizingMode = 'AUTO'` or `primaryAxisSizingMode = 'AUTO'` to hug content height. Text nodes inside containers must use `layoutSizingHorizontal = 'FILL'` + `textAutoResize = 'HEIGHT'` — never `WIDTH_AND_HEIGHT`. Custom row/cell builders are prohibited: always use the proven `_mkTable/_mkRow/_mkCell` helpers for tabular data.

**Why:**
- `WIDTH_AND_HEIGHT` text auto-resize lets text nodes grow horizontally without bound, escaping their container and overflowing the doc frame. `FILL + HEIGHT` constrains width to the parent and grows height instead.
- Frames without explicit `counterAxisSizingMode = 'AUTO'` default to a fixed height (typically 100px), silently clipping taller content (e.g., a 169px component preview, long rule text in Do/Don't panels).
- Custom row builders reliably produce 0px-tall text rows because the auto-layout sizing semantics (when to set `textAutoResize` vs `layoutSizingHorizontal`, and in what order relative to `appendChild`) are non-obvious. The proven helpers encode the correct sequence.

**Consequence:** All new sections added to the spec sheet must follow this sizing contract. A new tabular section must use `_mkTable/_mkRow/_mkCell`. A new non-tabular container must explicitly set FILL + HUG. Violations produce invisible or overflowing content that is hard to debug visually.

---

## [2026-04-27] Variable purpose is a semantic contract — purpose locks enforced via requiredCats

**Decision:** Every `_semPick` call that targets a specific-purpose slot (outline/border, surface/fill, text/fg) passes a `requiredCats` array. A candidate variable must contribute to all required categories to be considered — regardless of its role score. The functional fallback is also blocked when `requiredCats` is set. If no purpose-correct variable exists, the slot returns null.

Applied consistently:
- `outlineSubtle`, `outlineBrand`, `successBorder`, `warningBorder` → `['OUTLINE']`
- `successBg`, `warningBg` → `['BG']`
- `successText`, `warningText` → `['FG']`

Structural roles (`onSurface`, `surfaceDefault`, etc.) do not use `requiredCats` — they retain the functional fallback for DSes with entirely non-semantic naming.

**Why:**
- A variable path encodes its intended purpose. `color/outline/warning` is a border token; `color/icon/warning` is an icon-fill token. Using a wrong-purpose variable is a semantic error even if it scores positively for a role.
- The scoring system can assign a positive score to a variable with the wrong purpose if the status keyword (e.g. `warning`) dominates over the purpose keyword (e.g. `icon` vs `outline`). `requiredCats` is a hard filter that scoring alone cannot provide.
- This is also a QA contract: designers are expected to name variables according to their purpose. The showcase and future QA tools enforce the same rule.

**Consequence:** Status badge borders and fills only bind to variables that are explicitly named for that purpose. If the DS has no `outline/warning` variable, the badge renders without a border rather than borrowing an icon or surface token. Unit-tested in scenarios 14–16 of `tests/core/semantic-var-picker.test.js`.

---

## [2026-04-27] Bind showcase variables by path-segment scoring, not regex name matching

**Decision:** Replace all regex-based name pattern matching in `_buildShowcase()` with a segment-weighted scoring system (`_SEG` dictionary + `_segScore`). Every `/`-separated segment in a variable path contributes a positive or negative score to each semantic role. The variable with the highest total score wins. Functional scoring (contrast, luminance, saturation) runs only as a last resort when no variable scores above zero.

**Why:**
- Regex substring matching was semantically blind: `/surface/` matched `on-surface/default`, causing a foreground text token to be picked as a background.
- Name matching treated the path as an opaque string. Segment scoring treats each component as a meaningful signal — `on-surface` and `surface` are semantically opposite, which is now encoded directly.
- DSes with unconventional naming (e.g. `fg/primary` instead of `on-surface/default`) are understood via segment meaning rather than requiring a contrast fallback.
- The DS author's naming convention is trusted first. Functional scoring (contrast, lum, sat) only runs if the DS has no recognisable semantic keywords at all.
- All `_C.xxx` hardcoded fallback colors replaced with `_RC.xxx` — a resolved-color map that reads the DS variable's actual first-mode value, falling back to `_C` only if the variable is absent entirely.

**Consequence:** Variable bindings adapt to any DS naming convention that uses recognisable semantic keywords. Adding new naming conventions is a one-line dictionary entry. Status token disambiguation (`surface/success` vs `outline/success` vs `on-surface/success`) is handled by combined segment scores, not separate regex lists. Unit-tested in `tests/core/semantic-var-picker.test.js`.

---

## [2026-04-24] Always show the indicator glyph for icon tokens regardless of contrast threshold

**Decision:** `_buildSwatch` accepts a `forceIndicator` option. When set to `true`, the sample text glyph (☻) is rendered unconditionally. This option is passed for all icon token swatches. The WCAG badge continues to grade the actual contrast ratio independently.

**Why:**
- The default `≥ 4.5:1` threshold for rendering the glyph was suppressing it on icon swatches at 3–4:1 — tokens that are not text but are still meaningful to display.
- Icons operate at a different WCAG threshold (3:1 for graphical elements) and the glyph is the only visual indicator in the swatch cell; omitting it makes the swatch appear empty.
- Separating the "show the glyph" decision from the "pass WCAG AA" decision is cleaner: `forceIndicator` controls presence, the badge controls grading.

**Consequence:** Icon swatches always show the indicator glyph. Non-icon swatches continue to gate on 4.5:1. The WCAG badge reflects true pass/fail for both.

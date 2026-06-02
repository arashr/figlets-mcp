# Figlets developer guide

This document is for people working on the **figlets-mcp** repository: MCP server, bridge, plugins, tests, and docs. It is intentionally **not** linked from the root README, which is written for designers evaluating and using Figlets.

## Designer vs developer context

| Mode | When | Entry |
| --- | --- | --- |
| **Designer** | Helping someone use Figlets in Figma through an agent | Root [README.md](../README.md), [mcp-config-examples.md](./mcp-config-examples.md) |
| **Developer** | Editing this repo, debugging tools, release work | This file, [memory/PROJECT_MEMORY.md](../memory/PROJECT_MEMORY.md), [DECISIONS.md](../DECISIONS.md) |

Agent hosts should follow **[AGENTS.md](../AGENTS.md)** / **[CLAUDE.md](../CLAUDE.md)** for Designer Mode vs Developer Mode behavior.

## Architecture

Figlets is agent-agnostic. Deterministic design-system logic lives in shared packages. The MCP server exposes stable tools. Thin host plugins and adapters handle onboarding.

| Path | Role |
| --- | --- |
| `packages/figlets-core` | Shared analysis, planning, validation |
| `packages/figlets-mcp-server` | MCP server, CLI (`figlets-mcp`), bridge integration |
| `packages/figlets-adapter-*` | Thin host-specific guidance |
| `plugins/claude-code`, `plugins/codex` | Host plugins (marketplace manifests, skills, MCP wiring) |
| `docs/` | Architecture, MCP examples, gap register, tool contracts |
| `tests/` | Supported-runtime test suite |

Overview: **[architecture.md](./architecture.md)**.

## Local checkout

**Requirements:** Node.js **22+** for monorepo development and CI (`npm test`). The published `@figlets/mcp-server` package declares Node `>=18`.

```bash
git clone https://github.com/arashr/figlets-mcp.git
cd figlets-mcp
npm install
npm link --workspace=@figlets/mcp-server
```

Local designer smoke without publishing:

```bash
figlets-mcp launch
```

Pre-release Claude Code development when no GitHub release exists yet: `figlets-mcp setup --hosts=claude-code --yes` (local server binary) instead of the plugin tarball path. See [mcp-config-examples.md](./mcp-config-examples.md).

## Bulk repair surfaces

Before adding a public tool or parallel repair path, read **[bulk-repair-api-implementation-plan.md](./bulk-repair-api-implementation-plan.md)** and extend existing planner/apply surfaces when possible.

Common planner to apply routes:

| Inspection | Apply (after designer approval) |
| --- | --- |
| `inspect_ds_setup_gaps` | `apply_ds_setup_repairs` |
| `inspect_ds_token_gaps` (foundation) | `apply_ds_foundation_repairs` |
| `inspect_ds_token_gaps` (tokens / primitives) | `update_ds_tokens`, `update_ds_primitives` via `repairPlan` / `primitiveRepairPlan` |
| `qa_binding_audit` (read-only first) | `qa_binding_audit({ fix: true })` only for `fixableNow` items |

Destructive token prune apply requires `prune.config_authoritative=true` after dry-run review.

## Verify changes

```bash
npm test
git diff --check
```

Before a release tag:

```bash
npm run release:prepare -- 1.0.0   # or --patch / --minor / --major
npm run release:prepare -- --check # fail if any product version surface drifts
npm run build:server-tarball       # build self-contained server tarball
npm run verify:release             # tarball contents, packed tools/list, Agent Interface smoke
npm run smoke:plugins              # plugin version/tarball alignment + host smoke
```

Figlets has one product version. The source of truth is `packages/figlets-mcp-server/package.json`; `npm run release:prepare` syncs every workspace package, host plugin manifest, and GitHub release tarball URL to that version. Runtime server metadata reads from package metadata, so MCP `version` and REST `User-Agent` stay aligned without separate edits.

Claude/Codex plugins pin the GitHub release tarball via `npx -y <tarball>`. Run `release:prepare -- --check` and `verify:release` before tagging so designer installs do not drift.

Optional offline analysis: export or sync Figma JSON, then use CLIs under `packages/figlets-mcp-server/src/cli/`. See `.env.example` for REST export tokens. Designer-facing reviews should still go through Figlets MCP workflows.

## Developer-only broken fixture prep

BNN-37 manual smoke prep is intentionally developer-only. It is not an MCP designer tool and must not appear in designer menus, plugin skills, or commands. Use it only in a fresh/disposable Figma file.

The script resets local variables, local styles, and canvas content in the open file, builds a realistic Figlets-style design system, then intentionally removes a seeded set of semantic foreground companions, token variables, a text style, and extra spacing modes. It also seeds BNN-45 semantic naming conflicts such as `color/bg/danger` + `color/bg/on-danger`, and can create raw binding-audit target nodes. After the bridge reports the file key, the script copies the prepared config to `.local/<fileKey>/design-system.config.js` so config-backed smoke checks still know which tokens were intentionally removed.

```bash
FIGLETS_DEV_BRIDGE=1 node scripts/prepare-broken-ds-fixture.js \
  --yes-i-understand-this-mutates-figma \
  --seed bnn-37-smoke \
  --expected-file-name "Figlets Test"
```

Reset/re-run steps:

1. Open a fresh or disposable Figma file.
2. Open the local Figlets Bridge plugin from this checkout.
3. Run the command above with a seed. Reuse the same seed for repeatable gaps; change the seed for a different gap mix. Pass the disposable file's exact Figma name with `--expected-file-name` when you want the bridge to refuse mutation if a different file is open.
4. Run `sync_figma_data`, then manual smoke the designer workflows against the prepared broken file.

The receiver endpoint is gated by `FIGLETS_DEV_BRIDGE=1` and returns 404 outside developer bridge mode. The CLI also refuses to run without `--yes-i-understand-this-mutates-figma`, and the bridge request includes the explicit confirmation phrase `RESET_AND_BREAK_DISPOSABLE_FIGMA_FILE`.

## Agent PR review protocol

Use **[agent-pr-review-protocol.md](./agent-pr-review-protocol.md)** when agents open, review, or merge Figlets PRs. New PRs should use **[.github/pull_request_template.md](../.github/pull_request_template.md)** so Linear, scope, tests, manual verification, agent review, and merge notes stay visible.

GitHub PRs are the code review truth: detailed findings, verification, unresolved must-fix items, and merge readiness belong there. Linear issue comments are the task log: start, checkpoints, blockers, review verdicts, completion, and handoff belong there. Keep the two linked so another agent can recover state without rereading the chat thread.

Protocol drift is checked by:

```bash
npm run check:pr-protocol
```

## Troubleshooting (maintainers)

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Packed plugin install fails | Missing or stale release tarball | `npm run verify:release` before tagging |
| MCP apply returns `{}` while CLI works | Stale app-managed MCP session | Restart host; see project memory stale-host notes |
| Bridge capability mismatch | Plugin and server out of sync during dev | Reload Figma Bridge plugin; run `figlets-mcp doctor` |

## Roadmap and decisions

- **Linear** (team Minions, project Figlets MCP): operational source of truth for active work. Developer agents should leave additive task comments on active issues (start, checkpoint, blocker, review, completion) using the template in **[AGENTS.md](../AGENTS.md)** / **[CLAUDE.md](../CLAUDE.md)** Developer Mode; issue descriptions stay stable scope, comments are execution history.
- **[DECISIONS.md](../DECISIONS.md):** durable architectural choices.
- **[memory/PROJECT_MEMORY.md](../memory/PROJECT_MEMORY.md):** active implementation context.
- **[future-figlets-gap-register.md](./future-figlets-gap-register.md):** future gaps and risks (e.g. G-001 workflow readiness — v1 `figlets_health_check` shipped; v2 audit orchestration remains open).

Phase 3 token completion and core post-Phase-3 reliability hardening are done on `main`. Remaining polish includes guidance hygiene across entrypoints.

## Relationship to the legacy `figlets` repo

The original **figlets** repository is the earlier Claude-facing product. **figlets-mcp** is the shared, agent-agnostic core. Capabilities migrate here over time; adapters stay thin.

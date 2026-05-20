# Productization research — handover doc

**Purpose.** This document captures a strategic discussion about turning `figlets-mcp` from a developer-grade open-source toolkit into something a non-technical designer can install and use. It bundles the project's current state, the research findings on three proposed install/UX improvements, and the open strategic questions that need a human decision before any code moves.

**Audience.** A future thread or agent picking up the productization work. You should be able to read this doc once and have full context — no need to re-derive the architecture or re-do the research.

**Status.** Research complete. **No implementation started.** Project owner is deciding which path (if any) to commit to before code work begins.

---

## 1. What `figlets-mcp` is, briefly

An agent-agnostic MCP toolkit for Figma design-system workflows. Designed so deterministic logic (token analysis, contrast checks, ramp walking) lives outside the model and only ambiguity + orchestration are left to the agent. Cuts token burn and keeps results consistent across runs.

It's the rebuild of an earlier `figlets` repo that was Claude-skill-only. The new architecture lets Claude, Codex, Cursor, or any MCP-speaking agent drive the same flows.

**The product premise:** designers can run a QA pass on their Figma file's design system, see findings in plain language, approve fixes, and have the agent apply them — all without leaving the conversation.

---

## 2. Architecture today

Three layers in this monorepo:

```
packages/
  figlets-core/              Pure analysis: contrast math, token detection, ramp walking
  figlets-mcp-server/        MCP transport over the core; tools the agent calls
  figma-bridge-plugin/       The Figma plugin that reads/writes the file
  figlets-adapter*/          Thin adapters for Codex/Claude (mostly prompt config)
```

**The transport** is the critical architectural fact for productization:

- The bridge plugin runs inside Figma Desktop (sandboxed JS).
- It can't talk directly to the agent or to local files.
- Instead, the plugin polls a local HTTP receiver at `http://localhost:17337` by default (`packages/figma-bridge-plugin/src/receiver.js`).
- The MCP server makes HTTP calls to the same receiver to dispatch commands and collect results.
- Plugin → receiver → MCP server → agent. All on the same machine.

**The plugin makes its bridge fetches to `http://localhost:17337`** from `ui.html`. This is still a productization blocker until the endpoint is configurable in packaged builds (see §6), but the port is no longer the generic `1337`.

---

## 3. Current state of the product

### What works today (verified live against `local_mozwkg5o_ufp0x3jo`)

| Capability | Tool | Maturity |
|---|---|---|
| Pull Figma snapshot | `sync_figma_data` | Solid |
| Detect & document design system | `detect_design_system`, `prepare_ds_config`, `apply_ds_setup`, `update_ds_primitives` | Solid (existing setup flow) |
| Refresh local config from Figma | `refresh_ds_config_from_figma` | Solid |
| **QA pass over semantic color layer** | `inspect_ds_setup_gaps` | **Just rebuilt** (commits `618ebdf` + `c275c1d`) |
| **Apply approved fixes** (create + re-alias) | `apply_ds_setup_repairs` | **Just extended** (`c275c1d`) |
| Component inspection / docs | `inspect_component`, `generate_component_doc` | Solid |
| Visual showcase | `build_ds_showcase` | Solid (most recent rework on `main`) |
| Bridge health + capability declaration | `/health`, plugin polling | Solid |
| Read-only QA CLI fallback | `npm run figlets:check-setup-gaps` | Solid (works without MCP) |

### Active branch

`codex/designer-safe-setup-repair-cli` — 6 commits ahead of `main`, **not yet merged**. The last two commits are from the recent QA→Fix work:

- `618ebdf` Reshape setup-gap inspector as semantic-layer QA report
- `c275c1d` Plumb contrast re-alias through the existing apply tool

Memory + decisions log are up to date in [`memory/PROJECT_MEMORY.md`](../memory/PROJECT_MEMORY.md) and [`DECISIONS.md`](../DECISIONS.md). Read those first if you need deeper context on why the current code looks the way it does.

### What just shipped in the QA→Fix work

1. **Inspector** reports six finding kinds against the semantic color layer: missing-fg companions, missing-bg companions, incomplete modes, contrast failures (with hex + resolved primitives + near-miss tag), broken aliases (semantic-layer only), companion advisories (with DS-wide role suppression when applicable). Findings are severity-ordered. Snapshot freshness is in the response.
2. **Contrast picker is reused** from `validateSemanticPairs` via `accessible-repair-aliases.computePlannedAliases`. Each contrast failure carries `plannedReAlias: { token, mode, from, to }` when the picker can find an upgrade — no parallel contrast math.
3. **`apply_ds_setup_repairs` accepts two repair kinds** in one call: `repairs[]` (create new fg) and `aliasUpdates[]` (re-alias existing). One bridge round-trip. Both wired through `_applyDsSetupRepairs` in the plugin.
4. **Designer prompt** at [`docs/designer-fix-flow-prompt.md`](./designer-fix-flow-prompt.md) captures the full conversation script. Front-loads capability boundaries, severity-ordered walkthrough, plain-language translation rules, cluster-level approval pattern.

### What's deferred (intentional, per recent decisions)

- **Component-collection breakage detection.** A previous session expanded the inspector with broken-alias-with-setup-vs-component-scope classification. That direction was wrong — component breakage is a downstream rebinding problem outside the setup flow's scope. Decision logged in [`DECISIONS.md`](../DECISIONS.md). Don't reintroduce it.
- **Non-color semantic categories** (typography roles, spacing semantics, radius semantics) — color-only QA for now.
- **Auto-update config on re-alias.** The new `aliasUpdates` path doesn't touch `design-system.config.js`; designers run `refresh_ds_config_from_figma` separately if they want config to follow.
- **Borders auto-picker.** Border colors are added via the existing apply tool today, but with explicit `aliases` per mode supplied by the agent (no automated picker like there is for fg). A border picker would be a real feature, not a refactor.

### Project memory rules to know

Pulled from `memory/MEMORY.md`:

- Update `PROJECT_MEMORY.md` and `DECISIONS.md` before merging or ending any significant session.
- No `Co-Authored-By` or AI attribution in commit messages.
- Plugin code (`packages/figma-bridge-plugin/code.js`) is ES6-era only — no `??`, `?.`, `**` operators. Figma's sandbox doesn't support them. `node --check` passes but does NOT catch this.
- Test artifacts go to `/tmp`, never the project tree. `component-specs/` is gitignored.
- Brand changes cascade through semantics + Figma primitives + component bindings — never edit one in isolation.
- On "revert" requests, confirm scope before discarding work — past incidents of partial vs full revert ambiguity.

---

## 4. The productization question

The user's framing:

> Imagine this is a public product in the hands of designers with no technical knowledge and they have to install this, navigate it and run the existing commands. What are the possibilities?

Decomposed into four layers of friction for a non-technical designer today:

1. **Install** — clone repo, `npm install`, edit JSON for their agent, import a Figma plugin via developer-import flow, set `.env` token, etc.
2. **Command** — designer must know what to type. The current designer prompt at [`docs/designer-fix-flow-prompt.md`](./designer-fix-flow-prompt.md) is ~100 lines of engineer-grade instructions.
3. **Navigate / discover** — no surface tells the designer what's possible. They have to read docs.
4. **Recover from errors** — error messages today often surface implementation details (`ECONNREFUSED on 127.0.0.1:17337`, etc.).

---

## 5. The three concrete proposals that were researched

To attack the four friction layers, three top-priority concrete actions were proposed:

1. **Publish the bridge plugin to Figma Community.** One-click install for designers, removes the developer-import flow entirely.
2. **`npx figlets setup` with auto-config + slash commands shipped.** Detects the user's agent (Claude Desktop / Claude Code / Cursor / Codex), patches their MCP config, ships matching slash commands so the designer doesn't memorize prompts.
3. **In-plugin action panel + plain-language errors.** Buttons in the plugin UI for common flows (`Check setup`, `Build showcase`, `Run QA`) so designers who don't want to talk to a chat agent have a UI; plus catch all error paths and translate to plain language.

---

## 6. Research findings, with sources

### Finding #1 — Figma Community publication is **NOT FEASIBLE without architectural change**

Per [Figma's plugin manifest docs](https://developers.figma.com/docs/plugins/manifest/) and confirmed by [Figma's network requests guide](https://developers.figma.com/docs/plugins/making-network-requests/):

> "Published plugins cannot use localhost." Localhost patterns are only for `devAllowedDomains`, not for production `allowedDomains`.

The bridge plugin makes its HTTP calls to the local receiver from `ui.html` (currently `http://localhost:17337`). Community publication would silently break every command unless this endpoint becomes user-configurable or packaged with a companion app.

**Escape hatches, ranked by effort:**

| Option | Description | Cost | Audience |
|---|---|---|---|
| (a) Cloud-hosted MCP server | Plugin's `allowedDomains` becomes `["api.figlets.dev"]` (or similar). Real one-click install. | Hosting, auth, accounts, privacy story (file data leaves the machine), real product business | Everyone |
| (b) Org-publication on Figma Enterprise | Per a [Figma forum thread on the Chrome LNA issue](https://forum.figma.com/ask-the-community-7/chrome-local-network-access-policy-will-make-plugins-published-within-the-organization-unavailable-46262), org-published plugins can reach localhost (Figma resolved the LNA problem). | Apply to Figma's enterprise channel; same paperwork as any enterprise Figma deployment | Enterprise teams only |
| (c) Stay on dev-import flow | Designer downloads a folder → Figma → Plugins → Manage → Import from manifest. Three clicks. Documentable. | None | Anyone willing to do 3 clicks (designers do this for tools like Code Connect today) |
| (d) Move ALL logic into the plugin | No MCP server. Plugin runs everything in its sandbox. Community publication unblocked. | Massive rewrite. Loses the agent integration — the whole point of this product. | Probably wrong direction |

**Verdict on #1 as written:** not feasible. To make it real, the team would need to commit to the cloud-hosted SaaS path (option a).

---

### Finding #2 — `npx figlets setup` + slash commands: **FEASIBLE, two distribution paths**

Sources confirmed:

**Config paths are stable across all popular agents:**

- **Claude Desktop** (per [Anthropic's local MCP guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)):
  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
  - Linux: `~/.config/Claude/claude_desktop_config.json`
- **Claude Code** (per [Anthropic's MCP docs](https://code.claude.com/docs/en/mcp)) — has a real CLI: `claude mcp add --transport stdio figlets -- node /path/to/server`. Three scopes (local/project/user); user scope is right for global install.
- **Cursor**: edit `~/.cursor/mcp.json` (macOS) or `%APPDATA%\Cursor\mcp.json` (Windows).

Detection is straightforward — check binaries on PATH (`claude`, `cursor`), check known config paths, patch in place. Prompt user with copy-paste-ready snippet if no detection succeeds.

**Slash commands — even better than expected.** Per [Anthropic's Claude Code plugin announcement](https://www.anthropic.com/news/claude-code-plugins) and the [skills docs](https://code.claude.com/docs/en/skills):

> Claude Code now supports plugins: custom collections of slash commands, agents, MCP servers, and hooks that install with a single command. Install them with the `/plugin` command.

So **for Claude Code specifically**, we don't need the `npx`-based install at all. Ship Figlets as a **Claude Code plugin** (a public git repo with `.claude-plugin/marketplace.json`) bundling:

- The MCP server config
- Slash commands (`/figlets-check`, `/figlets-fix`, `/figlets-showcase`, `/figlets-help`)
- The agent skills (the long prompt at `docs/designer-fix-flow-prompt.md` becomes a skill file)
- Optional hooks

User runs `/plugin install figlets` once. Done. **This is significantly cleaner than the npx path for Claude Code users.**

For Cursor / Claude Desktop / Codex / others, the `npx figlets setup` script remains the right approach — there's no plugin marketplace equivalent yet for these.

**Verdict on #2:** fully feasible. **Two distribution paths in parallel** — Claude Code plugin (simplest) + npx setup (everyone else). Slash commands ship with both.

---

### Finding #3 — In-plugin action panel + plain-language errors: **SPLIT VERDICT**

- **Plain-language errors:** ✅ pure code work, no constraints. Wrap each error path in user-friendly translations + concrete next-action. Should do regardless of any other decision.

- **In-plugin action panel:** ⚠️ same blocker as #1. Buttons that trigger `inspect`/`apply` flows would need to talk to the MCP server, which means localhost, which means doesn't survive Community publication. In a **dev-install or org-published** world, the panel works fine and is a clear UX win. In a **Community-published cloud-hosted** world, it works against the cloud URL — even better.

So the action panel is feasible **conditional on the install story** picked above. It's not independently doable for Community.

---

## 7. Strategic paths

| Path | Designer install effort | Architectural cost | Audience |
|---|---|---|---|
| **A. Local + dev-import + Claude Code plugin + npx setup** | 3-click plugin import + 1 command | None beyond what we have | Engineer-friendly designers, Claude Code users |
| **B. Org-publish on Figma Enterprise + Claude Code plugin + npx setup** | One-click plugin (org members only) | Apply to Figma's enterprise channel | Enterprise teams |
| **C. Cloud-hosted MCP + Community plugin + Claude Code plugin + npx setup** | One-click plugin install (everyone) | Hosting, auth, accounts, privacy reckoning, billing model | Public/everyone |

### What each path unlocks vs. blocks

**Path A** is shippable now. Basically free engineering — `npx setup`, Claude Code plugin packaging, plain-language errors, dev-import documentation. Real ceiling on audience reach (the dev-import for the bridge plugin is a deal-breaker for many designers).

**Path B** is shippable now for Figma Enterprise teams. Same engineering as A plus enterprise channel paperwork.

**Path C** is the real product, but a 6–12 week build (server hosting, auth, accounts, privacy guarantees, billing if applicable). Changes the legal/operational shape of the project. Privacy story matters — designer Figma file data leaves the machine.

---

## 8. Recommended order if work is green-lit

Regardless of which path is ultimately chosen, these items are independently valuable and should ship first:

1. **Plain-language error catcher.** Wrap every `error: ...` path in MCP server + bridge plugin to produce designer-friendly messages with concrete next-actions. No architectural decisions needed. Clear win regardless of A/B/C.
2. **`npx figlets-mcp setup` script** that detects + auto-configures Claude Code (via `claude mcp add`), Cursor (via JSON patch), Claude Desktop (via JSON patch). Single npm package, prompts user when detection fails.
3. **Claude Code plugin packaging** — manifest + slash commands + bundled MCP config + skills. Published as a git repo with `.claude-plugin/marketplace.json`. Single-command install for Claude Code users.
4. **Designer-facing install README** that walks through the dev-import for the bridge plugin in plain words with screenshots. (For Path A only — under Paths B/C this gets replaced.)
5. **In-plugin status panel + plain-language errors in `ui.html`.** Works in current dev-install model. Future-proof for Path C (talks to whatever URL is configured).

Items 1–3 ship value under any path. Item 4 is Path A only. Item 5 is feasible under A and B, has to wait for C.

**Do NOT start with the Figma Community publication work.** The localhost block makes it a fake destination — the work would complete and then can't actually publish.

---

## 9. Open strategic questions

These need a human decision before code moves:

1. **Which path (A/B/C)?** This is the gating question. Everything cascades from it.
2. **If Path C is on the table at all** — is the team prepared to:
   - Host a public service (uptime, security, support)
   - Build auth + accounts
   - Make privacy guarantees about Figma file data leaving designer machines
   - Decide on a pricing model (free? freemium? paid)
3. **If staying open-source** — what's the project's positioning? "Free OSS for engineer-adjacent designers" vs "free OSS for everyone, with cloud as a future paid layer." Different roadmaps.
4. **Does the Figma plugin get a UI of its own?** Today it's mostly a status display. Adding action buttons changes the product shape: agent-mediated vs plugin-as-app.
5. **Naming / branding.** "Figlets" is the working name. For public release, worth deciding if that sticks or if it gets a more designer-friendly name.

---

## 10. Anti-patterns to avoid

These come from past sessions that drifted in the wrong direction:

- **Don't expand scope to component-collection breakage.** Setup-vs-component-scope detection was added in a previous commit (`1504b5d`) and reverted. Component breakage is downstream of setup; out of scope.
- **Don't duplicate contrast math.** The setup flow's `validateSemanticPairs` + `accessible-repair-aliases.computePlannedAliases` is the single owner. Anything that needs ramp-walking should reuse it.
- **Don't auto-apply fixes without designer approval.** Per-cluster approval is the contract. Reading `DECISIONS.md` will give the rationale.
- **Don't add "ready to repair" framing to QA output.** Recent work specifically removed that to avoid biasing the agent toward apply before the designer decides.
- **Don't introduce `??`, `?.`, or `**` in plugin code.** Figma sandbox is ES6-era. `node --check` passes them but the runtime fails silently.
- **Don't add or modify CLI scripts where an MCP tool would do.** The QA CLI exists as a no-MCP fallback per a 2026-05-11 decision; new functionality should expose itself as MCP tools, not new shell scripts.
- **For "revert" requests on uncommitted work, always confirm scope.** Past incident with partial-vs-full revert ambiguity.

---

## 11. Key file references

- [`README.md`](../README.md) — top-level project intro
- [`docs/architecture.md`](./architecture.md) — high-level architecture
- [`docs/tool-contracts.md`](./tool-contracts.md) — MCP tool contracts
- [`docs/migration-plan.md`](./migration-plan.md) — original migration plan from `figlets` to `figlets-mcp`
- [`docs/mcp-config-examples.md`](./mcp-config-examples.md) — sample MCP configurations
- [`docs/designer-fix-flow-prompt.md`](./designer-fix-flow-prompt.md) — current designer-facing prompt (the artifact `npx figlets setup` would distribute as a slash command / skill)
- [`memory/PROJECT_MEMORY.md`](../memory/PROJECT_MEMORY.md) — session-level history; read top-down for recent context
- [`DECISIONS.md`](../DECISIONS.md) — durable architectural decisions with rationale
- [`packages/figma-bridge-plugin/manifest.json`](../packages/figma-bridge-plugin/manifest.json) — plugin manifest (currently no `networkAccess` declared; uses dev-import default)
- [`packages/figma-bridge-plugin/ui.html`](../packages/figma-bridge-plugin/ui.html) — plugin UI; lines 630–917 contain the localhost fetches that block Community publication
- [`packages/figlets-mcp-server/src/cli/check-setup-gaps.js`](../packages/figlets-mcp-server/src/cli/check-setup-gaps.js) — the no-MCP fallback CLI
- `packages/figlets-mcp-server/src/index.js` — MCP server entry point; tool registry

---

## 12. Sources cited (Figma + agent docs)

- Figma plugin manifest: <https://developers.figma.com/docs/plugins/manifest/>
- Figma network requests: <https://developers.figma.com/docs/plugins/making-network-requests/>
- Figma forum on Chrome LNA + org-published plugins: <https://forum.figma.com/ask-the-community-7/chrome-local-network-access-policy-will-make-plugins-published-within-the-organization-unavailable-46262>
- Anthropic local MCP guide (Claude Desktop config paths): <https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop>
- Claude Code MCP docs (`claude mcp add` CLI): <https://code.claude.com/docs/en/mcp>
- Claude Code plugins announcement: <https://www.anthropic.com/news/claude-code-plugins>
- Claude Code skills: <https://code.claude.com/docs/en/skills>
- Cursor MCP setup: <https://cursor.com/docs/context/mcp>

---

## 13. Conversation timeline summary (for context)

This research came out of a multi-thread test of the QA → Fix flow:

1. **Earlier sessions** built the QA inspector, the apply path, the planned-aliases preview. Branch `codex/designer-safe-setup-repair-cli` accumulated the work.
2. **This session** started by reverting an over-scoped broken-alias commit (1504b5d), rebuilt `inspect_ds_setup_gaps` as a six-finding semantic-layer QA pass, polished the CLI for severity ordering and plain-language framing, and (most recently) extended `apply_ds_setup_repairs` to handle re-alias updates so contrast fixes are applyable.
3. **A live test run** on `local_mozwkg5o_ufp0x3jo`: agent walked the designer through 13 findings using the new prompt, designer approved 4 missing-fg additions, 1 contrast re-alias, and 5 border companions. All applied via one MCP-mediated session, zero manual Figma edits. Re-run confirmed the file matched.
4. **The productization question** then surfaced: what does it take to put this in non-technical designers' hands? The discussion moved from informal brainstorming through three concrete proposals to this research document.

If you're picking up the productization work, the live test (step 3) is the proof point that the **product itself is ready** — it works end-to-end with a real designer and a real Figma file. The remaining question is purely distribution and onboarding, which is what this document is about.

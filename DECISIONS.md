# Decisions

Running log of non-obvious project decisions and the reasons behind them.

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


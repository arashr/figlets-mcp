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

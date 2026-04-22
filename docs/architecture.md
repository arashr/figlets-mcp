# Architecture

## Principle

Put deterministic work in the MCP and keep agent-specific reasoning in thin adapters.

## Layers

### `figlets-core`

Reusable, agent-neutral logic for:

- design system detection
- variable and style indexing
- token gap matching
- component inspection
- documentation data extraction
- showcase planning

### `figlets-mcp-server`

The transport layer that exposes stable tools over the core, starting with:

- `detect_design_system`
- `inspect_component`
- `audit_token_bindings`
- `document_component`

It also owns thin bridge adapters that fetch runtime-specific Figma data and hand normalized payloads to shared core analysis.

### Adapters

Agent-specific prompting and orchestration:

- Codex adapter
- Claude adapter
- future adapters for any agent runtime with MCP support

## Boundary rule

- MCP handles deterministic analysis and generation inputs.
- Adapters handle prompting, user confirmation, and ambiguity.
- Figma file decisions live in config or explicit tool parameters.
- Runtime bridges should stay thin: fetch data, normalize shape, call core logic.
- Bridge implementations may be file-based, command-based, or eventually live Figma-backed, but they should all feed the same normalized data contract.
- The first real exporter uses Figma REST as an external producer of that data contract, which keeps the MCP side transport-agnostic.

## Why this split

- consistent outputs across agents
- lower context cost
- easier testing
- easier open-source adoption
- cleaner long-term maintenance than one multi-agent prompt repo

## Project Memory

Architectural decisions and ongoing project context are intentionally stored in-repo:

- `DECISIONS.md` for stable choices and rationale
- `memory/PROJECT_MEMORY.md` for session continuity and open questions

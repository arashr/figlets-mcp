# Migration Plan

## Goal

Move reusable logic out of the current `figlets` repo and into an MCP-first shared architecture without breaking the existing Claude-oriented workflow.

## Phase 1

- Set up the new repository
- Define MCP tool contracts
- Port shared DS detection logic
- Port component inspection and documentation extraction

## Phase 2

- Add token gap auditing
- Add spec generation helpers
- Add deterministic showcase planning

## Phase 3

- Build thin Claude and Codex adapters
- Reduce prompt-side logic in existing workflows
- Reuse the MCP as the primary execution surface

## Phase 4

- Decide whether the old repo becomes an adapter-only project
- Publish stable tool docs
- Add examples and tests for external contributors

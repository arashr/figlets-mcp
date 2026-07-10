# Figlets Prompts

This folder contains paste-ready prompt artifacts for host agents and manual smoke testing.

These prompts are not the public product entrypoint. The normal designer-facing path is the Figlets Agent Interface: `figlets_start` → `figlets_route_intent` → `figlets_workflow_guide`.

- `export-design-md.md` describes the DESIGN.md export conversation.
- `setup-gap-repair.md` describes the setup-gap repair conversation.

Keep prompts host-neutral, plain-language, and aligned with the workflow contracts in `packages/figlets-mcp-server/src/agent-interface/workflows.js`.

# figlets-mcp

`figlets-mcp` is the next step for figlets: an agent-agnostic, MCP-first toolkit for Figma design system workflows.

The current `figlets` repository remains the Claude-facing product. This repository becomes the shared core that we can expose to Codex, Claude, and future agents through stable MCP tools and thin adapters.

## Why this repo exists

The long-term goal is simple:

- keep deterministic Figma logic local
- reduce token burn
- improve consistency across runs
- reserve model reasoning for ambiguity, tradeoffs, and orchestration

## Direction

This repo is organized around three layers:

1. `packages/figlets-core`
   Shared analysis, planning, validation, and transformation logic.
2. `packages/figlets-mcp-server`
   An MCP server that exposes stable tools over the shared core.
3. `packages/figlets-adapter-*`
   Thin agent-specific adapters for Codex, Claude, and future runtimes.

## Initial workflow targets

The first workflows to migrate from the existing `figlets` repo are:

- design system detection
- token gap audit
- component inspection
- component documentation

These are the best early candidates because they are high-value, mostly deterministic, and useful across agents.

## Repo map

- `docs/architecture.md`
- `docs/migration-plan.md`
- `docs/tool-contracts.md`
- `DECISIONS.md`
- `memory/PROJECT_MEMORY.md`
- `examples/`
- `packages/figlets-core/`
- `packages/figlets-mcp-server/`

## Near-term roadmap

1. Define the MCP tool contracts.
2. Port design system detection into `figlets-core`.
3. Expose the first MCP tools from the server.
4. Build thin Claude and Codex adapters on top.

## Current Bridge Strategy

The first bridge is intentionally simple:

- the server can accept inline `figmaData`
- or load a Figma-like JSON payload from `figmaDataPath`
- or run a command that prints that payload with `figmaDataCommand`
- or read that path from `FIGLETS_FIGMA_DATA_PATH`
- or read that command from `FIGLETS_FIGMA_DATA_COMMAND`

That gives us a full fetch-then-analyze seam today, while keeping room for a real Figma runtime bridge next.

## Try It

From the repo root:

```bash
node packages/figlets-mcp-server/src/index.js
```

To run the first tool directly against the bundled example:

```bash
node packages/figlets-mcp-server/src/cli/detect-design-system.js
```

To run it against your own JSON payload:

```bash
node packages/figlets-mcp-server/src/cli/detect-design-system.js /absolute/path/to/figma-data.json
```

To run it through an external exporter command:

```bash
node packages/figlets-mcp-server/src/cli/detect-design-system.js --command "cat /absolute/path/to/figma-data.json"
```

To run the unit tests (from the repo root):

```bash
npm test
```

The test setup is intentionally lightweight and dependency-free right now so contributors do not need to learn extra tooling just to verify changes.

## Export From Figma REST

If you already have a Figma personal access token, you can export a real file into the JSON contract used by `detect_design_system`.

For private local testing on your machine:

1. Copy `.env.example` to `.env`
2. Put your Figma token in `.env`
3. Optionally write exports into `.local/`

Set one of these environment variables, or put it in `.env`:

```bash
export FIGMA_ACCESS_TOKEN=your_token_here
```

Then run (from the repo root):

```bash
node packages/figlets-mcp-server/src/cli/export-figma-file.js --file "https://www.figma.com/design/FILE_KEY/File-Name" --output /absolute/path/to/figma-data.json
```

A local-only example writing into the gitignored `.local/` directory:

```bash
node packages/figlets-mcp-server/src/cli/export-figma-file.js --file "https://www.figma.com/design/FILE_KEY/File-Name" --output .local/figma-data.json
```

Then analyze that export:

```bash
node packages/figlets-mcp-server/src/cli/detect-design-system.js /absolute/path/to/figma-data.json
```

Notes:
- The exporter uses Figma REST `GET /v1/files/:key` and attempts `GET /v1/files/:file_key/variables/local`.
- Per Figma’s official docs, the local Variables endpoint requires the `file_variables:read` scope and is available only to full members of Enterprise orgs.
- If the Variables API is unavailable, the exporter still returns file metadata plus any text and effect styles visible from the file response, along with a warning.
- `.env` and `.local/` are ignored by Git so your private tokens and scratch exports stay on your machine.

## Relationship to the existing figlets repo

This repository does not replace `figlets` immediately. Instead:

- `figlets` stays usable as the current product
- `figlets-mcp` becomes the shared architecture
- logic migrates here gradually
- adapters stay lightweight and agent-specific

## Project Memory

This repo keeps its reasoning close to the codebase:

- [DECISIONS.md](./DECISIONS.md) for durable architectural choices and rationale
- [memory/PROJECT_MEMORY.md](./memory/PROJECT_MEMORY.md) for active context, session notes, and next steps

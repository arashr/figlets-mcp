# Tool Contracts

## Proposed first tools

### `detect_design_system`

Input:

- Figma file context or selected node context
- optional `figmaData`
- optional `figmaDataPath`
- optional `figmaDataCommand`

Output:

- collections
- variables by type
- text styles
- effect styles
- inferred DS capabilities
- normalized summary payload for adapters

Short-term implementation note:

- Until live Figma execution is connected, this tool can accept an optional pre-fetched `snapshot` object and normalize/summarize it in a stable way.
- It can also accept a `figmaData` payload with variables, collections, text styles, and effect styles, then run structural analysis in shared core code.
- The current bridge layer can also load that payload from disk via `figmaDataPath` or `FIGLETS_FIGMA_DATA_PATH`, or from a shell command via `figmaDataCommand` or `FIGLETS_FIGMA_DATA_COMMAND`.
- A new exporter CLI can produce this payload from a real Figma file via the REST API, then pass it back into this same contract.

### `inspect_component`

Input:

- component name, selection, or node id

Output:

- variants
- component properties
- named anatomy
- sizing summary
- token bindings summary

### `audit_token_bindings`

Input:

- node or selection scope

Output:

- violations
- nearest token suggestions
- summary by type

### `document_component`

Input:

- component target
- usage rules
- variant descriptions

Output:

- structured spec payload
- markdown handoff content
- optional Figma spec metadata payload

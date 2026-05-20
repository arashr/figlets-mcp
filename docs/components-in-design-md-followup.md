# Components in DESIGN.md — follow-up plan

**Purpose.** This document captures everything a future agent or contributor needs to integrate per-component design specs (`generate_component_doc` output) into the DESIGN.md export flow. It is intentionally self-contained — you should be able to read this once and have full context, without re-deriving the spec, the architecture, or the open decisions.

**Status.** Not started. The current `design-md-export-flow` branch ships the DESIGN.md export + Google-spec compliance + `figlets-extended` round-trip. Components are deliberately deferred to keep that branch reviewable.

**When to pick this up.** After `design-md-export-flow` merges to `main`, or off `main` directly if it's faster. **Do not pile this onto the current branch** — it has its own design decisions worth reviewing on their own.

---

## 1. Project context — what `figlets-mcp` is

An agent-agnostic MCP toolkit for Figma design-system workflows. Deterministic Figma logic lives in `packages/figlets-core` and `packages/figlets-mcp-server`; thin adapter prompts live under `packages/figlets-adapter`. The bridge plugin in `packages/figma-bridge-plugin` runs inside Figma Desktop and talks to a local HTTP receiver on `:17337` by default.

**Key files relevant to this work:**

- `packages/figlets-core/src/ds-config/design-md-intake.js` — DESIGN.md import + export (where most code changes will land)
- `packages/figlets-mcp-server/src/tools/export-design-md.js` — the MCP tool that orchestrates sync → refresh → write DESIGN.md
- `packages/figlets-mcp-server/src/tools/generate-component-doc.js` — produces per-component spec markdown
- `packages/figlets-mcp-server/src/cli/export-design-md.js` — CLI wrapper
- `packages/figlets-mcp-server/src/cli/lint-design-md.js` — wraps `@google/design.md`'s linter
- `tests/integration/design-md-google-lint.test.js` — the round-trip + lint compliance test
- `docs/designer-export-md-prompt.md` — designer-facing prompt for the export flow
- `DECISIONS.md` and `memory/PROJECT_MEMORY.md` — durable choices and session history

**Read these first** if you're picking up cold: this doc → `memory/PROJECT_MEMORY.md` (top-most three entries) → `DECISIONS.md` (top-most two entries) → `docs/productization-research.md` (for the broader product framing).

---

## 2. What DESIGN.md's `components:` actually accepts

DESIGN.md is defined by `@google/design.md@0.1.1` (installed as devDependency). The spec lives in `node_modules/@google/design.md/dist/linter/spec.md` and `spec-config.yaml`. Quoting the spec verbatim:

> The components section defines a collection of design tokens used to ensure consistent styling of common components. It's a `map<string, map<string, string>>` that maps a component identifier to a group of sub token names and values. The design token values may be literal values, or references to previously defined design tokens.
>
> **Variants.** A component may have a variant for different UI states such as active, hover, pressed, etc. Those variant components may be defined under a different but related key, for example, `button-primary`, `button-primary-hover`, `button-primary-active`. The agent will consider all variants and make the appropriate styling decisions.

**Allowed sub-tokens** (the full list, from `spec-config.yaml`'s `component_sub_tokens`):

| Sub-token | Type |
|---|---|
| `backgroundColor` | Color (hex or `{colors.X}` reference) |
| `textColor` | Color |
| `typography` | Typography (`{typography.X}` reference) |
| `rounded` | Dimension (`Npx` / `Nem` / `Nrem` or `{rounded.X}`) |
| `padding` | Dimension |
| `size` | Dimension |
| `height` | Dimension |
| `width` | Dimension |

Example from the spec:

```yaml
components:
  button-primary:
    backgroundColor: "{colors.primary-60}"
    textColor: "{colors.primary-20}"
    rounded: "{rounded.md}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.primary-70}"
```

The spec also says:

> Note: The components specification is actively evolving. The current structure provides intentional flexibility for domain-specific component definitions while the spec matures.

**Translation:** the components slot is **style-token-shaped**. No variants of variants, no properties API, no anatomy, no usage rules. It exists to give Tailwind / DTCG emitters enough to render a component shell.

The matching body section is `## Components` (canonical name; appears after Shapes, before Do's and Don'ts). Body content is free-form markdown.

---

## 3. What `generate_component_doc` actually produces

Per-component markdown lives in `component-specs/<Name>.md` (filenames include version, e.g. `Button 1.0.0.md`). A representative file ([component-specs/Button 1.0.0.md](../component-specs/Button%201.0.0.md)) has these sections:

- **Title + description** (1–2 sentence purpose)
- **Variants** — table of dimension × values × implementation, plus a "Variant purposes" table
- **Component Properties** — Figma's componentPropertyDefinitions (label, boolean toggles, variant selectors) with types and defaults
- **Token Bindings** — every Figma node × property × token name × resolved value. Multiple rows per variant. Examples:
  - `State=Default | Fill | color/surface/brand | #453f9d`
  - `State=Default | paddingTop | space/4 | 16px`
  - `State=Default | cornerRadius | space/radius/full | 9999px`
  - `label | Fill | color/on-surface/brand | #fafafa`
- **Sizing** — width × height per variant
- **Anatomy** — sub-element tree (FRAME / TEXT / VECTOR layers) with primary token where applicable
- **Usage Rules** — Do / Don't bullet lists
- **Figma metadata** — file name, page, frame, ComponentSet ID, Spec Frame name

**Translation:** our per-component spec is **design-intent-shaped**. Much richer than DESIGN.md's `components:`. Different audience: design + code handover, AI agents implementing the component, variant/anatomy/intent communication.

---

## 4. The fit / mismatch

Overlap is the style tokens — `backgroundColor`, `textColor`, `rounded`, `padding`. Mismatch is everything else (variants tree, properties, anatomy, usage rules).

**Anti-patterns to avoid:**

- ❌ Cram the rich component-md into the DESIGN.md `components:` slot. The spec is strict (zod validators); unknown keys may fail. And it loses information by flattening.
- ❌ Ignore the `components:` slot entirely. Wastes Google's tooling integration (Tailwind / DTCG emitters read it).
- ❌ Replace `component-specs/*.md` with whatever DESIGN.md captures. The per-component files are the agreed handoff format; they're the source of truth for design intent.

**Recommended architecture — three layers:**

| Layer | What | Where | Source of truth for |
|---|---|---|---|
| 1 | Slim style summary | DESIGN.md `components:` front matter | Cross-tool component shell (Tailwind, DTCG) |
| 2 | Index + pointers | DESIGN.md `## Components` body section | Discoverability — "what components exist, where are their full specs" |
| 3 | Full design intent | `component-specs/*.md` (unchanged) | Variants, properties, anatomy, usage rules, all token bindings |

The `figlets-extended` block in DESIGN.md carries layer-1 summaries in structured form so round-trip is lossless.

---

## 5. Design decisions for the implementer

Each of these has options + a recommendation. Pick before coding.

### 5.1 Name mapping (component file → component identifier)

Filenames include version, e.g. `Button 1.0.0.md`. Variants come from `State=Default`, `State=Hover`, etc.

**Strategy:**

- Strip version suffix from filename: `Button 1.0.0` → `Button`
- Lowercase + kebab: `Button` → `button`
- Variant: take each `<prop>=<value>` pair, lowercase, kebab, join with `-`. So `State=Hover` → `hover`. Multi-property variants like `State=Default, Size=Lg` → `default-lg`.
- Default variant collapses to bare key. `State=Default` → `` (empty) → key is just `button`. `State=Hover` → key is `button-hover`. Detect "default" as: the variant marked as default in Figma's variant table, OR a variant key matching `default` / `base` / `normal`.

**Edge cases:**

- Single-variant components (no ComponentSet): emit one key, bare name.
- Variants whose name slugs to the empty string (rare): emit as bare key.
- Two variants slug to the same key: emit a warning, keep first, skip rest.

### 5.2 Padding strategy

DESIGN.md's `padding` is one Dimension. Our token bindings have `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` as four separate rows.

| Option | Behavior | Cost |
|---|---|---|
| (a) Skip padding entirely | Never emit `padding`. | Loses info; agent reads zero padding by default. |
| (b) Pick `paddingTop` | Single value, always there. | Lies when asymmetric. |
| (c) Emit only when all four equal | Honest. | Most components today won't qualify. |
| (d) Emit when top==bottom and left==right | Allows symmetric pill buttons. | Still lossy on full asymmetry; DESIGN.md can't express it. |

**Recommendation: (c) for v1, revisit if real Figma components show heavy asymmetry that's worth capturing.** No false symmetry beats partial info.

### 5.3 Token references vs. literals

Spec format prefers `{colors.X}` references over literal `"#FF0000"`. Our token bindings already have token names like `color/surface/brand`.

`color/surface/brand` needs to resolve to a key in the `colors:` front-matter map. Today `colors:` emits:

- Bare brand role names: `primary`, `neutral`, ...
- Ramp steps: `primary-500`, `neutral-100`, ...

Semantic colors like `surface/brand` are **not** in `colors:` today — they're only in the `components:` front-matter and the `figlets-extended` block.

**Two paths forward:**

| Option | Behavior | Implication |
|---|---|---|
| (i) Emit semantic colors into `colors:` too | `colors:` grows: `surface-brand: "#453f9d"` resolved from Light-mode alias | References work; also clears existing `orphanedTokens` lint warnings as a bonus |
| (ii) Leave semantic colors only in `components:`, fall back to literal hex on cross-references | `backgroundColor: "#453f9d"` instead of `{colors.surface-brand}` | Simpler. Worse for downstream tooling. |

**Recommendation: (i).** Resolves the orphaned-tokens warnings naturally and gives every reference a target. Caveat: semantic colors have Light/Dark — pick Light for the literal hex (matches the existing components-block convention).

### 5.4 Typography references

Component-md spec sheets reference typography by token name (e.g., `type/label/md`). DESIGN.md's `typography:` block uses kebab keys (`label-md`).

Translation: when a component binding references `type/label/md` → emit `{typography.label-md}`. Slug consistent with how typography keys are emitted in `_buildTypographyMap` (already replaces `/` with `-`).

### 5.5 Where the component data comes from

| Source | Pros | Cons |
|---|---|---|
| (a) **Parse `component-specs/*.md` from disk** | Read-only, no bridge needed, fast | Brittle if spec format changes; needs a markdown parser for tables |
| (b) **Re-call `generate_component_doc`'s underlying Figma inspection** | Freshest data; bypasses parser fragility | Requires bridge + plugin open; pricier per export; may surface new components not yet documented |
| (c) **Accept caller-supplied summaries** | Most flexible; future-proof | Caller has to compute them; complicates the tool signature |

**Recommendation: (a) by default, with (c) as an override.** The `component-specs/*.md` files are already the agreed handoff format. Falling through to (b) means re-deriving from Figma every export, which makes the export tool depend on a live plugin connection for components — too much coupling.

Lookup path: relative to the config's directory, glob `component-specs/*.md`. Make the directory configurable (`component_specs_dir`) with the default being `path.join(path.dirname(configPath), '..', 'component-specs')` or wherever your project keeps them. Check with the user — different projects place this folder differently.

### 5.6 Opt-out semantics

`export_design_md` is the orchestrator. Add:

- `include_components: boolean` (default `true`) — opt out entirely; emits today's behavior.
- `component_specs: string[]` (optional) — explicit list of file paths. Overrides the auto-discovery glob.

Both honor the existing `dry_run` flag.

---

## 6. Implementation roadmap

Land in this order. Each step is independently testable.

1. **Add `figlets-core` helper `parseComponentMd(filePath)`** that returns a structured object:

   ```ts
   {
     name: string,                         // 'Button'
     fullName: string,                     // 'Button 1.0.0'
     version: string | null,               // '1.0.0'
     defaultVariantKey: string | null,     // 'State=Default'
     variants: {
       [variantKey: string]: {             // 'State=Default'
         backgroundColor?: { token?: string, value?: string },
         textColor?: { token?: string, value?: string },
         typography?: { token?: string },
         rounded?: { token?: string, value?: string },
         padding?: { all?: number, top?: number, right?: number, bottom?: number, left?: number },
         size?: { width?: number, height?: number }
       }
     }
   }
   ```

   Parser scope: read the Token Bindings table + Sizing table from the spec markdown. Skip Anatomy, Properties, Usage Rules — out of scope for this slot.

2. **Add helper `componentMdToComponentsBlock(parsed, slugifier, paddingStrategy)`** that turns a parsed spec into a map keyed by the slugified identifier (per 5.1):

   ```ts
   {
     'button': { backgroundColor: '{colors.surface-brand}', textColor: '{colors.on-surface-brand}', rounded: '{rounded.full}', padding: '16px' },
     'button-hover': { backgroundColor: '...' },
     ...
   }
   ```

3. **Extend `_buildColorsMap`** to also emit semantic colors (per 5.3 option i). Semantic name → Light-mode alias → resolve through ramp → emit. New entries: `surface-brand: "#..."`, `on-surface-brand: "#..."`, etc.

4. **Extend `dsConfigToDesignMd`** in `packages/figlets-core/src/ds-config/design-md-intake.js`:
   - Accept `options.components` (array of parsed summaries).
   - Merge component summaries into the `components:` front matter (currently only emits semantic pairs).
   - Emit a `## Components` body section with intro prose + an index table linking to per-component spec files.
   - Include the components summary in the `figlets-extended` block.

5. **Extend `dsConfigToDesignMd` intake** (`designMdToDsConfig`) to restore `components` from the extended block when present. No new behavior needed on the front-matter path — external DESIGN.md files don't use our component summary format.

6. **Extend `export_design_md` tool** in `packages/figlets-mcp-server/src/tools/export-design-md.js`:
   - Add `include_components` + `component_specs` to the schema.
   - When `include_components !== false`, glob the conventional path or use the explicit list.
   - Parse each file via `parseComponentMd`; collect summaries; pass to `dsConfigToDesignMd`.
   - Return the list of consumed component paths in the tool result.

7. **Extend the CLI** in `packages/figlets-mcp-server/src/cli/export-design-md.js`:
   - `--no-components` flag.
   - `--component-specs <glob>` for override.

8. **Extend the designer prompt** in `docs/designer-export-md-prompt.md` to mention "I'll also include any component specs in `component-specs/`."

---

## 7. Tests to add

| Test | Location | What it covers |
|---|---|---|
| Slugifier units | `tests/core/component-md-slug.test.js` (new) | Filename + variant name → component key, default-variant collapse, multi-prop variants, edge cases |
| Padding strategy | `tests/core/component-md-padding.test.js` (new) | All-equal emits; asymmetric skips; partial values handled |
| Parser | `tests/core/component-md-parse.test.js` (new) | Fixture spec md → structured object; missing sections handled gracefully |
| Semantic colors in `colors:` | `tests/core/design-md-intake.test.js` (extend) | When `DS.color.semantics.pairs` set, `colors:` includes `surface-brand` style keys |
| `components:` from component summaries | `tests/core/design-md-intake.test.js` (extend) | Components merge into existing semantic-pairs components block; references resolve |
| Round-trip components in extended block | `tests/integration/design-md-google-lint.test.js` (extend) | Export + lint + reparse restores component summaries identically |
| Lint passes with components | `tests/integration/design-md-google-lint.test.js` (extend) | `@google/design.md` lint on an export with components — zero errors, references resolve |
| Server tool opt-out | `tests/server/export-design-md-tool.test.js` (extend) | `include_components: false` produces output identical to today |
| Server tool with component_specs glob | `tests/server/export-design-md-tool.test.js` (extend) | Fixture component specs → DESIGN.md contains expected component keys |

---

## 8. What this is NOT

- ❌ Not a rewrite of `generate_component_doc`. Per-component .md files remain canonical.
- ❌ Not round-trip for component anatomy / properties / usage rules through DESIGN.md. Those live in `component-specs/*.md` only.
- ❌ Not a way to *generate* component specs. The flow is: existing component-md → DESIGN.md summary, not the reverse.
- ❌ Not coupled to the `design-md-export-flow` branch. Implement after that lands or off main.

---

## 9. Pitfalls observed during research

- **The Google linter's `orphanedTokens` rule** flags colors that aren't referenced by any component. Today's export has 5 such warnings on a representative DS. Implementing 5.3 option (i) (emit semantic colors to `colors:`) plus this work will reduce them naturally as more components reference more colors.
- **The `figlets-extended` block** is a fenced ```figlets-extended``` code block in the markdown body. Google's linter passes it through (unknown info-string). Don't move the round-trip data into front-matter — zod validators will reject unknown keys.
- **`@google/design.md` is ESM-only.** Our tests use CJS `await import('@google/design.md/linter')`. The integration test ([tests/integration/design-md-google-lint.test.js](../tests/integration/design-md-google-lint.test.js)) shows the pattern.
- **Plugin code (`packages/figma-bridge-plugin/code.js`) is ES6-era only** — no `??`, `?.`, `**` operators. None of this work touches plugin code, but if you extend (b) re-derivation from Figma, the plugin path is hot — be careful.

---

## 10. Sources

- DESIGN.md spec: `node_modules/@google/design.md/dist/linter/spec.md` (after `npm install`)
- Spec config (zod-equivalent schema): `node_modules/@google/design.md/dist/linter/spec-config.yaml`
- Linter API: `node_modules/@google/design.md/dist/linter/lint.d.ts`
- Our exporter: `packages/figlets-core/src/ds-config/design-md-intake.js`
- Our component doc tool: `packages/figlets-mcp-server/src/tools/generate-component-doc.js`
- Example component spec: `component-specs/Button 1.0.0.md`
- Decision: `DECISIONS.md` entry "[2026-05-13] DESIGN.md export is spec-compliant with a `figlets-extended` round-trip block"
- Session history: `memory/PROJECT_MEMORY.md` entries dated 2026-05-13

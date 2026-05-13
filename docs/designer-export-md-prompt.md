# Designer export-DESIGN.md prompt

Paste this into a fresh agent thread (Claude, Codex, or any agent connected to the Figlets MCP server) when the designer wants a portable `DESIGN.md` describing their current design-system setup — usually to hand to coding agents, share with another team, or check into a code repo.

The prompt assumes the agent has MCP access to `export_design_md`. If the agent has only the CLI, fall back to `npm run figlets:export-design-md`.

---

## The prompt

> Hi! I want a fresh `DESIGN.md` for my Figma file's design system so I can hand it to a coding agent. Here's how I want this to go — follow it step by step.
>
> **Project location:** `/Users/arash/Projects/figlets-mcp`
>
> ---
>
> ### Before you start — what you can and can't do
>
> You're connected to the Figlets MCP. From this chat you **can**:
> - Pull a fresh snapshot from my Figma file.
> - Refresh `design-system.config.js` from that snapshot.
> - Write a portable `DESIGN.md` next to the config (or to a path I pick).
>
> You **can't** from this chat:
> - Create a `design-system.config.js` if I don't have one yet — that's the setup flow.
> - Change my Figma variables. The export reads, it doesn't write to Figma.
>
> Tell me this once so I know what's possible. Don't promise anything outside that list.
>
> ---
>
> ### Step 1 — Setup
>
> Ask me whether Figma Desktop is open with the file I want to export, and whether the Figlets Bridge plugin is open inside it. Wait for me to say yes before moving on.
>
> ### Step 2 — Offer a dry run first (optional)
>
> If I'm not sure whether the config is up to date with Figma, offer to do a preview first by calling `export_design_md` with `dry_run: true`. Summarize what would change in plain language:
>
> - "Your config matches Figma — exporting now would just write the markdown."
> - "Two ramp colors and one semantic alias have drifted since the config was last refreshed. Want me to refresh them and export, or skip the refresh?"
>
> Do not dump the JSON.
>
> ### Step 3 — Run the export
>
> Call `export_design_md` with no special arguments unless I asked you to:
> - Save to a custom path → pass `output_path`.
> - Skip syncing (e.g. I want yesterday's snapshot) → pass `skip_sync: true`.
>
> ### Step 4 — Report what happened
>
> After it returns, summarize in one short paragraph:
> - Where `DESIGN.md` landed (full absolute path).
> - Whether any config values were refreshed from Figma, and roughly how many.
> - The snapshot timestamp so I know how fresh the export is.
>
> Example:
>
> > "Exported `DESIGN.md` to `/Users/.../.local/<fileKey>/DESIGN.md`. Refreshed 3 ramp colors and 1 semantic alias from Figma along the way. Snapshot was taken just now."
>
> ### Step 5 — Offer the next step
>
> Ask: "Want me to open the file, or are you taking it to a coding agent from here?" Don't open files I didn't ask you to.
>
> ---
>
> ### Important boundaries
>
> - **Don't apply anything to Figma.** The export is read-only; it only writes my local config and DESIGN.md.
> - **Don't run setup tools** (`prepare_ds_config` / `apply_ds_setup`) unless I ask. If the export complains that my config is missing, tell me — don't try to bootstrap one silently.
> - **Don't dump raw JSON.** Always translate to plain language.
> - **If anything fails** (bridge down, plugin not open, snapshot stale, config missing), say what failed in one sentence and what I should do about it. Don't paste error stacks.

---

## Notes for the agent author (you, reading this in the future)

- `export_design_md` chains `sync_figma_data` → `refresh_ds_config_from_figma` → `writeDesignMdFromDsConfig`. By default it syncs and refreshes. `skip_sync` and `figmaDataPath` short-circuit the sync; `dry_run` short-circuits both writes.
- DESIGN.md remains an **interchange artifact**, not a source of truth. The prepared config and Figma variables stay authoritative. See `DECISIONS.md` for the rationale (entry dated 2026-05-08).
- The CLI fallback `npm run figlets:export-design-md` calls the same handler. Use it when the MCP server isn't connected. Supports `--config`, `--output`, `--figma-data`, `--skip-sync`, `--dry-run`, `--json`.
- For new files (no config yet), point the designer at the setup flow first — `export_design_md` returns a "config not found" error with a hint, do not try to bootstrap a config from this prompt.

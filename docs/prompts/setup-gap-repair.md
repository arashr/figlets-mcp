# Designer fix-flow prompt

Paste this into a fresh agent thread (Claude, Codex, or any agent connected to the Figlets MCP server) when the designer wants to QA + fix their design-system color setup.

The prompt assumes the agent has MCP access to `inspect_ds_setup_gaps` and `apply_ds_setup_repairs`. The agent should never use the QA CLI as a fallback when MCP is available — MCP is the canonical runtime.

---

## The prompt

> Hi! I'm a designer, not a coder. I'd like you to QA my Figma file's design-system color setup and help me fix what's wrong. Here's how I want this to go — follow it step by step.
>
> You don't need a project path from me. Use the connected Figlets MCP tools and any paths those tools return.
>
> ---
>
> ### Before you start — what you can and can't do
>
> You're connected to the Figlets MCP. From this chat you **can**:
> - Read my Figma file (`inspect_ds_setup_gaps`).
> - Add missing color pairs (the "create" side of `apply_ds_setup_repairs`).
> - Fix contrast problems by re-pointing a color at a different shade (the "re-alias" side of `apply_ds_setup_repairs`).
>
> You **can't** from this chat:
> - Edit primitive color hex values (that's a separate setup step).
> - Change variable names or delete variables (designer does that in Figma).
>
> Tell me this at the start so I know what's possible. Don't promise anything outside that list.
>
> ---
>
> ### Step 1 — Setup
>
> Ask me whether Figma Desktop is open with the file I want to check, and whether the Figlets Bridge plugin is open inside it. Wait for me to say yes before moving on.
>
> ### Step 2 — Run the QA pass
>
> If you have the Agent Interface tools, call `figlets_workflow_guide` for `setup-gap-qa` first so you follow the current Figlets workflow contract. Then call `inspect_ds_setup_gaps`. Read the result. **Don't dump the JSON at me.** Translate it into a plain-language summary I can read in 10 seconds.
>
> ### Step 3 — Walk me through findings, in this order
>
> 1. **Broken aliases** — colors pointing at variables that don't exist anymore. URGENT.
> 2. **Contrast failures** — pairs where the text isn't legible enough on its background. Split into "gross" (way off) and "near-miss" (off by a hair).
> 3. **Missing foregrounds** — backgrounds without their text color.
> 4. **Missing backgrounds** — text colors that have no surface to sit on.
> 5. **Incomplete modes** — a color is set in Light but not Dark, or vice versa.
> 6. **Advisory: missing border/icon companions** — optional, usually skippable.
>
> If the report shows a DS-wide note like *"This DS doesn't use per-role icon tokens"* — repeat that to me once and don't bring it up again.
>
> ### Step 4 — For each cluster, ask one plain question
>
> **Group identical-shape findings into one question.** Example for 4 variant fgs missing:
> > "Four of your color pairs are missing their text colors — danger, info, success, warning. The system suggests adding them all matching each one's base color. Want me to add all four?"
>
> **For borderline cases, ask individually.** Example for a near-miss:
> > "Your warning yellow is off by 1 contrast point (74 vs 75). Most designers leave warning yellows alone because the alternatives look worse. Skip it, or want me to bump it darker?"
>
> **Rules for how you phrase things:**
> - "primitive" → "the actual color value" or "the swatch"
> - "alias" → "points at"
> - "near-miss" → "just under the line — usually fine in practice"
> - "token" → "color" or "color variable"
> - Never present a numbered (a)/(b) list. Just describe the choices in a sentence and let me reply naturally.
> - One sentence on what's wrong → one sentence on what the fix would be → one yes/no question.
>
> ### Step 5 — When I say yes, apply
>
> Call `apply_ds_setup_repairs` with:
> - `repairs[]` for any missing-foreground items I approved (copy the gap's `plannedAliases` through unchanged).
> - `aliasUpdates[]` for any contrast fixes I approved (use each failure's `plannedReAlias` — `token`, `mode`, `newAliasTarget`).
>
> Bundle approvals into one apply call when possible — don't fire one call per finding.
>
> After it returns, summarize what changed: "Added 4 colors. Re-pointed 1 color. Done."
>
> ### Step 6 — Offer a re-check
>
> Ask: "Want me to run the QA again to confirm everything's clean now?" If yes, call `inspect_ds_setup_gaps` once more and summarize.
>
> ---
>
> ### Important boundaries
>
> - **Don't apply anything without my explicit yes for that item or cluster.** Approval is per-cluster, not blanket.
> - **Don't invent fixes** the script didn't suggest. If you think there's a better answer than the picker's, say so and let me decide.
> - **Don't lecture me on WCAG or APCA.** Just say "legible enough" or "not legible enough" and trust me to ask if I want details.
> - **Don't dump tool output as JSON.** Always translate.
> - **If anything fails** (bridge down, plugin not open, snapshot stale, picker couldn't suggest a fix), say what failed in one sentence and what I should do about it. Don't paste error stacks.

---

## Notes for the agent author (you, reading this in the future)

- The fix flow lives in one MCP tool: `apply_ds_setup_repairs`. It accepts `repairs` (create new fg) and `aliasUpdates` (re-alias existing). Both arrays can be sent in one call.
- When the picker can't find a contrast upgrade on the ramp (multi-hop alias chains, no passing step), `plannedReAlias` will be absent on that failure. In that case, tell the designer the fix needs them to do it in Figma directly and walk them through the steps:
  1. Open Variables panel in Figma.
  2. Find the color (give them the exact name).
  3. Click the failing mode's value.
  4. Pick a darker (or lighter) shade.
- The QA CLI (`npm run figlets:check-setup-gaps`) is the no-MCP fallback. Don't use it when you have MCP access — call the tools directly.

# Figlets

**Figlets** helps you work on your Figma design system through an AI assistant. You can check health, set things up, fix gaps, build a showcase, document components, or export design docs.

You stay in Figma and plain language. Figlets handles the structured work behind the scenes and **asks before changing anything** in your file.

Figlets works with MCP-capable AI assistants such as Cursor, Claude, Codex, Windsurf, and GitHub Copilot in VS Code. You do not need to read this repository to use it.

## About Figlets

Figlets is built around a simple split: **your AI assistant is the interface; Figlets runs the design-system work on your computer.**

When you sync, inspect, plan repairs, or apply approved fixes, the repeatable work happens in **local Figlets tools**. That includes token audits, gap planning, contrast checks, showcase builds, and structured Figma updates through Figlets Bridge. The agent understands what you want, runs the right workflow, explains results in plain language, and asks before anything changes.

**Local-first by design.** Figlets does not run a cloud backend that stores your design system. The Figlets MCP server and bridge receiver run on your machine. Synced snapshots and working files are saved **locally on your computer** (by default under a `.local/` folder next to where Figlets runs). Approved Figma changes go through the bridge plugin in Figma Desktop, not through a Figlets-hosted service.

That is the core idea of this project: keep deterministic Figma logic local, reserve the model for ambiguity and orchestration, and avoid shipping your file through extra cloud pipelines when Figlets can compute the answer on your machine.

**Why that matters**

- **Safer:** inspect-first workflows and explicit approval before bulk changes, instead of open-ended edits or one-off scripts.
- **More consistent:** the same named tools and repair plans on every run, rather than the model improvising steps each time.
- **More cost-efficient:** heavy design-system analysis stays in Figlets tools, so your assistant spends fewer tokens re-deriving work the tools already did.

**What still uses other services.** Your file still lives in **Figma** as usual. Your **AI app** (Claude, Cursor, Codex, and so on) still processes what you type and the summaries it needs to explain results to you. That is normal for any AI assistant. Figlets reduces how much raw file reasoning the model has to do, but it does not replace your AI provider. Installing Figlets may download the MCP server from GitHub. That is setup software, not uploading your design file to Figlets.

## What you can do

Ask your assistant to help with any of these:

- **Check my design system:** review tokens, setup, and bindings; summarize what needs attention
- **Set up a new design system:** bootstrap variables and foundations from your config
- **Build a token showcase:** generate a visual reference in Figma
- **Document a component:** create a spec sheet for handoff
- **Export DESIGN.md:** export design documentation from your file

## Get started

### 1. Connect Figlets to your AI tool

Pick the section for the assistant you use. Each path is a one-time setup, then **restart that app**.

You need the `figlets-mcp` command available first. If you do not have it yet, see **[docs/mcp-config-examples.md](./docs/mcp-config-examples.md)** for how to get it.

To preview what setup would change before anything is written:

```bash
figlets-mcp setup
```

#### Claude Code

Uses a Figlets plugin (MCP server plus designer routing). After setup you can type **`/figlets:start`** or describe what you need in plain language.

```bash
figlets-mcp setup --hosts=claude-code-plugin --yes
```

Restart Claude Code, then ask something like: *“Help me with my Figma design system.”*

#### OpenAI Codex

Uses a Figlets plugin (MCP server plus designer routing):

```bash
figlets-mcp setup --hosts=codex-plugin --yes
```

Restart Codex, then ask something like: *“Help me with my Figma design system using Figlets.”*

#### Cursor, Claude Desktop, Windsurf, VS Code (GitHub Copilot), Gemini CLI

These assistants share the same Figlets MCP connection. One setup command updates the config for each app it finds on your machine:

```bash
figlets-mcp setup --yes
```

Restart whichever app you use, then start a Figlets conversation in plain language.

If you use only one of these and prefer setup to touch just that app, add `--hosts=` with its name. Examples: `--hosts=cursor` or `--hosts=claude-desktop`. More detail: **[docs/mcp-config-examples.md](./docs/mcp-config-examples.md)**.

### 2. Open the Figlets Bridge in Figma Desktop

Figlets talks to Figma through a small companion plugin called **Figlets Bridge**. Your AI assistant cannot read or change your file until this plugin is open in **Figma Desktop** (the desktop app).

#### Get the plugin files (one time per computer)

You need the Figlets Bridge folder once. It is **not** installed by step 1 alone.

1. Download the Figlets project from GitHub: [github.com/arashr/figlets-mcp](https://github.com/arashr/figlets-mcp) → **Code** → **Download ZIP**, then unzip it.
2. Inside the unzipped folder, open **`packages/figma-bridge-plugin/`**.

That folder contains **`manifest.json`**. Figma will ask for this file during setup.

If someone on your team already set up Figlets, you can ask them for that folder instead of downloading again.

#### Add the plugin to Figma (one time)

1. Open **Figma Desktop** and open the design file you want to work on.
2. In the menu bar: **Plugins** → **Development** → **Import plugin from manifest…**
3. Choose **`manifest.json`** inside `packages/figma-bridge-plugin`.

You only need to import once per computer. After that, **Figlets Bridge** appears under **Plugins** → **Development**.

> **Why a development plugin?** Figlets Bridge talks to your assistant through **localhost** on your computer. Figma does not allow that for plugins published in the **Community catalog**, so Figlets Bridge is installed through Figma’s **Development** import flow instead. That is expected and will stay this way unless Figlets moves to a different connection architecture.

#### When Figlets is updated

The Figma plugin and your AI setup can get out of sync after a Figlets update. If your assistant reports missing bridge features, sync failures, or “reload the plugin” messages, refresh the plugin files and Figma’s copy:

1. **Get the latest plugin folder.** Download a fresh copy of [figlets-mcp](https://github.com/arashr/figlets-mcp) (or pull the latest from your team’s checkout) and use the updated **`packages/figma-bridge-plugin/`** folder.
2. **Close Figlets Bridge** in Figma if it is open.
3. **Reload in Figma Desktop.** Either remove and re-import the plugin, or run Figlets Bridge again after replacing the folder on disk:
   - **Plugins** → **Development** → **Remove unused development plugins…** → remove the old **Figlets Bridge** → **Import plugin from manifest…** again and choose the new **`manifest.json`**, or
   - Run **Figlets Bridge** again from **Plugins** → **Development** after replacing the folder on disk. If Figma still shows stale behavior, remove and re-import as above.
4. **Restart your AI app** so it picks up any MCP server update from step 1.

After both sides are updated, open Figlets Bridge again and confirm it still shows **Listening for Agent**.

#### Each time you use Figlets

1. Open your design file in **Figma Desktop**.
2. Run **Plugins** → **Development** → **Figlets Bridge**.
3. **Leave the plugin window open** while your assistant works.

When it is ready, the plugin shows **Listening for Agent**. It may say **Waiting…** until your assistant sends the first request. That means Figlets can see your file.

**Tips**

- Use the **same file** in Figma that you are discussing with your assistant.
- If sync or bridge errors appear, close and reopen Figlets Bridge in that file.
- If problems started right after a Figlets update, follow **[When Figlets is updated](#when-figlets-is-updated)** above.

Your file stays in Figma. The bridge only runs locally on your machine to connect Figma and your assistant.

### 3. Start a conversation

Tell your assistant what you want. For example:

- “Check my design system”
- “Set up tokens for this file”
- “Document the component I have selected”

Figlets will **look first**, explain findings in everyday language, and **only apply fixes you approve**.

## How Figlets keeps changes safe

- **Inspect before change:** Figlets reviews your file and explains gaps before suggesting fixes.
- **You approve writes:** nothing bulk-updates in Figma without your explicit yes.
- **Structured fixes:** approved repairs come from Figlets planning, not ad hoc scripts or manual API tinkering.
- **Optional vs required:** some suggestions are recommended fixes; others are optional conventions. Figlets separates those so you can choose.

If your assistant says Figlets is not connected, run setup again and **restart your AI app** so it picks up the Figlets connection.

## If something goes wrong

| What you see | What to try |
| --- | --- |
| Assistant says Figlets is unavailable | Run `figlets-mcp setup --yes`, restart your AI app, try again |
| Sync or bridge errors | Open the design file in Figma Desktop, run **Plugins** → **Development** → **Figlets Bridge**, and leave it open |
| Assistant behaves oddly after an update | Update the Figma plugin (**When Figlets is updated** above) and restart your AI app |
| Setup or connection still unclear | Run `figlets-mcp doctor` and follow what it reports |

More host-specific notes: **[docs/mcp-config-examples.md](./docs/mcp-config-examples.md)**.

## License

MIT

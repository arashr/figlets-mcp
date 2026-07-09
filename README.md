# Figlets

**Figlets** lets a designer work on a Figma design system through an AI assistant. Ask in plain language; Figlets runs the structured local checks, planning, and approved Figma writes.

You stay in Figma and conversation. Figlets inspects first, explains what it found, and **asks before changing anything** in your file.

Figlets currently works best in **Claude Code** through the Figlets plugin. It also supports OpenAI Codex, Cursor, Claude Desktop, Windsurf, VS Code/GitHub Copilot, Gemini CLI, and Google Antigravity through MCP setup paths.

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

## What Figlets Can Do

Ask your assistant to help with any of these:

- **Check my design system:** review tokens, setup, and bindings; summarize what needs attention
- **Set up a new design system:** bootstrap variables and foundations from your config
- **Build a token showcase:** generate a visual reference in Figma
- **Document a component:** create a spec sheet for handoff
- **Export DESIGN.md:** export design documentation from your file
- **Check the selected component:** audit selected layers for raw values and suggest safe bindings

## Get started

### Requirements

- **Figma Desktop.** The browser version of Figma cannot run the local bridge plugin.
- **Node.js 18 or newer.** The repo development suite uses Node 22+, but the released Figlets MCP server supports Node 18+.
- **An MCP-capable AI app.** Claude Code is the most polished path today.

### 1. Install the Figlets command

Figlets is distributed as a GitHub release tarball. Install the command once:

```bash
npm install -g https://github.com/arashr/figlets-mcp/releases/download/v1.1.0/figlets-mcp-server-1.1.0.tgz
```

Then check that it runs:

```bash
figlets-mcp doctor
```

When an assistant starts Figlets, `figlets_start` reports the running Figlets MCP version and warns when a newer release is available.

You can also run setup from a local checkout with `npm link --workspace=@figlets/mcp-server`; that path is mainly for local development and Codex plugin testing.

### 2. Connect Figlets to your AI tool

Pick the section for the assistant you use. Each path is a one-time setup, then **restart that app**.

#### Claude Code Recommended

The Claude Code plugin is the recommended setup. It installs the Figlets MCP server entry, a `/figlets:start` command, and a designer skill so normal phrases route into Figlets automatically:

```bash
figlets-mcp setup --hosts=claude-code-plugin --yes
```

Restart Claude Code, then ask something like: *“Help me with my Figma design system.”*

#### OpenAI Codex

Codex support uses a local plugin marketplace entry today, so run this from a `figlets-mcp` repo checkout rather than from the global tarball install:

```bash
npm install
npm link --workspace=@figlets/mcp-server
figlets-mcp setup --hosts=codex-plugin --yes
```

Restart Codex, then ask something like: *“Help me with my Figma design system using Figlets.”*

#### Cursor, Claude Desktop, Windsurf, VS Code (GitHub Copilot), Gemini CLI

These assistants use a raw MCP server entry. One setup command previews or updates the config for each app it finds on your machine:

```bash
figlets-mcp setup
figlets-mcp setup --yes
```

If you use only one host, target it directly:

```bash
figlets-mcp setup --hosts=cursor --yes
figlets-mcp setup --hosts=claude-desktop --yes
figlets-mcp setup --hosts=windsurf --yes
figlets-mcp setup --hosts=vscode --yes
figlets-mcp setup --hosts=gemini --yes
figlets-mcp setup --hosts=antigravity --yes
```

Restart whichever app you use, then start a Figlets conversation in plain language.

More detail: **[docs/mcp-config-examples.md](./docs/mcp-config-examples.md)**.

### 3. Open the Figlets Bridge in Figma Desktop

Figlets talks to Figma through a small companion plugin called **Figlets Bridge**. Your AI assistant cannot read or change your file until this plugin is open in **Figma Desktop** (the desktop app).

#### Get the plugin files (one time per computer)

You need the Figlets Bridge folder once. It is **not** installed by step 1 alone.

Download the repository source ZIP, not the `figlets-mcp-server-*.tgz` release asset. The `.tgz` file is only the MCP server used by your AI app; it does not include the Figma plugin files.

1. Download the Figlets source ZIP:
   - Stable v1.1.0 source: [figlets-mcp v1.1.0 source ZIP](https://github.com/arashr/figlets-mcp/archive/refs/tags/v1.1.0.zip)
   - Or latest source: [github.com/arashr/figlets-mcp](https://github.com/arashr/figlets-mcp) → **Code** → **Download ZIP**
2. Unzip it.
3. Inside the unzipped folder, open:
   - **`figlets-mcp-1.1.0/packages/figma-bridge-plugin/`** if you downloaded the stable v1.1.0 source ZIP
   - **`figlets-mcp-main/packages/figma-bridge-plugin/`** if you downloaded latest source from **Code** → **Download ZIP**

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

### 4. Start a conversation

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

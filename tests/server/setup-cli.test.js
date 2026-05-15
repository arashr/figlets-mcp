const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  FIGLETS_PLUGIN_MARKETPLACE_NAME,
  FIGLETS_PLUGIN_SPEC,
  FIGLETS_CODEX_PLUGIN_MARKETPLACE_NAME,
  FIGLETS_CODEX_PLUGIN_SPEC,
  getSetupPlan,
  applySetupPlan,
  formatSetupPlan,
} = require("../../packages/figlets-mcp-server/src/cli/setup.js");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-setup-cli-test-"));
const home = path.join(TEMP_DIR, "home");
const cwd = path.join(TEMP_DIR, "project");
const bin = path.join(TEMP_DIR, "bin");
const fakeNode = path.join(bin, "node");
const fakeFigletsBin = path.join(TEMP_DIR, "repo", "packages", "figlets-mcp-server", "bin", "figlets-mcp.js");
const codexMarketplaceSource = path.join(TEMP_DIR, "repo");
mkdirp(home);
mkdirp(cwd);
mkdirp(bin);
mkdirp(path.dirname(fakeFigletsBin));
mkdirp(path.join(codexMarketplaceSource, ".agents", "plugins"));
fs.writeFileSync(path.join(codexMarketplaceSource, ".agents", "plugins", "marketplace.json"), JSON.stringify({ name: "figlets-codex", plugins: [] }));

function mkdirp(dirPath) {
  if (fs.existsSync(dirPath)) return;
  mkdirp(path.dirname(dirPath));
  try {
    fs.mkdirSync(dirPath);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
}

try {
  {
    // Default source is the public GitHub slug, so nothing leaks a developer-local path even without
    // any injected override.
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      env: { PATH: "" },
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
      codexMarketplaceSource,
    });
    assert.strictEqual(plan.command, "figlets-mcp");
    assert.ok(plan.targets.some(target => target.id === "claude-desktop"));
    assert.ok(plan.targets.some(target => target.id === "codex-plugin"));
    assert.ok(!plan.targets.some(target => target.id === "codex"), "default plan should prefer the Codex plugin when its local marketplace is available");
    assert.ok(plan.targets.some(target => target.id === "claude-code" && target.status === "manual"));
    // The plugin target is always present so explicit --hosts=claude-code-plugin always returns an
    // actionable plan; when claude is not on PATH it reports manual with a clear next step.
    const pluginTarget = plan.targets.find(target => target.id === "claude-code-plugin");
    assert.ok(pluginTarget, "claude-code-plugin should always appear so explicit selection works");
    assert.strictEqual(pluginTarget.status, "manual");
    assert.ok(pluginTarget.reason && /not found on PATH/i.test(pluginTarget.reason), "manual reason should explain the missing claude binary");
    assert.ok(pluginTarget.reason.includes("arashr/figlets-mcp"), "manual reason should quote the GitHub marketplace source");
    assert.ok(!JSON.stringify(plan).includes(os.homedir()), "setup plan should not leak the developer's real home directory");
  }

  {
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code-project"],
      env: { PATH: "" },
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
    });
    assert.strictEqual(plan.targets[0].path, path.join(cwd, ".mcp.json"));
    assert.strictEqual(plan.targets[0].status, "would-update");
    const applied = applySetupPlan(plan);
    assert.strictEqual(applied.targets[0].status, "updated");
    const config = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf-8"));
    assert.strictEqual(config.mcpServers.figlets.command, fakeNode);
    assert.deepStrictEqual(config.mcpServers.figlets.args, [fakeFigletsBin]);

    const idempotent = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code-project"],
      env: { PATH: "" },
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
    });
    assert.strictEqual(idempotent.targets[0].status, "unchanged");
  }

  {
    const plan = getSetupPlan({ homeDir: home, cwd, platform: "darwin", hosts: ["cursor", "vscode"] });
    assert.deepStrictEqual(plan.targets.map(target => target.id).sort(), ["cursor", "vscode"]);
  }

  {
    const claudePath = path.join(bin, "claude");
    fs.writeFileSync(claudePath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(claudePath, 0o755);
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code"],
      env: { PATH: bin },
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
    });
    assert.strictEqual(plan.targets[0].status, "would-run");
    assert.ok(plan.targets[0].command.includes("claude mcp add --scope user --transport stdio figlets --"));
    assert.ok(plan.targets[0].command.includes("figlets-mcp.js"));
    const calls = [];
    const applied = applySetupPlan(plan, {
      runner: (command, args) => {
        calls.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(applied.targets[0].status, "updated");
    assert.deepStrictEqual(calls[0].args.slice(0, 8), ["mcp", "add", "--scope", "user", "--transport", "stdio", "figlets", "--"]);
    assert.strictEqual(calls[0].args[8], fakeNode);
    assert.strictEqual(calls[0].args[9], fakeFigletsBin);
  }

  {
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code"],
      env: { PATH: bin },
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
    });
    const calls = [];
    const applied = applySetupPlan(plan, {
      runner: (command, args) => {
        calls.push({ command, args });
        if (calls.length === 1) {
          return {
            status: 1,
            stdout: "MCP server figlets already exists in local config\n",
            stderr: "warn: CPU lacks AVX support\n",
          };
        }
        if (args[1] === "remove") return { status: 0, stdout: "", stderr: "" };
        return { status: 0, stdout: "Added figlets\n", stderr: "" };
      },
    });
    assert.strictEqual(applied.targets[0].status, "updated");
    assert.strictEqual(applied.targets[0].repaired, true);
    assert.ok(applied.targets[0].reason.includes("re-added"));
    assert.ok(calls.some(call => call.args.join(" ").includes("remove --scope local figlets")));
    assert.ok(calls.some(call => call.args.join(" ").includes("remove --scope user figlets")));
  }

  {
    const cursorPath = path.join(home, ".cursor", "mcp.json");
    mkdirp(path.dirname(cursorPath));
    fs.writeFileSync(cursorPath, JSON.stringify({ mcpServers: { other: { command: "other-server" } } }, null, 2));

    const plan = getSetupPlan({ homeDir: home, cwd, platform: "darwin", hosts: ["cursor"] });
    assert.strictEqual(plan.targets[0].status, "would-update");
    const applied = applySetupPlan(plan);
    assert.strictEqual(applied.targets[0].status, "updated");
    assert.ok(applied.targets[0].backup, "existing config should be backed up before patching");

    const updated = JSON.parse(fs.readFileSync(cursorPath, "utf-8"));
    assert.strictEqual(updated.mcpServers.other.command, "other-server");
    assert.strictEqual(updated.mcpServers.figlets.command, "figlets-mcp");

    const idempotent = getSetupPlan({ homeDir: home, cwd, platform: "darwin", hosts: ["cursor"] });
    assert.strictEqual(idempotent.targets[0].status, "unchanged");
  }

  {
    const codexPath = path.join(home, ".codex", "config.toml");
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["codex"],
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
    });
    const applied = applySetupPlan(plan);
    assert.strictEqual(applied.targets[0].status, "updated");
    const text = fs.readFileSync(codexPath, "utf-8");
    assert.ok(text.includes("[mcp_servers.figlets]"));
    assert.ok(text.includes(`command = "${fakeNode}"`));
    assert.ok(text.includes(`args = ["${fakeFigletsBin}"]`));

    const idempotent = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["codex"],
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
    });
    assert.strictEqual(idempotent.targets[0].status, "unchanged");
  }

  {
    const codexPath = path.join(home, ".codex", "config.toml");
    fs.writeFileSync(codexPath, [
      "[projects.\"/tmp/example\"]",
      "trust_level = \"trusted\"",
      "",
      "[[mcp_servers]]",
      "name = \"figlets\"",
      "command = \"figlets-mcp\"",
      "",
    ].join("\n"));
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["codex"],
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
    });
    assert.strictEqual(plan.targets[0].status, "would-update", "legacy Codex mcp_servers array form should be repaired");
    const applied = applySetupPlan(plan);
    assert.strictEqual(applied.targets[0].status, "updated");
    const text = fs.readFileSync(codexPath, "utf-8");
    assert.ok(text.includes("[projects.\"/tmp/example\"]"), "unrelated Codex config should be preserved");
    assert.ok(!text.includes("[[mcp_servers]]"), "invalid sequence-style Codex MCP config should be removed");
    assert.ok(text.includes("[mcp_servers.figlets]"), "Codex MCP config should be written as a map table");
    assert.ok(text.includes(`command = "${fakeNode}"`));
    assert.ok(text.includes(`args = ["${fakeFigletsBin}"]`));
  }

  {
    const codexPath = path.join(home, ".codex", "config.toml");
    if (fs.existsSync(codexPath)) fs.unlinkSync(codexPath);
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["codex-plugin"],
      codexMarketplaceSource,
    });
    assert.strictEqual(plan.targets[0].id, "codex-plugin");
    assert.strictEqual(plan.targets[0].status, "would-update");
    assert.strictEqual(plan.targets[0].marketplaceName, FIGLETS_CODEX_PLUGIN_MARKETPLACE_NAME);
    assert.strictEqual(plan.targets[0].pluginSpec, FIGLETS_CODEX_PLUGIN_SPEC);

    const applied = applySetupPlan(plan);
    assert.strictEqual(applied.targets[0].status, "updated");
    const text = fs.readFileSync(codexPath, "utf-8");
    assert.ok(text.includes(`[marketplaces.${FIGLETS_CODEX_PLUGIN_MARKETPLACE_NAME}]`));
    assert.ok(text.includes(`source = "${codexMarketplaceSource.replace(/\\/g, "\\\\")}"`));
    assert.ok(text.includes(`[plugins."${FIGLETS_CODEX_PLUGIN_SPEC}"]`));
    assert.ok(text.includes("enabled = true"));

    const idempotent = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["codex-plugin"],
      codexMarketplaceSource,
    });
    assert.strictEqual(idempotent.targets[0].status, "unchanged");
  }

  {
    const codexPath = path.join(home, ".codex", "config.toml");
    mkdirp(path.dirname(codexPath));
    fs.writeFileSync(codexPath, [
      "[projects.\"/tmp/example\"]",
      "trust_level = \"trusted\"",
      "",
      `[marketplaces.${FIGLETS_CODEX_PLUGIN_MARKETPLACE_NAME}]`,
      "source_type = \"local\"",
      "source = \"/old/figlets-mcp\"",
      "",
      `[plugins."${FIGLETS_CODEX_PLUGIN_SPEC}"]`,
      "enabled = false",
      "",
    ].join("\n"));
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["codex-plugin"],
      codexMarketplaceSource,
    });
    assert.strictEqual(plan.targets[0].status, "would-update", "source drift or disabled plugin should be repaired");
    const applied = applySetupPlan(plan);
    assert.strictEqual(applied.targets[0].status, "updated");
    const text = fs.readFileSync(codexPath, "utf-8");
    assert.ok(text.includes("[projects.\"/tmp/example\"]"), "unrelated Codex config should be preserved");
    assert.ok(!text.includes("/old/figlets-mcp"), "stale marketplace source should be removed");
    assert.ok(text.includes(`source = "${codexMarketplaceSource.replace(/\\/g, "\\\\")}"`), "marketplace source should be updated");
    assert.ok(text.includes("enabled = true"), "plugin should be enabled");
  }

  {
    const missingSource = path.join(TEMP_DIR, "missing-codex-marketplace");
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["codex-plugin"],
      codexMarketplaceSource: missingSource,
    });
    assert.strictEqual(plan.targets[0].status, "manual");
    assert.ok(/no .agents\/plugins\/marketplace\.json/i.test(plan.targets[0].reason));
  }

  {
    const plan = getSetupPlan({ homeDir: home, cwd, platform: "darwin", hosts: ["cursor"] });
    const output = formatSetupPlan(plan, false);
    assert.ok(output.includes("Mode: dry run"));
    assert.ok(output.includes("rerun with --yes"));
    assert.ok(output.includes("Open the Figlets Bridge plugin"));
  }

  // When claude is on PATH (GitHub source is always usable), the legacy claude-code target is
  // dropped from the default run so we don't double-register Figlets.
  {
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      env: { PATH: bin },
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
    });
    const ids = plan.targets.map(target => target.id);
    assert.ok(ids.includes("claude-code-plugin"), "default plan should include the plugin install target when claude is available");
    assert.ok(!ids.includes("claude-code"), "default plan should drop the legacy claude-code target when the plugin path is viable");
    const pluginTarget = plan.targets.find(target => target.id === "claude-code-plugin");
    assert.strictEqual(pluginTarget.status, "would-run");
    assert.ok(pluginTarget.command.includes("claude plugin marketplace add arashr/figlets-mcp"), "default command should use the GitHub slug");
    assert.ok(pluginTarget.command.includes("--sparse .claude-plugin plugins/claude-code"), "GitHub source should limit the monorepo checkout via --sparse");
  }

  // But the legacy target is still reachable when explicitly requested.
  {
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code"],
      env: { PATH: bin },
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
    });
    assert.strictEqual(plan.targets.length, 1);
    assert.strictEqual(plan.targets[0].id, "claude-code");
  }

  // Explicit --hosts=claude-code-plugin must always return a target — never an empty plan — so the
  // user gets a clear next step. When claude is missing, status is manual with an actionable reason.
  {
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code-plugin"],
      env: { PATH: "" },
    });
    assert.strictEqual(plan.targets.length, 1, "explicit plugin target should always plan, even when claude is missing");
    assert.strictEqual(plan.targets[0].id, "claude-code-plugin");
    assert.strictEqual(plan.targets[0].status, "manual");
    assert.ok(/claude.*not found on PATH/i.test(plan.targets[0].reason), "manual reason should call out the missing claude binary");
    assert.ok(plan.targets[0].reason.includes("plugin marketplace add arashr/figlets-mcp"), "manual reason should show the GitHub install command");
    assert.ok(plan.targets[0].reason.includes(FIGLETS_PLUGIN_SPEC), "manual reason should reference the plugin spec");
  }

  // A local-path source override that lacks .claude-plugin/marketplace.json is manual with a clear reason.
  {
    const badLocalSource = path.join(TEMP_DIR, "bad-local-source");
    mkdirp(badLocalSource);
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code-plugin"],
      env: { PATH: bin },
      marketplaceSource: badLocalSource,
    });
    assert.strictEqual(plan.targets.length, 1);
    assert.strictEqual(plan.targets[0].status, "manual");
    assert.ok(/no .claude-plugin\/marketplace\.json/i.test(plan.targets[0].reason), "manual reason should call out the missing local marketplace manifest");
  }

  // A local-path source override WITH .claude-plugin/marketplace.json is would-run and uses no --sparse.
  {
    const goodLocalSource = path.join(TEMP_DIR, "good-local-source");
    mkdirp(path.join(goodLocalSource, ".claude-plugin"));
    fs.writeFileSync(path.join(goodLocalSource, ".claude-plugin", "marketplace.json"), "{}");
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code-plugin"],
      env: { PATH: bin },
      marketplaceSource: goodLocalSource,
    });
    assert.strictEqual(plan.targets[0].status, "would-run");
    assert.ok(plan.targets[0].command.includes(`claude plugin marketplace add ${goodLocalSource} --scope user`), "local source command should not include --sparse");
    assert.ok(!plan.targets[0].command.includes("--sparse"), "local-path source must not pass git --sparse");
  }

  // P3: a Windows-style path must be treated as a local path (not a GitHub slug),
  // so it does NOT get the git-only --sparse flag.
  {
    const plan = getSetupPlan({
      homeDir: home, cwd, platform: "darwin", hosts: ["claude-code-plugin"], env: { PATH: bin },
      marketplaceSource: "C:\\Users\\dev\\figlets-mcp",
    });
    // Treated as local: status is manual here only because the path does not exist
    // on this test machine — the point is it is NOT sent to git with --sparse.
    assert.strictEqual(plan.targets[0].status, "manual");
    assert.ok(/no .claude-plugin\/marketplace\.json/i.test(plan.targets[0].reason), "Windows path must be handled as a local source");
    assert.ok(!String(plan.targets[0].command || "").includes("--sparse"), "Windows local path must not get --sparse");
  }

  // P3: a local source containing spaces must be shell-quoted in the displayed command.
  {
    const spaced = path.join(TEMP_DIR, "dir with spaces", "figlets-mcp");
    mkdirp(path.join(spaced, ".claude-plugin"));
    fs.writeFileSync(path.join(spaced, ".claude-plugin", "marketplace.json"), "{}");
    const plan = getSetupPlan({
      homeDir: home, cwd, platform: "darwin", hosts: ["claude-code-plugin"], env: { PATH: bin },
      marketplaceSource: spaced,
    });
    assert.strictEqual(plan.targets[0].status, "would-run");
    assert.ok(plan.targets[0].command.includes(`'${spaced}'`), "a path with spaces must be single-quoted so the printed command is copy-pastable");
    assert.ok(!plan.targets[0].command.includes(`add ${spaced} `), "unquoted spaced path would break when copied");
  }

  // Claude Code plugin install — fresh install runs marketplace add (GitHub slug + --sparse),
  // plugin install, then legacy MCP cleanup.
  {
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code-plugin"],
      env: { PATH: bin },
    });
    assert.strictEqual(plan.targets[0].id, "claude-code-plugin");
    assert.strictEqual(plan.targets[0].status, "would-run");
    assert.ok(plan.targets[0].command.includes("claude plugin marketplace add arashr/figlets-mcp"));
    assert.ok(plan.targets[0].command.includes("claude plugin install"));

    const calls = [];
    const applied = applySetupPlan(plan, {
      runner: (command, args) => {
        calls.push({ command, args });
        if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
          return { status: 0, stdout: "Configured marketplaces:\n  ❯ karpathy-skills\n", stderr: "" };
        }
        if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add") {
          return { status: 0, stdout: `Added marketplace ${FIGLETS_PLUGIN_MARKETPLACE_NAME}\n`, stderr: "" };
        }
        if (args[0] === "plugin" && args[1] === "list") {
          return { status: 0, stdout: "Installed plugins:\n  ❯ andrej-karpathy-skills@karpathy-skills\n", stderr: "" };
        }
        if (args[0] === "plugin" && args[1] === "install") {
          return { status: 0, stdout: `Installed ${FIGLETS_PLUGIN_SPEC}\n`, stderr: "" };
        }
        if (args[0] === "mcp" && args[1] === "list") {
          return { status: 0, stdout: "plugin:figlets:figlets: npx -y https://example/x.tgz - ✓ Connected\n", stderr: "" };
        }
        if (args[0] === "mcp" && args[1] === "remove" && args[3] === "user") {
          return { status: 0, stdout: "Removed MCP server figlets from user config\n", stderr: "" };
        }
        if (args[0] === "mcp" && args[1] === "remove") {
          return { status: 1, stdout: "", stderr: `No MCP server found with name: figlets\n` };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(applied.targets[0].status, "updated");
    const stepKinds = applied.targets[0].steps.map(step => step.step);
    assert.deepStrictEqual(stepKinds, ["marketplace-add", "plugin-install", "smoke-check", "mcp-remove-user", "mcp-remove-project", "mcp-remove-local"]);
    assert.strictEqual(applied.targets[0].steps[0].status, "ok");
    assert.strictEqual(applied.targets[0].steps[1].status, "ok");
    assert.strictEqual(applied.targets[0].steps[2].status, "connected");
    assert.strictEqual(applied.targets[0].steps[3].status, "removed");
    assert.strictEqual(applied.targets[0].steps[4].status, "absent");
    assert.strictEqual(applied.targets[0].steps[5].status, "absent");
    assert.ok(applied.targets[0].reason.includes("/figlets:start"));
    assert.ok(applied.targets[0].reason.includes("legacy figlets MCP entries"));

    const sequence = calls.map(call => {
      const head = call.args.slice(0, 2).join(" ");
      return head === "plugin marketplace" ? call.args.slice(0, 3).join(" ") : head;
    });
    assert.deepStrictEqual(sequence, [
      "plugin marketplace list",
      "plugin marketplace add",
      "plugin list",
      "plugin install",
      "mcp list",
      "mcp remove",
      "mcp remove",
      "mcp remove",
    ]);
    assert.deepStrictEqual(calls[1].args, [
      "plugin", "marketplace", "add", "arashr/figlets-mcp",
      "--sparse", ".claude-plugin", "plugins/claude-code",
      "--scope", "user",
    ]);
    assert.strictEqual(calls[3].args[2], FIGLETS_PLUGIN_SPEC);
    assert.deepStrictEqual(calls[3].args.slice(3), ["--scope", "user"]);
    assert.deepStrictEqual(calls.slice(5).map(call => call.args), [
      ["mcp", "remove", "--scope", "user", "figlets"],
      ["mcp", "remove", "--scope", "project", "figlets"],
      ["mcp", "remove", "--scope", "local", "figlets"],
    ]);
  }

  // Smoke check fails (plugin server unreachable, e.g. release not published):
  // legacy MCP cleanup must be SKIPPED so a working legacy setup is preserved.
  {
    const plan = getSetupPlan({
      homeDir: home, cwd, platform: "darwin", hosts: ["claude-code-plugin"], env: { PATH: bin },
    });
    const calls = [];
    const applied = applySetupPlan(plan, {
      runner: (command, args) => {
        calls.push({ command, args });
        if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
          return { status: 0, stdout: "Configured marketplaces:\n  ❯ karpathy-skills\n", stderr: "" };
        }
        if (args[0] === "plugin" && args[1] === "list") {
          return { status: 0, stdout: "Installed plugins:\n  ❯ other@x\n", stderr: "" };
        }
        if (args[0] === "mcp" && args[1] === "list") {
          return { status: 0, stdout: "plugin:figlets:figlets: npx -y https://example/x.tgz - ✗ Failed to connect\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    const stepKinds = applied.targets[0].steps.map(step => step.step);
    assert.deepStrictEqual(stepKinds, ["marketplace-add", "plugin-install", "smoke-check"], "no mcp-remove steps when the plugin server is unreachable");
    assert.strictEqual(applied.targets[0].steps[2].status, "unreachable");
    assert.ok(!calls.some(c => c.args[0] === "mcp" && c.args[1] === "remove"), "must not run any claude mcp remove when smoke check failed");
    assert.ok(/not reachable/i.test(applied.targets[0].reason), "reason should explain the server is not reachable");
    assert.ok(/intact/i.test(applied.targets[0].reason), "reason should state legacy config was left intact");
  }

  // Marketplace source changed (old local Directory → GitHub slug): must re-point,
  // not silently report unchanged with a stale cached plugin.
  {
    const plan = getSetupPlan({
      homeDir: home, cwd, platform: "darwin", hosts: ["claude-code-plugin"], env: { PATH: bin },
    });
    const calls = [];
    const applied = applySetupPlan(plan, {
      runner: (command, args) => {
        calls.push({ command, args });
        if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
          return { status: 0, stdout: `Configured marketplaces:\n  ❯ ${FIGLETS_PLUGIN_MARKETPLACE_NAME}\n    Source: Directory (/old/local/figlets-mcp)\n`, stderr: "" };
        }
        if (args[0] === "plugin" && args[1] === "list") {
          return { status: 0, stdout: `Installed plugins:\n  ❯ ${FIGLETS_PLUGIN_SPEC}\n`, stderr: "" };
        }
        if (args[0] === "mcp" && args[1] === "list") {
          return { status: 0, stdout: "plugin:figlets:figlets: npx -y https://example/x.tgz - ✓ Connected\n", stderr: "" };
        }
        if (args[0] === "mcp" && args[1] === "remove") {
          return { status: 1, stdout: "", stderr: "No MCP server found with name: figlets\n" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    const repoint = applied.targets[0].steps.find(s => s.step === "marketplace-repoint");
    assert.ok(repoint, "should record a marketplace-repoint step when the source changed");
    assert.strictEqual(repoint.status, "removed-stale");
    const mpAdd = applied.targets[0].steps.find(s => s.step === "marketplace-add");
    assert.strictEqual(mpAdd.status, "repointed");
    assert.ok(
      calls.some(c => c.args[0] === "plugin" && c.args[1] === "uninstall" && c.args[2] === FIGLETS_PLUGIN_SPEC),
      "should uninstall the stale plugin (by spec) before re-adding"
    );
    assert.ok(calls.some(c => c.args[0] === "plugin" && c.args[1] === "marketplace" && c.args[2] === "remove"), "should remove the stale marketplace before re-adding");
    assert.ok(calls.some(c => c.args[0] === "plugin" && c.args[1] === "marketplace" && c.args[2] === "add"), "should re-add the marketplace with the new source");
  }

  // Idempotent: same source already registered → marketplace refreshed, nothing removed.
  {
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code-plugin"],
      env: { PATH: bin },
    });
    const calls = [];
    const applied = applySetupPlan(plan, {
      runner: (command, args) => {
        calls.push({ command, args });
        if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
          return { status: 0, stdout: `Configured marketplaces:\n  ❯ ${FIGLETS_PLUGIN_MARKETPLACE_NAME}\n    Source: GitHub (arashr/figlets-mcp)\n`, stderr: "" };
        }
        if (args[0] === "plugin" && args[1] === "list") {
          return { status: 0, stdout: `Installed plugins:\n  ❯ ${FIGLETS_PLUGIN_SPEC}\n    Status: enabled\n`, stderr: "" };
        }
        if (args[0] === "plugin" && args[1] === "update") {
          return { status: 0, stdout: `Updated ${FIGLETS_PLUGIN_SPEC}\n`, stderr: "" };
        }
        if (args[0] === "mcp" && args[1] === "list") {
          return { status: 0, stdout: "plugin:figlets:figlets: npx -y https://example/x.tgz - ✓ Connected\n", stderr: "" };
        }
        if (args[0] === "mcp" && args[1] === "remove") {
          return { status: 1, stdout: "", stderr: `No MCP server found with name: figlets\n` };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(applied.targets[0].status, "unchanged");
    const mpAdd = applied.targets[0].steps.find(s => s.step === "marketplace-add");
    assert.strictEqual(mpAdd.status, "refreshed", "same-source re-run refreshes the marketplace so new commits reach the user");
    const mpUpdate = applied.targets[0].steps.find(s => s.step === "marketplace-update");
    assert.strictEqual(mpUpdate.status, "ok");
    const pluginUpdate = applied.targets[0].steps.find(s => s.step === "plugin-update");
    assert.strictEqual(pluginUpdate.status, "ok");
    const pInstall = applied.targets[0].steps.find(s => s.step === "plugin-install");
    assert.strictEqual(pInstall.status, "skipped");
    const removeSteps = applied.targets[0].steps.filter(step => step.step.startsWith("mcp-remove-"));
    assert.ok(removeSteps.every(step => step.status === "absent"), "no legacy figlets MCP entries should be removed when nothing to clean up");
    assert.ok(calls.some(c => c.args[0] === "plugin" && c.args[1] === "marketplace" && c.args[2] === "update"), "should refresh the marketplace from source");
    assert.ok(calls.some(c => c.args[0] === "plugin" && c.args[1] === "update" && c.args[2] === FIGLETS_PLUGIN_SPEC), "should update the installed plugin after refreshing marketplace metadata");
    const issuedSubcommands = calls.map(call => call.args.slice(0, 2).join(" "));
    assert.ok(!issuedSubcommands.some(cmd => cmd.startsWith("plugin install")), "should not re-run plugin install when already present");
    assert.ok(!issuedSubcommands.some(cmd => cmd.startsWith("plugin marketplace add")), "should not re-add marketplace when already present");
  }

  // Same source, but marketplace update fails: block instead of claiming refreshed/unchanged.
  {
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code-plugin"],
      env: { PATH: bin },
    });
    const calls = [];
    const applied = applySetupPlan(plan, {
      runner: (command, args) => {
        calls.push({ command, args });
        if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
          return { status: 0, stdout: `Configured marketplaces:\n  ❯ ${FIGLETS_PLUGIN_MARKETPLACE_NAME}\n    Source: GitHub (arashr/figlets-mcp)\n`, stderr: "" };
        }
        if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "update") {
          return { status: 1, stdout: "", stderr: "network unavailable\n" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(applied.targets[0].status, "blocked");
    assert.ok(/network unavailable/i.test(applied.targets[0].reason), "marketplace update failure should be reported");
    assert.ok(!calls.some(c => c.args[0] === "plugin" && c.args[1] === "update"), "must not run plugin update after marketplace update failed");
    assert.ok(!calls.some(c => c.args[0] === "mcp" && c.args[1] === "remove"), "must not remove legacy MCP entries after marketplace update failed");
  }

  // Same source, marketplace update succeeds but plugin update fails: block honestly.
  {
    const plan = getSetupPlan({
      homeDir: home,
      cwd,
      platform: "darwin",
      hosts: ["claude-code-plugin"],
      env: { PATH: bin },
    });
    const calls = [];
    const applied = applySetupPlan(plan, {
      runner: (command, args) => {
        calls.push({ command, args });
        if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
          return { status: 0, stdout: `Configured marketplaces:\n  ❯ ${FIGLETS_PLUGIN_MARKETPLACE_NAME}\n    Source: GitHub (arashr/figlets-mcp)\n`, stderr: "" };
        }
        if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "update") {
          return { status: 0, stdout: "Updated marketplace\n", stderr: "" };
        }
        if (args[0] === "plugin" && args[1] === "update") {
          return { status: 1, stdout: "", stderr: "plugin update failed\n" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(applied.targets[0].status, "blocked");
    assert.ok(/plugin update failed/i.test(applied.targets[0].reason), "plugin update failure should be reported");
    assert.ok(calls.some(c => c.args[0] === "plugin" && c.args[1] === "update" && c.args[2] === FIGLETS_PLUGIN_SPEC), "should attempt plugin update");
    assert.ok(!calls.some(c => c.args[0] === "mcp" && c.args[1] === "remove"), "must not remove legacy MCP entries after plugin update failed");
  }

} finally {
  rmrf(TEMP_DIR);
}

function rmrf(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.lstatSync(targetPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath)) {
      rmrf(path.join(targetPath, entry));
    }
    fs.rmdirSync(targetPath);
    return;
  }
  fs.unlinkSync(targetPath);
}

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
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
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(cwd, { recursive: true });
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(path.dirname(fakeFigletsBin), { recursive: true });

try {
  {
    const plan = getSetupPlan({ homeDir: home, cwd, platform: "darwin", env: { PATH: "" }, nodePath: fakeNode, figletsBinPath: fakeFigletsBin });
    assert.strictEqual(plan.command, "figlets-mcp");
    assert.ok(plan.targets.some(target => target.id === "claude-desktop"));
    assert.ok(plan.targets.some(target => target.id === "codex"));
    assert.ok(plan.targets.some(target => target.id === "claude-code" && target.status === "manual"));
    assert.ok(!JSON.stringify(plan).includes("/Users/arash"), "setup plan should not leak a developer-local repo path");
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
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
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
    const plan = getSetupPlan({ homeDir: home, cwd, platform: "darwin", hosts: ["codex"] });
    const applied = applySetupPlan(plan);
    assert.strictEqual(applied.targets[0].status, "updated");
    const text = fs.readFileSync(codexPath, "utf-8");
    assert.ok(text.includes('name = "figlets"'));
    assert.ok(text.includes('command = "figlets-mcp"'));
  }

  {
    const plan = getSetupPlan({ homeDir: home, cwd, platform: "darwin", hosts: ["cursor"] });
    const output = formatSetupPlan(plan, false);
    assert.ok(output.includes("Mode: dry run"));
    assert.ok(output.includes("rerun with --yes"));
    assert.ok(output.includes("Open the Figlets Bridge plugin"));
  }

} finally {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

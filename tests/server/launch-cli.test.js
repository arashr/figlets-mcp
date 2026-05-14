const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-launch-cli-test-"));
const home = path.join(TEMP_DIR, "home");
const cwd = path.join(TEMP_DIR, "project");
const bin = path.join(TEMP_DIR, "bin");
const fakeNode = path.join(bin, "node");
const fakeFigletsBin = path.join(TEMP_DIR, "repo", "packages", "figlets-mcp-server", "bin", "figlets-mcp.js");

fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(cwd, { recursive: true });
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(path.dirname(fakeFigletsBin), { recursive: true });

process.env.FIGLETS_LOCAL_DIR = path.join(TEMP_DIR, "local");

const toClear = [
  "../../packages/figlets-mcp-server/src/utils/paths.js",
  "../../packages/figlets-mcp-server/src/agent-interface/workflows.js",
  "../../packages/figlets-mcp-server/src/cli/launch.js",
];
toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });

const { getLaunchReport, formatLaunchReport } = require("../../packages/figlets-mcp-server/src/cli/launch.js");

module.exports = (async () => {
  try {
    const report = await getLaunchReport({
      homeDir: home,
      cwd,
      platform: "darwin",
      env: { PATH: "" },
      nodePath: fakeNode,
      figletsBinPath: fakeFigletsBin,
      doctorReport: {
        receiverRunning: false,
        pluginConnected: false,
        receiverUrl: "http://127.0.0.1:1337",
        activeSessionId: null,
      },
    });

    assert.strictEqual(report.projectConfig.status, "updated");
    assert.strictEqual(report.projectConfig.path, path.join(cwd, ".mcp.json"));
    assert.ok(report.designerResponse.includes("| What you can ask for | What I'll do |"));
    assert.ok(report.designerResponse.includes("Check my design system"));
    assert.strictEqual(report.nextPrompt, "Help me with my Figma design system using Figlets.");

    const config = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf-8"));
    assert.strictEqual(config.mcpServers.figlets.command, fakeNode);
    assert.deepStrictEqual(config.mcpServers.figlets.args, [fakeFigletsBin]);

    const formatted = formatLaunchReport(report);
    assert.ok(formatted.includes("Figlets Designer Launcher"));
    assert.ok(formatted.includes("Designer menu preview:"));
    assert.ok(formatted.includes("receiver not running is normal"));
    assert.ok(formatted.includes("approve the project MCP server"));
    assert.ok(!formatted.includes("Plugin / MCP server code"));

  } finally {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    delete process.env.FIGLETS_LOCAL_DIR;
    toClear.forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });
  }
})();

const assert = require("assert");
const childProcess = require("child_process");
const path = require("path");

module.exports = new Promise((resolve, reject) => {
  const root = path.resolve(__dirname, "../..");
  const child = childProcess.spawn(
    process.execPath,
    [path.join(root, "packages", "figlets-mcp-server", "bin", "figlets-mcp.js")],
    { cwd: root, stdio: ["pipe", "pipe", "pipe"] }
  );

  let stdout = "";
  let stderr = "";
  let settled = false;

  function finish(err) {
    if (settled) return;
    settled = true;
    child.kill();
    if (err) reject(err);
    else resolve();
  }

  child.stdout.on("data", chunk => {
    stdout += String(chunk);
  });
  child.stderr.on("data", chunk => {
    stderr += String(chunk);
  });
  child.on("error", finish);
  child.on("exit", code => {
    if (!settled && code !== null && code !== 0) {
      finish(new Error(`MCP server exited with ${code}: ${stderr}`));
    }
  });

  function send(id, method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  }

  setTimeout(() => {
    send(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "figlets-test", version: "0.0.0" },
    });
  }, 25);

  setTimeout(() => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  }, 100);

  setTimeout(() => {
    send(2, "tools/list", {});
  }, 175);

  setTimeout(() => {
    try {
      const lines = stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
      const listResponse = lines.find(item => item.id === 2);
      assert.ok(listResponse, "tools/list response should be present");
      assert.ok(!listResponse.error, `tools/list should not error: ${JSON.stringify(listResponse.error)}`);
      const toolNames = listResponse.result.tools.map(tool => tool.name);
      assert.ok(toolNames.indexOf("figlets_start") >= 0, "tools/list should expose figlets_start");
      assert.ok(toolNames.indexOf("figlets_route_intent") >= 0, "tools/list should expose figlets_route_intent");
      assert.ok(toolNames.indexOf("figlets_workflow_guide") >= 0, "tools/list should expose figlets_workflow_guide");
      assert.ok(toolNames.indexOf("inspect_ds_token_gaps") >= 0, "tools/list should expose inspect_ds_token_gaps");
      assert.ok(toolNames.indexOf("update_ds_tokens") >= 0, "tools/list should expose update_ds_tokens");
      finish();
    } catch (err) {
      err.message += `\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
      finish(err);
    }
  }, 1000);
});

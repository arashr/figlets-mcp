#!/usr/bin/env node
// Developer-only: spawn a fresh figlets-mcp stdio session and call update_ds_tokens
// through the registered MCP tools/call path (not direct handlers).
const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const root = path.resolve(__dirname, "..");
const configPath = path.resolve(".local/local_mpcspbgz_7gq8yy0l/design-system.config.js");
const receiverUrl = process.env.FIGLETS_RECEIVER_URL || "http://localhost:17337";
const category = process.env.FIGLETS_MCP_LIVE_CATEGORY || "elevation-styles";

function getHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${receiverUrl}/health`, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data || "{}") });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`Health check timed out for ${receiverUrl}`));
    });
  });
}

function callMcpUpdateDsTokens() {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      process.execPath,
      [path.join(root, "packages", "figlets-mcp-server", "bin", "figlets-mcp.js")],
      {
        cwd: root,
        stdio: ["pipe", "pipe", "pipe"],
        env: Object.assign({}, process.env, { FIGLETS_RECEIVER_URL: receiverUrl }),
      }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    function finish(err, value) {
      if (settled) return;
      settled = true;
      child.kill();
      if (err) reject(err);
      else resolve(value);
    }

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });

    function send(id, method, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    }

    child.on("error", (err) => finish(err));
    child.on("exit", (code) => {
      if (!settled && code !== null && code !== 0) {
        finish(new Error(`MCP server exited with ${code}: ${stderr}`));
      }
    });

    setTimeout(() => {
      send(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "figlets-live-mcp-callback", version: "0.0.0" },
      });
    }, 25);

    setTimeout(() => {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    }, 100);

    setTimeout(() => {
      send(2, "tools/call", {
        name: "update_ds_tokens",
        arguments: {
          config_path: configPath,
          categories: [category],
          dry_run: false,
        },
      });
    }, 175);

    setTimeout(() => {
      try {
        const lines = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
        const response = lines.find((item) => item.id === 2);
        assert.ok(response, "tools/call response should be present");
        if (response.error) {
          throw new Error(`tools/call error: ${JSON.stringify(response.error)}`);
        }
        const text = response.result && response.result.content && response.result.content[0] && response.result.content[0].text;
        assert.ok(text, `tools/call should return text content. STDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
        const payload = JSON.parse(text);
        finish(null, { payload, stdout, stderr });
      } catch (err) {
        err.message += `\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
        finish(err);
      }
    }, 90000);
  });
}

(async () => {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config: ${configPath}`);
  }

  const health = await getHealth();
  if (health.statusCode !== 200 || !health.body.ok) {
    throw new Error(`Bridge unhealthy at ${receiverUrl}: ${JSON.stringify(health.body)}`);
  }
  if (!health.body.pluginConnected) {
    throw new Error(`Figma plugin not connected at ${receiverUrl}. Open Figlets Bridge in Figma Desktop.`);
  }
  if (!health.body.updateTokensLive) {
    throw new Error(`Connected plugin session lacks update-tokens capability: ${JSON.stringify(health.body.pluginCapabilities)}`);
  }

  console.log(JSON.stringify({
    step: "health",
    receiverUrl,
    activeFileKey: health.body.activeFileKey,
    activeSessionId: health.body.activeSessionId,
    updateTokensLive: health.body.updateTokensLive,
  }, null, 2));

  const { payload } = await callMcpUpdateDsTokens();

  assert.strictEqual(typeof payload, "object", "MCP payload should be an object");
  assert.ok(!payload.then, "registered MCP callback must not stringify an unresolved Promise");
  assert.notDeepStrictEqual(payload, {}, "MCP apply must not return an empty object");
  assert.ok(payload.categories && payload.categories.includes(category), "resolved payload should include requested category");
  assert.ok(payload.report && payload.report[category], "resolved apply report should be present");

  console.log(JSON.stringify({
    step: "mcp-update-ds-tokens",
    ok: true,
    dryRun: payload.dryRun,
    categories: payload.categories,
    message: payload.message,
    reportSummary: payload.report && payload.report[category] && {
      entries: payload.report[category].entries,
      createdStyles: (payload.report[category].createdStyles || []).length,
      refreshedStyles: (payload.report[category].refreshedStyles || []).length,
      createdVariables: (payload.report[category].createdVariables || []).length,
      updatedVariables: (payload.report[category].updatedVariables || []).length,
      bindingWarnings: (payload.report[category].bindingWarnings || []).length,
    },
  }, null, 2));
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

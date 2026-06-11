const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createBridgeHookFile,
  readBridgeHookCapture,
  setBridgeHookRoute,
} = require("../helpers/bridge-hook.js");

module.exports = (async () => {
  const root = path.resolve(__dirname, "../..");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-mcp-update-tokens-"));
  const configPath = path.join(tmp, "design-system.config.js");
  const capturePath = path.join(tmp, "capture.json");
  const hookPath = createBridgeHookFile(tmp);
  fs.writeFileSync(configPath, "const DS = " + JSON.stringify({
    collections: {
      spacing: "4. Spacing",
      typography: "3. Typography",
    },
    spacing: {
      radius: { md: 8 },
      border: {},
      semantic: {},
    },
    typography: {
      scale: {},
    },
  }, null, 2) + ";\n", "utf8");

  setBridgeHookRoute(hookPath, "/request-update-tokens", {
    capturePath,
    json: {
      success: true,
      result: {
        dryRun: false,
        categories: ["spacing-semantics"],
        unknownCategories: [],
        report: {
          "spacing-semantics": {
            entries: 1,
            createdVariables: [],
            updatedVariables: [],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [],
            refreshedStyles: [],
            unmatched: [],
            typeMismatch: [],
          },
        },
        message: "spacing-semantics: 1 changed",
      },
    },
  });

  const child = childProcess.spawn(
    process.execPath,
    [path.join(root, "packages", "figlets-mcp-server", "bin", "figlets-mcp.js")],
    {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      env: Object.assign({}, process.env, { FIGLETS_BRIDGE_HOOK_FILE: hookPath, FIGLETS_SKIP_RECEIVER: "1" }),
    }
  );

  let stdout = "";
  let stderr = "";
  let settled = false;

  function finish(err) {
    if (settled) return;
    settled = true;
    child.kill();
    try { fs.unlinkSync(configPath); } catch (e) {}
    try { fs.unlinkSync(capturePath); } catch (e) {}
    try { fs.unlinkSync(hookPath); } catch (e) {}
    try { fs.rmdirSync(tmp); } catch (e) {}
    if (err) throw err;
  }

  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });

  function send(id, method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  }

  try {
    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", code => {
        if (!settled && code !== null && code !== 0) {
          reject(new Error(`MCP server exited with ${code}: ${stderr}`));
        }
      });

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
        send(2, "tools/call", {
          name: "update_ds_tokens",
          arguments: {
            config_path: configPath,
            categories: ["spacing-semantics"],
            spacing_semantic_repairs: [{
              name: "space/layout/lg",
              updates: [{
                modeId: "mobile",
                modeName: "Mobile",
                toAliasId: "space-12",
                toAliasName: "space/12",
                configExpected: 48,
              }],
            }],
            dry_run: false,
          },
        });
      }, 175);

      setTimeout(() => {
        try {
          const lines = stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
          const response = lines.find(item => item.id === 2);
          assert.ok(response, "tools/call response should be present");
          assert.ok(!response.error, `tools/call should not error: ${JSON.stringify(response.error)}`);
          const text = response.result && response.result.content && response.result.content[0] && response.result.content[0].text;
          assert.ok(text, `tools/call should return text content. STDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
          const payload = JSON.parse(text);
          assert.strictEqual(payload.dryRun, false);
          assert.deepStrictEqual(payload.categories, ["spacing-semantics"]);
          assert.strictEqual(payload.message, "spacing-semantics: 1 changed");
          assert.ok(payload.report && payload.report["spacing-semantics"], "resolved apply report should be present");
          assert.ok(!payload.then, "registered MCP callback must not stringify an unresolved Promise");
          const receivedBody = readBridgeHookCapture(capturePath);
          assert.ok(receivedBody.DS, "MCP call should reach the bridge hook without binding localhost");
          assert.deepStrictEqual(receivedBody.spacingSemanticRepairs, [{
            name: "space/layout/lg",
            updates: [{
              modeId: "mobile",
              modeName: "Mobile",
              toAliasId: "space-12",
              toAliasName: "space/12",
              configExpected: 48,
            }],
          }]);
          resolve();
        } catch (err) {
          err.message += `\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
          reject(err);
        }
      }, 1000);
    });
  } finally {
    finish();
  }
})();

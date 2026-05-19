const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

module.exports = (async () => {
  const root = path.resolve(__dirname, "../..");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-mcp-update-tokens-"));
  const configPath = path.join(tmp, "design-system.config.js");
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

  let receivedBody = null;
  const mockServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/request-update-tokens") {
      let body = "";
      req.on("data", chunk => { body += chunk.toString(); });
      req.on("end", () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          result: {
            dryRun: false,
            categories: ["radius"],
            unknownCategories: [],
            report: {
              radius: {
                entries: 1,
                createdVariables: [{ name: "space/radius/md" }],
                updatedVariables: [],
                wouldCreateVariables: [],
                wouldUpdateVariables: [],
                createdStyles: [],
                refreshedStyles: [],
                unmatched: [],
                typeMismatch: [],
                fontLoadFailures: [],
              },
            },
            message: "radius: 1 changed",
          },
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
  const { port } = mockServer.address();

  const child = childProcess.spawn(
    process.execPath,
    [path.join(root, "packages", "figlets-mcp-server", "bin", "figlets-mcp.js")],
    {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      env: Object.assign({}, process.env, { FIGLETS_RECEIVER_URL: `http://localhost:${port}` }),
    }
  );

  let stdout = "";
  let stderr = "";
  let settled = false;

  function finish(err) {
    if (settled) return;
    settled = true;
    child.kill();
    mockServer.close(() => {});
    try { fs.unlinkSync(configPath); } catch (e) {}
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
            categories: ["radius"],
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
          assert.deepStrictEqual(payload.categories, ["radius"]);
          assert.strictEqual(payload.message, "radius: 1 changed");
          assert.ok(payload.report && payload.report.radius, "resolved apply report should be present");
          assert.ok(!payload.then, "registered MCP callback must not stringify an unresolved Promise");
          assert.ok(receivedBody && receivedBody.DS, "MCP call should reach the mock bridge receiver");
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

const assert = require("assert");
const http = require("http");

async function runTests() {
  await (async () => {
    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-qa-audit") {
        let body = "";
        req.on("data", chunk => { body += chunk.toString(); });
        req.on("end", () => {
          assert.deepStrictEqual(JSON.parse(body), { fix: false });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            result: {
              scope: "selection",
              fileName: "Portfolio DS",
              pageName: "Components",
              selectedCount: 1,
              checkedRootCount: 1,
              auditedNodeCount: 8,
              truncated: false,
              maxNodes: 2500,
              deadlineMs: 45000,
              violationCount: 2,
              byType: { color: 1, spacing: 1 },
              violations: [
                {
                  nodeId: "1:2",
                  nodeName: "Button",
                  property: "Fill color",
                  rawValue: "rgb(255,255,255)",
                  type: "color",
                  suggestion: { kind: "variable", name: "color/surface/default" }
                }
              ]
            }
          }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js")];
      const { handleQaBindingAudit } = require("../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js");
      const result = await handleQaBindingAudit();
      assert.ok(!result.isError, "should succeed");
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.scope, "selection");
      assert.strictEqual(data.auditedNodeCount, 8);
      assert.strictEqual(data.truncated, false);
      assert.strictEqual(data.maxNodes, 2500);
      assert.strictEqual(data.violationCount, 2);
      assert.deepStrictEqual(data.byType, { color: 1, spacing: 1 });
      assert.strictEqual(data.violations[0].suggestion.name, "color/surface/default");
      assert.ok(data.message.includes("2 violation(s)"));
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  await (async () => {
    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-qa-audit") {
        let body = "";
        req.on("data", chunk => { body += chunk.toString(); });
        req.on("end", () => {
          assert.deepStrictEqual(JSON.parse(body), { fix: true });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            result: {
              scope: "selection",
	              violationCount: 1,
	              fixApplied: true,
	              fixedCount: 1,
	              failedCount: 1,
	              fixed: [{ nodeId: "1:2", property: "paddingTop", boundTo: "space/component/md" }],
	              failed: [{ nodeId: "1:3", property: "Fill color", reason: "LOW_CONFIDENCE" }]
	            }
	          }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js")];
      const { handleQaBindingAudit } = require("../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js");
      const result = await handleQaBindingAudit({ fix: true });
      const data = JSON.parse(result.content[0].text);
	      assert.strictEqual(data.fixApplied, true);
	      assert.strictEqual(data.fixedCount, 1);
	      assert.strictEqual(data.failedCount, 1);
	      assert.strictEqual(data.fixed[0].boundTo, "space/component/md");
	      assert.strictEqual(data.failed[0].reason, "LOW_CONFIDENCE");
	    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  await (async () => {
    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-qa-audit") {
        let body = "";
        req.on("data", chunk => { body += chunk.toString(); });
        req.on("end", () => {
          assert.deepStrictEqual(JSON.parse(body), { fix: false, maxNodes: 25, deadlineMs: 500 });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            result: {
              scope: "page",
              checkedRootCount: 3,
              auditedNodeCount: 25,
              truncated: true,
              truncateReason: "MAX_NODES",
              maxNodes: 25,
              deadlineMs: 500,
              violationCount: 0,
              byType: {}
            }
          }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js")];
      const { handleQaBindingAudit } = require("../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js");
      const result = await handleQaBindingAudit({ max_nodes: 25, deadline_ms: 500 });
      const data = JSON.parse(result.content[0].text);
      assert.strictEqual(data.truncated, true);
      assert.strictEqual(data.truncateReason, "MAX_NODES");
      assert.strictEqual(data.auditedNodeCount, 25);
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  await (async () => {
    const mockServer = http.createServer((req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Figma plugin is not connected or listening.", activeSessionId: "figlets-test" }));
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js")];
      const { handleQaBindingAudit } = require("../../packages/figlets-mcp-server/src/tools/qa-binding-audit.js");
      const result = await handleQaBindingAudit();
      assert.ok(result.isError, "should error");
      assert.ok(result.content[0].text.includes("figlets-test"), "should surface active session id");
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
    }
  })();

  delete process.env.FIGLETS_RECEIVER_URL;
}

module.exports = runTests();

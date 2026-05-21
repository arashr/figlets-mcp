const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const {
  applyDsFoundationRepairsTool,
  handleApplyDsFoundationRepairs,
} = require("../../packages/figlets-mcp-server/src/tools/apply-ds-foundation-repairs.js");

const DS = {
  collections: {
    primitives: "1. Primitives",
    typography: "3. Typography",
    spacing: "4. Spacing",
    elevation: "5. Elevation",
  },
  breakpoints: { modes: ["Mobile", "Desktop"] },
};

module.exports = (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-foundation-repairs-"));
  const configPath = path.join(tmp, "design-system.config.js");
  fs.writeFileSync(configPath, "const DS = " + JSON.stringify(DS, null, 2) + ";\n", "utf8");

  try {
    assert.strictEqual(applyDsFoundationRepairsTool.name, "apply_ds_foundation_repairs");
    assert.ok(
      applyDsFoundationRepairsTool.description.includes("creating only missing configured variable collections"),
      "tool description should stay narrow"
    );

    {
      const result = await handleApplyDsFoundationRepairs({
        config_path: configPath,
        collections: [{ kind: "spacing", name: "Wrong Spacing" }],
      });
      assert.ok(result.error && /Unsupported foundation repair collection/.test(result.error), "server should reject non-config collection names");
    }

    const mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/request-foundation-repairs") {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
          const payload = JSON.parse(body);
          assert.deepStrictEqual(
            payload.collections,
            [{ kind: "spacing", name: "4. Spacing", modes: ["Mobile", "Desktop"] }],
            "server should send config-derived modes, not arbitrary caller modes"
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            result: {
              createdCollections: [{ kind: "spacing", name: "4. Spacing", id: "coll1" }],
              existingCollections: [],
              skippedCollections: [],
              message: "Foundation repairs applied.",
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
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      const result = await handleApplyDsFoundationRepairs({
        config_path: configPath,
        collections: [{ kind: "spacing", name: "4. Spacing", modes: ["Made Up"] }],
      });
      assert.ok(!result.error, result.error);
      assert.deepStrictEqual(result.createdCollections, [{ kind: "spacing", name: "4. Spacing", id: "coll1" }]);
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
      delete process.env.FIGLETS_RECEIVER_URL;
    }
  } finally {
    try { fs.unlinkSync(configPath); } catch (err) {}
    try { fs.rmdirSync(tmp); } catch (err) {}
  }
})();

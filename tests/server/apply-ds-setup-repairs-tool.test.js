const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const {
  applyDsSetupRepairsTool,
  handleApplyDsSetupRepairs,
  _normalizeRepairs,
  _updateConfigPairs,
} = require("../../packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js");

module.exports = (async () => {
  assert.strictEqual(applyDsSetupRepairsTool.name, "apply_ds_setup_repairs");
  assert.ok(/approved/.test(applyDsSetupRepairsTool.description));

  assert.deepStrictEqual(
    _normalizeRepairs([
      { bg: "color/surface/info-variant", recommended: "color/on-surface/info-variant", source: "color/on-surface/info" },
      { recommended: "", source: "color/on-surface/danger" },
    ]),
    [{ bg: "color/surface/info-variant", name: "color/on-surface/info-variant", source: "color/on-surface/info" }]
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-setup-repairs-"));
  const configPath = path.join(tmp, "design-system.config.js");
  fs.writeFileSync(configPath, `const DS = {
    color: { semantics: { pairs: [
      { bg: "color/surface/default", text: "color/on-surface/default" }
    ] } }
  };\n`, "utf8");

  const configResult = _updateConfigPairs(configPath, [
    { bg: "color/surface/info-variant", name: "color/on-surface/info-variant" },
    { bg: "color/surface/info-variant", name: "color/on-surface/info-variant" },
  ]);
  assert.deepStrictEqual(configResult, { updated: true, added: 1, conflicts: [] });
  const updatedConfig = fs.readFileSync(configPath, "utf8");
  assert.ok(updatedConfig.includes("color/surface/info-variant"));
  assert.strictEqual((updatedConfig.match(/color\/surface\/info-variant/g) || []).length, 1);

  let receivedBody = null;
  const mockServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/request-setup-repairs") {
      let body = "";
      req.on("data", chunk => { body += chunk.toString(); });
      req.on("end", () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          result: {
            created: [{ name: "color/on-surface/danger-variant", source: "color/on-surface/danger", collection: "Color / Semantics" }],
            skipped: [],
            unresolved: [],
            message: "1 created, 0 skipped, 0 unresolved."
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
    const result = await handleApplyDsSetupRepairs({
      config_path: configPath,
      repairs: [{ bg: "color/surface/danger-variant", recommended: "color/on-surface/danger-variant", source: "color/on-surface/danger" }]
    });
    assert.ok(!result.error);
    assert.strictEqual(result.created.length, 1);
    assert.deepStrictEqual(receivedBody.repairs, [
      { bg: "color/surface/danger-variant", name: "color/on-surface/danger-variant", source: "color/on-surface/danger" }
    ]);
    assert.deepStrictEqual(result.configUpdate, { updated: true, added: 1, conflicts: [] });
  } finally {
    delete process.env.FIGLETS_RECEIVER_URL;
    await new Promise(resolve => mockServer.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const conflictConfigPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "figlets-setup-repair-conflict-")), "design-system.config.js");
  fs.writeFileSync(conflictConfigPath, `const DS = {
    color: { semantics: { pairs: [
      { bg: "color/surface/info-variant", text: "color/on-surface/info" }
    ] } }
  };\n`, "utf8");
  const conflictResult = _updateConfigPairs(conflictConfigPath, [
    { bg: "color/surface/info-variant", name: "color/on-surface/info-variant" },
  ]);
  assert.deepStrictEqual(conflictResult, {
    updated: false,
    added: 0,
    conflicts: [{
      bg: "color/surface/info-variant",
      existingText: "color/on-surface/info",
      proposedText: "color/on-surface/info-variant",
    }],
  });
  fs.rmSync(path.dirname(conflictConfigPath), { recursive: true, force: true });
})();

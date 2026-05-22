const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createBridgeHookFile,
  installBridgeHook,
  readBridgeHookCapture,
  setBridgeHookRoute,
} = require("../helpers/bridge-hook.js");
const { requestBridgePost } = require("../../packages/figlets-mcp-server/src/bridges/bridge-request.js");

module.exports = (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-bridge-hook-"));
  const hookPath = createBridgeHookFile(tmp);
  const capturePath = path.join(tmp, "capture.json");
  const uninstall = installBridgeHook(hookPath);

  try {
    setBridgeHookRoute(hookPath, "/request-update-tokens", {
      capturePath,
      json: {
        success: true,
        result: { dryRun: false, categories: ["radius"], message: "ok" },
      },
    });

    const response = await requestBridgePost("/request-update-tokens", {
      DS: { spacing: { radius: { md: 8 } } },
      categories: ["radius"],
      dryRun: false,
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.data.result.message, "ok");
    assert.deepStrictEqual(readBridgeHookCapture(capturePath).categories, ["radius"]);
  } finally {
    uninstall();
    try { fs.rmdirSync(tmp); } catch (err) {}
  }
})();

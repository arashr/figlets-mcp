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
const {
  bridgePluginRetryHint,
  bridgeStatusError,
  formatPluginNotListening,
  formatReceiverConnectionError,
  requestBridgePost,
} = require("../../packages/figlets-mcp-server/src/bridges/bridge-request.js");

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

    let attempts = 0;
    const retryResponse = await requestBridgePost("/request-update-tokens", {
      categories: ["spacing"],
      dryRun: false,
    }, {
      bridgeRetryAttempts: 3,
      bridgeRetryDelayMs: 0,
      transport: ({ path: routePath, body }) => {
        attempts += 1;
        assert.strictEqual(routePath, "/request-update-tokens");
        assert.deepStrictEqual(body.categories, ["spacing"]);
        if (attempts < 3) {
          return {
            statusCode: 503,
            data: {
              error: "Figma plugin was connected recently but is not listening for a new command yet.",
              pluginRecentlySeen: true,
              activeSessionId: "figlets-live"
            },
            raw: ""
          };
        }
        return {
          statusCode: 200,
          data: { success: true, result: { message: "retried" } },
          raw: ""
        };
      }
    });
    assert.strictEqual(attempts, 3);
    assert.strictEqual(retryResponse.statusCode, 200);
    assert.strictEqual(retryResponse.data.result.message, "retried");

    let nonRetryAttempts = 0;
    const nonRetryResponse = await requestBridgePost("/request-update-tokens", {}, {
      bridgeRetryAttempts: 3,
      bridgeRetryDelayMs: 0,
      transport: () => {
        nonRetryAttempts += 1;
        return {
          statusCode: 503,
          data: { error: "Figma plugin is not connected or listening." },
          raw: ""
        };
      }
    });
    assert.strictEqual(nonRetryAttempts, 1);
    assert.strictEqual(nonRetryResponse.statusCode, 503);

    uninstall();
    const missingHookPath = path.join(tmp, "missing-hook.json");
    process.env.FIGLETS_BRIDGE_HOOK_FILE = missingHookPath;
    const missing = await requestBridgePost("/request-update-tokens", {
      categories: ["radius"],
      dryRun: false,
    });
    assert.ok(missing.connectionError, "configured hook path must fail closed");
    assert.ok(/does not exist/.test(missing.connectionError), missing.connectionError);
    assert.ok(/FIGLETS_BRIDGE_HOOK_FILE/.test(missing.connectionError));
    assert.strictEqual(missing.statusCode, 0);
    delete process.env.FIGLETS_BRIDGE_HOOK_FILE;

    const retryHint = bridgePluginRetryHint({
      pluginRecentlySeen: true,
      activeSessionId: "figlets-live",
    });
    assert.ok(/retried automatically/.test(retryHint), retryHint);

    const notListening = formatPluginNotListening("QA commands", {
      pluginRecentlySeen: true,
      activeSessionId: "figlets-live",
      pluginCapabilities: ["sync", "qa-audit"],
    });
    assert.ok(/QA commands/.test(notListening), notListening);
    assert.ok(/figlets-live/.test(notListening), notListening);
    assert.ok(/retried automatically/.test(notListening), notListening);

    const receiverError = formatReceiverConnectionError("ECONNREFUSED 127.0.0.1:17337");
    assert.ok(/Bridge receiver is not running/.test(receiverError), receiverError);
    assert.ok(/ECONNREFUSED/.test(receiverError), receiverError);

    const statusError = bridgeStatusError({
      statusCode: 409,
      data: {
        activeSessionId: "figlets-live",
        pluginCapabilities: ["sync"],
      },
    }, {
      conflictError: "Missing command.",
    });
    assert.deepStrictEqual(statusError, {
      error: "Missing command.",
      activeSessionId: "figlets-live",
      pluginCapabilities: ["sync"],
    });
  } finally {
    try { fs.rmdirSync(tmp); } catch (err) {}
  }
})();

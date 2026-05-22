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

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-update-prim-test-"));
const configPath = path.join(TEMP_DIR, "design-system.config.js");

// Minimal prepared DS — only the fields the tool validates.
const minimalDs = {
  collections: { primitives: "1. Primitives" },
  color: {
    ramps: [
      { folder: "color/lime", steps: [[500, 0.76, 0.97, 0.43]] }
    ]
  },
  primitives: {
    spacing: [[0, 0], [4, 16]]
  }
};
fs.writeFileSync(configPath, `const DS = ${JSON.stringify(minimalDs, null, 2)};\n`, "utf-8");

const toolModule = "../../packages/figlets-mcp-server/src/tools/update-ds-primitives.js";

module.exports = (async () => {
  const hookPath = createBridgeHookFile(TEMP_DIR);
  const uninstallHook = installBridgeHook(hookPath);
  // Tool metadata
  try {
    delete require.cache[require.resolve(toolModule)];
    const { updateDsPrimitivesTool, handleUpdateDsPrimitives } = require(toolModule);
    assert.strictEqual(updateDsPrimitivesTool.name, "update_ds_primitives");
    assert.ok(updateDsPrimitivesTool.description.length > 0);
    assert.ok(updateDsPrimitivesTool.description.includes("semantic aliases"), "tool description should mention semantic alias updates");
    assert.ok(updateDsPrimitivesTool.description.includes("dry_run"), "tool description should mention dry-run confirmation");
    assert.ok(updateDsPrimitivesTool.inputSchema.properties.create_missing, "tool schema should expose create_missing");
    assert.ok(updateDsPrimitivesTool.inputSchema.properties.dry_run, "tool schema should expose dry_run");

    // Missing config_path -> clear error
    {
      const result = await handleUpdateDsPrimitives({});
      assert.ok(result.error && /config_path/.test(result.error), "should error on missing config_path");
    }

    // Successful round trip - bridge hook returns a 200 with a result envelope.
    {
      const capturePath = path.join(TEMP_DIR, "update-primitives-capture.json");
      setBridgeHookRoute(hookPath, "/request-update-primitives", {
        capturePath,
        json: {
          success: true,
          result: {
            collection: "1. Primitives",
            categories: ["color"],
            unknownCategories: [],
            report: { color: { dryRun: true, entries: 1, updated: 0, wouldUpdate: 1, unchanged: 0, unmatched: [], typeMismatch: [] } },
            dryRun: true,
            message: "color: 0 updated, 0 unchanged, 1 would update"
          }
        }
      });

      const result = await handleUpdateDsPrimitives({
        config_path: configPath,
        categories: ["color"],
        create_missing: true,
        dry_run: true
      });
      assert.ok(!result.error, "should succeed");
      assert.strictEqual(result.dryRun, true, "should expose dry-run result flag");
      assert.deepStrictEqual(result.categories, ["color"]);
      assert.strictEqual(result.collection, "1. Primitives");
      assert.strictEqual(result.report.color.updated, 0);
      assert.strictEqual(result.report.color.wouldUpdate, 1);

      // Verify what the tool actually sent to the bridge
      const receivedBody = readBridgeHookCapture(capturePath);
      assert.ok(receivedBody && receivedBody.DS, "should send DS object");
      assert.deepStrictEqual(receivedBody.categories, ["color"], "should forward categories list");
      assert.strictEqual(receivedBody.createMissing, true, "should forward create_missing as createMissing");
      assert.strictEqual(receivedBody.dryRun, true, "should forward dry_run as dryRun");
      assert.ok(receivedBody.DS.color && Array.isArray(receivedBody.DS.color.ramps), "DS should include color.ramps");
    }

    // 503 from bridge -> user-facing error mentioning the plugin
    {
      setBridgeHookRoute(hookPath, "/request-update-primitives", {
        statusCode: 503,
        json: { error: "not connected" }
      });
      const result = await handleUpdateDsPrimitives({ config_path: configPath });
      assert.ok(result.error && /plugin/i.test(result.error), "503 should produce a plugin-not-connected message");
    }

    // 409 from bridge -> stale plugin reload guidance without waiting for timeout
    {
      setBridgeHookRoute(hookPath, "/request-update-primitives", {
        statusCode: 409,
        json: {
          error: "The open Figlets Bridge plugin is out of date. Close and reopen the plugin in Figma Desktop, then try again.",
          activeSessionId: "figlets-old",
          pluginCapabilities: []
        }
      });
      const result = await handleUpdateDsPrimitives({ config_path: configPath });
      assert.ok(result.error && /does not advertise|out of date/i.test(result.error), "409 should explain unavailable command");
      assert.strictEqual(result.activeSessionId, "figlets-old");
      assert.deepStrictEqual(result.pluginCapabilities, []);
    }

    // Missing explicit hook file fails closed instead of falling back to localhost.
    {
      const previous = process.env.FIGLETS_BRIDGE_HOOK_FILE;
      process.env.FIGLETS_BRIDGE_HOOK_FILE = path.join(TEMP_DIR, "missing-hook.json");
      const result = await handleUpdateDsPrimitives({ config_path: configPath });
      assert.ok(result.error && /hook file does not exist/i.test(result.error), "missing hook should fail closed");
      if (previous !== undefined) process.env.FIGLETS_BRIDGE_HOOK_FILE = previous;
      else delete process.env.FIGLETS_BRIDGE_HOOK_FILE;
    }

    // Cleanup
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } finally {
    uninstallHook();
  }
})();

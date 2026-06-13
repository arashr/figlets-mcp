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
  const capturePath = path.join(tmp, "capture.json");
  const hookPath = createBridgeHookFile(tmp);
  const uninstallHook = installBridgeHook(hookPath);
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

    setBridgeHookRoute(hookPath, "/request-foundation-repairs", {
      capturePath,
      json: {
        success: true,
        result: {
          createdCollections: [{ kind: "spacing", name: "4. Spacing", id: "coll1", createdModes: ["Desktop"] }],
          existingCollections: [],
          skippedCollections: [],
          message: "Foundation repairs applied.",
        },
      },
    });

    const result = await handleApplyDsFoundationRepairs({
      config_path: configPath,
      collections: [{ kind: "spacing", name: "4. Spacing", modes: ["Made Up"] }],
    });
    assert.ok(!result.error, result.error);
    assert.deepStrictEqual(result.createdCollections, [{ kind: "spacing", name: "4. Spacing", id: "coll1", createdModes: ["Desktop"] }]);
    assert.strictEqual(result.requiresResponsiveSpacingValidation, true);
    assert.ok(
      result.nextStep.includes("responsive setup validation"),
      "newly created spacing modes should not be summarized as a clean responsive result"
    );
    assert.deepStrictEqual(
      result.createdModeEntries,
      [{ kind: "spacing", name: "4. Spacing", createdModes: ["Desktop"] }]
    );
    const payload = readBridgeHookCapture(capturePath);
    assert.deepStrictEqual(
      payload.collections,
      [{ kind: "spacing", name: "4. Spacing", modes: ["Mobile", "Desktop"] }],
      "server should send config-derived modes, not arbitrary caller modes"
    );
  } finally {
    uninstallHook();
    try { fs.unlinkSync(configPath); } catch (err) {}
    try { fs.rmdirSync(tmp); } catch (err) {}
  }
})();

const assert = require("assert");
const {
  createBridgeHookFile,
  installBridgeHook,
  readBridgeHookCapture,
  setBridgeHookRoute,
} = require("../helpers/bridge-hook.js");
const { handleApplyDsSetupRepairs } = require("../../packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js");
const fs = require("fs");
const os = require("os");
const path = require("path");

// BNN-34 apply-boundary regression: test that repairs with non-variable sources
// (e.g. "background-ramp") can be applied when aliases are provided, and fail
// safely when aliases are missing or unresolvable.

module.exports = (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-apply-no-source-"));
  const hookPath = createBridgeHookFile(tmp);
  const uninstallHook = installBridgeHook(hookPath);

  try {
    // ── Test 1: background-ramp source with valid aliases succeeds ────────────
    const capturePath1 = path.join(tmp, "capture-1.json");
    setBridgeHookRoute(hookPath, "/request-setup-repairs", {
      capturePath: capturePath1,
      json: {
        success: true,
        result: {
          created: [
            {
              name: "color/on-surface/default",
              source: "background-ramp",
              collection: "Color / Semantics",
              aliases: { Light: "color/neutral/900", Dark: "color/neutral/50" },
            },
          ],
          skipped: [],
          unresolved: [],
          message: "1 created via background-ramp derivation.",
        },
      },
    });

    const result1 = await handleApplyDsSetupRepairs({
      repairs: [
        {
          bg: "color/surface/default",
          name: "color/on-surface/default",
          source: "background-ramp",
          aliases: { Light: "color/neutral/900", Dark: "color/neutral/50" },
        },
      ],
      update_config: false,
    });

    assert.ok(!result1.error, "background-ramp repair with aliases should succeed");
    assert.strictEqual(result1.created.length, 1, "Should create 1 variable");
    assert.strictEqual(
      result1.created[0].name,
      "color/on-surface/default",
      "Created variable should match request"
    );

    const capture1 = readBridgeHookCapture(capturePath1);
    assert.strictEqual(
      capture1.repairs.length,
      1,
      "Bridge should receive 1 repair"
    );
    assert.strictEqual(
      capture1.repairs[0].source,
      "background-ramp",
      "Bridge should receive background-ramp source"
    );
    assert.deepStrictEqual(
      capture1.repairs[0].aliases,
      { Light: "color/neutral/900", Dark: "color/neutral/50" },
      "Bridge should receive planned aliases"
    );

    // ── Test 2: background-ramp source without aliases fails ──────────────────
    const capturePath2 = path.join(tmp, "capture-2.json");
    setBridgeHookRoute(hookPath, "/request-setup-repairs", {
      capturePath: capturePath2,
      json: {
        success: true,
        result: {
          created: [],
          skipped: [],
          unresolved: [
            {
              name: "color/on-surface/overlay",
              bg: "color/surface/overlay",
              source: "background-ramp",
              reason: "Non-variable source requires aliases.",
            },
          ],
          message: "0 created, 0 skipped, 1 unresolved.",
        },
      },
    });

    const result2 = await handleApplyDsSetupRepairs({
      repairs: [
        {
          bg: "color/surface/overlay",
          name: "color/on-surface/overlay",
          source: "background-ramp",
          // Missing aliases
        },
      ],
      update_config: false,
    });

    assert.ok(!result2.error, "Server call should succeed");
    assert.strictEqual(
      result2.unresolved.length,
      1,
      "Should have 1 unresolved repair"
    );
    assert.ok(
      result2.unresolved[0].reason.includes("aliases"),
      "Unresolved reason should mention missing aliases"
    );

    // ── Test 3: derived source marker also supported ──────────────────────────
    const capturePath3 = path.join(tmp, "capture-3.json");
    setBridgeHookRoute(hookPath, "/request-setup-repairs", {
      capturePath: capturePath3,
      json: {
        success: true,
        result: {
          created: [
            {
              name: "color/on-surface/raised",
              source: "derived",
              collection: "Color / Semantics",
              aliases: { Light: "color/neutral/800", Dark: "color/neutral/100" },
            },
          ],
          skipped: [],
          unresolved: [],
          message: "1 created via derived source.",
        },
      },
    });

    const result3 = await handleApplyDsSetupRepairs({
      repairs: [
        {
          bg: "color/surface/raised",
          name: "color/on-surface/raised",
          source: "derived",
          aliases: { Light: "color/neutral/800", Dark: "color/neutral/100" },
        },
      ],
      update_config: false,
    });

    assert.ok(
      !result3.error,
      "'derived' source marker should also be supported"
    );
    assert.strictEqual(result3.created.length, 1, "Should create 1 variable");

    const capture3 = readBridgeHookCapture(capturePath3);
    assert.strictEqual(
      capture3.repairs[0].source,
      "derived",
      "Bridge should receive 'derived' source marker"
    );

    console.log(
      "BNN-34 apply-boundary test passed: background-ramp repairs are applyable with aliases"
    );
  } finally {
    uninstallHook();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

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
  applyDsSetupRepairsTool,
  handleApplyDsSetupRepairs,
  _normalizeRepairs,
  _normalizeAliasUpdates,
  _normalizeRoleRepairs,
  _updateConfigPairs,
  _updateConfigRoles,
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

  assert.deepStrictEqual(
    _normalizeRepairs([
      { recommended: "color/on-surface/danger-variant", source: "color/on-surface/danger" },
      { bg: "", name: "color/on-surface/x", source: "color/on-surface/y" },
    ]),
    []
  );

  assert.deepStrictEqual(
    _normalizeRepairs([
      {
        bg: "color/surface/info-variant",
        recommended: "color/on-surface/info-variant",
        source: "color/on-surface/info",
        aliases: { Light: "color/blue/700", Dark: "color/blue/200", Empty: "" },
      },
    ]),
    [{
      bg: "color/surface/info-variant",
      name: "color/on-surface/info-variant",
      source: "color/on-surface/info",
      aliases: { Light: "color/blue/700", Dark: "color/blue/200" },
    }]
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-setup-repairs-"));
  const hookPath = createBridgeHookFile(tmp);
  const uninstallHook = installBridgeHook(hookPath);
  const configPath = path.join(tmp, "design-system.config.js");
  fs.writeFileSync(configPath, `const DS = {
    color: { semantics: { pairs: [
      { bg: "color/surface/default", text: "color/on-surface/default" }
    ] } }
  };\n`, "utf8");

  try {
    const configResult = _updateConfigPairs(configPath, [
      { bg: "color/surface/info-variant", name: "color/on-surface/info-variant" },
      { bg: "color/surface/info-variant", name: "color/on-surface/info-variant" },
    ]);
    assert.deepStrictEqual(configResult, { updated: true, added: 1, conflicts: [] });
    const updatedConfig = fs.readFileSync(configPath, "utf8");
    assert.ok(updatedConfig.includes("color/surface/info-variant"));
    assert.strictEqual((updatedConfig.match(/color\/surface\/info-variant/g) || []).length, 1);

    const capturePath = path.join(tmp, "setup-repairs-capture.json");
    setBridgeHookRoute(hookPath, "/request-setup-repairs", {
      capturePath,
      json: {
        success: true,
        result: {
          created: [{ name: "color/on-surface/danger-variant", source: "color/on-surface/danger", collection: "Color / Semantics" }],
          skipped: [],
          unresolved: [],
          message: "1 created, 0 skipped, 0 unresolved."
        }
      }
    });

    const prevLocalDir = process.env.FIGLETS_LOCAL_DIR;
    process.env.FIGLETS_LOCAL_DIR = tmp;
    try {
      const result = await handleApplyDsSetupRepairs({
        config_path: configPath,
        repairs: [{ bg: "color/surface/danger-variant", recommended: "color/on-surface/danger-variant", source: "color/on-surface/danger" }]
      });
      assert.ok(!result.error);
      assert.strictEqual(result.created.length, 1);
      const receivedBody = readBridgeHookCapture(capturePath);
      assert.deepStrictEqual(receivedBody.repairs, [
        { bg: "color/surface/danger-variant", name: "color/on-surface/danger-variant", source: "color/on-surface/danger" }
      ]);
      assert.deepStrictEqual(result.configUpdate, { updated: true, added: 1, conflicts: [] });
    } finally {
      if (prevLocalDir !== undefined) process.env.FIGLETS_LOCAL_DIR = prevLocalDir;
      else delete process.env.FIGLETS_LOCAL_DIR;
    }
  } finally {
    uninstallHook();
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

  assert.deepStrictEqual(
    _normalizeAliasUpdates([
      { token: "color/on-surface/variant", mode: "Dark", newAliasTarget: "color/neutral/200" },
      { token: "", mode: "Light", newAliasTarget: "color/neutral/50" },
      { token: "color/on-surface/warning", mode: "", newAliasTarget: "color/yellow/950" },
      { token: "color/on-surface/info", mode: "Light", newAliasTarget: "" },
      { token: "color/on-surface/success", mode: "Light", newAliasTarget: "color/green/700" },
      { token: "color/on-surface/danger", mode: "Light", from: "color/neutral/300", to: "color/neutral/950" },
    ]),
    [
      { token: "color/on-surface/variant", mode: "Dark", newAliasTarget: "color/neutral/200" },
      { token: "color/on-surface/success", mode: "Light", newAliasTarget: "color/green/700" },
      {
        token: "color/on-surface/danger",
        mode: "Light",
        newAliasTarget: "color/neutral/950",
        expectedCurrentAlias: "color/neutral/300",
      },
    ]
  );

  assert.deepStrictEqual(
    _normalizeRoleRepairs([
      { name: "color/border/info", role: "border", aliases: { Light: "color/blue/500", Dark: "color/blue/500", Empty: "" } },
      { name: "color/icon/success", role: "icon", aliases: { Light: "color/green/800" } },
      { name: "", role: "border", aliases: { Light: "color/blue/500" } },
      { name: "color/border/warning", role: "border", aliases: {} },
    ]),
    [
      { name: "color/border/info", role: "border", aliases: { Light: "color/blue/500", Dark: "color/blue/500" } },
      { name: "color/icon/success", role: "icon", aliases: { Light: "color/green/800" } },
    ]
  );

  const roleConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-role-config-"));
  const roleConfigPath = path.join(roleConfigDir, "design-system.config.js");
  fs.writeFileSync(roleConfigPath, `const DS = { color: { semantics: { icons: [], unpaired: [] } } };\n`, "utf8");
  const roleConfigResult = _updateConfigRoles(roleConfigPath, [
    { name: "color/border/info", role: "border", aliases: { Light: "color/blue/500", Dark: "color/blue/500" } },
    { name: "color/icon/success", role: "icon", aliases: { Light: "color/green/800", Dark: "color/green/200" } },
  ]);
  assert.deepStrictEqual(roleConfigResult, { updated: true, added: 2 });
  const roleConfigText = fs.readFileSync(roleConfigPath, "utf8");
  assert.ok(roleConfigText.includes("color/border/info"));
  assert.ok(roleConfigText.includes("color/icon/success"));
  fs.rmSync(roleConfigDir, { recursive: true, force: true });

  const aliasTmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-alias-update-"));
  const aliasHookPath = createBridgeHookFile(aliasTmp);
  const uninstallAliasHook = installBridgeHook(aliasHookPath);
  const aliasCapturePath = path.join(aliasTmp, "setup-repairs-alias-capture.json");
  setBridgeHookRoute(aliasHookPath, "/request-setup-repairs", {
    capturePath: aliasCapturePath,
    json: {
      success: true,
      result: {
        created: [], skipped: [], unresolved: [],
        updated: [{ token: "color/on-surface/variant", mode: "Dark", to: "color/neutral/200" }],
        updateSkipped: [], updateUnresolved: [],
        message: "0 created, 0 skipped, 0 unresolved, 1 re-aliased."
      }
    }
  });
  const prevAliasLocal = process.env.FIGLETS_LOCAL_DIR;
  process.env.FIGLETS_LOCAL_DIR = aliasTmp;
  try {
    const aliasResult = await handleApplyDsSetupRepairs({
      aliasUpdates: [
        { token: "color/on-surface/variant", mode: "Dark", to: "color/neutral/200", from: "color/neutral/900" },
      ],
      update_config: false,
    });
    assert.ok(!aliasResult.error, "alias-only apply should succeed");
    const aliasBody = readBridgeHookCapture(aliasCapturePath);
    assert.deepStrictEqual(aliasBody.aliasUpdates, [
      {
        token: "color/on-surface/variant",
        mode: "Dark",
        newAliasTarget: "color/neutral/200",
        expectedCurrentAlias: "color/neutral/900",
      },
    ]);
    assert.deepStrictEqual(aliasBody.repairs, []);
    assert.strictEqual(aliasResult.updated.length, 1);
    assert.strictEqual(aliasResult.updated[0].token, "color/on-surface/variant");
  } finally {
    uninstallAliasHook();
    if (prevAliasLocal !== undefined) process.env.FIGLETS_LOCAL_DIR = prevAliasLocal;
    else delete process.env.FIGLETS_LOCAL_DIR;
    fs.rmSync(aliasTmp, { recursive: true, force: true });
  }

  const roleTmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-role-apply-"));
  const roleHookPath = createBridgeHookFile(roleTmp);
  const uninstallRoleHook = installBridgeHook(roleHookPath);
  const roleCapturePath = path.join(roleTmp, "setup-repairs-role-capture.json");
  setBridgeHookRoute(roleHookPath, "/request-setup-repairs", {
    capturePath: roleCapturePath,
    json: {
      success: true,
      result: {
        created: [], skipped: [], unresolved: [],
        roleCreated: [{ name: "color/border/info", role: "border", collection: "Color" }],
        roleSkipped: [], roleUnresolved: [],
        updated: [], updateSkipped: [], updateUnresolved: [],
        message: "0 created, 1 role created, 0 skipped, 0 unresolved."
      }
    }
  });
  const roleApplyConfig = path.join(roleTmp, "design-system.config.js");
  fs.writeFileSync(roleApplyConfig, `const DS = { color: { semantics: { icons: [], unpaired: [] } } };\n`, "utf8");
  const prevRoleLocal = process.env.FIGLETS_LOCAL_DIR;
  process.env.FIGLETS_LOCAL_DIR = roleTmp;
  try {
    const roleResult = await handleApplyDsSetupRepairs({
      config_path: roleApplyConfig,
      roleRepairs: [
        { name: "color/border/info", role: "border", aliases: { Light: "color/blue/500", Dark: "color/blue/500" } },
      ],
    });
    assert.ok(!roleResult.error, "role repair apply should succeed");
    const roleBody = readBridgeHookCapture(roleCapturePath);
    assert.deepStrictEqual(roleBody.roleRepairs, [
      { name: "color/border/info", role: "border", aliases: { Light: "color/blue/500", Dark: "color/blue/500" } },
    ]);
    assert.strictEqual(roleResult.roleCreated.length, 1);
    assert.deepStrictEqual(roleResult.roleConfigUpdate, { updated: true, added: 1 });
  } finally {
    uninstallRoleHook();
    if (prevRoleLocal !== undefined) process.env.FIGLETS_LOCAL_DIR = prevRoleLocal;
    else delete process.env.FIGLETS_LOCAL_DIR;
    fs.rmSync(roleTmp, { recursive: true, force: true });
  }

  const missingHookTmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-setup-missing-hook-"));
  const previousHook = process.env.FIGLETS_BRIDGE_HOOK_FILE;
  process.env.FIGLETS_BRIDGE_HOOK_FILE = path.join(missingHookTmp, "missing-hook.json");
  try {
    const result = await handleApplyDsSetupRepairs({
      update_config: false,
      repairs: [{ bg: "color/surface/danger-variant", recommended: "color/on-surface/danger-variant", source: "color/on-surface/danger" }]
    });
    assert.ok(result.error && /hook file does not exist/.test(result.error), "missing hook should fail closed");
  } finally {
    if (previousHook !== undefined) process.env.FIGLETS_BRIDGE_HOOK_FILE = previousHook;
    else delete process.env.FIGLETS_BRIDGE_HOOK_FILE;
    fs.rmSync(missingHookTmp, { recursive: true, force: true });
  }

  const emptyResult = await handleApplyDsSetupRepairs({});
  assert.ok(emptyResult.error && /at least one/i.test(emptyResult.error));
})();

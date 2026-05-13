const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const {
  applyDsSetupRepairsTool,
  handleApplyDsSetupRepairs,
  _normalizeRepairs,
  _normalizeAliasUpdates,
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

  // Regression — a repair missing `bg` must be dropped by the normalizer.
  // Otherwise an agent could approve `{ name, source }` and Figma would still
  // create an orphan semantic with no paired background.
  assert.deepStrictEqual(
    _normalizeRepairs([
      { recommended: "color/on-surface/danger-variant", source: "color/on-surface/danger" },
      { bg: "", name: "color/on-surface/x", source: "color/on-surface/y" },
    ]),
    []
  );

  // Designer-approved aliases must round-trip through the normalizer so the
  // bridge sees exactly what was previewed.
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
  // Isolate from the developer's `.local/` snapshot so the bridge payload is
  // deterministic. With no snapshot reachable, the handler can't compute
  // accessible aliases and emits the legacy `{bg,name,source}` payload.
  const prevLocalDir = process.env.FIGLETS_LOCAL_DIR;
  process.env.FIGLETS_LOCAL_DIR = tmp;
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
    if (prevLocalDir !== undefined) process.env.FIGLETS_LOCAL_DIR = prevLocalDir;
    else delete process.env.FIGLETS_LOCAL_DIR;
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

  // ── aliasUpdates: normalization drops bad rows, keeps clean ones ─────────
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

  // ── aliasUpdates wire-format + handler round-trip ────────────────────────
  // Mock receiver inspects the body, returns an updated/result payload, and
  // the handler should surface `updated` back to the caller.
  let aliasBody = null;
  const aliasServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/request-setup-repairs") {
      let body = "";
      req.on("data", chunk => { body += chunk.toString(); });
      req.on("end", () => {
        aliasBody = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          result: {
            created: [], skipped: [], unresolved: [],
            updated: [{ token: "color/on-surface/variant", mode: "Dark", to: "color/neutral/200" }],
            updateSkipped: [], updateUnresolved: [],
            message: "0 created, 0 skipped, 0 unresolved, 1 re-aliased."
          }
        }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolve => aliasServer.listen(0, resolve));
  const aliasPort = aliasServer.address().port;
  process.env.FIGLETS_RECEIVER_URL = `http://localhost:${aliasPort}`;
  const aliasTmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-alias-update-"));
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
    assert.deepStrictEqual(aliasBody.aliasUpdates, [
      {
        token: "color/on-surface/variant",
        mode: "Dark",
        newAliasTarget: "color/neutral/200",
        expectedCurrentAlias: "color/neutral/900",
      },
    ]);
    // Repairs array can still be sent (empty) — the wire-format is consistent.
    assert.deepStrictEqual(aliasBody.repairs, []);
    assert.strictEqual(aliasResult.updated.length, 1);
    assert.strictEqual(aliasResult.updated[0].token, "color/on-surface/variant");
  } finally {
    delete process.env.FIGLETS_RECEIVER_URL;
    if (prevAliasLocal !== undefined) process.env.FIGLETS_LOCAL_DIR = prevAliasLocal;
    else delete process.env.FIGLETS_LOCAL_DIR;
    await new Promise(resolve => aliasServer.close(resolve));
    fs.rmSync(aliasTmp, { recursive: true, force: true });
  }

  // No inputs → error
  const emptyResult = await handleApplyDsSetupRepairs({});
  assert.ok(emptyResult.error && /at least one/i.test(emptyResult.error));
})();

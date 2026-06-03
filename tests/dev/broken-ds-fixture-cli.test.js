const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "../..");
const script = path.join(root, "scripts", "prepare-broken-ds-fixture.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-broken-fixture-cli-"));
const preloadPath = path.join(tempDir, "preload.js");

fs.writeFileSync(preloadPath, `
const fs = require("fs");
const { EventEmitter } = require("events");
const Module = require("module");
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  const resolved = Module._resolveFilename(request, parent, isMain);
  if (resolved.replace(/\\\\/g, "/").endsWith("/packages/figlets-mcp-server/src/utils/ensure-receiver.js")) {
    return {
      ensureReceiverRunning: async () => {
        fs.writeFileSync(process.env.FIGLETS_TEST_MARKER + ".ensure", "called");
        if (process.env.FIGLETS_TEST_ENSURE_MODE === "throw") {
          throw new Error("ensureReceiverRunning should not be called");
        }
      },
    };
  }
  if (request === "http") {
    const actualHttp = originalLoad.apply(this, arguments);
    return Object.assign({}, actualHttp, {
      request: (url, options, callback) => {
        let payload = "";
        const req = new EventEmitter();
        req.write = (chunk) => { payload += String(chunk || ""); };
        req.setTimeout = () => {};
        req.destroy = () => {};
        req.end = () => {
          fs.writeFileSync(process.env.FIGLETS_TEST_MARKER + ".request", JSON.stringify({
            url: String(url),
            pathname: new URL(String(url)).pathname,
            payload,
          }));
          process.nextTick(() => {
            const res = new EventEmitter();
            res.statusCode = Number(process.env.FIGLETS_TEST_HTTP_STATUS || "200");
            callback(res);
            res.emit("data", process.env.FIGLETS_TEST_HTTP_RESPONSE || "{}");
            res.emit("end");
          });
        };
        return req;
      },
    });
  }
  return originalLoad.apply(this, arguments);
};
`, "utf8");

function baseEnv(extra) {
  const env = Object.assign({}, process.env, {
    FIGLETS_LOCAL_DIR: path.join(tempDir, "local"),
    FIGLETS_TEST_MARKER: path.join(tempDir, "marker"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${preloadPath}`.trim(),
  });
  delete env.FIGLETS_DEV_BRIDGE;
  Object.assign(env, extra || {});
  return env;
}

module.exports = (async () => {
  try {
    {
      const marker = path.join(tempDir, "negative");
      const configPath = path.join(tempDir, "negative-config", "design-system.config.js");
      const env = baseEnv({
        FIGLETS_TEST_MARKER: marker,
        FIGLETS_TEST_ENSURE_MODE: "throw",
      });
      const result = spawnSync(process.execPath, [
        script,
        "--yes-i-understand-this-mutates-figma",
        "--config",
        configPath,
      ], {
        cwd: root,
        env,
        encoding: "utf8",
      });

      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /FIGLETS_DEV_BRIDGE=1 is required/);
      assert.ok(!result.stderr.includes("ensureReceiverRunning should not be called"));
      assert.ok(!fs.existsSync(marker + ".ensure"), "receiver startup must not be attempted without explicit dev bridge opt-in");
      assert.ok(!fs.existsSync(configPath), "fixture config must not be written before the dev bridge gate");
    }

    {
      const marker = path.join(tempDir, "positive");
      const configPath = path.join(tempDir, "positive-config", "design-system.config.js");
      const env = baseEnv({
        FIGLETS_DEV_BRIDGE: "1",
        FIGLETS_RECEIVER_URL: "http://127.0.0.1:18181",
        FIGLETS_TEST_MARKER: marker,
        FIGLETS_TEST_ENSURE_MODE: "ok",
        FIGLETS_TEST_HTTP_RESPONSE: JSON.stringify({
          result: {
            fileKey: "local_cli_positive",
            fileName: "Figlets Disposable Smoke",
            removedVariables: ["space/radius/md"],
            removedTextStyles: ["type/body/md"],
            trimmedModes: [{ collectionName: "4. Spacing", keepModeNames: ["Mobile"] }],
            semanticNamingConflicts: {
              createdVariables: [{ source: "color/bg/danger", target: "color/bg/on-danger", kind: "invalid-on-background" }],
              existingVariables: [],
              missingSources: [],
              failed: [],
            },
            bindingAuditTargets: { ok: true },
            message: "Prepared by fake receiver.",
          },
        }),
      });
      const result = spawnSync(process.execPath, [
        script,
        "--yes-i-understand-this-mutates-figma",
        "--seed",
        "cli-positive",
        "--config",
        configPath,
        "--expected-file-name",
        "Figlets Disposable Smoke",
      ], {
        cwd: root,
        env,
        encoding: "utf8",
      });

      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      assert.ok(fs.existsSync(marker + ".ensure"), "explicit dev bridge mode should still ensure the receiver");
      const request = JSON.parse(fs.readFileSync(marker + ".request", "utf8"));
      const requestBody = JSON.parse(request.payload);
      assert.strictEqual(request.pathname, "/request-prepare-broken-ds-fixture");
      assert.strictEqual(requestBody.seed, "cli-positive");
      assert.strictEqual(requestBody.confirmation, "RESET_AND_BREAK_DISPOSABLE_FIGMA_FILE");
      assert.strictEqual(requestBody.expectedFileName, "Figlets Disposable Smoke");
      assert.ok(requestBody.ds && requestBody.ds.project && requestBody.ds.project.name.includes("cli-positive"));
      assert.deepStrictEqual(
        requestBody.gaps.createSemanticNamingConflicts,
        [
          { source: "color/bg/danger", target: "color/bg/on-danger", kind: "invalid-on-background" },
          { source: "color/bg/info", target: "color/bg/on-info", kind: "invalid-on-background" },
        ]
      );

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.status, "ok");
      assert.strictEqual(output.fileKey, "local_cli_positive");
      assert.strictEqual(output.fileName, "Figlets Disposable Smoke");
      assert.strictEqual(output.expectedFileName, "Figlets Disposable Smoke");
      assert.strictEqual(output.message, "Prepared by fake receiver.");
      assert.deepStrictEqual(output.semanticNamingConflicts.createdVariables, [
        { source: "color/bg/danger", target: "color/bg/on-danger", kind: "invalid-on-background" },
      ]);
      assert.strictEqual(
        output.configPath,
        path.join(tempDir, "local", "local_cli_positive", "design-system.config.js")
      );
      assert.ok(fs.existsSync(output.configPath));
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})();

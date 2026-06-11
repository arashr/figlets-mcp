const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "../..");
const script = path.join(root, "scripts", "reset-test-figma-file.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-reset-test-file-cli-"));
const preloadPath = path.join(tempDir, "preload.js");

fs.writeFileSync(preloadPath, `
const fs = require("fs");
const Module = require("module");
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "child_process") {
    const actual = originalLoad.apply(this, arguments);
    return Object.assign({}, actual, {
      spawnSync: (cmd, args, options) => {
        fs.writeFileSync(process.env.FIGLETS_TEST_MARKER, JSON.stringify({
          cmd,
          args,
          cwd: options && options.cwd,
          env: {
            FIGLETS_DEV_BRIDGE: options && options.env && options.env.FIGLETS_DEV_BRIDGE,
          },
          stdio: options && options.stdio,
        }));
        return { status: Number(process.env.FIGLETS_TEST_CHILD_STATUS || "0") };
      },
    });
  }
  return originalLoad.apply(this, arguments);
};
`, "utf8");

function run(args, extraEnv) {
  const marker = path.join(tempDir, "marker-" + Math.random().toString(16).slice(2));
  const env = Object.assign({}, process.env, {
    FIGLETS_TEST_MARKER: marker,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${preloadPath}`.trim(),
  }, extraEnv || {});
  return {
    marker,
    result: spawnSync(process.execPath, [script].concat(args || []), {
      cwd: root,
      env,
      encoding: "utf8",
    }),
  };
}

try {
  {
    const { marker, result } = run([]);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const call = JSON.parse(fs.readFileSync(marker, "utf8"));
    assert.strictEqual(call.env.FIGLETS_DEV_BRIDGE, "1");
    assert.strictEqual(call.stdio, "inherit");
    assert.ok(call.args[0].endsWith("scripts/prepare-broken-ds-fixture.js"));
    assert.ok(call.args.includes("--yes-i-understand-this-mutates-figma"));
    assert.deepStrictEqual(
      call.args.slice(call.args.indexOf("--seed"), call.args.indexOf("--seed") + 2),
      ["--seed", "bnn-53-smoke"]
    );
    assert.deepStrictEqual(
      call.args.slice(call.args.indexOf("--expected-file-name"), call.args.indexOf("--expected-file-name") + 2),
      ["--expected-file-name", "Figlets Test"]
    );
    assert.deepStrictEqual(
      call.args.slice(call.args.indexOf("--config"), call.args.indexOf("--config") + 2),
      ["--config", path.join(".local", "bnn-53-smoke-broken-fixture", "design-system.config.js")]
    );
  }

  {
    const customConfig = path.join(tempDir, "custom.config.js");
    const { marker, result } = run([
      "--seed",
      "bnn-26-smoke",
      "--expected-file-name",
      "Other Disposable",
      "--config",
      customConfig,
    ]);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const call = JSON.parse(fs.readFileSync(marker, "utf8"));
    assert.deepStrictEqual(
      call.args.slice(call.args.indexOf("--seed"), call.args.indexOf("--seed") + 2),
      ["--seed", "bnn-26-smoke"]
    );
    assert.deepStrictEqual(
      call.args.slice(call.args.indexOf("--expected-file-name"), call.args.indexOf("--expected-file-name") + 2),
      ["--expected-file-name", "Other Disposable"]
    );
    assert.deepStrictEqual(
      call.args.slice(call.args.indexOf("--config"), call.args.indexOf("--config") + 2),
      ["--config", customConfig]
    );
  }

  {
    const { marker, result } = run(["--help"]);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /npm run figlets:reset-test-file|reset-test-figma-file/);
    assert.ok(!fs.existsSync(marker), "help should not delegate to the destructive prep script");
  }

  {
    const { marker, result } = run(["--seed", ""]);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /--seed must not be empty/);
    assert.ok(!fs.existsSync(marker), "invalid args should not delegate to the destructive prep script");
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

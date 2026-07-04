const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  PRODUCT_VERSION_SOURCE,
  WORKSPACE_PACKAGE_PATHS,
  assertProductVersionAlignment,
  bumpVersion,
  collectLockfileDrift,
  collectProductVersionDrift,
  expectedTarballUrl,
  parseSemver,
  readProductVersion,
  syncProductVersion,
} = require("../../scripts/lib/product-version.js");

const REPO_ROOT = path.resolve(__dirname, "../..");
const SYNC_SCRIPT = path.join(REPO_ROOT, "scripts", "sync-product-version.js");

assert.strictEqual(PRODUCT_VERSION_SOURCE, "packages/figlets-mcp-server/package.json");

const version = readProductVersion();
parseSemver(version);
assert.strictEqual(
  expectedTarballUrl(version),
  `https://github.com/arashr/figlets-mcp/releases/download/v${version}/figlets-mcp-server-${version}.tgz`
);

assert.strictEqual(bumpVersion("1.0.0", "patch"), "1.0.1");
assert.strictEqual(bumpVersion("1.0.0", "minor"), "1.1.0");
assert.strictEqual(bumpVersion("1.0.0", "major"), "2.0.0");

assert.throws(() => parseSemver("1.0"), /Invalid semver/);
assert.throws(() => parseSemver("v1.0.0"), /Invalid semver/);

const drift = collectProductVersionDrift();
assert.strictEqual(drift.version, version);
assert.deepStrictEqual(drift.mismatches, []);
assertProductVersionAlignment();

function copyProductVersionFixtures(destRoot) {
  for (const relPath of WORKSPACE_PACKAGE_PATHS) {
    const src = path.join(REPO_ROOT, relPath);
    const dest = path.join(destRoot, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  const pluginPaths = [
    "plugins/claude-code/figlets/.claude-plugin/plugin.json",
    "plugins/codex/figlets/.codex-plugin/plugin.json",
    "plugins/codex/figlets/.mcp.json",
  ];
  for (const relPath of pluginPaths) {
    const src = path.join(REPO_ROOT, relPath);
    const dest = path.join(destRoot, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  fs.copyFileSync(path.join(REPO_ROOT, "package-lock.json"), path.join(destRoot, "package-lock.json"));
  return pluginPaths;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-version-sync-"));
try {
  const pluginPaths = copyProductVersionFixtures(tempRoot);

  const nextVersion = bumpVersion(version, "patch");
  const result = syncProductVersion(nextVersion, {
    skipLockfile: true,
    repoRoot: tempRoot,
  });
  assert.strictEqual(result.version, nextVersion);
  assert.ok(result.changed.length > 0, "sync should report changed files");

  for (const relPath of WORKSPACE_PACKAGE_PATHS) {
    const pkg = JSON.parse(fs.readFileSync(path.join(tempRoot, relPath), "utf-8"));
    assert.strictEqual(pkg.version, nextVersion, `${relPath} should sync to ${nextVersion}`);
  }

  const claudePlugin = JSON.parse(fs.readFileSync(path.join(tempRoot, pluginPaths[0]), "utf-8"));
  assert.strictEqual(claudePlugin.version, nextVersion);
  assert.strictEqual(claudePlugin.mcpServers.figlets.args[1], expectedTarballUrl(nextVersion));

  const codexPlugin = JSON.parse(fs.readFileSync(path.join(tempRoot, pluginPaths[1]), "utf-8"));
  assert.strictEqual(codexPlugin.version, nextVersion);

  const codexMcp = JSON.parse(fs.readFileSync(path.join(tempRoot, pluginPaths[2]), "utf-8"));
  assert.strictEqual(codexMcp.mcpServers.figlets.args[1], expectedTarballUrl(nextVersion));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const repairRoot = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-version-repair-"));
try {
  const pluginPaths = copyProductVersionFixtures(repairRoot);
  const targetVersion = bumpVersion(version, "patch");

  const serverPkgPath = path.join(repairRoot, "packages", "figlets-mcp-server", "package.json");
  const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, "utf-8"));
  serverPkg.version = targetVersion;
  fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 2) + "\n");

  const repairDrift = collectProductVersionDrift({ repoRoot: repairRoot });
  assert.ok(repairDrift.mismatches.length > 0, "partial manual bump should create drift");

  const repairResult = syncProductVersion(targetVersion, {
    skipLockfile: true,
    repoRoot: repairRoot,
  });
  assert.ok(repairResult.changed.length > 0, "exact-version sync should repair drift even when server already matches");

  const afterRepair = collectProductVersionDrift({ repoRoot: repairRoot });
  const nonLockDrift = afterRepair.mismatches.filter(item => !item.includes("package-lock.json"));
  assert.deepStrictEqual(nonLockDrift, [], "exact-version sync should repair package and plugin drift");

  const claudePlugin = JSON.parse(fs.readFileSync(path.join(repairRoot, pluginPaths[0]), "utf-8"));
  assert.strictEqual(claudePlugin.version, targetVersion);
  assert.strictEqual(claudePlugin.mcpServers.figlets.args[1], expectedTarballUrl(targetVersion));
} finally {
  fs.rmSync(repairRoot, { recursive: true, force: true });
}

const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-version-lock-"));
try {
  copyProductVersionFixtures(lockRoot);
  const lockPath = path.join(lockRoot, "package-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  lock.version = "9.9.9";
  lock.packages[""].version = "9.9.9";
  lock.packages["packages/figlets-core"].version = "9.9.9";
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");

  const lockDrift = collectLockfileDrift(lockRoot, version);
  assert.ok(lockDrift.some(item => item.includes("package-lock.json version")), "stale root lockfile version should drift");
  assert.ok(
    lockDrift.some(item => item.includes("packages/figlets-core")),
    "stale workspace lockfile entry should drift"
  );

  const fullDrift = collectProductVersionDrift({ repoRoot: lockRoot });
  assert.ok(fullDrift.mismatches.some(item => item.includes("package-lock.json")), "product drift should include lockfile");

  const checkMessage = [
    "Product version check FAILED",
    ...fullDrift.mismatches.map(item => `  - ${item}`),
  ].join("\n");
  assert.match(checkMessage, /Product version check FAILED/);
  assert.match(checkMessage, /package-lock\.json/);
} finally {
  fs.rmSync(lockRoot, { recursive: true, force: true });
}

const mixedFlags = childProcess.spawnSync(process.execPath, [SYNC_SCRIPT, "--check", "--patch"], {
  cwd: REPO_ROOT,
  encoding: "utf-8",
});
assert.notStrictEqual(mixedFlags.status, 0, "mixed --check and bump flags should fail");
assert.match(mixedFlags.stderr, /--check cannot be combined/);

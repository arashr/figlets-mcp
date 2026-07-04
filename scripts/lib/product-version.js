"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const SERVER_PKG_PATH = path.join(REPO_ROOT, "packages", "figlets-mcp-server", "package.json");

const PRODUCT_VERSION_SOURCE = path.relative(REPO_ROOT, SERVER_PKG_PATH);

const LOCKFILE_PATH = "package-lock.json";
const BRIDGE_CODE_PATH = "packages/figma-bridge-plugin/code.js";
const RELEASE_DOC_PATHS = [
  "README.md",
  "docs/mcp-config-examples.md",
];

const WORKSPACE_PACKAGE_PATHS = [
  "package.json",
  "packages/figlets-core/package.json",
  "packages/figlets-mcp-server/package.json",
  "packages/figlets-adapter/package.json",
  "packages/figma-bridge-plugin/package.json",
];

const TARBALL_URL_RE =
  /^https:\/\/github\.com\/arashr\/figlets-mcp\/releases\/download\/v(\d+\.\d+\.\d+)\/figlets-mcp-server-(\d+\.\d+\.\d+)\.tgz$/;
const TARBALL_URL_GLOBAL_RE =
  /https:\/\/github\.com\/arashr\/figlets-mcp\/releases\/download\/v\d+\.\d+\.\d+\/figlets-mcp-server-\d+\.\d+\.\d+\.tgz/g;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function resolveRepoRoot(options = {}) {
  return options.repoRoot ? path.resolve(options.repoRoot) : REPO_ROOT;
}

function serverPkgPath(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, "packages", "figlets-mcp-server", "package.json");
}

function readProductVersion(options = {}) {
  const pkg = readJson(serverPkgPath(resolveRepoRoot(options)));
  assert.ok(pkg.version, "server package must declare a version");
  return pkg.version;
}

function collectLockfileDrift(repoRoot, version) {
  const mismatches = [];
  const lockPath = path.join(repoRoot, LOCKFILE_PATH);
  if (!fs.existsSync(lockPath)) {
    return ["package-lock.json is missing"];
  }

  const lock = readJson(lockPath);
  if (lock.version !== version) {
    mismatches.push(
      `package-lock.json version is ${JSON.stringify(lock.version)}, expected ${JSON.stringify(version)}`
    );
  }

  for (const relPath of WORKSPACE_PACKAGE_PATHS) {
    if (relPath === "package.json") {
      continue;
    }
    const lockKey = relPath.replace(/\/package\.json$/, "");
    const entry = lock.packages && lock.packages[lockKey];
    if (!entry || !entry.version) {
      mismatches.push(`package-lock.json missing workspace entry ${lockKey}`);
      continue;
    }
    if (entry.version !== version) {
      mismatches.push(
        `package-lock.json ${lockKey} version is ${JSON.stringify(entry.version)}, expected ${JSON.stringify(version)}`
      );
    }
  }

  return mismatches;
}

function expectedTarballUrl(version) {
  return `https://github.com/arashr/figlets-mcp/releases/download/v${version}/figlets-mcp-server-${version}.tgz`;
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid semver (expected X.Y.Z): ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bumpVersion(current, kind) {
  const { major, minor, patch } = parseSemver(current);
  if (kind === "major") {
    return `${major + 1}.0.0`;
  }
  if (kind === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  if (kind === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }
  throw new Error(`Unknown bump kind: ${kind}`);
}

function assertTarballUrl(url, contextLabel) {
  const match = TARBALL_URL_RE.exec(url);
  assert.ok(match, `${contextLabel} must use a versioned GitHub release tarball URL`);
  assert.strictEqual(match[1], match[2], `${contextLabel} tarball tag and filename version must match`);
  return match[1];
}

function collectProductVersionDrift(options = {}) {
  const repoRoot = resolveRepoRoot(options);
  const version = readProductVersion({ repoRoot });
  const expectedUrl = expectedTarballUrl(version);
  const mismatches = [];

  for (const relPath of WORKSPACE_PACKAGE_PATHS) {
    const pkg = readJson(path.join(repoRoot, relPath));
    if (pkg.version !== version) {
      mismatches.push(`${relPath} version is ${JSON.stringify(pkg.version)}, expected ${JSON.stringify(version)}`);
    }
  }

  mismatches.push(...collectLockfileDrift(repoRoot, version));

  const claudePluginPath = path.join(repoRoot, "plugins", "claude-code", "figlets", ".claude-plugin", "plugin.json");
  const claudePlugin = readJson(claudePluginPath);
  if (claudePlugin.version !== version) {
    mismatches.push(`Claude plugin version is ${JSON.stringify(claudePlugin.version)}, expected ${JSON.stringify(version)}`);
  }
  const claudeUrl = claudePlugin.mcpServers.figlets.args[1];
  try {
    assertTarballUrl(claudeUrl, "Claude plugin MCP");
  } catch (err) {
    mismatches.push(err.message);
  }
  if (claudeUrl !== expectedUrl) {
    mismatches.push(`Claude plugin MCP URL is ${claudeUrl}, expected ${expectedUrl}`);
  }

  const codexPlugin = readJson(path.join(repoRoot, "plugins", "codex", "figlets", ".codex-plugin", "plugin.json"));
  if (codexPlugin.version !== version) {
    mismatches.push(`Codex plugin version is ${JSON.stringify(codexPlugin.version)}, expected ${JSON.stringify(version)}`);
  }
  const codexMcp = readJson(path.join(repoRoot, "plugins", "codex", "figlets", ".mcp.json"));
  const codexUrl = codexMcp.mcpServers.figlets.args[1];
  try {
    assertTarballUrl(codexUrl, "Codex plugin MCP");
  } catch (err) {
    mismatches.push(err.message);
  }
  if (codexUrl !== expectedUrl) {
    mismatches.push(`Codex plugin MCP URL is ${codexUrl}, expected ${expectedUrl}`);
  }

  const bridgeCode = fs.readFileSync(path.join(repoRoot, BRIDGE_CODE_PATH), "utf-8");
  const bridgeBuildMatch = bridgeCode.match(/var _bridgeBuild = '([^']+)';/);
  if (!bridgeBuildMatch) {
    mismatches.push(`${BRIDGE_CODE_PATH} is missing the _bridgeBuild marker`);
  } else if (bridgeBuildMatch[1] !== version) {
    mismatches.push(`${BRIDGE_CODE_PATH} bridge build is ${JSON.stringify(bridgeBuildMatch[1])}, expected ${JSON.stringify(version)}`);
  }

  for (const relPath of RELEASE_DOC_PATHS) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), "utf-8");
    const urls = text.match(TARBALL_URL_GLOBAL_RE) || [];
    if (urls.length === 0) {
      mismatches.push(`${relPath} must include the current release tarball install URL`);
      continue;
    }
    for (const url of urls) {
      if (url !== expectedUrl) {
        mismatches.push(`${relPath} release tarball URL is ${url}, expected ${expectedUrl}`);
      }
    }
  }

  return { version, expectedUrl, mismatches };
}

function assertProductVersionAlignment() {
  const result = collectProductVersionDrift();
  if (result.mismatches.length) {
    throw new Error(
      "Figlets product version drift detected:\n" +
      result.mismatches.map(item => `  - ${item}`).join("\n") +
      `\nRun npm run release:prepare -- ${result.version} (or --patch/--minor/--major) to sync.`
    );
  }
  return { version: result.version, expectedUrl: result.expectedUrl };
}

function syncProductVersion(newVersion, options = {}) {
  parseSemver(newVersion);
  const repoRoot = resolveRepoRoot(options);
  const changed = [];

  for (const relPath of WORKSPACE_PACKAGE_PATHS) {
    const absPath = path.join(repoRoot, relPath);
    const pkg = readJson(absPath);
    if (pkg.version === newVersion) {
      continue;
    }
    pkg.version = newVersion;
    writeJson(absPath, pkg);
    changed.push(relPath);
  }

  const claudePluginPath = path.join(repoRoot, "plugins", "claude-code", "figlets", ".claude-plugin", "plugin.json");
  const claudePlugin = readJson(claudePluginPath);
  const claudeUrl = expectedTarballUrl(newVersion);
  let claudeChanged = false;
  if (claudePlugin.version !== newVersion) {
    claudePlugin.version = newVersion;
    claudeChanged = true;
  }
  if (claudePlugin.mcpServers.figlets.args[1] !== claudeUrl) {
    claudePlugin.mcpServers.figlets.args[1] = claudeUrl;
    claudeChanged = true;
  }
  if (claudeChanged) {
    writeJson(claudePluginPath, claudePlugin);
    changed.push(path.relative(repoRoot, claudePluginPath));
  }

  const codexPluginPath = path.join(repoRoot, "plugins", "codex", "figlets", ".codex-plugin", "plugin.json");
  const codexPlugin = readJson(codexPluginPath);
  let codexPluginChanged = false;
  if (codexPlugin.version !== newVersion) {
    codexPlugin.version = newVersion;
    codexPluginChanged = true;
  }
  if (codexPluginChanged) {
    writeJson(codexPluginPath, codexPlugin);
    changed.push(path.relative(repoRoot, codexPluginPath));
  }

  const codexMcpPath = path.join(repoRoot, "plugins", "codex", "figlets", ".mcp.json");
  const codexMcp = readJson(codexMcpPath);
  const codexUrl = expectedTarballUrl(newVersion);
  if (codexMcp.mcpServers.figlets.args[1] !== codexUrl) {
    codexMcp.mcpServers.figlets.args[1] = codexUrl;
    writeJson(codexMcpPath, codexMcp);
    changed.push(path.relative(repoRoot, codexMcpPath));
  }

  const bridgeCodePath = path.join(repoRoot, BRIDGE_CODE_PATH);
  const bridgeCode = fs.readFileSync(bridgeCodePath, "utf-8");
  const bridgeBuildMatch = bridgeCode.match(/var _bridgeBuild = '([^']+)';/);
  if (!bridgeBuildMatch) {
    throw new Error(`${BRIDGE_CODE_PATH} is missing the _bridgeBuild marker`);
  }
  if (bridgeBuildMatch[1] !== newVersion) {
    fs.writeFileSync(bridgeCodePath, bridgeCode.replace(/var _bridgeBuild = '[^']+';/, `var _bridgeBuild = '${newVersion}';`));
    changed.push(BRIDGE_CODE_PATH);
  }

  for (const relPath of RELEASE_DOC_PATHS) {
    const absPath = path.join(repoRoot, relPath);
    const text = fs.readFileSync(absPath, "utf-8");
    const next = text.replace(TARBALL_URL_GLOBAL_RE, expectedTarballUrl(newVersion));
    if (next !== text) {
      fs.writeFileSync(absPath, next);
      changed.push(relPath);
    }
  }

  if (!options.skipLockfile && !options.repoRoot) {
    const lockDrift = collectLockfileDrift(REPO_ROOT, newVersion);
    if (changed.length > 0 || lockDrift.length > 0) {
      const result = childProcess.spawnSync("npm", ["install", "--package-lock-only"], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: "pipe",
      });
      if (result.status !== 0) {
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
        throw new Error(`npm install --package-lock-only failed:\n${output}`);
      }
      if (!changed.includes(LOCKFILE_PATH)) {
        changed.push(LOCKFILE_PATH);
      }
    }
  }

  return { version: newVersion, changed };
}

module.exports = {
  REPO_ROOT,
  PRODUCT_VERSION_SOURCE,
  BRIDGE_CODE_PATH,
  RELEASE_DOC_PATHS,
  WORKSPACE_PACKAGE_PATHS,
  TARBALL_URL_RE,
  readProductVersion,
  readServerVersion: readProductVersion,
  expectedTarballUrl,
  parseSemver,
  bumpVersion,
  assertTarballUrl,
  collectLockfileDrift,
  collectProductVersionDrift,
  assertProductVersionAlignment,
  syncProductVersion,
};

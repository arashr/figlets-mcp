const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const { runDoctor } = require("./doctor.js");

const FIGLETS_SERVER = { command: "figlets-mcp" };
const FIGLETS_PLUGIN_MARKETPLACE_NAME = "figlets-claude-code";
const FIGLETS_PLUGIN_NAME = "figlets";
const FIGLETS_PLUGIN_SPEC = `${FIGLETS_PLUGIN_NAME}@${FIGLETS_PLUGIN_MARKETPLACE_NAME}`;
// The plugin is distributed from the public GitHub repo. Claude Code reads the marketplace manifest
// strictly from <repo-root>/.claude-plugin/marketplace.json, so the GitHub shorthand is the repo
// slug; --sparse limits the monorepo checkout to just the Claude integration paths.
const FIGLETS_PLUGIN_GITHUB_SOURCE = "arashr/figlets-mcp";
const FIGLETS_PLUGIN_SPARSE_PATHS = [".claude-plugin", "plugins/claude-code"];

function _figletsBinPath(options) {
  return options && options.figletsBinPath
    ? options.figletsBinPath
    : path.resolve(__dirname, "../../bin/figlets-mcp.js");
}

// The marketplace source passed to `claude plugin marketplace add`. Defaults to the public GitHub
// repo. For local development before the repo is pushed, pass options.marketplaceSource (or set
// FIGLETS_MARKETPLACE_SOURCE) to the repo root, which now hosts .claude-plugin/marketplace.json.
function _marketplaceSource(options) {
  if (options && options.marketplaceSource) return options.marketplaceSource;
  const env = _env(options);
  if (env && env.FIGLETS_MARKETPLACE_SOURCE) return env.FIGLETS_MARKETPLACE_SOURCE;
  return FIGLETS_PLUGIN_GITHUB_SOURCE;
}

function _isLocalPathSource(source) {
  return typeof source === "string" && (source.startsWith("/") || source.startsWith("./") || source.startsWith("../") || source.startsWith("."));
}

function _nodePath(options) {
  return options && options.nodePath ? options.nodePath : (process.execPath || "node");
}

function _claudeCodeCommand(options) {
  return `${_nodePath(options)} ${_figletsBinPath(options)}`;
}

function _homeDir(options) {
  return (options && options.homeDir) || os.homedir();
}

function _platform(options) {
  return (options && options.platform) || process.platform;
}

function _env(options) {
  return (options && options.env) || process.env;
}

function _join() {
  return path.join.apply(path, arguments);
}

function _pathDelimiter(options) {
  return _platform(options) === "win32" ? ";" : ":";
}

function _findOnPath(binary, options) {
  const env = _env(options);
  const pathValue = env.PATH || env.Path || env.path || "";
  const extensions = _platform(options) === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];
  const dirs = pathValue.split(_pathDelimiter(options)).filter(Boolean);

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, binary + ext.toLowerCase());
      const candidateUpper = path.join(dir, binary + ext.toUpperCase());
      if (fs.existsSync(candidate)) return candidate;
      if (fs.existsSync(candidateUpper)) return candidateUpper;
    }
  }

  return null;
}

function getKnownTargets(options) {
  const home = _homeDir(options);
  const cwd = (options && options.cwd) || process.cwd();
  const platform = _platform(options);
  const env = _env(options);
  const appData = env.APPDATA || _join(home, "AppData", "Roaming");
  const marketplaceSource = _marketplaceSource(options);

  const claudeDesktopPath = platform === "win32"
    ? _join(appData, "Claude", "claude_desktop_config.json")
    : platform === "linux"
      ? _join(home, ".config", "Claude", "claude_desktop_config.json")
      : _join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");

  const cursorPath = platform === "win32"
    ? _join(appData, "Cursor", "mcp.json")
    : _join(home, ".cursor", "mcp.json");

  // The Claude Code plugin install target is always included so an explicit --hosts=claude-code-plugin
  // returns an actionable plan (with a clear manual reason) even when claude is missing. Whether it
  // supersedes the legacy claude-code target in the default run is decided after planning, based on
  // whether the plugin path is actually viable in this environment.
  const sparseArgs = _isLocalPathSource(marketplaceSource)
    ? []
    : ["--sparse"].concat(FIGLETS_PLUGIN_SPARSE_PATHS);
  return [
    {
      id: "claude-code-plugin",
      label: "Claude Code plugin",
      type: "claude-plugin-install",
      binary: "claude",
      marketplaceName: FIGLETS_PLUGIN_MARKETPLACE_NAME,
      marketplaceSource,
      marketplaceSparseArgs: sparseArgs,
      pluginName: FIGLETS_PLUGIN_NAME,
      pluginSpec: FIGLETS_PLUGIN_SPEC,
      scope: "user",
      description: "Installs the Figlets Claude Code plugin (MCP server + /figlets:start command + designer skill) via claude plugin marketplace add and claude plugin install. This is the recommended path for Claude Code.",
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      type: "json-mcpServers",
      path: claudeDesktopPath,
      description: "Adds Figlets to Claude Desktop's MCP servers.",
    },
    {
      id: "cursor",
      label: "Cursor",
      type: "json-mcpServers",
      path: cursorPath,
      description: "Adds Figlets to Cursor's global MCP config.",
    },
    {
      id: "windsurf",
      label: "Windsurf",
      type: "json-mcpServers",
      path: _join(home, ".codeium", "windsurf", "mcp_config.json"),
      description: "Adds Figlets to Windsurf's MCP config.",
    },
    {
      id: "vscode",
      label: "VS Code / GitHub Copilot",
      type: "json-servers",
      path: _join(cwd, ".vscode", "mcp.json"),
      description: "Adds Figlets to this workspace's VS Code MCP config.",
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      type: "json-mcpServers",
      path: _join(home, ".gemini", "settings.json"),
      description: "Adds Figlets to Gemini CLI settings.",
    },
    {
      id: "codex",
      label: "Codex CLI",
      type: "toml-codex",
      path: _join(home, ".codex", "config.toml"),
      description: "Adds Figlets to Codex CLI config.",
    },
    {
      id: "claude-code",
      label: "Claude Code",
      type: "native-command",
      binary: "claude",
      args: ["mcp", "add", "--scope", "user", "--transport", "stdio", "figlets", "--", _nodePath(options), _figletsBinPath(options)],
      command: `claude mcp add --scope user --transport stdio figlets -- ${_claudeCodeCommand(options)}`,
      repairScopes: ["local", "project", "user"],
      supersededBy: "claude-code-plugin",
      description: "Legacy: registers Figlets as a user-scope MCP server via claude mcp add. Superseded by the claude-code-plugin target whenever the plugin marketplace folder is available.",
    },
    {
      id: "claude-code-project",
      label: "Claude Code project config",
      type: "json-mcpServers",
      path: _join(cwd, ".mcp.json"),
      server: {
        command: _nodePath(options),
        args: [_figletsBinPath(options)],
      },
      description: "Writes a project-local .mcp.json so Claude Code sessions opened in this repo can discover Figlets.",
    },
  ];
}

function _readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

function _parseJsonOrEmpty(filePath) {
  const text = _readTextIfExists(filePath);
  if (!text || !text.trim()) return {};
  return JSON.parse(text);
}

function planJsonPatch(target) {
  let current = null;
  let parseError = null;
  try {
    current = _parseJsonOrEmpty(target.path);
  } catch (err) {
    parseError = err.message;
  }

  if (parseError) {
    return Object.assign({}, target, {
      exists: fs.existsSync(target.path),
      status: "blocked",
      reason: "Existing JSON could not be parsed: " + parseError,
    });
  }

  const rootKey = target.type === "json-servers" ? "servers" : "mcpServers";
  const server = target.server || FIGLETS_SERVER;
  const existing = current[rootKey] && current[rootKey].figlets;
  const alreadyConfigured = existing
    && existing.command === server.command
    && JSON.stringify(existing.args || []) === JSON.stringify(server.args || []);

  return Object.assign({}, target, {
    exists: fs.existsSync(target.path),
    status: alreadyConfigured ? "unchanged" : "would-update",
    rootKey,
    server,
  });
}

function planTomlPatch(target) {
  const text = _readTextIfExists(target.path) || "";
  const hasFiglets = /\[\[mcp_servers\]\][\s\S]*?name\s*=\s*["']figlets["']/.test(text);
  const hasCommand = /command\s*=\s*["']figlets-mcp["']/.test(text);
  return Object.assign({}, target, {
    exists: fs.existsSync(target.path),
    status: hasFiglets && hasCommand ? "unchanged" : "would-update",
    block: '[[mcp_servers]]\nname = "figlets"\ncommand = "figlets-mcp"\n',
  });
}

function planNativeCommand(target, options) {
  const executable = _findOnPath(target.binary, options);
  return Object.assign({}, target, {
    executable,
    status: executable ? "would-run" : "manual",
    reason: executable ? null : `${target.binary} was not found on PATH. Run the command manually after installing ${target.label}.`,
  });
}

function _claudePluginInstallCommand(target) {
  const addParts = ["claude plugin marketplace add", target.marketplaceSource]
    .concat(target.marketplaceSparseArgs || [])
    .concat(["--scope", target.scope]);
  return `${addParts.join(" ")} && claude plugin install ${target.pluginSpec} --scope ${target.scope}`;
}

function planClaudePluginInstall(target, options) {
  const executable = _findOnPath(target.binary, options);
  if (!executable) {
    return Object.assign({}, target, {
      executable: null,
      status: "manual",
      reason: `${target.binary} was not found on PATH. After installing Claude Code, run: ${_claudePluginInstallCommand(target)}`,
    });
  }
  // Local-path source (dev override) must point at a folder containing .claude-plugin/marketplace.json.
  if (_isLocalPathSource(target.marketplaceSource) && !fs.existsSync(path.join(target.marketplaceSource, ".claude-plugin", "marketplace.json"))) {
    return Object.assign({}, target, {
      executable,
      status: "manual",
      reason: `Local marketplace source ${target.marketplaceSource} has no .claude-plugin/marketplace.json. Point FIGLETS_MARKETPLACE_SOURCE at the figlets-mcp repo root, or unset it to use the GitHub source ${FIGLETS_PLUGIN_GITHUB_SOURCE}.`,
    });
  }
  return Object.assign({}, target, {
    executable,
    status: "would-run",
    command: _claudePluginInstallCommand(target),
  });
}

function getSetupPlan(options) {
  const selected = options && options.hosts ? new Set(options.hosts) : null;
  const knownTargets = getKnownTargets(options);
  const filteredTargets = knownTargets.filter(target => !selected || selected.has(target.id));
  const planned = filteredTargets.map(target => {
    if (target.type === "json-mcpServers" || target.type === "json-servers") return planJsonPatch(target);
    if (target.type === "toml-codex") return planTomlPatch(target);
    if (target.type === "native-command") return planNativeCommand(target, options);
    if (target.type === "claude-plugin-install") return planClaudePluginInstall(target, options);
    return Object.assign({}, target, { status: "manual" });
  });

  // Supersession applies only to the default run (no explicit --hosts). A target is dropped only
  // when its superseder is actually viable in this environment (would-run or unchanged) — otherwise
  // we keep the legacy target so the user still sees an actionable fallback.
  const targets = selected
    ? planned
    : planned.filter(target => {
        if (!target.supersededBy) return true;
        const superseder = planned.find(item => item.id === target.supersededBy);
        if (!superseder) return true;
        return !(superseder.status === "would-run" || superseder.status === "unchanged");
      });

  return {
    command: "figlets-mcp",
    dryRunDefault: true,
    targets,
    bridgeChecklist: [
      "Open Figma Desktop.",
      "Open the Figlets Bridge plugin in the target file.",
      "Keep the plugin open while the agent works.",
      "In your agent, ask: Help me with my design system.",
    ],
  };
}

function _backupPath(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return filePath + "." + stamp + ".bak";
}

function _writeWithBackup(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let backup = null;
  if (fs.existsSync(filePath)) {
    backup = _backupPath(filePath);
    fs.copyFileSync(filePath, backup);
  }
  fs.writeFileSync(filePath, text);
  return backup;
}

function applyJsonPatch(plan) {
  const current = _parseJsonOrEmpty(plan.path);
  const rootKey = plan.rootKey || (plan.type === "json-servers" ? "servers" : "mcpServers");
  current[rootKey] = current[rootKey] && typeof current[rootKey] === "object" ? current[rootKey] : {};
  current[rootKey].figlets = plan.server || FIGLETS_SERVER;
  const backup = _writeWithBackup(plan.path, JSON.stringify(current, null, 2) + "\n");
  return Object.assign({}, plan, { status: "updated", backup });
}

function applyTomlPatch(plan) {
  const current = _readTextIfExists(plan.path) || "";
  const separator = current && !/\n$/.test(current) ? "\n\n" : current ? "\n" : "";
  const backup = _writeWithBackup(plan.path, current + separator + plan.block);
  return Object.assign({}, plan, { status: "updated", backup });
}

function applyNativeCommand(plan, options) {
  const runner = options && options.runner ? options.runner : childProcess.spawnSync;
  const executable = plan.executable || plan.binary;
  const result = runner(executable, plan.args, { encoding: "utf-8" });
  const output = result ? String((result.stderr || "") + (result.stdout || "")) : "";
  if (result && result.error) {
    return Object.assign({}, plan, {
      status: "blocked",
      reason: result.error.message,
    });
  }
  if (/already exists/i.test(output)) {
    const repairResults = [];
    const scopes = plan.repairScopes || [];
    for (const scope of scopes) {
      const removeResult = runner(executable, ["mcp", "remove", "--scope", scope, "figlets"], { encoding: "utf-8" });
      repairResults.push({
        scope,
        status: removeResult && typeof removeResult.status === "number" ? removeResult.status : null,
      });
    }
    const retry = runner(executable, plan.args, { encoding: "utf-8" });
    const retryOutput = retry ? String((retry.stderr || "") + (retry.stdout || "")) : "";
    if (retry && typeof retry.status === "number" && retry.status === 0) {
      return Object.assign({}, plan, {
        status: "updated",
        repaired: true,
        repairResults,
        reason: "Removed stale figlets MCP entries and re-added Figlets at Claude Code user scope.",
      });
    }
    return Object.assign({}, plan, {
      status: "blocked",
      repaired: false,
      repairResults,
      reason: (retryOutput || output || "Claude Code reported an existing figlets MCP server and repair failed.").trim(),
    });
  }
  if (result && typeof result.status === "number" && result.status !== 0) {
    return Object.assign({}, plan, {
      status: "blocked",
      reason: (output || `Command exited with ${result.status}`).trim(),
    });
  }
  return Object.assign({}, plan, { status: "updated" });
}

function applyClaudePluginInstall(plan, options) {
  const runner = options && options.runner ? options.runner : childProcess.spawnSync;
  const executable = plan.executable;
  const steps = [];

  const marketplaceList = runner(executable, ["plugin", "marketplace", "list"], { encoding: "utf-8" });
  if (marketplaceList && marketplaceList.error) {
    return Object.assign({}, plan, { status: "blocked", reason: marketplaceList.error.message, steps });
  }
  const marketplaceListOutput = marketplaceList ? String((marketplaceList.stdout || "") + (marketplaceList.stderr || "")) : "";
  const marketplaceRegistered = new RegExp("(^|\\n)\\s*[^\\n]*\\b" + plan.marketplaceName + "\\b", "i").test(marketplaceListOutput);

  if (!marketplaceRegistered) {
    const addArgs = ["plugin", "marketplace", "add", plan.marketplaceSource]
      .concat(plan.marketplaceSparseArgs || [])
      .concat(["--scope", plan.scope]);
    const addResult = runner(executable, addArgs, { encoding: "utf-8" });
    const addOutput = addResult ? String((addResult.stdout || "") + (addResult.stderr || "")) : "";
    if (addResult && addResult.error) {
      return Object.assign({}, plan, { status: "blocked", reason: addResult.error.message, steps });
    }
    const addStatus = addResult && typeof addResult.status === "number" ? addResult.status : null;
    const alreadyExists = /already exists|already registered|already added/i.test(addOutput);
    if (addStatus !== 0 && addStatus !== null && !alreadyExists) {
      return Object.assign({}, plan, { status: "blocked", reason: (addOutput || `marketplace add exited with ${addStatus}`).trim(), steps });
    }
    steps.push({ step: "marketplace-add", status: alreadyExists ? "already" : "ok" });
  } else {
    steps.push({ step: "marketplace-add", status: "skipped" });
  }

  const pluginList = runner(executable, ["plugin", "list"], { encoding: "utf-8" });
  if (pluginList && pluginList.error) {
    return Object.assign({}, plan, { status: "blocked", reason: pluginList.error.message, steps });
  }
  const pluginListOutput = pluginList ? String((pluginList.stdout || "") + (pluginList.stderr || "")) : "";
  const pluginInstalled = new RegExp("\\b" + plan.pluginName + "@" + plan.marketplaceName + "\\b").test(pluginListOutput);

  if (!pluginInstalled) {
    const installResult = runner(executable, ["plugin", "install", plan.pluginSpec, "--scope", plan.scope], { encoding: "utf-8" });
    const installOutput = installResult ? String((installResult.stdout || "") + (installResult.stderr || "")) : "";
    if (installResult && installResult.error) {
      return Object.assign({}, plan, { status: "blocked", reason: installResult.error.message, steps });
    }
    const installStatus = installResult && typeof installResult.status === "number" ? installResult.status : null;
    const alreadyInstalled = /already installed|already enabled/i.test(installOutput);
    if (installStatus !== 0 && installStatus !== null && !alreadyInstalled) {
      return Object.assign({}, plan, { status: "blocked", reason: (installOutput || `plugin install exited with ${installStatus}`).trim(), steps });
    }
    steps.push({ step: "plugin-install", status: alreadyInstalled ? "already" : "ok" });
  } else {
    steps.push({ step: "plugin-install", status: "skipped" });
  }

  // Auto-clean legacy non-plugin figlets MCP registrations so the plugin's server isn't duplicated.
  // A user who had previously run `claude mcp add ... figlets` (or the legacy claude-code target)
  // would otherwise see two figlets entries — the plugin's and the user/project/local one — both
  // exposing the same tools. The plugin install supersedes those, so we remove them.
  const legacyScopes = ["user", "project", "local"];
  for (const scope of legacyScopes) {
    const removeResult = runner(executable, ["mcp", "remove", "--scope", scope, "figlets"], { encoding: "utf-8" });
    const removeOutput = removeResult ? String((removeResult.stdout || "") + (removeResult.stderr || "")) : "";
    const removeStatus = removeResult && typeof removeResult.status === "number" ? removeResult.status : null;
    const notFound = /no .*mcp server found|no server.*found|not found/i.test(removeOutput);
    if (removeResult && removeResult.error) {
      steps.push({ step: `mcp-remove-${scope}`, status: "error", reason: removeResult.error.message });
      continue;
    }
    if (removeStatus === 0 && !notFound) {
      steps.push({ step: `mcp-remove-${scope}`, status: "removed" });
    } else {
      steps.push({ step: `mcp-remove-${scope}`, status: "absent" });
    }
  }

  const installSteps = steps.filter(step => step.step === "marketplace-add" || step.step === "plugin-install");
  const everySkipped = installSteps.every(step => step.status === "skipped");
  const removedAny = steps.some(step => step.step.startsWith("mcp-remove-") && step.status === "removed");
  let resultStatus;
  if (everySkipped && !removedAny) resultStatus = "unchanged";
  else resultStatus = "updated";

  return Object.assign({}, plan, {
    status: resultStatus,
    steps,
    reason: resultStatus === "unchanged"
      ? "Marketplace and plugin already in place. Restart Claude Code if it was running before this changed."
      : everySkipped
        ? "Plugin already installed; removed legacy figlets MCP entries that the plugin supersedes. Restart Claude Code."
        : "Marketplace added and Figlets plugin installed" + (removedAny ? " (and legacy figlets MCP entries removed)" : "") + ". Restart Claude Code, then type /figlets:start (or just describe your design system to trigger the figlets-designer skill).",
  });
}

function applySetupPlan(plan, options) {
  const results = [];
  for (const target of plan.targets) {
    if (target.status !== "would-update" && target.status !== "would-run") {
      results.push(target);
      continue;
    }
    if (target.type === "json-mcpServers" || target.type === "json-servers") {
      results.push(applyJsonPatch(target));
    } else if (target.type === "toml-codex") {
      results.push(applyTomlPatch(target));
    } else if (target.type === "native-command") {
      results.push(applyNativeCommand(target, options));
    } else if (target.type === "claude-plugin-install") {
      results.push(applyClaudePluginInstall(target, options));
    } else {
      results.push(target);
    }
  }
  return Object.assign({}, plan, { targets: results });
}

function formatSetupPlan(plan, applied) {
  const lines = [];
  lines.push("Figlets MCP Setup");
  lines.push("");
  lines.push(`MCP command: ${plan.command}`);
  lines.push(applied ? "Mode: applied approved config updates" : "Mode: dry run (no files changed)");
  lines.push("");
  lines.push("Agent configs:");

  for (const target of plan.targets) {
    if (target.type === "manual-command" || (target.type === "native-command" && target.status === "manual")) {
      lines.push(`- ${target.label}: manual`);
      lines.push(`  Run: ${target.command}`);
      if (target.reason) lines.push(`  Reason: ${target.reason}`);
      continue;
    }
    if (target.type === "native-command") {
      lines.push(`- ${target.label}: ${target.status}`);
      lines.push(`  Run: ${target.command}`);
      if (target.repaired) lines.push("  Repair: removed stale figlets entries and re-added at user scope");
      if (target.reason) lines.push(`  Reason: ${target.reason}`);
      continue;
    }
    if (target.type === "claude-plugin-install") {
      lines.push(`- ${target.label}: ${target.status}`);
      if (target.command) lines.push(`  Run: ${target.command}`);
      if (target.steps && target.steps.length) {
        lines.push(`  Steps: ${target.steps.map(step => `${step.step}=${step.status}`).join(", ")}`);
      }
      if (target.reason) lines.push(`  Reason: ${target.reason}`);
      continue;
    }
    lines.push(`- ${target.label}: ${target.status}`);
    lines.push(`  File: ${target.path}`);
    if (target.backup) lines.push(`  Backup: ${target.backup}`);
    if (target.reason) lines.push(`  Reason: ${target.reason}`);
  }

  lines.push("");
  lines.push("Figma Bridge checklist:");
  for (const item of plan.bridgeChecklist) lines.push(`- ${item}`);

  if (!applied) {
    lines.push("");
    lines.push("Next step: rerun with --yes to update the listed config files.");
  }

  return lines.join("\n");
}

function _parseArgs(argv) {
  const args = argv || [];
  const result = { yes: false, doctor: false, hosts: null };
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") result.yes = true;
    else if (arg === "--dry-run") result.yes = false;
    else if (arg === "--doctor") result.doctor = true;
    else if (arg === "--skip-doctor") result.doctor = false;
    else if (arg.indexOf("--hosts=") === 0) {
      result.hosts = arg.slice("--hosts=".length).split(",").map(item => item.trim()).filter(Boolean);
    }
  }
  return result;
}

async function runSetup(argv, options) {
  const parsed = _parseArgs(argv);
  const plan = getSetupPlan(Object.assign({}, options || {}, { hosts: parsed.hosts }));
  const finalPlan = parsed.yes ? applySetupPlan(plan, options || {}) : plan;
  process.stdout.write(formatSetupPlan(finalPlan, parsed.yes) + "\n");

  if (parsed.yes && parsed.doctor) {
    process.stdout.write("\n");
    await runDoctor();
  }

  return finalPlan;
}

if (require.main === module) {
  runSetup(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`Setup failed: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  FIGLETS_SERVER,
  FIGLETS_PLUGIN_MARKETPLACE_NAME,
  FIGLETS_PLUGIN_NAME,
  FIGLETS_PLUGIN_SPEC,
  FIGLETS_PLUGIN_GITHUB_SOURCE,
  FIGLETS_PLUGIN_SPARSE_PATHS,
  getKnownTargets,
  getSetupPlan,
  applySetupPlan,
  applyNativeCommand,
  applyClaudePluginInstall,
  formatSetupPlan,
  runSetup,
};

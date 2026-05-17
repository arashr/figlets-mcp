const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const {
  FIGMA_DATA_PATH,
  getActiveFileKey,
  getActiveFilePaths
} = require("../utils/paths.js");

function readJsonFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, "utf8");

  return {
    absolutePath,
    json: JSON.parse(content)
  };
}

function readJsonFromCommand(command) {
  const content = childProcess.execSync(command, { encoding: "utf8" });

  return {
    command,
    json: JSON.parse(content)
  };
}

function loadFigmaDataSource(input = {}) {
  if (input.figmaData && typeof input.figmaData === "object") {
    return {
      kind: "inline",
      target: input.target !== undefined
        ? input.target
        : (input.figmaData.target !== undefined ? input.figmaData.target : "unknown"),
      figmaData: input.figmaData
    };
  }

  if (typeof input.figmaDataPath === "string" && input.figmaDataPath.trim()) {
    const { absolutePath, json } = readJsonFile(input.figmaDataPath);

    return {
      kind: "file",
      target: input.target !== undefined
        ? input.target
        : (json.target !== undefined ? json.target : absolutePath),
      figmaData: json,
      meta: {
        path: absolutePath
      }
    };
  }

  if (typeof input.figmaDataCommand === "string" && input.figmaDataCommand.trim()) {
    const commandResult = readJsonFromCommand(input.figmaDataCommand);

    return {
      kind: "command",
      target: input.target !== undefined
        ? input.target
        : (commandResult.json.target !== undefined ? commandResult.json.target : "command-output"),
      figmaData: commandResult.json,
      meta: {
        command: commandResult.command
      }
    };
  }

  if (typeof process.env.FIGLETS_FIGMA_DATA_PATH === "string" && process.env.FIGLETS_FIGMA_DATA_PATH.trim()) {
    const { absolutePath, json } = readJsonFile(process.env.FIGLETS_FIGMA_DATA_PATH);

    return {
      kind: "env-file",
      target: input.target !== undefined
        ? input.target
        : (json.target !== undefined ? json.target : absolutePath),
      figmaData: json,
      meta: {
        path: absolutePath,
        env: "FIGLETS_FIGMA_DATA_PATH"
      }
    };
  }

  if (typeof process.env.FIGLETS_FIGMA_DATA_COMMAND === "string" && process.env.FIGLETS_FIGMA_DATA_COMMAND.trim()) {
    const commandResult = readJsonFromCommand(process.env.FIGLETS_FIGMA_DATA_COMMAND);

    return {
      kind: "env-command",
      target: input.target !== undefined
        ? input.target
        : (commandResult.json.target !== undefined ? commandResult.json.target : "command-output"),
      figmaData: commandResult.json,
      meta: {
        command: commandResult.command,
        env: "FIGLETS_FIGMA_DATA_COMMAND"
      }
    };
  }

  const activeSource = loadActiveFigmaDataSource(input);
  if (activeSource) return activeSource;

  // Last resort: use the legacy well-known local snapshot.
  if (fs.existsSync(FIGMA_DATA_PATH)) {
    const { absolutePath, json } = readJsonFile(FIGMA_DATA_PATH);
    return {
      kind: "local-snapshot",
      target: input.target !== undefined
        ? input.target
        : (json.target !== undefined ? json.target : "local-snapshot"),
      figmaData: json,
      meta: { path: absolutePath }
    };
  }

  return null;
}

function loadActiveFigmaDataSource(input = {}) {
  const activeFileKey = getActiveFileKey();
  if (!activeFileKey) return null;
  const activePaths = getActiveFilePaths();
  if (!fs.existsSync(activePaths.data)) return null;
  const { absolutePath, json } = readJsonFile(activePaths.data);
  return {
    kind: "active-file-snapshot",
    target: input.target !== undefined
      ? input.target
      : (json.target !== undefined ? json.target : activeFileKey),
    figmaData: json,
    meta: {
      fileKey: activeFileKey,
      path: absolutePath,
      configPath: activePaths.config,
      dsContextPath: activePaths.dsContext
    }
  };
}

function explainMissingFigmaBridge() {
  return {
    code: "FIGMA_BRIDGE_NOT_CONFIGURED",
    message: "No live Figma bridge is configured yet. Pass figmaData directly, provide figmaDataPath or figmaDataCommand, or set FIGLETS_FIGMA_DATA_PATH or FIGLETS_FIGMA_DATA_COMMAND."
  };
}

module.exports = {
  explainMissingFigmaBridge,
  loadActiveFigmaDataSource,
  loadFigmaDataSource
};

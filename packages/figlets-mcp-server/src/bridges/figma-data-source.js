const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

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

  // Last resort: use the well-known local snapshot written by sync_figma_data
  const localSnapshotPath = path.resolve(__dirname, "../../../../.local/figma-data.json");
  if (fs.existsSync(localSnapshotPath)) {
    const { absolutePath, json } = readJsonFile(localSnapshotPath);
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

function explainMissingFigmaBridge() {
  return {
    code: "FIGMA_BRIDGE_NOT_CONFIGURED",
    message: "No live Figma bridge is configured yet. Pass figmaData directly, provide figmaDataPath or figmaDataCommand, or set FIGLETS_FIGMA_DATA_PATH or FIGLETS_FIGMA_DATA_COMMAND."
  };
}

module.exports = {
  explainMissingFigmaBridge,
  loadFigmaDataSource
};

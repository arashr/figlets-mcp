const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { exampleFigmaData } = require("../fixtures/design-system-data.js");

const fixturePath = path.resolve(__dirname, "../../examples/detect-design-system.figma-data.json");

function freshFigmaDataSource() {
  delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/utils/paths.js")];
  delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/bridges/figma-data-source.js")];
  return require("../../packages/figlets-mcp-server/src/bridges/figma-data-source.js");
}

function withTempLocalDir(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-figma-data-source-"));
  const previousLocalDir = process.env.FIGLETS_LOCAL_DIR;
  process.env.FIGLETS_LOCAL_DIR = tempDir;
  try {
    return run(tempDir, freshFigmaDataSource());
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousLocalDir === undefined) delete process.env.FIGLETS_LOCAL_DIR;
    else process.env.FIGLETS_LOCAL_DIR = previousLocalDir;
    delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/utils/paths.js")];
    delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/bridges/figma-data-source.js")];
  }
}

{
  const { explainMissingFigmaBridge, loadFigmaDataSource } = freshFigmaDataSource();

  const result = loadFigmaDataSource({ figmaData: exampleFigmaData });
  assert.strictEqual(result.kind, "inline");
  assert.strictEqual(result.target, "fixture-file");
}

{
  const { loadFigmaDataSource } = freshFigmaDataSource();

  const result = loadFigmaDataSource({ figmaDataPath: fixturePath });
  assert.strictEqual(result.kind, "file");
  assert.strictEqual(result.meta.path, fixturePath);
}

{
  const { loadFigmaDataSource } = freshFigmaDataSource();

  const result = loadFigmaDataSource({
    figmaDataCommand: "cat " + fixturePath
  });
  assert.strictEqual(result.kind, "command");
  assert.strictEqual(result.target, "example-file");
}

{
  const { explainMissingFigmaBridge } = freshFigmaDataSource();

  const missing = explainMissingFigmaBridge();
  assert.strictEqual(missing.code, "FIGMA_BRIDGE_NOT_CONFIGURED");
  assert.ok(/figmaDataCommand/.test(missing.message));
}

module.exports = (async () => {
  withTempLocalDir((tempDir, { loadFigmaDataSource }) => {
    const legacySnapshot = { target: "legacy-only", fileKey: "", variables: [] };
    fs.writeFileSync(
      path.join(tempDir, "figma-data.json"),
      JSON.stringify(legacySnapshot),
      "utf8"
    );

    const result = loadFigmaDataSource({});
    assert.strictEqual(result.kind, "local-snapshot");
    assert.strictEqual(result.figmaData.target, "legacy-only");
    assert.ok(result.meta.path.endsWith("figma-data.json"));
  });

  withTempLocalDir((tempDir, { loadFigmaDataSource }) => {
    const fileKey = "local_active_precedence";
    const scopedDir = path.join(tempDir, fileKey);
    fs.mkdirSync(scopedDir, { recursive: true });
    fs.writeFileSync(
      path.join(scopedDir, "figma-data.json"),
      JSON.stringify({ target: "scoped-active", fileKey, variables: [] }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempDir, "figma-data.json"),
      JSON.stringify({ target: "legacy-flat", fileKey: "", variables: [] }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempDir, "active-file.json"),
      JSON.stringify({ fileKey, updatedAt: new Date().toISOString() }),
      "utf8"
    );

    const result = loadFigmaDataSource({});
    assert.strictEqual(result.kind, "active-file-snapshot");
    assert.strictEqual(result.figmaData.target, "scoped-active");
    assert.strictEqual(result.meta.fileKey, fileKey);
    assert.ok(result.meta.path.endsWith(path.join(fileKey, "figma-data.json")));
  });

  withTempLocalDir((tempDir, { loadFigmaDataSource }) => {
    const envSnapshotPath = path.join(tempDir, "env-snapshot.json");
    fs.writeFileSync(
      envSnapshotPath,
      JSON.stringify({ target: "env-file-wins", variables: [] }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempDir, "figma-data.json"),
      JSON.stringify({ target: "legacy-flat", variables: [] }),
      "utf8"
    );

    const previousEnvPath = process.env.FIGLETS_FIGMA_DATA_PATH;
    process.env.FIGLETS_FIGMA_DATA_PATH = envSnapshotPath;
    try {
      const result = loadFigmaDataSource({});
      assert.strictEqual(result.kind, "env-file");
      assert.strictEqual(result.figmaData.target, "env-file-wins");
      assert.strictEqual(result.meta.path, envSnapshotPath);
    } finally {
      if (previousEnvPath === undefined) delete process.env.FIGLETS_FIGMA_DATA_PATH;
      else process.env.FIGLETS_FIGMA_DATA_PATH = previousEnvPath;
    }
  });

  withTempLocalDir((tempDir, { loadFigmaDataSource }) => {
    const previousEnvCommand = process.env.FIGLETS_FIGMA_DATA_COMMAND;
    process.env.FIGLETS_FIGMA_DATA_COMMAND = "cat " + fixturePath;
    try {
      const result = loadFigmaDataSource({});
      assert.strictEqual(result.kind, "env-command");
      assert.strictEqual(result.target, "example-file");
    } finally {
      if (previousEnvCommand === undefined) delete process.env.FIGLETS_FIGMA_DATA_COMMAND;
      else process.env.FIGLETS_FIGMA_DATA_COMMAND = previousEnvCommand;
    }
  });

  withTempLocalDir((tempDir, { loadFigmaDataSource }) => {
    const fileKey = "local_active_precedence";
    const scopedDir = path.join(tempDir, fileKey);
    fs.mkdirSync(scopedDir, { recursive: true });
    fs.writeFileSync(
      path.join(scopedDir, "figma-data.json"),
      JSON.stringify({ target: "scoped-active", fileKey, variables: [] }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempDir, "active-file.json"),
      JSON.stringify({ fileKey, updatedAt: new Date().toISOString() }),
      "utf8"
    );

    const result = loadFigmaDataSource({ figmaData: { target: "explicit-inline", variables: [] } });
    assert.strictEqual(result.kind, "inline");
    assert.strictEqual(result.target, "explicit-inline");
  });
})();

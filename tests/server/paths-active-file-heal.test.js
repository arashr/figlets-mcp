const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-paths-heal-"));
process.env.FIGLETS_LOCAL_DIR = TEMP_DIR;

function freshPaths() {
  delete require.cache[require.resolve("../../packages/figlets-mcp-server/src/utils/paths.js")];
  return require("../../packages/figlets-mcp-server/src/utils/paths.js");
}

module.exports = (async () => {
  try {
    const scopedKey = "local_mpcspbgz_7gq8yy0l";
    const scopedDir = path.join(TEMP_DIR, scopedKey);
    fs.mkdirSync(scopedDir, { recursive: true });
    fs.writeFileSync(
      path.join(scopedDir, "figma-data.json"),
      JSON.stringify({ fileName: "Figlets Test", fileKey: scopedKey, variables: [] }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(TEMP_DIR, "figma-data.json"),
      JSON.stringify({ fileName: "Figlets Test", fileKey: "", variables: [] }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(TEMP_DIR, "active-file.json"),
      JSON.stringify({ fileKey: null, updatedAt: new Date().toISOString() }),
      "utf8"
    );

    const paths = freshPaths();
    assert.strictEqual(paths.healFileKeyFromFileName("Figlets Test"), scopedKey);
    assert.strictEqual(paths.getActiveFileKey(), scopedKey);

    paths.writeActiveFile(scopedKey);
    assert.strictEqual(paths.getActiveFileKey(), scopedKey);
  } finally {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    delete process.env.FIGLETS_LOCAL_DIR;
  }
})();

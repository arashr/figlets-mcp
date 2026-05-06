const path = require("path");
const fs   = require("fs");

const LOCAL_DIR = process.env.FIGLETS_LOCAL_DIR
  || path.resolve(__dirname, "../../../../.local");

// Legacy flat paths (kept for backward compat)
const FIGMA_DATA_PATH = path.join(LOCAL_DIR, "figma-data.json");
const DS_CONTEXT_PATH = path.join(LOCAL_DIR, "figma-ds-context.json");
const SELECTION_PATH  = path.join(LOCAL_DIR, "figma-selection.json");

function getFilePaths(fileKey) {
  const dir = (fileKey && fileKey.trim())
    ? path.join(LOCAL_DIR, fileKey.trim())
    : LOCAL_DIR;
  return {
    dir,
    data:      path.join(dir, "figma-data.json"),
    selection: path.join(dir, "figma-selection.json"),
    config:    path.join(dir, "design-system.config.js"),
    dsContext: path.join(dir, "figma-ds-context.json"),
  };
}

function readActiveFile() {
  const p = path.join(LOCAL_DIR, "active-file.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}

function getActiveFilePaths() {
  const active = readActiveFile();
  return getFilePaths(active ? active.fileKey : null);
}

module.exports = {
  LOCAL_DIR,
  FIGMA_DATA_PATH,
  DS_CONTEXT_PATH,
  SELECTION_PATH,
  getFilePaths,
  readActiveFile,
  getActiveFilePaths,
};

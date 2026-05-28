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

function healFileKeyFromFileName(fileName) {
  const normalized = String(fileName || "").trim();
  if (!normalized || !fs.existsSync(LOCAL_DIR)) return null;
  try {
    const matches = [];
    for (const entry of fs.readdirSync(LOCAL_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidateKey = String(entry.name || "").trim();
      if (!candidateKey) continue;
      const dataPath = path.join(LOCAL_DIR, candidateKey, "figma-data.json");
      if (!fs.existsSync(dataPath)) continue;
      let snapshot = null;
      try { snapshot = JSON.parse(fs.readFileSync(dataPath, "utf-8")); } catch { continue; }
      if (snapshot && snapshot.fileName === normalized) matches.push(candidateKey);
    }
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

function writeActiveFile(fileKey) {
  const resolved = String(fileKey || "").trim();
  if (!resolved) return false;
  const dir = LOCAL_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "active-file.json"),
    JSON.stringify({ fileKey: resolved, updatedAt: new Date().toISOString() }, null, 2),
    "utf-8"
  );
  return true;
}

function getActiveFilePaths() {
  const active = readActiveFile();
  return getFilePaths(active ? active.fileKey : null);
}

function getActiveFileKey() {
  const active = readActiveFile();
  if (active && typeof active.fileKey === "string" && active.fileKey.trim()) {
    return active.fileKey.trim();
  }

  if (fs.existsSync(FIGMA_DATA_PATH)) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(FIGMA_DATA_PATH, "utf-8"));
      if (snapshot && typeof snapshot.fileKey === "string" && snapshot.fileKey.trim()) {
        return snapshot.fileKey.trim();
      }
      const healed = healFileKeyFromFileName(snapshot && snapshot.fileName);
      if (healed) return healed;
    } catch (_) {}
  }

  return null;
}

function getActiveFileConfigPath() {
  const fileKey = getActiveFileKey();
  return fileKey ? getFilePaths(fileKey).config : null;
}

function isLegacyFlatConfigPath(configPath) {
  return path.resolve(configPath) === path.join(LOCAL_DIR, "design-system.config.js");
}

function getConfigPathGuardError(configPath) {
  const activeFileKey = getActiveFileKey();
  if (isLegacyFlatConfigPath(configPath)) {
    return {
      error: activeFileKey
        ? "Refusing to use the legacy flat .local/design-system.config.js while an active Figma file is selected."
        : "Refusing to use the legacy flat .local/design-system.config.js because the active Figma file has no fileKey.",
      hint: activeFileKey
        ? "Use .local/" + activeFileKey + "/design-system.config.js for the active file instead."
        : "Save/open a Figma file with a real fileKey, run sync_figma_data, then create or prepare .local/<fileKey>/design-system.config.js for that file.",
    };
  }
  return null;
}

module.exports = {
  LOCAL_DIR,
  FIGMA_DATA_PATH,
  DS_CONTEXT_PATH,
  SELECTION_PATH,
  getFilePaths,
  readActiveFile,
  healFileKeyFromFileName,
  writeActiveFile,
  getActiveFileKey,
  getActiveFilePaths,
  getActiveFileConfigPath,
  isLegacyFlatConfigPath,
  getConfigPathGuardError,
};

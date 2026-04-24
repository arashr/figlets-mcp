const path = require("path");

const LOCAL_DIR = process.env.FIGLETS_LOCAL_DIR
  || path.resolve(__dirname, "../../../../.local");

const FIGMA_DATA_PATH     = path.join(LOCAL_DIR, "figma-data.json");
const DS_CONTEXT_PATH     = path.join(LOCAL_DIR, "figma-ds-context.json");
const SELECTION_PATH      = path.join(LOCAL_DIR, "figma-selection.json");

module.exports = { LOCAL_DIR, FIGMA_DATA_PATH, DS_CONTEXT_PATH, SELECTION_PATH };

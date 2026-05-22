const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  updateDsPrimitivesTool,
} = require("../../packages/figlets-mcp-server/src/tools/update-ds-primitives.js");
const {
  handleUpdateDsTokens,
  updateDsTokensTool,
} = require("../../packages/figlets-mcp-server/src/tools/update-ds-tokens.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-token-boundary-"));
const configPath = path.join(tmp, "design-system.config.js");
const figmaDataPath = path.join(tmp, "figma-data.json");

const DS = {
  collections: {
    primitives: "1. Primitives",
    color: "2. Color",
    typography: "3. Typography",
    spacing: "4. Spacing",
    elevation: "5. Elevation",
  },
  color: {
    ramps: [{ folder: "color/blue", steps: [[500, 0, 0, 1]] }],
    semantics: { paired: [], unpaired: [] },
  },
  primitives: {
    spacing: [[0, 0], [4, 16]],
  },
  spacing: {
    radius: { md: 8 },
    border: { default: 1 },
    semantic: { "component/md": [12, 16, 16] },
  },
  typography: {
    families: { sans: "Inter" },
    scale: {
      "body/md": { sizes: [14, 14, 16], lineHeights: [20, 20, 24], weight: 400, tracking: 0 },
    },
  },
  naming: {
    textStyle: "type/{role}/{size}",
    typePrefix: "type",
    fontFamily: "font/{variant}",
  },
};

const figmaData = {
  variables: [],
  textStyles: [],
  effectStyles: [],
};

fs.writeFileSync(configPath, "const DS = " + JSON.stringify(DS, null, 2) + ";\n", "utf8");
fs.writeFileSync(figmaDataPath, JSON.stringify(figmaData, null, 2), "utf8");

module.exports = (async () => {
  try {
    assert.ok(
      updateDsPrimitivesTool.inputSchema.properties.categories.description.includes("primitive-typography"),
      "update_ds_primitives should advertise primitive/color-semantic categories"
    );
    assert.ok(
      updateDsTokensTool.description.includes("config-backed non-color token completion"),
      "update_ds_tokens should remain the non-color token-completion surface"
    );

    const primitivesAsTokens = handleUpdateDsTokens({
      config_path: configPath,
      figmaDataPath,
      categories: ["primitive-color", "primitive-spacing", "color-semantics"],
      dry_run: false,
      create_missing: true,
    });
    assert.ok(
      primitivesAsTokens.error && /limited to radius, border-width, semantic spacing/.test(primitivesAsTokens.error),
      "update_ds_tokens apply should reject primitive/color-semantic ownership"
    );
    assert.deepStrictEqual(
      primitivesAsTokens.unknownCategories,
      ["primitive-color", "primitive-spacing", "color-semantics"],
      "primitive/color-semantic categories should not be token-apply categories"
    );
    assert.deepStrictEqual(
      primitivesAsTokens.missingCapabilityNotes.map(note => note.kind),
      ["unsupported-apply-category", "unsupported-apply-category", "unsupported-apply-category"],
      "boundary violations should stay product-gap notes, not silent routing"
    );

    const nonColorDryRun = handleUpdateDsTokens({
      config_path: configPath,
      figmaDataPath,
      categories: ["radius", "border-width", "spacing-semantics", "typography-variables"],
      dry_run: true,
      create_missing: true,
    });
    assert.ok(!nonColorDryRun.error, nonColorDryRun.error);
    assert.deepStrictEqual(
      nonColorDryRun.categories,
      ["radius", "border-width", "spacing-semantics", "typography-variables"],
      "update_ds_tokens should continue to own approved non-color completion slices"
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

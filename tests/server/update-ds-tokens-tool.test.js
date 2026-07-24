const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createBridgeHookFile,
  installBridgeHook,
  readBridgeHookCapture,
  setBridgeHookRoute,
} = require("../helpers/bridge-hook.js");

const {
  updateDsTokensTool,
  handleUpdateDsTokens,
} = require("../../packages/figlets-mcp-server/src/tools/update-ds-tokens.js");

function stubUpdateTokensRoute(hookPath, capturePath, result, options) {
  setBridgeHookRoute(hookPath, "/request-update-tokens", {
    capturePath,
    statusCode: options && options.statusCode,
    json: options && options.statusCode && options.statusCode !== 200
      ? options.json
      : { success: true, result },
  });
}

function variable(id, name, type) {
  return {
    id,
    name,
    resolvedType: type || "FLOAT",
    valuesByMode: { m1: 1 },
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-update-tokens-"));
const configPath = path.join(tmp, "design-system.config.js");
const figmaDataPath = path.join(tmp, "figma-data.json");

const DS = {
  collections: {
    primitives: "1. Primitives",
    typography: "3. Typography",
    spacing: "4. Spacing",
    elevation: "5. Elevation",
  },
  naming: { textStyle: "type/{role}/{size}", typePrefix: "type", fontFamily: "font/{variant}" },
  primitives: { spacing: [[0, 0], [4, 16]] },
  color: { ramps: [{ folder: "color/blue", steps: [[500, 0, 0, 1]] }] },
  typography: {
    families: { sans: "Inter", mono: "JetBrains Mono" },
    scale: {
      "body/md": { sizes: [14, 14, 16], lineHeights: [20, 20, 24], weight: 400, tracking: 0 },
    },
  },
  spacing: {
    semantic: { "component/md": [12, 16, 16] },
    radius: { md: 8 },
    border: { default: 1 },
  },
};

const figmaData = {
  variables: [
    variable("space-component-md", "space/component/md"),
    variable("type-body-size", "type/body/md/size"),
    variable("type-body-weight", "type/body/md/weight"),
    variable("radius-md", "space/radius/md", "COLOR"),
  ],
  textStyles: [],
  effectStyles: [{ name: "elevation/0" }],
};

fs.writeFileSync(configPath, "const DS = " + JSON.stringify(DS, null, 2) + ";\n", "utf8");
fs.writeFileSync(figmaDataPath, JSON.stringify(figmaData, null, 2), "utf8");

module.exports = (async () => {
  const hookPath = createBridgeHookFile(tmp);
  const uninstallHook = installBridgeHook(hookPath);
  try {
    assert.strictEqual(updateDsTokensTool.name, "update_ds_tokens");
    assert.ok(updateDsTokensTool.description.includes("broad typography/elevation orchestration"));
    assert.ok(updateDsTokensTool.inputSchema.properties.prune, "schema should expose prune options");
    assert.ok(
      updateDsTokensTool.inputSchema.properties.effect_style_repairs,
      "schema should expose exact audited effect-style repairs"
    );

    {
      const result = handleUpdateDsTokens({});
      assert.ok(result.error && /config_path/.test(result.error), "missing config_path should fail clearly");
    }

    {
      const exactConfigPath = path.join(tmp, "design-system-exact-mobile-spacing.config.js");
      const exactSnapshotPath = path.join(tmp, "figma-data-exact-mobile-spacing.json");
      const exactDs = Object.assign({}, DS, {
        spacing: {
          semantic: {
            "layout/lg": [48, 64, 96],
            "layout/xl": [64, 96, 128],
            "touch/min": [44, 44, 44],
            "touch/comfortable": [48, 48, 40],
            "component/md": [24, 32, 32],
          },
          radius: {},
          border: {},
        },
      });
      const exactSnapshot = {
        collections: [
          {
            id: "primitives",
            name: "1. Primitives",
            variableIds: ["space-11", "space-12", "space-16"],
            modes: [{ modeId: "default", name: "Default" }],
          },
          {
            id: "spacing",
            name: "4. Spacing",
            variableIds: ["layout-lg", "layout-xl", "touch-min", "touch-comfortable"],
            modes: [{ modeId: "mobile", name: "Mobile" }],
          },
        ],
        variables: [
          { id: "space-11", name: "space/11", resolvedType: "FLOAT", valuesByMode: { default: 44 } },
          { id: "space-12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 48 } },
          { id: "space-16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 64 } },
          { id: "layout-lg", name: "space/layout/lg", resolvedType: "FLOAT", valuesByMode: { mobile: 48 } },
          { id: "layout-xl", name: "space/layout/xl", resolvedType: "FLOAT", valuesByMode: { mobile: 64 } },
          { id: "touch-min", name: "space/touch/min", resolvedType: "FLOAT", valuesByMode: { mobile: 44 } },
          { id: "touch-comfortable", name: "space/touch/comfortable", resolvedType: "FLOAT", valuesByMode: { mobile: 48 } },
        ],
        textStyles: [],
        effectStyles: [],
      };
      fs.writeFileSync(exactConfigPath, "const DS = " + JSON.stringify(exactDs, null, 2) + ";\n", "utf8");
      fs.writeFileSync(exactSnapshotPath, JSON.stringify(exactSnapshot, null, 2), "utf8");
      const result = handleUpdateDsTokens({
        config_path: exactConfigPath,
        figmaDataPath: exactSnapshotPath,
        categories: ["spacing-semantics"],
        spacing_semantic_repairs: [
          { name: "space/layout/lg", updates: [{ modeId: "mobile", modeName: "Mobile", toAliasId: "space-12", toAliasName: "space/12", configExpected: 48 }] },
          { name: "space/layout/xl", updates: [{ modeId: "mobile", modeName: "Mobile", toAliasId: "space-16", toAliasName: "space/16", configExpected: 64 }] },
          { name: "space/touch/min", updates: [{ modeId: "mobile", modeName: "Mobile", toAliasId: "space-11", toAliasName: "space/11", configExpected: 44 }] },
          { name: "space/touch/comfortable", updates: [{ modeId: "mobile", modeName: "Mobile", toAliasId: "space-12", toAliasName: "space/12", configExpected: 48 }] },
        ],
        create_missing: true,
        dry_run: true,
      });
      assert.ok(!result.error, result.error);
      assert.deepStrictEqual(
        result.report["spacing-semantics"].wouldUpdateVariables.map(item => item.name).sort(),
        ["space/layout/lg", "space/layout/xl", "space/touch/comfortable", "space/touch/min"].sort(),
        "exact spacing repair dry-run should preview only the approved token subset"
      );
      assert.strictEqual(
        result.report["spacing-semantics"].wouldCreateVariables.length,
        0,
        "exact spacing repair dry-run must not preview unrelated semantic spacing creation"
      );
      for (const item of result.report["spacing-semantics"].wouldUpdateVariables) {
        assert.strictEqual(item.updates.length, 1, item.name + " should preview only the approved Mobile update");
        assert.strictEqual(item.updates[0].modeName, "Mobile");
      }
    }

    {
      const result = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath,
        categories: ["typography", "radius", "made-up"],
        create_missing: true,
        dry_run: true,
        prune: { off_scale_color_steps: true },
      });
      assert.ok(!result.error, result.error);
      assert.strictEqual(result.dryRun, true);
      assert.deepStrictEqual(result.categories, ["typography", "radius"]);
      assert.deepStrictEqual(result.unknownCategories, ["made-up"]);
      assert.ok(
        result.missingCapabilityNotes.some(note => note.kind === "unsupported-prune" && /update_ds_primitives/.test(note.reason)),
        "color prune requests should redirect to update_ds_primitives"
      );
      assert.ok(
        result.report.typography.wouldCreateVariables.some(item => item.name === "type/body/md/line-height"),
        "dry-run should report missing typography variables as wouldCreateVariables"
      );
      assert.ok(
        result.report.typography.wouldCreateStyles.some(item => item.name === "type/body/md"),
        "dry-run should report missing text styles as wouldCreateStyles"
      );
      assert.ok(
        result.report.radius.typeMismatch.some(item => item.name === "space/radius/md" && item.actualType === "COLOR"),
        "dry-run should report type mismatches without mutating"
      );
      assert.ok(/would create/.test(result.message), "message should summarize would-create work");
      assert.strictEqual(result.applySupported, true);
      assert.deepStrictEqual(
        result.supportedApplyCategories,
        ["border-width", "elevation", "elevation-styles", "elevation-variables", "radius", "spacing-semantics", "typography", "typography-styles", "typography-variables"]
      );
    }

    {
      const aliasRepairDataPath = path.join(tmp, "figma-data-spacing-alias-repair.json");
      const aliasRepairSnapshot = {
        collections: [
          {
            id: "primitives",
            name: "1. Primitives",
            variableIds: ["space-12", "space-16"],
            modes: [{ id: "default", modeId: "default", name: "Default" }],
          },
          {
            id: "spacing",
            name: "4. Spacing",
            variableIds: ["space-component-md"],
            modes: [
              { id: "mobile", modeId: "mobile", name: "Mobile" },
              { id: "tablet", modeId: "tablet", name: "Tablet" },
              { id: "desktop", modeId: "desktop", name: "Desktop" },
            ],
          },
        ],
        variables: [
          { id: "space-12", name: "space/12", resolvedType: "FLOAT", valuesByMode: { default: 12 } },
          { id: "space-16", name: "space/16", resolvedType: "FLOAT", valuesByMode: { default: 16 } },
          {
            id: "space-component-md",
            name: "space/component/md",
            resolvedType: "FLOAT",
            valuesByMode: { mobile: 12, tablet: 16, desktop: 16 },
          },
        ],
        textStyles: [],
        effectStyles: [],
      };
      fs.writeFileSync(aliasRepairDataPath, JSON.stringify(aliasRepairSnapshot, null, 2), "utf8");
      const result = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath: aliasRepairDataPath,
        categories: ["spacing-semantics"],
        create_missing: true,
        dry_run: true,
      });
      assert.ok(!result.error, result.error);
      assert.ok(
        result.report["spacing-semantics"].wouldUpdateVariables.some(item => item.name === "space/component/md"),
        "dry-run should surface deterministic semantic spacing alias rewires as wouldUpdateVariables"
      );
      const spacingUpdate = result.report["spacing-semantics"].wouldUpdateVariables.find(item => item.name === "space/component/md");
      assert.ok(
        spacingUpdate.updates.some(update => update.modeName === "Mobile" && update.toAliasName === "space/12"),
        "dry-run should include exact mode-level alias target details for semantic spacing repairs"
      );
    }

    {
      const pruneFigmaDataPath = path.join(tmp, "figma-data-prune.json");
      const pruneSnapshot = {
        collections: [
          {
            id: "spacing",
            name: "4. Spacing",
            modes: [{ id: "m1", modeId: "m1", name: "Mobile" }],
            variableIds: ["space-component-md", "space-legacy"],
          },
          {
            id: "typography",
            name: "3. Typography",
            modes: [{ id: "t1", modeId: "t1", name: "Mobile" }],
            variableIds: ["type-body-size"],
          },
        ],
        variables: [
          variable("space-component-md", "space/component/md"),
          variable("space-legacy", "space/legacy-token"),
          variable("type-body-size", "type/body/md/size"),
        ],
        textStyles: [{ name: "type/body/md" }, { name: "type/body/legacy" }],
        effectStyles: [{ name: "elevation/0" }, { name: "elevation/9" }],
      };
      fs.writeFileSync(pruneFigmaDataPath, JSON.stringify(pruneSnapshot, null, 2), "utf8");
      const result = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath: pruneFigmaDataPath,
        categories: ["spacing-semantics", "typography-styles", "elevation-styles"],
        create_missing: true,
        dry_run: true,
        prune: {
          off_config_variables: true,
          off_config_text_styles: true,
          off_config_effect_styles: true,
        },
      });
      assert.ok(!result.error, result.error);
      assert.ok(result.report.prune, "token prune dry-run should include prune report");
      assert.ok(
        result.report.prune.wouldPruneVariables.some(item => item.name === "space/legacy-token"),
        "off-config spacing variables should be prune candidates"
      );
      assert.ok(
        result.report.prune.wouldPruneTextStyles.some(item => item.name === "type/body/legacy"),
        "off-config text styles should be prune candidates"
      );
      assert.ok(
        result.report.prune.wouldPruneEffectStyles.some(item => item.name === "elevation/9"),
        "off-config effect styles should be prune candidates"
      );
      assert.ok(!result.report.prune.wouldPruneEffectStyles.some(item => item.name === "elevation/0"));

      const dryPruneGuarded = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath: pruneFigmaDataPath,
        categories: ["radius"],
        dry_run: true,
        prune: { off_config_variables: true },
      });
      assert.ok(
        dryPruneGuarded.missingCapabilityNotes.some(note => note.kind === "prune-requires-config-authoritative"),
        "dry-run prune should warn that apply needs config_authoritative"
      );

      const blockedPruneApply = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath: pruneFigmaDataPath,
        categories: ["radius"],
        dry_run: false,
        prune: { off_config_variables: true },
      });
      assert.ok(blockedPruneApply.error && /config_authoritative/i.test(blockedPruneApply.error));
      assert.ok(
        blockedPruneApply.missingCapabilityNotes.some(note => note.kind === "prune-requires-config-authoritative"),
        "prune apply without config_authoritative should be blocked"
      );
    }

    {
      const result = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath,
        categories: ["typography"],
        create_missing: false,
        dry_run: true,
      });
      assert.ok(!result.error, result.error);
      assert.ok(
        result.report.typography.unmatched.some(item => item.name === "type/body/md/line-height"),
        "create_missing=false should keep missing variables in unmatched"
      );
      assert.strictEqual(result.report.typography.wouldCreateVariables.length, 0);
      assert.strictEqual(result.report.typography.wouldCreateStyles.length, 0);
    }

    {
      const result = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath,
        categories: ["typography-variables"],
        create_missing: true,
        dry_run: true,
      });
      assert.ok(!result.error, result.error);
      assert.ok(
        result.report["typography-variables"].wouldCreateVariables.some(item => item.name === "type/body/md/line-height"),
        "typography-variables dry-run should report missing typography variables"
      );
      assert.strictEqual(
        result.report["typography-variables"].wouldCreateStyles.length,
        0,
        "typography-variables dry-run must not include text styles"
      );
    }

    {
      const completeStyleDataPath = path.join(tmp, "figma-data-complete-styles.json");
      const completeStyleData = {
        variables: [
          variable("type-body-md-size", "type/body/md/size"),
          variable("type-body-md-line-height", "type/body/md/line-height"),
          variable("type-body-md-weight", "type/body/md/weight"),
          variable("type-body-md-tracking", "type/body/md/tracking"),
          variable("type-body-md-family", "type/body/md/family", "STRING"),
          variable("elevation-xs-offset", "elevation/xs/offset-y"),
          variable("elevation-xs-radius", "elevation/xs/radius"),
          variable("elevation-sm-offset", "elevation/sm/offset-y"),
          variable("elevation-sm-radius", "elevation/sm/radius"),
          variable("elevation-md-offset", "elevation/md/offset-y"),
          variable("elevation-md-radius", "elevation/md/radius"),
          variable("elevation-lg-offset", "elevation/lg/offset-y"),
          variable("elevation-lg-radius", "elevation/lg/radius"),
          variable("elevation-xl-offset", "elevation/xl/offset-y"),
          variable("elevation-xl-radius", "elevation/xl/radius"),
        ],
        textStyles: [{ name: "type/body/md" }],
        effectStyles: [
          { name: "elevation/0" },
          { name: "elevation/1" },
          { name: "elevation/2" },
          { name: "elevation/3" },
          { name: "elevation/4" },
          { name: "elevation/5" },
        ],
      };
      fs.writeFileSync(completeStyleDataPath, JSON.stringify(completeStyleData, null, 2), "utf8");
      const result = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath: completeStyleDataPath,
        categories: ["typography-styles", "elevation-styles"],
        create_missing: true,
        dry_run: true,
      });
      assert.ok(!result.error, result.error);
      assert.deepStrictEqual(result.report["typography-styles"].wouldCreateStyles, []);
      assert.deepStrictEqual(
        result.report["typography-styles"].wouldRefreshStyles.map(item => item.name),
        ["type/body/md"],
        "dry-run should preview existing config-derived text style refreshes"
      );
      assert.deepStrictEqual(result.report["elevation-styles"].wouldCreateStyles, []);
      assert.deepStrictEqual(
        result.report["elevation-styles"].wouldRefreshStyles.map(item => item.name),
        ["elevation/0", "elevation/1", "elevation/2", "elevation/3", "elevation/4", "elevation/5"],
        "dry-run should preview existing config-derived effect style refreshes"
      );
      assert.ok(
        /would refresh/.test(result.message),
        "dry-run message should summarize refresh candidates"
      );
    }

    {
      const rawStyleDataPath = path.join(tmp, "figma-data-five-raw-elevation-styles.json");
      const rawEffectStyles = [{ id: "effect-0", name: "elevation/0", effects: [] }];
      for (let level = 1; level <= 5; level++) {
        rawEffectStyles.push({
          id: `effect-${level}`,
          name: `elevation/${level}`,
          effects: [{
            type: "DROP_SHADOW",
            color: { r: 0, g: 0, b: 0, a: 0.2 },
            offset: { x: 0, y: level },
            radius: level * 2,
            boundVariables: {},
          }],
        });
      }
      fs.writeFileSync(rawStyleDataPath, JSON.stringify({
        variables: [],
        textStyles: [],
        effectStyles: rawEffectStyles,
      }, null, 2), "utf8");

      const fallbackPreview = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath: rawStyleDataPath,
        categories: ["elevation-styles"],
        create_missing: true,
        dry_run: true,
      });
      assert.ok(!fallbackPreview.error, fallbackPreview.error);
      assert.deepStrictEqual(
        fallbackPreview.report["elevation-styles"].wouldRefreshStyles.map(item => item.name),
        ["elevation/1", "elevation/2", "elevation/3", "elevation/4", "elevation/5"],
        "fallback preview must project the shared raw-binding findings instead of proposing healthy elevation/0"
      );

      const exactRepairs = rawEffectStyles.slice(1).map((style, index) => ({
        styleId: style.id,
        name: style.name,
        bindings: [{
          effectIndex: 0,
          shadowRole: "key",
          property: "radius",
          rawValue: (index + 1) * 2,
          expectedVariable: `elevation/${["xs", "sm", "md", "lg", "xl"][index]}/radius`,
          expectedVariableId: null,
          expectedVariableExists: false,
        }],
      }));
      const exactPreview = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath: rawStyleDataPath,
        categories: ["elevation-styles"],
        effect_style_repairs: exactRepairs,
        create_missing: true,
        dry_run: true,
      });
      assert.ok(!exactPreview.error, exactPreview.error);
      assert.strictEqual(exactPreview.repairSource, "inspect_ds_token_gaps.effect_style_repairs");
      assert.deepStrictEqual(
        exactPreview.report["elevation-styles"].wouldRefreshStyles.map(item => item.name),
        ["elevation/1", "elevation/2", "elevation/3", "elevation/4", "elevation/5"],
        "exact preview must use the carried audit payload without a second discovery pass"
      );
      assert.ok(
        !exactPreview.report["elevation-styles"].wouldRefreshStyles.some(item => item.name === "elevation/0"),
        "exact preview must not widen the repair to a healthy style"
      );
    }

    {
      const capturePath = path.join(tmp, "capture-orchestration.json");
      stubUpdateTokensRoute(hookPath, capturePath, {
        dryRun: false,
        categories: ["typography-variables", "typography-styles"],
        unknownCategories: [],
        report: {
          "typography-variables": {
            entries: 4,
            createdVariables: [{ name: "type/body/md/line-height" }],
            updatedVariables: [],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [],
            wouldCreateStyles: [],
            wouldRefreshStyles: [],
            refreshedStyles: [],
            unmatched: [],
            typeMismatch: [],
            fontLoadFailures: [],
            bindingWarnings: [],
          },
          "typography-styles": {
            entries: 1,
            createdVariables: [],
            updatedVariables: [],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [{ name: "type/body/md", id: "style-orch-1" }],
            wouldCreateStyles: [],
            wouldRefreshStyles: [],
            refreshedStyles: [],
            unmatched: [],
            typeMismatch: [],
            fontLoadFailures: [],
            bindingWarnings: [],
          },
        },
        message: "typography-variables: 1 changed; typography-styles: 1 changed",
      });
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath,
        categories: ["typography"],
        dry_run: false,
      });
      assert.ok(!result.error, result.error);
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.requestedCategories, ["typography"]);
      assert.deepStrictEqual(result.orchestratedFrom, ["typography"]);
      assert.deepStrictEqual(readBridgeHookCapture(capturePath).categories, ["typography-variables", "typography-styles"]);
    }

    {
      const result = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath,
        categories: ["primitive-typography", "primitive-shadow"],
        dry_run: false,
      });
      assert.ok(result.error && /typography\/elevation orchestration/.test(result.error));
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.unknownCategories, ["primitive-typography", "primitive-shadow"]);
      assert.deepStrictEqual(
        result.missingCapabilityNotes.map(note => note.category),
        ["primitive-typography", "primitive-shadow"],
        "primitive categories should remain explicit apply product gaps on update_ds_tokens"
      );
    }

    {
      const capturePath = path.join(tmp, "capture-typography-styles.json");
      stubUpdateTokensRoute(hookPath, capturePath, {
        dryRun: false,
        categories: ["typography-styles"],
        unknownCategories: [],
        report: {
          "typography-styles": {
            entries: 1,
            createdVariables: [],
            updatedVariables: [],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [{ name: "type/body/md", id: "style-1", boundVariables: ["fontSize", "lineHeight", "letterSpacing"] }],
            refreshedStyles: [],
            unmatched: [],
            typeMismatch: [],
            fontLoadFailures: [],
            bindingWarnings: [],
          },
        },
        message: "typography-styles: 1 changed",
      });
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["typography-styles"],
        create_missing: true,
        dry_run: false,
      });
      const receivedBody = readBridgeHookCapture(capturePath);
      assert.ok(!result.error, result.error);
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.categories, ["typography-styles"]);
      assert.strictEqual(result.applySupported, true);
      assert.ok(receivedBody.DS, "typography-styles apply should send DS to bridge hook");
      assert.deepStrictEqual(receivedBody.categories, ["typography-styles"]);
      assert.strictEqual(receivedBody.dryRun, false);
    }

    {
      const capturePath = path.join(tmp, "capture-elevation-styles.json");
      stubUpdateTokensRoute(hookPath, capturePath, {
        dryRun: false,
        categories: ["elevation-styles"],
        unknownCategories: [],
        report: {
          "elevation-styles": {
            entries: 6,
            createdVariables: [],
            updatedVariables: [],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [{ name: "elevation/1", id: "style-1", effectCount: 1 }],
            refreshedStyles: [{ name: "elevation/0", id: "existing-style-0", effectCount: 0 }],
            unmatched: [],
            typeMismatch: [],
            fontLoadFailures: [],
            bindingWarnings: [{
              kind: "missingShadowColorVariable",
              name: "color/shadow/ambient",
              styleName: "elevation/2",
            }],
          },
        },
        message: "elevation-styles: 2 changed",
      });
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["elevation-styles"],
        effect_style_repairs: [{
          styleId: "existing-style-1",
          name: "elevation/1",
          bindings: [{
            effectIndex: 0,
            shadowRole: "key",
            property: "radius",
            rawValue: 2,
            expectedVariable: "elevation/xs/radius",
            expectedVariableId: "elevation-xs-radius",
            expectedVariableExists: true,
          }],
        }],
        create_missing: true,
        dry_run: false,
      });
      const receivedBody = readBridgeHookCapture(capturePath);
      assert.ok(!result.error, result.error);
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.categories, ["elevation-styles"]);
      assert.strictEqual(result.applySupported, true);
      assert.deepStrictEqual(
        result.report["elevation-styles"].bindingWarnings[0].kind,
        "missingShadowColorVariable",
        "server should preserve bridge binding warnings for designer review"
      );
      assert.ok(receivedBody.DS, "elevation-styles apply should send DS to bridge hook");
      assert.deepStrictEqual(receivedBody.categories, ["elevation-styles"]);
      assert.deepStrictEqual(
        receivedBody.effectStyleRepairs.map(item => item.name),
        ["elevation/1"],
        "apply must forward the exact approved style set to the bridge"
      );
    }

    {
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["elevation-styles"],
        effect_style_repairs: [],
        create_missing: true,
        dry_run: false,
      });
      assert.ok(
        result.error && result.error.includes("effect_style_repairs was provided"),
        "an empty exact effect-style payload must fail closed instead of widening to every elevation style"
      );
    }

    {
      const capturePath = path.join(tmp, "capture-elevation-variables.json");
      stubUpdateTokensRoute(hookPath, capturePath, {
        dryRun: false,
        categories: ["elevation-variables"],
        unknownCategories: [],
        report: {
          "elevation-variables": {
            entries: 10,
            createdVariables: [{
              name: "elevation/xs/offset-y",
              scopes: ["EFFECT_FLOAT"],
              valuesByMode: [{
                modeId: "value",
                modeName: "Value",
                value: { type: "VARIABLE_ALIAS", id: "shadow-1-offset", name: "shadow/1/offset-y" },
              }],
            }],
            updatedVariables: [{
              name: "elevation/xs/radius",
              scopes: ["EFFECT_FLOAT"],
              valuesByMode: [{
                modeId: "value",
                modeName: "Value",
                value: { type: "VARIABLE_ALIAS", id: "shadow-1-radius", name: "shadow/1/radius" },
              }],
            }],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [],
            refreshedStyles: [],
            unmatched: [],
            typeMismatch: [],
            fontLoadFailures: [],
          },
        },
        message: "elevation-variables: 2 changed",
      });
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["elevation-variables"],
        create_missing: true,
        dry_run: false,
      });
      const receivedBody = readBridgeHookCapture(capturePath);
      assert.ok(!result.error, result.error);
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.categories, ["elevation-variables"]);
      assert.strictEqual(result.applySupported, true);
      assert.deepStrictEqual(
        result.report["elevation-variables"].createdVariables[0].valuesByMode[0].value.name,
        "shadow/1/offset-y",
        "server should preserve bridge alias target details for changed variables"
      );
      assert.ok(receivedBody.DS, "elevation-variables apply should send DS to bridge hook");
      assert.deepStrictEqual(receivedBody.categories, ["elevation-variables"]);
      assert.strictEqual(receivedBody.dryRun, false);
    }

    {
      const capturePath = path.join(tmp, "capture-radius-border.json");
      stubUpdateTokensRoute(hookPath, capturePath, {
        dryRun: false,
        categories: ["radius", "border-width"],
        unknownCategories: [],
        report: {
          radius: {
            entries: 1,
            createdVariables: [{ name: "space/radius/md" }],
            updatedVariables: [],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [],
            refreshedStyles: [],
            unmatched: [],
            typeMismatch: [],
            fontLoadFailures: [],
          },
          "border-width": {
            entries: 1,
            createdVariables: [],
            updatedVariables: [{ name: "space/border/default" }],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [],
            refreshedStyles: [],
            unmatched: [],
            typeMismatch: [],
            fontLoadFailures: [],
          },
        },
        message: "radius: 1 changed; border-width: 1 changed",
      });
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["radius", "border-width"],
        create_missing: true,
        dry_run: false,
      });
      const receivedBody = readBridgeHookCapture(capturePath);
      assert.ok(!result.error, result.error);
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.categories, ["radius", "border-width"]);
      assert.strictEqual(result.applySupported, true);
      assert.ok(receivedBody.DS, "apply should send DS to bridge hook");
      assert.deepStrictEqual(receivedBody.categories, ["radius", "border-width"]);
      assert.strictEqual(receivedBody.createMissing, true);
      assert.strictEqual(receivedBody.dryRun, false);
    }

    {
      const capturePath = path.join(tmp, "capture-typography-variables.json");
      stubUpdateTokensRoute(hookPath, capturePath, {
        dryRun: false,
        categories: ["typography-variables"],
        unknownCategories: [],
        report: {
          "typography-variables": {
            entries: 5,
            createdVariables: [{ name: "type/body/md/line-height" }],
            updatedVariables: [{ name: "type/body/md/size" }],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [],
            refreshedStyles: [],
            unmatched: [],
            typeMismatch: [],
            fontLoadFailures: [],
          },
        },
        message: "typography-variables: 2 changed",
      });
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["typography-variables"],
        create_missing: true,
        dry_run: false,
      });
      const receivedBody = readBridgeHookCapture(capturePath);
      assert.ok(!result.error, result.error);
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.categories, ["typography-variables"]);
      assert.strictEqual(result.applySupported, true);
      assert.ok(receivedBody.DS, "typography-variables apply should send DS to bridge hook");
      assert.deepStrictEqual(receivedBody.categories, ["typography-variables"]);
      assert.strictEqual(receivedBody.dryRun, false);
    }

    {
      const capturePath = path.join(tmp, "capture-spacing-semantics.json");
      stubUpdateTokensRoute(hookPath, capturePath, {
        dryRun: false,
        categories: ["spacing-semantics"],
        unknownCategories: [],
        report: {
          "spacing-semantics": {
            entries: 1,
            createdVariables: [{ name: "space/component/md" }],
            updatedVariables: [],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [],
            refreshedStyles: [],
            unmatched: [],
            typeMismatch: [],
            fontLoadFailures: [],
          },
        },
        message: "spacing-semantics: 1 changed",
      });
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["spacing-semantics"],
        create_missing: true,
        dry_run: false,
      });
      const receivedBody = readBridgeHookCapture(capturePath);
      assert.ok(!result.error, result.error);
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.categories, ["spacing-semantics"]);
      assert.strictEqual(result.applySupported, true);
      assert.ok(receivedBody.DS, "spacing-semantics apply should send DS to bridge hook");
      assert.deepStrictEqual(receivedBody.categories, ["spacing-semantics"]);
      assert.strictEqual(receivedBody.dryRun, false);
      assert.strictEqual(
        receivedBody.ensureCollectionModes,
        false,
        "spacing-semantics apply must not implicitly create configured breakpoint modes"
      );
    }

    {
      const capturePath = path.join(tmp, "capture-exact-spacing-repairs.json");
      stubUpdateTokensRoute(hookPath, capturePath, {
        dryRun: false,
        categories: ["spacing-semantics"],
        unknownCategories: [],
        report: {
          "spacing-semantics": {
            entries: 1,
            createdVariables: [],
            updatedVariables: [{ name: "space/layout/lg" }],
            wouldCreateVariables: [],
            wouldUpdateVariables: [],
            createdStyles: [],
            refreshedStyles: [],
            unmatched: [],
            typeMismatch: [],
            fontLoadFailures: [],
          },
        },
        message: "spacing-semantics: 1 changed",
      });
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["spacing-semantics"],
        spacing_semantic_repairs: [{
          name: "space/layout/lg",
          updates: [{
            modeId: "mobile",
            modeName: "Mobile",
            toAliasId: "space-12",
            toAliasName: "space/12",
            configExpected: 48,
          }],
        }],
        create_missing: true,
        dry_run: false,
      });
      const receivedBody = readBridgeHookCapture(capturePath);
      assert.ok(!result.error, result.error);
      assert.strictEqual(receivedBody.ensureCollectionModes, false);
      assert.deepStrictEqual(receivedBody.spacingSemanticRepairs, [{
        name: "space/layout/lg",
        updates: [{
          modeId: "mobile",
          modeName: "Mobile",
          toAliasId: "space-12",
          toAliasName: "space/12",
          configExpected: 48,
        }],
      }]);
    }

    {
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["spacing-semantics"],
        spacing_semantic_repairs: [],
        create_missing: true,
        dry_run: false,
      });
      assert.ok(
        result.error && result.error.includes("spacing_semantic_repairs was provided"),
        "explicit but empty exact semantic spacing repairs should fail closed before bridge apply"
      );
      assert.ok(
        result.error.includes("omit the field entirely for a full category apply"),
        "error should distinguish exact subset apply from full category apply"
      );
    }

    {
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["spacing-semantics"],
        spacing_semantic_repairs: [{
          name: "space/layout/lg",
          updates: [],
        }],
        create_missing: true,
        dry_run: false,
      });
      assert.ok(
        result.error && result.error.includes("spacing_semantic_repairs was provided"),
        "malformed exact semantic spacing repairs should not silently widen to full category apply"
      );
    }

    {
      const capturePath = path.join(tmp, "capture-explicit-ensure-modes.json");
      stubUpdateTokensRoute(hookPath, capturePath, {
        dryRun: false,
        categories: ["spacing-semantics"],
        unknownCategories: [],
        report: {},
        ensuredModes: [{ collection: "4. Spacing", createdModes: ["Tablet", "Desktop"] }],
        message: "collection modes ensured",
      });
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["spacing-semantics"],
        ensure_collection_modes: true,
        create_missing: true,
        dry_run: false,
      });
      const receivedBody = readBridgeHookCapture(capturePath);
      assert.ok(!result.error, result.error);
      assert.strictEqual(
        receivedBody.ensureCollectionModes,
        true,
        "explicitly approved ensure_collection_modes should still be forwarded"
      );
    }

    {
      const result = await handleUpdateDsTokens({
        config_path: configPath,
        categories: ["spacing-semantics"],
        ensure_collection_modes: true,
        spacing_semantic_repairs: [{
          name: "space/layout/lg",
          updates: [{
            modeId: "mobile",
            modeName: "Mobile",
            toAliasId: "space-12",
            toAliasName: "space/12",
            configExpected: 48,
          }],
        }],
        create_missing: true,
        dry_run: false,
      });
      assert.ok(
        result.error && result.error.includes("Invalid approval boundary"),
        "bundled mode creation and exact spacing alias repair should be rejected"
      );
      assert.ok(
        result.error.includes("separate approval"),
        "error should explain the separate approval boundary"
      );
    }

    {
      stubUpdateTokensRoute(hookPath, null, {}, {
        statusCode: 409,
        json: {
          error: "The Figlets Bridge plugin is connected but does not advertise the token-update command.",
          activeSessionId: "figlets-old",
          pluginCapabilities: ["update-primitives"],
        },
      });
      const result = await handleUpdateDsTokens({ config_path: configPath, categories: ["radius"], dry_run: false });
      assert.ok(result.error && /token-update/.test(result.error), "409 should explain stale plugin capability");
      assert.strictEqual(result.activeSessionId, "figlets-old");
      assert.deepStrictEqual(result.pluginCapabilities, ["update-primitives"]);
    }

    {
      stubUpdateTokensRoute(hookPath, null, {
        dryRun: false,
        categories: ["radius"],
        unknownCategories: [],
        report: {},
        error: "Spacing collection \"4. Spacing\" is not present in this Figma file, so this narrow token update did not make changes.",
        missingCapabilityNotes: [{
          kind: "missing-foundation-collection",
          collection: "4. Spacing",
          repairTool: "apply_ds_foundation_repairs",
          repairReady: true,
          productGap: false,
        }],
      });
      const result = await handleUpdateDsTokens({ config_path: configPath, categories: ["radius"], dry_run: false });
      assert.ok(result.error && /Spacing collection/.test(result.error), "plugin result error should be preserved");
      assert.ok(
        result.missingCapabilityNotes.some(note =>
          note.kind === "missing-foundation-collection" &&
          note.repairTool === "apply_ds_foundation_repairs" &&
          note.productGap === false
        ),
        "missing foundation guided repair notes should survive the server bridge response"
      );
    }
  } finally {
    uninstallHook();
    try { fs.unlinkSync(configPath); } catch (err) {}
    try { fs.unlinkSync(figmaDataPath); } catch (err) {}
    try { fs.rmdirSync(tmp); } catch (err) {}
  }
})();

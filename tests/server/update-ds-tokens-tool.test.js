const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const {
  updateDsTokensTool,
  handleUpdateDsTokens,
} = require("../../packages/figlets-mcp-server/src/tools/update-ds-tokens.js");

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
  try {
    assert.strictEqual(updateDsTokensTool.name, "update_ds_tokens");
    assert.ok(updateDsTokensTool.description.includes("radius, border-width, semantic spacing, typography variables/text styles, elevation variables, and elevation effect styles"));
    assert.ok(updateDsTokensTool.inputSchema.properties.prune, "schema should expose prune options");

    {
      const result = handleUpdateDsTokens({});
      assert.ok(result.error && /config_path/.test(result.error), "missing config_path should fail clearly");
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
        result.missingCapabilityNotes.some(note => note.kind === "unsupported-prune"),
        "prune requests should be reported as unsupported in Phase 3B"
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
      assert.deepStrictEqual(result.supportedApplyCategories, ["border-width", "elevation-styles", "elevation-variables", "radius", "spacing-semantics", "typography-styles", "typography-variables"]);
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
      const result = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath,
        categories: ["typography"],
        dry_run: false,
      });
      assert.ok(result.error && /limited to radius, border-width, semantic spacing, typography variables\/text styles, elevation variables, and elevation effect styles/.test(result.error), "unsupported apply categories should be explicit");
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.unknownCategories, ["typography"]);
    }

    {
      const result = handleUpdateDsTokens({
        config_path: configPath,
        figmaDataPath,
        categories: ["typography", "elevation", "primitive-typography", "primitive-shadow"],
        dry_run: false,
      });
      assert.ok(result.error && /limited to radius, border-width, semantic spacing, typography variables\/text styles, elevation variables, and elevation effect styles/.test(result.error));
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.categories, []);
      assert.deepStrictEqual(result.unknownCategories, ["typography", "elevation", "primitive-typography", "primitive-shadow"]);
      assert.deepStrictEqual(
        result.missingCapabilityNotes.map(note => note.category),
        ["typography", "elevation", "primitive-typography", "primitive-shadow"],
        "typography/elevation-style categories should remain explicit apply product gaps until their strategies land"
      );
    }

    await (async () => {
      let receivedBody = null;
      const mockServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/request-update-tokens") {
          let body = "";
          req.on("data", chunk => { body += chunk.toString(); });
          req.on("end", () => {
            receivedBody = JSON.parse(body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              success: true,
              result: {
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
              }
            }));
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
      const { port } = mockServer.address();
      process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

      try {
        const result = await handleUpdateDsTokens({
          config_path: configPath,
          categories: ["typography-styles"],
          create_missing: true,
          dry_run: false,
        });
        assert.ok(!result.error, result.error);
        assert.strictEqual(result.dryRun, false);
        assert.deepStrictEqual(result.categories, ["typography-styles"]);
        assert.strictEqual(result.applySupported, true);
        assert.ok(receivedBody && receivedBody.DS, "typography-styles apply should send DS to bridge");
        assert.deepStrictEqual(receivedBody.categories, ["typography-styles"]);
        assert.strictEqual(receivedBody.dryRun, false);
      } finally {
        await new Promise(resolve => mockServer.close(resolve));
        delete process.env.FIGLETS_RECEIVER_URL;
      }
    })();

    await (async () => {
      let receivedBody = null;
      const mockServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/request-update-tokens") {
          let body = "";
          req.on("data", chunk => { body += chunk.toString(); });
          req.on("end", () => {
            receivedBody = JSON.parse(body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              success: true,
              result: {
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
              }
            }));
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
      const { port } = mockServer.address();
      process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

      try {
        const result = await handleUpdateDsTokens({
          config_path: configPath,
          categories: ["elevation-styles"],
          create_missing: true,
          dry_run: false,
        });
        assert.ok(!result.error, result.error);
        assert.strictEqual(result.dryRun, false);
        assert.deepStrictEqual(result.categories, ["elevation-styles"]);
        assert.strictEqual(result.applySupported, true);
        assert.deepStrictEqual(
          result.report["elevation-styles"].bindingWarnings[0].kind,
          "missingShadowColorVariable",
          "server should preserve bridge binding warnings for designer review"
        );
        assert.ok(receivedBody && receivedBody.DS, "elevation-styles apply should send DS to bridge");
        assert.deepStrictEqual(receivedBody.categories, ["elevation-styles"]);
      } finally {
        await new Promise(resolve => mockServer.close(resolve));
        delete process.env.FIGLETS_RECEIVER_URL;
      }
    })();

    await (async () => {
      let receivedBody = null;
      const mockServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/request-update-tokens") {
          let body = "";
          req.on("data", chunk => { body += chunk.toString(); });
          req.on("end", () => {
            receivedBody = JSON.parse(body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              success: true,
              result: {
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
              }
            }));
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
      const { port } = mockServer.address();
      process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

      try {
        const result = await handleUpdateDsTokens({
          config_path: configPath,
          categories: ["elevation-variables"],
          create_missing: true,
          dry_run: false,
        });
        assert.ok(!result.error, result.error);
        assert.strictEqual(result.dryRun, false);
        assert.deepStrictEqual(result.categories, ["elevation-variables"]);
        assert.strictEqual(result.applySupported, true);
        assert.deepStrictEqual(
          result.report["elevation-variables"].createdVariables[0].valuesByMode[0].value.name,
          "shadow/1/offset-y",
          "server should preserve bridge alias target details for changed variables"
        );
        assert.ok(receivedBody && receivedBody.DS, "elevation-variables apply should send DS to bridge");
        assert.deepStrictEqual(receivedBody.categories, ["elevation-variables"]);
        assert.strictEqual(receivedBody.dryRun, false);
      } finally {
        await new Promise(resolve => mockServer.close(resolve));
        delete process.env.FIGLETS_RECEIVER_URL;
      }
    })();

    await (async () => {
      let receivedBody = null;
      const mockServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/request-update-tokens") {
          let body = "";
          req.on("data", chunk => { body += chunk.toString(); });
          req.on("end", () => {
            receivedBody = JSON.parse(body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              success: true,
              result: {
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
              }
            }));
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
      const { port } = mockServer.address();
      process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

      try {
        const result = await handleUpdateDsTokens({
          config_path: configPath,
          categories: ["radius", "border-width"],
          create_missing: true,
          dry_run: false,
        });
        assert.ok(!result.error, result.error);
        assert.strictEqual(result.dryRun, false);
        assert.deepStrictEqual(result.categories, ["radius", "border-width"]);
        assert.strictEqual(result.applySupported, true);
        assert.ok(receivedBody && receivedBody.DS, "apply should send DS to bridge");
        assert.deepStrictEqual(receivedBody.categories, ["radius", "border-width"]);
        assert.strictEqual(receivedBody.createMissing, true);
        assert.strictEqual(receivedBody.dryRun, false);
      } finally {
        await new Promise(resolve => mockServer.close(resolve));
        delete process.env.FIGLETS_RECEIVER_URL;
      }
    })();

    await (async () => {
      let receivedBody = null;
      const mockServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/request-update-tokens") {
          let body = "";
          req.on("data", chunk => { body += chunk.toString(); });
          req.on("end", () => {
            receivedBody = JSON.parse(body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              success: true,
              result: {
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
              }
            }));
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
      const { port } = mockServer.address();
      process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

      try {
        const result = await handleUpdateDsTokens({
          config_path: configPath,
          categories: ["typography-variables"],
          create_missing: true,
          dry_run: false,
        });
        assert.ok(!result.error, result.error);
        assert.strictEqual(result.dryRun, false);
        assert.deepStrictEqual(result.categories, ["typography-variables"]);
        assert.strictEqual(result.applySupported, true);
        assert.ok(receivedBody && receivedBody.DS, "typography-variables apply should send DS to bridge");
        assert.deepStrictEqual(receivedBody.categories, ["typography-variables"]);
        assert.strictEqual(receivedBody.dryRun, false);
      } finally {
        await new Promise(resolve => mockServer.close(resolve));
        delete process.env.FIGLETS_RECEIVER_URL;
      }
    })();

    await (async () => {
      let receivedBody = null;
      const mockServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/request-update-tokens") {
          let body = "";
          req.on("data", chunk => { body += chunk.toString(); });
          req.on("end", () => {
            receivedBody = JSON.parse(body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              success: true,
              result: {
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
              }
            }));
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
      const { port } = mockServer.address();
      process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

      try {
        const result = await handleUpdateDsTokens({
          config_path: configPath,
          categories: ["spacing-semantics"],
          create_missing: true,
          dry_run: false,
        });
        assert.ok(!result.error, result.error);
        assert.strictEqual(result.dryRun, false);
        assert.deepStrictEqual(result.categories, ["spacing-semantics"]);
        assert.strictEqual(result.applySupported, true);
        assert.ok(receivedBody && receivedBody.DS, "spacing-semantics apply should send DS to bridge");
        assert.deepStrictEqual(receivedBody.categories, ["spacing-semantics"]);
        assert.strictEqual(receivedBody.dryRun, false);
      } finally {
        await new Promise(resolve => mockServer.close(resolve));
        delete process.env.FIGLETS_RECEIVER_URL;
      }
    })();

    await (async () => {
      const mockServer = http.createServer((req, res) => {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "The Figlets Bridge plugin is connected but does not advertise the token-update command.",
          activeSessionId: "figlets-old",
          pluginCapabilities: ["update-primitives"],
        }));
      });

      await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
      const { port } = mockServer.address();
      process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

      try {
        const result = await handleUpdateDsTokens({ config_path: configPath, categories: ["radius"], dry_run: false });
        assert.ok(result.error && /token-update/.test(result.error), "409 should explain stale plugin capability");
        assert.strictEqual(result.activeSessionId, "figlets-old");
        assert.deepStrictEqual(result.pluginCapabilities, ["update-primitives"]);
      } finally {
        await new Promise(resolve => mockServer.close(resolve));
        delete process.env.FIGLETS_RECEIVER_URL;
      }
    })();

    await (async () => {
      const mockServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/request-update-tokens") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            result: {
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
            },
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
      const { port } = mockServer.address();
      process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

      try {
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
      } finally {
        await new Promise(resolve => mockServer.close(resolve));
        delete process.env.FIGLETS_RECEIVER_URL;
      }
    })();
  } finally {
    try { fs.unlinkSync(configPath); } catch (err) {}
    try { fs.unlinkSync(figmaDataPath); } catch (err) {}
    try { fs.rmdirSync(tmp); } catch (err) {}
  }
})();

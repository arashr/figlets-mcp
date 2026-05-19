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
    assert.ok(updateDsTokensTool.description.includes("radius and border-width"));
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
      assert.deepStrictEqual(result.supportedApplyCategories, ["border-width", "radius"]);
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
        categories: ["typography"],
        dry_run: false,
      });
      assert.ok(result.error && /limited to radius and border-width/.test(result.error), "unsupported apply categories should be explicit");
      assert.strictEqual(result.dryRun, false);
      assert.deepStrictEqual(result.unknownCategories, ["typography"]);
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
                productGap: true,
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
          result.missingCapabilityNotes.some(note => note.kind === "missing-foundation-collection" && note.productGap === true),
          "missing foundation notes should survive the server bridge response"
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

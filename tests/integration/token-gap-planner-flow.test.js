const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const {
  handleInspectDsTokenGaps,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-token-gaps.js");
const {
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

function writeConfig(configPath, ds) {
  fs.writeFileSync(configPath, "const DS = " + JSON.stringify(ds, null, 2) + ";\n", "utf8");
}

function writeSnapshot(figmaDataPath, figmaData) {
  fs.writeFileSync(figmaDataPath, JSON.stringify(figmaData, null, 2), "utf8");
}

module.exports = (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-token-flow-"));
  const configPath = path.join(tmp, "design-system.config.js");
  const figmaDataPath = path.join(tmp, "figma-data.json");

  const DS = {
    collections: {
      primitives: "1. Primitives",
      typography: "3. Typography",
      spacing: "4. Spacing",
      elevation: "5. Elevation",
    },
    naming: { textStyle: "type/{role}/{size}", typePrefix: "type" },
    primitives: { spacing: [[0, 0], [4, 16]] },
    typography: {
      families: { sans: "Inter" },
      scale: {
        "body/md": { sizes: [14, 14, 16], lineHeights: [20, 20, 24], weight: 400, tracking: 0 },
      },
    },
    spacing: {
      semantic: { "component/md": [12, 16, 16] },
      radius: { md: 8, lg: 12 },
      border: { default: 1 },
    },
  };

  const initialSnapshot = {
    collections: [
      {
        id: "spacing",
        name: "4. Spacing",
        modes: [{ id: "m1", modeId: "m1", name: "Value" }],
        variableIds: [],
      },
      {
        id: "elevation",
        name: "5. Elevation",
        modes: [{ id: "e1", modeId: "e1", name: "Value" }],
        variableIds: [],
      },
    ],
    variables: [],
    textStyles: [],
    effectStyles: [],
  };

  writeConfig(configPath, DS);
  writeSnapshot(figmaDataPath, initialSnapshot);

  try {
    const inspected = handleInspectDsTokenGaps({
      config_path: configPath,
      figmaDataPath,
      categories: ["radius", "border-width", "spacing-semantics", "typography", "elevation"],
    });
    assert.ok(!inspected.error, inspected.error);
    assert.deepStrictEqual(inspected.repairPlan.previewInput.categories, ["border-width", "elevation", "radius", "spacing-semantics", "typography"]);
    assert.deepStrictEqual(inspected.repairPlan.applyInput.categories, ["border-width", "elevation-variables", "radius", "spacing-semantics"]);
    assert.deepStrictEqual(
      inspected.repairPlan.foundationRepairPlan.applyInput.collections,
      [{ kind: "typography", name: "3. Typography", modes: ["Mobile", "Tablet", "Desktop"] }],
      "missing Typography collection should be routed through foundation repair before token apply"
    );
    assert.ok(
      inspected.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "typography"),
      "typography should remain a dry-run/product-gap category"
    );
    assert.ok(
      !inspected.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "spacing-semantics"),
      "spacing-semantics should be apply-supported, not a product gap"
    );
    assert.ok(
      inspected.repairPlan.missingCapabilityNotes.some(note => note.kind === "unsupported-apply-category" && note.category === "elevation"),
      "broad elevation effect-style work should remain a dry-run/product-gap category"
    );

    const dryRun = handleUpdateDsTokens(Object.assign({}, inspected.repairPlan.previewInput, {
      figmaDataPath,
    }));
    assert.ok(!dryRun.error, dryRun.error);
    assert.strictEqual(dryRun.dryRun, true);
    assert.strictEqual(dryRun.report.radius.wouldCreateVariables.length, 2);
    assert.strictEqual(dryRun.report["border-width"].wouldCreateVariables.length, 1);
    assert.ok(
      dryRun.report["spacing-semantics"].wouldCreateVariables.some(item => item.name === "space/component/md"),
      "dry-run should preview missing semantic spacing variables"
    );
    assert.ok(dryRun.report.typography.wouldCreateVariables.length > 0);
    assert.ok(dryRun.report.typography.wouldCreateStyles.length > 0);
    assert.ok(dryRun.report.elevation.wouldCreateVariables.length > 0);
    assert.ok(dryRun.report.elevation.wouldCreateStyles.length > 0);

    const afterFoundationSnapshot = Object.assign({}, initialSnapshot, {
      collections: initialSnapshot.collections.concat([{
        id: "typography",
        name: "3. Typography",
        modes: [
          { id: "t1", modeId: "t1", name: "Mobile" },
          { id: "t2", modeId: "t2", name: "Tablet" },
          { id: "t3", modeId: "t3", name: "Desktop" },
        ],
        variableIds: [],
      }]),
    });
    writeSnapshot(figmaDataPath, afterFoundationSnapshot);
    const reinspectedAfterFoundation = handleInspectDsTokenGaps({
      config_path: configPath,
      figmaDataPath,
      categories: ["radius", "border-width", "spacing-semantics", "typography", "elevation"],
    });
    assert.ok(!reinspectedAfterFoundation.error, reinspectedAfterFoundation.error);
    assert.deepStrictEqual(
      reinspectedAfterFoundation.repairPlan.applyInput.categories,
      ["border-width", "elevation-variables", "radius", "spacing-semantics", "typography-variables"],
      "foundation repair should unblock the narrow typography variable apply slice"
    );

    let receivedBody = null;
    const mockServer = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/request-update-tokens") {
        res.writeHead(404);
        res.end();
        return;
      }

      let body = "";
      req.on("data", chunk => { body += chunk.toString(); });
      req.on("end", () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          result: {
            dryRun: false,
            categories: receivedBody.categories,
            unknownCategories: [],
            report: {
              radius: {
                entries: 2,
                wouldCreateVariables: [],
                createdVariables: [
                  { name: "space/radius/md" },
                  { name: "space/radius/lg" },
                ],
                wouldUpdateVariables: [],
                updatedVariables: [],
                wouldCreateStyles: [],
                createdStyles: [],
                wouldRefreshStyles: [],
                refreshedStyles: [],
                unmatched: [],
                typeMismatch: [],
                fontLoadFailures: [],
              },
              "border-width": {
                entries: 1,
                wouldCreateVariables: [],
                createdVariables: [{ name: "space/border/default" }],
                wouldUpdateVariables: [],
                updatedVariables: [],
                wouldCreateStyles: [],
                createdStyles: [],
                wouldRefreshStyles: [],
                refreshedStyles: [],
                unmatched: [],
                typeMismatch: [],
                fontLoadFailures: [],
              },
              "spacing-semantics": {
                entries: 1,
                wouldCreateVariables: [],
                createdVariables: [{ name: "space/component/md" }],
                wouldUpdateVariables: [],
                updatedVariables: [],
                wouldCreateStyles: [],
                createdStyles: [],
                wouldRefreshStyles: [],
                refreshedStyles: [],
                unmatched: [],
                typeMismatch: [],
                fontLoadFailures: [],
              },
              "typography-variables": {
                entries: 5,
                wouldCreateVariables: [],
                createdVariables: [
                  { name: "type/body/md/size" },
                  { name: "type/body/md/line-height" },
                  { name: "type/body/md/weight" },
                  { name: "type/body/md/tracking" },
                ],
                wouldUpdateVariables: [],
                updatedVariables: [],
                wouldCreateStyles: [],
                createdStyles: [],
                wouldRefreshStyles: [],
                refreshedStyles: [],
                unmatched: [{ name: "type/body/md/family" }],
                typeMismatch: [],
                fontLoadFailures: [],
              },
              "elevation-variables": {
                entries: 10,
                wouldCreateVariables: [],
                createdVariables: [
                  { name: "elevation/xs/offset-y" },
                  { name: "elevation/xs/radius" },
                  { name: "elevation/sm/offset-y" },
                  { name: "elevation/sm/radius" },
                  { name: "elevation/md/offset-y" },
                  { name: "elevation/md/radius" },
                  { name: "elevation/lg/offset-y" },
                  { name: "elevation/lg/radius" },
                  { name: "elevation/xl/offset-y" },
                  { name: "elevation/xl/radius" },
                ],
                wouldUpdateVariables: [],
                updatedVariables: [],
                wouldCreateStyles: [],
                createdStyles: [],
                wouldRefreshStyles: [],
                refreshedStyles: [],
                unmatched: [],
                typeMismatch: [],
                fontLoadFailures: [],
              },
            },
            message: "radius: 2 changed; border-width: 1 changed; spacing-semantics: 1 changed; typography-variables: 4 changed; elevation-variables: 10 changed",
          },
        }));
      });
    });

    await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
    const { port } = mockServer.address();
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${port}`;

    try {
      const applied = await handleUpdateDsTokens(reinspectedAfterFoundation.repairPlan.applyInput);
      assert.ok(!applied.error, applied.error);
      assert.strictEqual(applied.dryRun, false);
      assert.deepStrictEqual(receivedBody.categories, ["border-width", "elevation-variables", "radius", "spacing-semantics", "typography-variables"]);
      assert.strictEqual(receivedBody.dryRun, false);
    } finally {
      await new Promise(resolve => mockServer.close(resolve));
      delete process.env.FIGLETS_RECEIVER_URL;
    }

    const updatedSnapshot = Object.assign({}, afterFoundationSnapshot, {
      variables: [
        variable("space-radius-md", "space/radius/md"),
        variable("space-radius-lg", "space/radius/lg"),
        variable("space-border-default", "space/border/default"),
        variable("space-component-md", "space/component/md"),
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
    });
    writeSnapshot(figmaDataPath, updatedSnapshot);

    const reinspected = handleInspectDsTokenGaps({
      config_path: configPath,
      figmaDataPath,
      categories: ["radius", "border-width", "spacing-semantics", "typography", "elevation"],
    });
    assert.ok(!reinspected.error, reinspected.error);
    assert.ok(!reinspected.tokenGaps.some(gap => gap.category === "radius"));
    assert.ok(!reinspected.tokenGaps.some(gap => gap.category === "border-width"));
    assert.ok(
      !reinspected.tokenGaps.some(gap => gap.category === "spacing-semantics"),
      "approved semantic spacing should be resolved after narrow apply"
    );
    assert.ok(
      reinspected.tokenGaps.some(gap => gap.category === "typography" && gap.gapType === "missing-style"),
      "text styles should remain visible after typography variable apply"
    );
    assert.ok(
      !reinspected.tokenGaps.some(gap => gap.category === "elevation" && gap.gapType === "missing-variable"),
      "approved elevation variables should be resolved after narrow apply"
    );
    assert.ok(
      reinspected.tokenGaps.some(gap => gap.category === "elevation" && gap.gapType === "missing-style"),
      "effect styles should remain visible after elevation variable apply"
    );
    assert.deepStrictEqual(
      reinspected.repairPlan.applyInput.categories,
      ["elevation-styles", "typography-styles"],
      "once prerequisite variables exist, planner should offer the narrow style apply slices"
    );

    const styleDryRun = handleUpdateDsTokens({
      config_path: configPath,
      figmaDataPath,
      categories: ["elevation-styles", "typography-styles"],
      create_missing: true,
      dry_run: true,
    });
    assert.ok(!styleDryRun.error, styleDryRun.error);
    assert.strictEqual(styleDryRun.report["elevation-styles"].wouldCreateStyles.length, 6);
    assert.strictEqual(styleDryRun.report["typography-styles"].wouldCreateStyles.length, 1);

    let receivedStyleBody = null;
    const mockStyleServer = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/request-update-tokens") {
        res.writeHead(404);
        res.end();
        return;
      }

      let body = "";
      req.on("data", chunk => { body += chunk.toString(); });
      req.on("end", () => {
        receivedStyleBody = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          result: {
            dryRun: false,
            categories: receivedStyleBody.categories,
            unknownCategories: [],
            report: {
              "elevation-styles": {
                entries: 6,
                wouldCreateVariables: [],
                createdVariables: [],
                wouldUpdateVariables: [],
                updatedVariables: [],
                wouldCreateStyles: [],
                createdStyles: [
                  { name: "elevation/0" },
                  { name: "elevation/1" },
                  { name: "elevation/2" },
                  { name: "elevation/3" },
                  { name: "elevation/4" },
                  { name: "elevation/5" },
                ],
                wouldRefreshStyles: [],
                refreshedStyles: [],
                unmatched: [],
                typeMismatch: [],
                fontLoadFailures: [],
                bindingWarnings: [],
              },
              "typography-styles": {
                entries: 1,
                wouldCreateVariables: [],
                createdVariables: [],
                wouldUpdateVariables: [],
                updatedVariables: [],
                wouldCreateStyles: [],
                createdStyles: [
                  { name: "type/body/md", id: "text-style-1", boundVariables: ["fontSize", "lineHeight", "letterSpacing", "fontFamily", "fontWeight"] },
                ],
                wouldRefreshStyles: [],
                refreshedStyles: [],
                unmatched: [],
                typeMismatch: [],
                fontLoadFailures: [],
                bindingWarnings: [],
              },
            },
            message: "elevation-styles: 6 changed; typography-styles: 1 changed",
          },
        }));
      });
    });

    await new Promise(resolve => mockStyleServer.listen(0, "127.0.0.1", resolve));
    const stylePort = mockStyleServer.address().port;
    process.env.FIGLETS_RECEIVER_URL = `http://localhost:${stylePort}`;

    try {
      const appliedStyles = await handleUpdateDsTokens(reinspected.repairPlan.applyInput);
      assert.ok(!appliedStyles.error, appliedStyles.error);
      assert.strictEqual(appliedStyles.dryRun, false);
      assert.deepStrictEqual(receivedStyleBody.categories, ["elevation-styles", "typography-styles"]);
    } finally {
      await new Promise(resolve => mockStyleServer.close(resolve));
      delete process.env.FIGLETS_RECEIVER_URL;
    }

    const finalSnapshot = Object.assign({}, updatedSnapshot, {
      effectStyles: [
        { name: "elevation/0" },
        { name: "elevation/1" },
        { name: "elevation/2" },
        { name: "elevation/3" },
        { name: "elevation/4" },
        { name: "elevation/5" },
      ],
      textStyles: [{ name: "type/body/md" }],
    });
    writeSnapshot(figmaDataPath, finalSnapshot);

    const finalInspect = handleInspectDsTokenGaps({
      config_path: configPath,
      figmaDataPath,
      categories: ["radius", "border-width", "spacing-semantics", "typography", "elevation"],
    });
    assert.ok(!finalInspect.error, finalInspect.error);
    assert.ok(
      !finalInspect.tokenGaps.some(gap => gap.category === "elevation"),
      "elevation variables and effect styles should be resolved after both narrow applies"
    );
    assert.ok(
      !finalInspect.tokenGaps.some(gap => gap.category === "typography"),
      "typography variables and text styles should be resolved after both narrow typography applies"
    );
  } finally {
    try { fs.unlinkSync(configPath); } catch (err) {}
    try { fs.unlinkSync(figmaDataPath); } catch (err) {}
    try { fs.rmdirSync(tmp); } catch (err) {}
  }
})();

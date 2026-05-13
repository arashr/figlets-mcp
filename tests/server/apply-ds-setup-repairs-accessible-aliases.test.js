const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const {
  handleApplyDsSetupRepairs,
} = require("../../packages/figlets-mcp-server/src/tools/apply-ds-setup-repairs.js");

// Build a synthetic figma-data.json snapshot covering a green primitive ramp
// plus surface/success-variant (BG) and on-surface/success (source FG).
// Light-mode contrast for source FG (green/300) against the BG (green/50)
// fails WCAG 4.5, so the picker must walk the ramp to a darker step.
function makeSnapshot() {
  function prim(id, name, r, g, b) {
    return {
      id, name,
      resolvedType: "COLOR",
      variableCollectionId: "primColl",
      valuesByMode: { primMode: { r, g, b } },
    };
  }
  function sem(id, name, lightAliasId, darkAliasId) {
    return {
      id, name,
      resolvedType: "COLOR",
      variableCollectionId: "semColl",
      valuesByMode: {
        lightId: { type: "VARIABLE_ALIAS", id: lightAliasId },
        darkId: { type: "VARIABLE_ALIAS", id: darkAliasId },
      },
    };
  }

  // OKish approximate sRGB green ramp (light → dark).
  const primitives = [
    prim("g50",  "color/green/50",  0.94, 0.99, 0.95),
    prim("g100", "color/green/100", 0.86, 0.97, 0.89),
    prim("g200", "color/green/200", 0.73, 0.93, 0.79),
    prim("g300", "color/green/300", 0.55, 0.87, 0.65),
    prim("g500", "color/green/500", 0.13, 0.67, 0.33),
    prim("g700", "color/green/700", 0.06, 0.40, 0.20),
    prim("g800", "color/green/800", 0.04, 0.30, 0.15),
    prim("g900", "color/green/900", 0.02, 0.22, 0.10),
    prim("g950", "color/green/950", 0.01, 0.13, 0.06),
    // Add a neutral ramp so brand detection has something neutral too.
    prim("n50",  "color/neutral/50",  0.98, 0.98, 0.98),
    prim("n950", "color/neutral/950", 0.05, 0.05, 0.05),
  ];

  const semantics = [
    // BG variant: light = green/50, dark = green/950.
    sem("sSurfSV", "color/surface/success-variant", "g50", "g950"),
    // Source FG: light = green/300 (FAILS contrast vs green/50),
    //            dark  = green/200 (passes vs green/950, ~ample contrast).
    sem("sOnSucc", "color/on-surface/success", "g300", "g200"),
  ];

  return {
    variables: primitives.concat(semantics),
    collections: [
      {
        id: "primColl",
        name: "Primitives",
        modes: [{ modeId: "primMode", name: "Value" }],
        variableIds: primitives.map(v => v.id),
      },
      {
        id: "semColl",
        name: "Color",
        modes: [{ modeId: "lightId", name: "Light" }, { modeId: "darkId", name: "Dark" }],
        variableIds: semantics.map(v => v.id),
      },
    ],
  };
}

module.exports = (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-repair-aliases-"));
  const snapshotPath = path.join(tmp, "figma-data.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(makeSnapshot()), "utf8");

  let receivedBody = null;
  const mockServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/request-setup-repairs") {
      let body = "";
      req.on("data", chunk => { body += chunk.toString(); });
      req.on("end", () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          result: {
            created: [{
              name: "color/on-surface/success-variant",
              source: "color/on-surface/success",
              collection: "Color",
              aliases: receivedBody.repairs[0].aliases || null,
            }],
            skipped: [],
            unresolved: [],
            message: "1 created, 0 skipped, 0 unresolved.",
          }
        }));
      });
    } else { res.writeHead(404); res.end(); }
  });

  await new Promise(r => mockServer.listen(0, r));
  const { port } = mockServer.address();

  const prevReceiver = process.env.FIGLETS_RECEIVER_URL;
  const prevLocal = process.env.FIGLETS_LOCAL_DIR;
  const prevFigPath = process.env.FIGLETS_FIGMA_DATA_PATH;
  process.env.FIGLETS_RECEIVER_URL = `http://127.0.0.1:${port}`;
  process.env.FIGLETS_LOCAL_DIR = tmp;          // no active-file.json → no scoped snapshot
  process.env.FIGLETS_FIGMA_DATA_PATH = snapshotPath;

  try {
    const result = await handleApplyDsSetupRepairs({
      // No config_path — no DS config exists. Bootstrap path must kick in.
      update_config: false,
      repairs: [{
        bg: "color/surface/success-variant",
        recommended: "color/on-surface/success-variant",
        source: "color/on-surface/success",
      }],
    });

    assert.ok(!result.error, "handler reported error: " + result.error);
    assert.strictEqual(result.created.length, 1);

    assert.ok(receivedBody, "bridge did not receive a request");
    const wire = receivedBody.repairs[0];
    assert.strictEqual(wire.bg, "color/surface/success-variant");
    assert.strictEqual(wire.name, "color/on-surface/success-variant");
    assert.strictEqual(wire.source, "color/on-surface/success");

    // The picker must produce aliases for both modes.
    assert.ok(wire.aliases, "expected aliases to be set on bridge payload");
    assert.ok(typeof wire.aliases.Light === "string", "Light alias missing");
    assert.ok(typeof wire.aliases.Dark === "string", "Dark alias missing");

    // Light must be upgraded off green/300 to a darker step that passes WCAG 4.5.
    // green/300 against green/50 is well under 4.5:1 — the walker should land
    // on green/700 or darker.
    assert.notStrictEqual(wire.aliases.Light, "color/green/300",
      "Light alias should not be the failing source step");
    assert.ok(/^color\/green\/(700|800|900|950)$/.test(wire.aliases.Light),
      "expected Light to be a dark green step, got " + wire.aliases.Light);

    // Dark (green/200 on green/950) already passes — picker should keep it.
    assert.strictEqual(wire.aliases.Dark, "color/green/200",
      "Dark alias should retain the passing source step, got " + wire.aliases.Dark);
  } finally {
    if (prevReceiver !== undefined) process.env.FIGLETS_RECEIVER_URL = prevReceiver;
    else delete process.env.FIGLETS_RECEIVER_URL;
    if (prevLocal !== undefined) process.env.FIGLETS_LOCAL_DIR = prevLocal;
    else delete process.env.FIGLETS_LOCAL_DIR;
    if (prevFigPath !== undefined) process.env.FIGLETS_FIGMA_DATA_PATH = prevFigPath;
    else delete process.env.FIGLETS_FIGMA_DATA_PATH;
    await new Promise(r => mockServer.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

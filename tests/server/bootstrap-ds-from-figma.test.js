const assert = require("assert");
const {
  bootstrapDsFromSnapshot,
  buildRampsFromSnapshot,
  detectBrand,
} = require("../../packages/figlets-mcp-server/src/utils/bootstrap-ds-from-figma.js");

function makePrim(id, name, r, g, b) {
  return { id, name, resolvedType: "COLOR", valuesByMode: { primMode: { r, g, b } } };
}

module.exports = (async () => {
  // ── buildRampsFromSnapshot ──────────────────────────────────────────────
  {
    const snapshot = {
      variables: [
        makePrim("g50", "color/green/50", 0.95, 0.99, 0.95),
        makePrim("g500", "color/green/500", 0.13, 0.55, 0.27),
        makePrim("g900", "color/green/900", 0.05, 0.20, 0.10),
        makePrim("n50", "color/neutral/50", 0.98, 0.98, 0.98),
        makePrim("n900", "color/neutral/900", 0.10, 0.10, 0.10),
        // Non-primitive (3 parts but non-numeric leaf) — should be excluded.
        { id: "sX", name: "color/surface/default", resolvedType: "COLOR", valuesByMode: { m: { r: 1, g: 1, b: 1 } } },
        // Non-COLOR — excluded.
        { id: "sp", name: "spacing/sm", resolvedType: "FLOAT", valuesByMode: { m: 8 } },
      ],
    };
    const ramps = buildRampsFromSnapshot(snapshot);
    assert.strictEqual(ramps.length, 2);
    const green = ramps.find(r => r.folder === "color/green");
    assert.ok(green);
    assert.deepStrictEqual(green.steps.map(s => s[0]), [50, 500, 900]);
    assert.deepStrictEqual(green.steps[1], [500, 0.13, 0.55, 0.27]);
    assert.ok(ramps.find(r => r.folder === "color/neutral"));
  }

  // Alias chain: primitive aliases to another primitive — must still resolve RGB.
  {
    const snapshot = {
      variables: [
        makePrim("real", "color/blue/500", 0.2, 0.4, 0.9),
        { id: "alias", name: "color/blue/600", resolvedType: "COLOR",
          valuesByMode: { m: { type: "VARIABLE_ALIAS", id: "real" } } },
      ],
    };
    const ramps = buildRampsFromSnapshot(snapshot);
    const blue = ramps.find(r => r.folder === "color/blue");
    assert.ok(blue);
    const six = blue.steps.find(s => s[0] === 600);
    assert.deepStrictEqual(six, [600, 0.2, 0.4, 0.9]);
  }

  // ── detectBrand ─────────────────────────────────────────────────────────
  {
    const ramps = [
      { folder: "color/neutral", steps: [[100, 1, 1, 1], [500, 0.5, 0.5, 0.5]] },
      { folder: "color/primary", steps: [[400, 0.3, 0.5, 0.9], [600, 0.1, 0.2, 0.6]] },
      { folder: "color/brand",   steps: [[500, 0.9, 0.1, 0.1]] },
    ];
    // primary > brand > first
    const brand = detectBrand(ramps);
    assert.deepStrictEqual(brand, [{ name: "primary", role: "primary", step: 400 }]);
  }
  {
    const ramps = [
      { folder: "color/neutral", steps: [[100, 1, 1, 1]] },
      { folder: "color/brand",   steps: [[700, 0.9, 0.1, 0.1]] },
    ];
    assert.deepStrictEqual(detectBrand(ramps), [{ name: "brand", role: "primary", step: 700 }]);
  }
  {
    const ramps = [{ folder: "color/teal", steps: [[300, 0.1, 0.5, 0.5]] }];
    assert.deepStrictEqual(detectBrand(ramps), [{ name: "teal", role: "primary", step: 300 }]);
  }
  assert.deepStrictEqual(detectBrand([]), []);

  // ── bootstrapDsFromSnapshot ─────────────────────────────────────────────
  {
    const snapshot = {
      variables: [
        makePrim("p500", "color/primary/500", 0.2, 0.4, 0.9),
        makePrim("n100", "color/neutral/100", 0.95, 0.95, 0.95),
      ],
    };
    const ds = bootstrapDsFromSnapshot(snapshot);
    assert.strictEqual(ds.color.contrastAlgorithm, "wcag");
    assert.strictEqual(ds.color.brand[0].name, "primary");
    assert.strictEqual(ds.color.ramps.length, 2);
    assert.deepStrictEqual(ds.color.semantics, { pairs: [] });

    const dsApca = bootstrapDsFromSnapshot(snapshot, { algorithm: "apca" });
    assert.strictEqual(dsApca.color.contrastAlgorithm, "apca");
  }
})();

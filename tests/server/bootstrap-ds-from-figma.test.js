const assert = require("assert");
const {
  bootstrapDsFromSnapshot,
  buildRampsFromSnapshot,
  detectBrand,
  inferCollectionsFromSnapshot,
  inferSemanticsFromSnapshot,
} = require("../../packages/figlets-mcp-server/src/utils/bootstrap-ds-from-figma.js");
const {
  inspectDsSetupGapsFromFigmaData,
} = require("../../packages/figlets-mcp-server/src/tools/inspect-ds-setup-gaps.js");

function makePrim(id, name, r, g, b) {
  return { id, name, resolvedType: "COLOR", valuesByMode: { primMode: { r, g, b } } };
}

function semanticColor(id, name, lightId, darkId) {
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: "color",
    valuesByMode: {
      light: { type: "VARIABLE_ALIAS", id: lightId },
      dark: { type: "VARIABLE_ALIAS", id: darkId },
    },
  };
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
    assert.deepStrictEqual(ds.color.semantics, { pairs: [], icons: [], unpaired: [] });

    const dsApca = bootstrapDsFromSnapshot(snapshot, { algorithm: "apca" });
    assert.strictEqual(dsApca.color.contrastAlgorithm, "apca");
  }

  // Imported design systems should get useful semantic config, not an empty shell.
  {
    const snapshot = {
      fileKey: "file_imported",
      fileName: "Imported DS",
      collections: [
        { id: "prim", name: "Primitives", modes: [{ modeId: "m", name: "Default" }], variableIds: ["n100", "n900"] },
        { id: "color", name: "Color", modes: [{ modeId: "l", name: "Light" }, { modeId: "d", name: "Dark" }], variableIds: ["bg", "fg", "outline", "icon", "focus"] },
      ],
      variables: [
        makePrim("n100", "color/neutral/100", 0.95, 0.95, 0.95),
        makePrim("n900", "color/neutral/900", 0.05, 0.05, 0.05),
        { id: "bg", name: "color/surface/brand", resolvedType: "COLOR", variableCollectionId: "color", valuesByMode: { l: { type: "VARIABLE_ALIAS", id: "n100" }, d: { type: "VARIABLE_ALIAS", id: "n900" } } },
        { id: "fg", name: "color/on-surface/brand", resolvedType: "COLOR", variableCollectionId: "color", valuesByMode: { l: { type: "VARIABLE_ALIAS", id: "n900" }, d: { type: "VARIABLE_ALIAS", id: "n100" } } },
        { id: "outline", name: "color/outline/brand", resolvedType: "COLOR", variableCollectionId: "color", valuesByMode: { l: { type: "VARIABLE_ALIAS", id: "n900" }, d: { type: "VARIABLE_ALIAS", id: "n100" } } },
        { id: "icon", name: "color/icon/brand", resolvedType: "COLOR", variableCollectionId: "color", valuesByMode: { l: { type: "VARIABLE_ALIAS", id: "n900" }, d: { type: "VARIABLE_ALIAS", id: "n100" } } },
        { id: "focus", name: "color/outline/focus", resolvedType: "COLOR", variableCollectionId: "color", valuesByMode: { l: { type: "VARIABLE_ALIAS", id: "n900" }, d: { type: "VARIABLE_ALIAS", id: "n100" } } },
      ],
    };
    const collections = inferCollectionsFromSnapshot(snapshot);
    assert.strictEqual(collections.primitives, "Primitives");
    assert.strictEqual(collections.color, "Color");
    const semantics = inferSemanticsFromSnapshot(snapshot);
    assert.deepStrictEqual(semantics.pairs, [{
      bg: "color/surface/brand",
      text: "color/on-surface/brand",
      border: "color/outline/brand",
      icon: "color/icon/brand",
    }]);
    assert.deepStrictEqual(semantics.unpaired, [{ token: "color/outline/focus" }]);
    const ds = bootstrapDsFromSnapshot(snapshot, { createdAt: "2026-05-16T00:00:00.000Z" });
    assert.strictEqual(ds.figlets.source, "figma-snapshot-bootstrap");
    assert.strictEqual(ds.color.semantics.pairs[0].icon, "color/icon/brand");
  }

  // A Figlets-generated role-style system may be reopened without the original
  // intake config. Snapshot bootstrap must not downgrade its rich semantic map
  // into loose bg→same-leaf text pairings such as bg/brand → text/brand.
  {
    const primitives = [
      makePrim("p50", "color/pink/50", 1, 0.9, 0.96),
      makePrim("p100", "color/pink/100", 0.98, 0.8, 0.9),
      makePrim("p300", "color/pink/300", 0.9, 0.45, 0.7),
      makePrim("p500", "color/pink/500", 0.8, 0.05, 0.45),
      makePrim("p600", "color/pink/600", 0.65, 0.03, 0.35),
      makePrim("p700", "color/pink/700", 0.5, 0.02, 0.25),
      makePrim("p950", "color/pink/950", 0.12, 0, 0.08),
      makePrim("n50", "color/neutral/50", 0.98, 0.98, 0.98),
      makePrim("n200", "color/neutral/200", 0.9, 0.9, 0.9),
      makePrim("n500", "color/neutral/500", 0.5, 0.5, 0.5),
      makePrim("n800", "color/neutral/800", 0.15, 0.15, 0.15),
      makePrim("n950", "color/neutral/950", 0.02, 0.02, 0.02),
    ];
    const semantics = [
      semanticColor("bg-default", "color/bg/default", "n50", "n950"),
      semanticColor("bg-muted", "color/bg/muted", "n200", "n800"),
      semanticColor("text-default", "color/text/default", "n950", "n50"),
      semanticColor("text-muted", "color/text/muted", "n500", "n500"),
      semanticColor("bg-brand", "color/bg/brand", "p600", "p500"),
      semanticColor("text-on-brand", "color/text/on-brand", "n50", "n50"),
      semanticColor("icon-on-brand", "color/icon/on-brand", "n50", "n50"),
      semanticColor("bg-brand-subtle", "color/bg/brand-subtle", "p50", "p950"),
      semanticColor("text-brand", "color/text/brand", "p700", "p100"),
      semanticColor("icon-brand", "color/icon/brand", "p600", "p300"),
    ];
    const snapshot = {
      collections: [
        { id: "prim", name: "1. Primitives", modes: [{ modeId: "primMode", name: "Value" }], variableIds: primitives.map(v => v.id) },
        { id: "color", name: "2. Color", modes: [{ modeId: "light", name: "Light" }, { modeId: "dark", name: "Dark" }], variableIds: semantics.map(v => v.id) },
      ],
      variables: primitives.concat(semantics),
    };

    const ds = bootstrapDsFromSnapshot(snapshot, { algorithm: "wcag" });
    const pairs = ds.color.semantics.pairs;
    assert.ok(
      pairs.some(pair => pair.bg === "color/bg/brand" && pair.text === "color/text/on-brand" && pair.icon === "color/icon/on-brand"),
      "bootstrap should keep the generated on-brand foreground/icon context for brand fills"
    );
    assert.ok(
      !pairs.some(pair => pair.bg === "color/bg/brand" && pair.text === "color/text/brand"),
      "bootstrap should not pair strong brand backgrounds with normal brand text"
    );
    assert.ok(
      pairs.some(pair => pair.bg === "color/bg/default" && pair.text === "color/text/muted" && pair.min === null),
      "bootstrap should preserve generated muted-text contrast exemption metadata"
    );
    assert.deepStrictEqual(
      ds.spacing.responsiveModeValidation.allowSameValueModes.categories,
      ["component", "stack", "touch"],
      "bootstrap should carry generated spacing same-value allowances for stable categories"
    );

    const health = inspectDsSetupGapsFromFigmaData(snapshot, { existingDs: ds, algorithm: "wcag" });
    assert.deepStrictEqual(health.contrastFailures, [], "bootstrapped generated semantics should not create text contrast failures");
    assert.deepStrictEqual(health.iconContrastFailures, [], "bootstrapped generated semantics should not create icon contrast failures");
  }
})();

const assert = require("assert");
const {
  collectStyles,
  normalizeVariablesResponse,
  parseFigmaFileKey
} = require("../../packages/figlets-mcp-server/src/exporters/figma-rest-export.js");

{
  assert.strictEqual(parseFigmaFileKey("AbCd1234XYZ"), "AbCd1234XYZ");
  assert.strictEqual(
    parseFigmaFileKey("https://www.figma.com/design/AbCd1234XYZ/My-File"),
    "AbCd1234XYZ"
  );
  assert.strictEqual(
    parseFigmaFileKey("https://www.figma.com/design/AbCd1234XYZ/branch/BrNcH5678/My-File"),
    "BrNcH5678"
  );
}

{
  const styles = collectStyles({
    styles: {
      a: { key: "k1", name: "body/md", style_type: "TEXT" },
      b: { key: "k2", name: "elevation/100", style_type: "EFFECT" },
      c: { key: "k3", name: "fill/brand", style_type: "FILL" }
    }
  });

  assert.strictEqual(styles.textStyles.length, 1);
  assert.strictEqual(styles.textStyles[0].name, "body/md");
  assert.strictEqual(styles.effectStyles.length, 1);
  assert.strictEqual(styles.effectStyles[0].name, "elevation/100");
}

{
  const normalized = normalizeVariablesResponse({
    meta: {
      variables: {
        v1: {
          id: "v1",
          name: "color/brand/500",
          key: "key-1",
          variableCollectionId: "c1",
          resolvedType: "COLOR",
          valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 } },
          remote: false,
          description: "",
          hiddenFromPublishing: false,
          scopes: ["ALL_SCOPES"],
          codeSyntax: {}
        }
      },
      variableCollections: {
        c1: {
          id: "c1",
          name: "Primitives",
          key: "key-c1",
          modes: [{ modeId: "m1", name: "Value" }],
          defaultModeId: "m1",
          remote: false,
          hiddenFromPublishing: true,
          variableIds: ["v1"],
          isExtension: false,
          deletedButReferenced: false
        }
      }
    }
  });

  assert.strictEqual(normalized.variables.length, 1);
  assert.strictEqual(normalized.variables[0].name, "color/brand/500");
  assert.strictEqual(normalized.collections.length, 1);
  assert.strictEqual(normalized.collections[0].name, "Primitives");
}

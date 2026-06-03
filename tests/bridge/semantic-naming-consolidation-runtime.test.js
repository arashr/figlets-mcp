const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function makeVariable(id, name, valuesByMode) {
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: "color",
    valuesByMode: Object.assign({}, valuesByMode || {}),
  };
}

function makeContext(variables) {
  const context = {
    figma: {
      variables: {
        async getLocalVariablesAsync() {
          return variables;
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(code, "_applySemanticNamingConsolidation"), context, { filename: "semantic-naming-runtime.js" });
  return context;
}

module.exports = (async () => {
  {
    const variables = [
      makeVariable("canonical", "color/text/danger", {
        light: { type: "VARIABLE_ALIAS", id: "n950" },
        dark: { type: "VARIABLE_ALIAS", id: "n50" },
      }),
      makeVariable("duplicate", "color/text/on-danger", {
        light: { type: "VARIABLE_ALIAS", id: "n950" },
        dark: { type: "VARIABLE_ALIAS", id: "n50" },
      }),
    ];
    const context = makeContext(variables);
    const result = await context._applySemanticNamingConsolidation({
      renameVariables: [{
        id: "duplicate",
        expectedCurrentName: "color/text/on-danger",
        newName: "_deprecated/color/text/on-danger",
        canonicalName: "color/text/danger",
        canonicalId: "canonical",
        expectedEquivalence: {
          status: "equivalent",
          modes: [
            { modeId: "light", canonicalSignature: "alias:n950", duplicateSignature: "alias:n950" },
            { modeId: "dark", canonicalSignature: "alias:n50", duplicateSignature: "alias:n50" },
          ],
        },
      }],
    });
    assert.strictEqual(result.renamed.length, 1);
    assert.strictEqual(variables[1].name, "_deprecated/color/text/on-danger");
  }

  {
    const variables = [
      makeVariable("canonical", "color/icon/danger", {
        light: { type: "VARIABLE_ALIAS", id: "n950" },
        dark: { type: "VARIABLE_ALIAS", id: "n50" },
      }),
      makeVariable("duplicate", "color/icon/on-danger", {
        light: { type: "VARIABLE_ALIAS", id: "r700" },
        dark: { type: "VARIABLE_ALIAS", id: "r200" },
      }),
    ];
    const context = makeContext(variables);
    const result = await context._applySemanticNamingConsolidation({
      renameVariables: [{
        id: "duplicate",
        expectedCurrentName: "color/icon/on-danger",
        newName: "_deprecated/color/icon/on-danger",
        canonicalName: "color/icon/danger",
        canonicalId: "canonical",
        expectedEquivalence: {
          status: "different",
          modes: [
            { modeId: "light", canonicalSignature: "alias:n950", duplicateSignature: "alias:r700" },
            { modeId: "dark", canonicalSignature: "alias:n50", duplicateSignature: "alias:r200" },
          ],
        },
      }],
    });
    assert.strictEqual(result.renamed.length, 1);
    assert.strictEqual(variables[1].name, "_deprecated/color/icon/on-danger");
    assert.deepStrictEqual(variables[1].valuesByMode, {
      light: { type: "VARIABLE_ALIAS", id: "r700" },
      dark: { type: "VARIABLE_ALIAS", id: "r200" },
    });
  }

  {
    const variables = [
      makeVariable("canonical", "color/text/danger", {
        light: { type: "VARIABLE_ALIAS", id: "n950" },
        dark: { type: "VARIABLE_ALIAS", id: "n50" },
      }),
      makeVariable("duplicate", "color/text/on-danger", {
        light: { type: "VARIABLE_ALIAS", id: "n950" },
        dark: { type: "VARIABLE_ALIAS", id: "changed-after-approval" },
      }),
    ];
    const context = makeContext(variables);
    const result = await context._applySemanticNamingConsolidation({
      renameVariables: [{
        id: "duplicate",
        expectedCurrentName: "color/text/on-danger",
        newName: "_deprecated/color/text/on-danger",
        canonicalName: "color/text/danger",
        canonicalId: "canonical",
        expectedEquivalence: {
          status: "equivalent",
          modes: [
            { modeId: "light", canonicalSignature: "alias:n950", duplicateSignature: "alias:n950" },
            { modeId: "dark", canonicalSignature: "alias:n50", duplicateSignature: "alias:n50" },
          ],
        },
      }],
    });
    assert.strictEqual(result.renamed.length, 0);
    assert.strictEqual(result.unresolved[0].reason, "Current values changed since approval.");
    assert.strictEqual(variables[1].name, "color/text/on-danger");
  }

  {
    const variables = [
      makeVariable("primitive", "color/red/700", {
        value: { r: 0.5, g: 0, b: 0 },
      }),
      makeVariable("canonical", "color/text/danger", {
        value: { r: 0, g: 0, b: 0 },
      }),
    ];
    const context = makeContext(variables);
    const result = await context._applySemanticNamingConsolidation({
      renameVariables: [{
        id: "primitive",
        expectedCurrentName: "color/red/700",
        newName: "_deprecated/color/red/700",
        canonicalName: "color/text/danger",
        canonicalId: "canonical",
        expectedEquivalence: {
          status: "equivalent",
          modes: [{ modeId: "value", canonicalSignature: "{\"b\":0,\"g\":0,\"r\":0}", duplicateSignature: "{\"b\":0,\"g\":0,\"r\":0}" }],
        },
      }],
    });
    assert.strictEqual(result.renamed.length, 0);
    assert.ok(result.unresolved[0].reason.includes("semantic color"));
    assert.strictEqual(variables[0].name, "color/red/700");
  }
})();

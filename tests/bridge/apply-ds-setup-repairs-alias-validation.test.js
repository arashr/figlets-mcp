const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// BNN-34 re-review regression: test that the bridge validates ALL aliases
// upfront before creating variables, preventing partial/empty variable creation
// for non-variable sources (background-ramp, derived).

const code = fs.readFileSync(
  path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"),
  "utf8"
);

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

function makeVariable(id, name, collectionId, type, valuesByMode) {
  return {
    id,
    name,
    variableCollectionId: collectionId,
    resolvedType: type,
    valuesByMode: Object.assign({}, valuesByMode || {}),
    scopes: [],
    setValueForMode(modeId, value) {
      this.valuesByMode[modeId] = value;
    },
    remove() {
      // Mock removal
    },
  };
}

module.exports = (async () => {
  const collections = [
    {
      id: "color-semantic",
      name: "Color / Semantics",
      modes: [
        { modeId: "light", name: "Light" },
        { modeId: "dark", name: "Dark" },
      ],
      variableIds: [],
    },
  ];

  const variables = [
    makeVariable("p-neutral-50", "color/neutral/50", "primitives", "COLOR", {
      light: { r: 0.98, g: 0.98, b: 0.98, a: 1 },
    }),
    makeVariable("p-neutral-900", "color/neutral/900", "primitives", "COLOR", {
      dark: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
    }),
    makeVariable("bg-default", "color/surface/default", "color-semantic", "COLOR", {
      light: { type: "VARIABLE_ALIAS", id: "p-neutral-50" },
      dark: { type: "VARIABLE_ALIAS", id: "p-neutral-900" },
    }),
    makeVariable("bg-overlay", "color/surface/overlay", "color-semantic", "COLOR", {
      light: { type: "VARIABLE_ALIAS", id: "p-neutral-50" },
      dark: { type: "VARIABLE_ALIAS", id: "p-neutral-900" },
    }),
    makeVariable("bg-raised", "color/surface/raised", "color-semantic", "COLOR", {
      light: { type: "VARIABLE_ALIAS", id: "p-neutral-50" },
      dark: { type: "VARIABLE_ALIAS", id: "p-neutral-900" },
    }),
  ];

  // Register BG variables in collection
  collections[0].variableIds = variables
    .filter((v) => v.variableCollectionId === "color-semantic")
    .map((v) => v.id);

  let createdVariables = [];
  const figma = {
    variables: {
      async getLocalVariableCollectionsAsync() {
        return collections;
      },
      async getLocalVariablesAsync() {
        return variables;
      },
      createVariable(name, collection, type) {
        const variable = makeVariable(
          `created-${createdVariables.length}`,
          name,
          collection.id,
          type,
          {}
        );
        variables.push(variable);
        collection.variableIds.push(variable.id);
        createdVariables.push(variable);
        return variable;
      },
    },
  };

  function _setVariableScopesForName(variable, name, type) {
    // Mock scope setter
  }

  const fnBody = extractFunction(code, "_applyDsSetupRepairs");
  const fn = vm.runInNewContext(
    `(async function() { ${fnBody}; return _applyDsSetupRepairs; })()`,
    { figma, _setVariableScopesForName }
  );
  const _applyDsSetupRepairs = await fn;

  // ── Test 1: All valid aliases → should create variable ────────────────────
  createdVariables = [];
  const result1 = await _applyDsSetupRepairs({
    repairs: [
      {
        bg: "color/surface/default",
        name: "color/on-surface/default",
        source: "background-ramp",
        aliases: {
          Light: "color/neutral/900",
          Dark: "color/neutral/50",
        },
      },
    ],
  });

  assert.strictEqual(
    result1.created.length,
    1,
    "All valid aliases should create variable"
  );
  assert.strictEqual(result1.unresolved.length, 0, "Should have no failures");
  assert.strictEqual(
    createdVariables.length,
    1,
    "Should have created 1 variable"
  );
  assert.strictEqual(
    createdVariables[0].name,
    "color/on-surface/default",
    "Created variable name should match"
  );
  assert.ok(
    createdVariables[0].valuesByMode.light,
    "Light mode should be set"
  );
  assert.ok(createdVariables[0].valuesByMode.dark, "Dark mode should be set");

  // ── Test 2: One valid + one missing alias target → should fail upfront ────
  createdVariables = [];
  const result2 = await _applyDsSetupRepairs({
    repairs: [
      {
        bg: "color/surface/overlay",
        name: "color/on-surface/overlay",
        source: "background-ramp",
        aliases: {
          Light: "color/neutral/900",
          Dark: "color/neutral/MISSING", // Missing alias target
        },
      },
    ],
  });

  assert.strictEqual(
    result2.created.length,
    0,
    "Partial aliases should not create variable"
  );
  assert.strictEqual(
    result2.unresolved.length,
    1,
    "Should have 1 unresolved"
  );
  assert.ok(
    result2.unresolved[0].reason.includes("not found"),
    "Failure reason should mention missing target"
  );
  assert.strictEqual(
    createdVariables.length,
    0,
    "Should not have created any variable"
  );

  // ── Test 3: Alias mode name that does not exist → should fail upfront ─────
  createdVariables = [];
  const result3 = await _applyDsSetupRepairs({
    repairs: [
      {
        bg: "color/surface/raised",
        name: "color/on-surface/raised",
        source: "derived",
        aliases: {
          Light: "color/neutral/900",
          InvalidMode: "color/neutral/50", // Mode doesn't exist
        },
      },
    ],
  });

  assert.strictEqual(
    result3.created.length,
    0,
    "Invalid mode name should not create variable"
  );
  assert.strictEqual(
    result3.unresolved.length,
    1,
    "Should have 1 unresolved"
  );
  assert.ok(
    result3.unresolved[0].reason.includes("not found in collection"),
    "Failure reason should mention missing mode"
  );
  assert.strictEqual(
    createdVariables.length,
    0,
    "Should not have created any variable"
  );

  // ── Test 4: Aliases present but none resolvable → should fail upfront ─────
  createdVariables = [];
  const result4 = await _applyDsSetupRepairs({
    repairs: [
      {
        bg: "color/surface/default",
        name: "color/text/default",
        source: "background-ramp",
        aliases: {
          Light: "color/MISSING/900",
          Dark: "color/MISSING/50",
        },
      },
    ],
  });

  assert.strictEqual(
    result4.created.length,
    0,
    "No resolvable aliases should not create variable"
  );
  assert.strictEqual(
    result4.unresolved.length,
    1,
    "Should have 1 unresolved"
  );
  assert.ok(
    result4.unresolved[0].reason.includes("not found"),
    "Failure reason should mention missing target"
  );
  assert.strictEqual(
    createdVariables.length,
    0,
    "Should not have created any variable"
  );

  console.log(
    "BNN-34 alias validation test passed: bridge validates all aliases upfront"
  );
})();

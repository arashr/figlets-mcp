const assert = require("assert");
const fs = require("fs");
const path = require("path");

const pluginPath = path.resolve(__dirname, "../../packages/figma-bridge-plugin/code.js");
const plugin = fs.readFileSync(pluginPath, "utf8");

const expectedCommands = [
  {
    command: "build-showcase",
    doneType: "showcase-built",
    handler: "_buildShowcase",
    executeLog: "Executing build_ds_showcase.",
    completedLog: "Completed build_ds_showcase.",
    failedPrefix: "build_ds_showcase failed: ",
    notify: "Token showcase built!",
  },
  {
    command: "apply-ds-setup",
    doneType: "ds-setup-done",
    handler: "_applyDsSetup",
    executeLog: "Executing apply_ds_setup.",
    completedLog: "Completed apply_ds_setup.",
    failedPrefix: "apply_ds_setup failed: ",
    notify: "Design system collections created!",
  },
  {
    command: "apply-foundation-repairs",
    doneType: "foundation-repairs-done",
    handler: "_applyDsFoundationRepairs",
    executeLog: "Executing apply_ds_foundation_repairs.",
    completedLog: "Completed apply_ds_foundation_repairs.",
    failedPrefix: "apply_ds_foundation_repairs failed: ",
    notify: "Foundation repairs applied.",
  },
  {
    command: "reset-figlets-file",
    doneType: "figlets-reset-done",
    handler: "_resetFigletsFile",
    executeLog: "Executing reset_figlets_file.",
    completedLog: "Completed reset_figlets_file.",
    failedPrefix: "reset_figlets_file failed: ",
    notify: "Figlets file content reset.",
  },
  {
    command: "trim-collection-modes",
    doneType: "figlets-trim-collection-modes-done",
    handler: "_trimCollectionModesForDevPrep",
    executeLog: "Executing trim_collection_modes.",
    completedLog: "Completed trim_collection_modes.",
    failedPrefix: "trim_collection_modes failed: ",
  },
  {
    command: "remove-text-styles",
    doneType: "figlets-remove-text-styles-done",
    handler: "_removeLocalTextStylesByName",
    executeLog: "Executing remove_text_styles.",
    completedLog: "Completed remove_text_styles.",
    failedPrefix: "remove_text_styles failed: ",
  },
  {
    command: "prepare-broken-ds-fixture",
    doneType: "figlets-prepare-broken-ds-fixture-done",
    handler: "_prepareBrokenDsFixtureForDevPrep",
    executeLog: "Executing prepare_broken_ds_fixture.",
    completedLog: "Completed prepare_broken_ds_fixture.",
    failedPrefix: "prepare_broken_ds_fixture failed: ",
    notify: "Broken DS fixture prepared. Developer test prep only.",
  },
  {
    command: "update-primitives",
    doneType: "primitives-update-done",
    handler: "_updateDsPrimitives",
    executeLog: "Executing update_ds_primitives.",
    completedLog: "Completed update_ds_primitives.",
    failedPrefix: "update_ds_primitives failed: ",
    notify: "Primitives updated.",
  },
  {
    command: "update-tokens",
    doneType: "tokens-update-done",
    handler: "_updateDsTokens",
    executeLog: "Executing update_ds_tokens.",
    completedLog: "Completed update_ds_tokens.",
    failedPrefix: "update_ds_tokens failed: ",
    notify: "Tokens updated.",
  },
  {
    command: "apply-setup-repairs",
    doneType: "setup-repairs-done",
    handler: "_applyDsSetupRepairs",
    executeLog: "Executing apply_ds_setup_repairs.",
    completedLog: "Completed apply_ds_setup_repairs.",
    failedPrefix: "apply_ds_setup_repairs failed: ",
    notify: "Setup repairs applied.",
  },
  {
    command: "apply-semantic-naming-consolidation",
    doneType: "semantic-naming-consolidation-done",
    handler: "_applySemanticNamingConsolidation",
    executeLog: "Executing apply_ds_semantic_naming_consolidation.",
    completedLog: "Completed apply_ds_semantic_naming_consolidation.",
    failedPrefix: "apply_ds_semantic_naming_consolidation failed: ",
    notify: "Semantic naming consolidation applied.",
  },
  {
    command: "apply-figma-operations",
    doneType: "figma-operations-done",
    handler: "_applyFigmaOperations",
    executeLog: "Executing apply_ds_figma_operations.",
    completedLog: "Completed apply_ds_figma_operations.",
    failedPrefix: "apply_ds_figma_operations failed: ",
    notify: "Figma operations applied.",
  },
  {
    command: "build-doc",
    doneType: "doc-built",
    handler: "_buildComponentDoc",
    executeLog: "Executing generate_component_doc.",
    completedLog: "Completed generate_component_doc.",
    failedPrefix: "generate_component_doc failed: ",
    notify: "Component spec sheet built!",
  },
  {
    command: "qa-audit",
    doneType: "qa-audit-done",
    handler: "_runQaBindingAudit",
    executeLog: "Executing qa_binding_audit.",
    completedLog: "Completed qa_binding_audit.",
    failedPrefix: "qa_binding_audit failed: ",
    notify: "QA audit complete.",
  },
];

function extractCommandBranch(command) {
  const marker = "if (msg.type === '" + command + "')";
  const start = plugin.indexOf(marker);
  assert.notStrictEqual(start, -1, "plugin must handle command " + command);
  const open = plugin.indexOf("{", start);
  assert.notStrictEqual(open, -1, "plugin command " + command + " must have a block");
  let depth = 0;
  for (let i = open; i < plugin.length; i++) {
    if (plugin[i] === "{") depth++;
    if (plugin[i] === "}") depth--;
    if (depth === 0) return plugin.slice(start, i + 1);
  }
  throw new Error("Could not find end of command block for " + command);
}

for (const expected of expectedCommands) {
  const branch = extractCommandBranch(expected.command);
  assert.ok(branch.includes(expected.doneType), expected.command + " must post " + expected.doneType);
  assert.ok(branch.includes(expected.handler), expected.command + " must call " + expected.handler);
  assert.ok(branch.includes(expected.executeLog), expected.command + " must keep execute log text");
  assert.ok(branch.includes(expected.completedLog), expected.command + " must keep completed log text");
  assert.ok(branch.includes(expected.failedPrefix), expected.command + " must keep failure log text");
  if (expected.notify) {
    assert.ok(branch.includes(expected.notify), expected.command + " must keep notify text");
  } else {
    assert.ok(!branch.includes("notify:"), expected.command + " should not add a notify option");
    assert.ok(!branch.includes("figma.notify("), expected.command + " should not notify");
  }
}

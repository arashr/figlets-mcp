const assert = require("assert");
const fs = require("fs");
const path = require("path");

const code = fs.readFileSync(path.join(__dirname, "../../packages/figma-bridge-plugin/code.js"), "utf8");
const ui = fs.readFileSync(path.join(__dirname, "../../packages/figma-bridge-plugin/ui.html"), "utf8");
const receiver = fs.readFileSync(path.join(__dirname, "../../packages/figma-bridge-plugin/src/receiver.js"), "utf8");

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

module.exports = (() => {
  const fn = extractFunction(code, "_updateDsTokens");

  assert.ok(
    fn.includes("'radius': true") &&
      fn.includes("'border-width': true") &&
      fn.includes("'spacing-semantics': true") &&
      fn.includes("'typography-variables': true") &&
      fn.includes("'elevation-variables': true") &&
      fn.includes("'elevation-styles': true"),
    "Phase 3C/3D apply support covers radius, border-width, semantic spacing, typography variables, elevation variables, and elevation effect styles only"
  );
  assert.ok(!fn.includes("createTextStyle"), "Phase 3C token apply must not create text styles");
  assert.ok(fn.includes("figma.createEffectStyle"), "elevation-styles apply can create approved local effect styles");
  assert.ok(fn.includes("figma.getLocalEffectStylesAsync"), "elevation-styles apply should refresh existing local effect styles");
  assert.ok(fn.includes("figma.variables.setBoundVariableForEffect"), "elevation-styles apply should bind effect fields to variables where possible");
  assert.ok(fn.includes("missingElevationVariable"), "elevation-styles should report missing required elevation variables");
  assert.ok(fn.includes("missingShadowColorVariable"), "elevation-styles should report missing optional shadow color variables");
  assert.ok(fn.includes("unsupportedEffectBinding"), "elevation-styles should report binding API failures");
  assert.ok(!fn.includes("'typography': true") && !fn.includes("'elevation': true"), "broad typography/elevation must stay out of the narrow apply slice");
  assert.ok(fn.includes("typographyName") && fn.includes("Typography collection"), "typography variables should target the Typography collection");
  assert.ok(fn.includes("type/body") === false, "typography variable apply should be config-driven, not hard-coded to one role");
  assert.ok(fn.includes("VARIABLE_ALIAS"), "semantic spacing apply should alias to primitive spacing variables when available");
  assert.ok(!fn.includes("addMode("), "narrow token apply must not create new collection modes");
  assert.ok(fn.includes("figma.variables.createVariable"), "approved apply can create missing spacing variables");
  assert.ok(fn.includes("_setVariableScopesForName(existing, entry.name, entry.type)"), "existing variables should preserve IDs and refresh scopes");
  assert.ok(fn.includes("existing.setValueForMode"), "approved apply can update existing variable values");
  assert.ok(fn.includes("missing-foundation-collection"), "missing foundation should be reported as product-gap scope");
  assert.ok(!fn.includes("Run apply_ds_setup first"), "missing foundation should not hard-code a setup-first halt");

  assert.ok(ui.includes("'update-tokens'"), "UI should advertise update-tokens capability");
  assert.ok(ui.includes("data.command === 'update-tokens'"), "UI should dispatch update-tokens commands");
  assert.ok(ui.includes("sync-update-tokens"), "UI should post update token results back to receiver");

  assert.ok(receiver.includes("/request-update-tokens"), "receiver should expose request-update-tokens");
  assert.ok(receiver.includes("/sync-update-tokens"), "receiver should accept sync-update-tokens results");
  assert.ok(receiver.includes("_pluginHasCapability('update-tokens')"), "receiver should gate token updates on advertised capability");
})();

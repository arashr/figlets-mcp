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
      fn.includes("'typography-styles': true") &&
      fn.includes("'elevation-variables': true") &&
      fn.includes("'elevation-styles': true"),
    "Phase 3C/3D apply support covers radius, border-width, semantic spacing, typography variables/text styles, elevation variables, and elevation effect styles only"
  );
  assert.ok(fn.includes("figma.createTextStyle"), "typography-styles apply can create approved local text styles");
  assert.ok(fn.includes("figma.getLocalTextStylesAsync"), "typography-styles apply should refresh existing local text styles");
  assert.ok(fn.includes("figma.loadFontAsync"), "typography-styles apply must load fonts before touching text style font properties");
  assert.ok(fn.includes("missingTypographyVariable"), "typography-styles should report missing required typography variables");
  assert.ok(fn.includes("missingFontFamilyVariable"), "typography-styles should report missing optional family variable fallbacks");
  assert.ok(fn.includes("unsupportedTextStyleBinding"), "typography-styles should report binding API failures");
  assert.ok(fn.includes("figma.createEffectStyle"), "elevation-styles apply can create approved local effect styles");
  assert.ok(fn.includes("figma.getLocalEffectStylesAsync"), "elevation-styles apply should refresh existing local effect styles");
  assert.ok(fn.includes("figma.variables.setBoundVariableForEffect"), "elevation-styles apply should bind effect fields to variables where possible");
  assert.ok(fn.includes("missingElevationVariable"), "elevation-styles should report missing required elevation variables");
  assert.ok(fn.includes("missingShadowColorVariable"), "elevation-styles should report missing optional shadow color variables");
  assert.ok(fn.includes("unsupportedEffectBinding"), "elevation-styles should report binding API failures");
  assert.ok(
    fn.includes("function _orchestrationSlices(cat)") &&
      fn.includes("if (cat === 'typography') return ['typography-variables', 'typography-styles']") &&
      fn.includes("if (cat === 'elevation') return ['elevation-variables', 'elevation-styles']"),
    "broad typography/elevation should expand into ordered narrow apply slices"
  );
  assert.ok(fn.includes("typographyName") && fn.includes("Typography collection"), "typography variables should target the Typography collection");
  assert.ok(fn.includes("type/body") === false, "typography variable apply should be config-driven, not hard-coded to one role");
  assert.ok(fn.includes("VARIABLE_ALIAS"), "semantic spacing apply should alias to primitive spacing variables when available");
  assert.ok(!fn.includes("addMode("), "narrow token apply must not create new collection modes");
  assert.ok(fn.includes("figma.variables.createVariable"), "approved apply can create missing spacing variables");
  assert.ok(fn.includes("_setVariableScopesForName(existing, entry.name, entry.type)"), "existing variables should preserve IDs and refresh scopes");
  assert.ok(fn.includes("existing.setValueForMode"), "approved apply can update existing variable values");
  assert.ok(fn.includes("missing-foundation-collection"), "missing foundation should be reported as guided repair scope");
  assert.ok(!fn.includes("Run apply_ds_setup first"), "missing foundation should not hard-code a setup-first halt");
  assert.ok(code.includes("function _configuredCollectionName(DS, kind)"), "bridge should share configured collection names across setup/repair paths");
  assert.ok(code.includes("function _configuredFoundationModes(DS, kind)"), "bridge should share configured foundation mode rules");
  assert.ok(code.includes("return _ensureCollectionModes(collection, modeNames).map"), "setup should use the shared mode helper instead of a parallel mode builder");
  assert.ok(code.includes("async function _applyDsFoundationRepairs"), "bridge should expose a narrow foundation repair helper");
  assert.ok(code.includes("createVariableCollection(name)"), "foundation repair can create approved collection shells");
  assert.ok(code.includes("Collection is not an approved config-backed foundation repair"), "foundation repair should reject arbitrary collections");

  assert.ok(ui.includes("'update-tokens'"), "UI should advertise update-tokens capability");
  assert.ok(ui.includes("'foundation-repairs'"), "UI should advertise foundation-repairs capability");
  assert.ok(ui.includes("data.command === 'apply-foundation-repairs'"), "UI should dispatch foundation repair commands");
  assert.ok(ui.includes("sync-foundation-repairs"), "UI should post foundation repair results back to receiver");
  assert.ok(ui.includes("data.command === 'update-tokens'"), "UI should dispatch update-tokens commands");
  assert.ok(ui.includes("sync-update-tokens"), "UI should post update token results back to receiver");
  assert.ok(ui.includes("http://localhost:17337"), "UI should use the Figlets-specific bridge port");
  assert.ok(!ui.includes("localhost:1337"), "UI should not use the generic 1337 bridge port");

  assert.ok(receiver.includes("const DEFAULT_PORT = 17337"), "receiver should default to the Figlets-specific bridge port");
  assert.ok(receiver.includes("FIGLETS_RECEIVER_PORT"), "receiver should allow local port override");
  assert.ok(receiver.includes("/request-update-tokens"), "receiver should expose request-update-tokens");
  assert.ok(receiver.includes("/request-foundation-repairs"), "receiver should expose request-foundation-repairs");
  assert.ok(receiver.includes("/sync-foundation-repairs"), "receiver should accept sync-foundation-repairs results");
  assert.ok(receiver.includes("_pluginHasCapability('foundation-repairs')"), "receiver should gate foundation repairs on advertised capability");
  assert.ok(receiver.includes("/sync-update-tokens"), "receiver should accept sync-update-tokens results");
  assert.ok(receiver.includes("_pluginHasCapability('update-tokens')"), "receiver should gate token updates on advertised capability");
})();

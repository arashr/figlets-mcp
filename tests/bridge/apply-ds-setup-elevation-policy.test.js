const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

module.exports = (() => {
  const fn = extractFunction(code, "_applyDsSetup");

  assert.ok(
    fn.includes("elevOffsetVar.setValueForMode(elevModeId, offsetYId ? { type: 'VARIABLE_ALIAS', id: offsetYId } : el.offsetY)") &&
      fn.includes("elevRadiusVar.setValueForMode(elevModeId, radiusId ? { type: 'VARIABLE_ALIAS', id: radiusId } : el.radius)"),
    "setup elevation variables must write numeric fallback values when primitive shadow aliases are unavailable"
  );
  assert.ok(
    fn.includes("figma.variables.setBoundVariableForEffect(effect, property, variable)") &&
      fn.includes("keyEffect = _withBoundEffectVariable(keyEffect, 'offsetY', elevVarMapForStyles['elevation/' + eff.key + '/offset-y'])") &&
      fn.includes("keyEffect = _withBoundEffectVariable(keyEffect, 'radius', elevVarMapForStyles['elevation/' + eff.key + '/radius'])"),
    "setup-created elevation styles should bind key shadow offset/radius by transforming effect objects before assignment"
  );
  assert.ok(
    fn.includes("ambientEffect = _withBoundEffectVariable(ambientEffect, 'radius', _varById(primVarMapForElev['shadow/ambient/' + eff.level + '/radius']))"),
    "setup-created ambient shadows should bind ambient radius when the primitive exists"
  );
})();

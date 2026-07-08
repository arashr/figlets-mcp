const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const codePath = path.join(repoRoot, "packages/figma-bridge-plugin/code.js");
const code = fs.readFileSync(codePath, "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  assert.ok(start !== -1, "Could not locate function " + name + " in code.js");
  let i = src.indexOf("{", start);
  assert.ok(i !== -1, "Malformed function " + name + " (no opening brace)");
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  assert.strictEqual(depth, 0, "Unbalanced braces while extracting " + name);
  return src.slice(start, i);
}

const helperNames = [
  "_docFormatNumber",
  "_docFormatUnitValue",
  "_docFormatTextStyleResolvedValue",
  "_docFormatResolvedVariableValue",
];

const helpers = new Function(
  helperNames.map(name => extractFunction(code, name)).join("\n") +
    "\nreturn { _docFormatTextStyleResolvedValue, _docFormatResolvedVariableValue };"
)();

module.exports = (async () => {
  const style = {
    name: "type/body/md",
    fontName: { family: "Inter", style: "Semi Bold" },
    fontSize: 16,
    lineHeight: { unit: "PIXELS", value: 24 },
    letterSpacing: { unit: "PERCENT", value: 2 },
  };
  assert.strictEqual(
    helpers._docFormatTextStyleResolvedValue(style),
    "Family: Inter; Style: Semi Bold; Size: 16px; Line height: 24px; Letter spacing: 2%",
    "text-style resolved values should include the full typography recipe, not only size/line-height"
  );

  assert.strictEqual(
    helpers._docFormatTextStyleResolvedValue({
      fontName: { family: "Roboto", style: "Regular" },
      fontSize: 14,
      lineHeight: { unit: "AUTO" },
      letterSpacing: { unit: "PIXELS", value: 0 },
    }),
    "Family: Roboto; Style: Regular; Size: 14px; Line height: auto; Letter spacing: 0px",
    "auto line-height and zero tracking should still be explicit in handoff docs"
  );

  assert.strictEqual(
    helpers._docFormatResolvedVariableValue("fontWeight", { type: "FLOAT", val: 600 }, () => "#000000"),
    "600",
    "font weight variables should not be formatted as pixels"
  );

  assert.strictEqual(
    helpers._docFormatResolvedVariableValue("fontFamily", { type: "STRING", val: "Inter" }, () => "#000000"),
    "Inter",
    "font family variables should resolve string values"
  );

  assert.ok(
    code.includes("['fontFamily', 'fontFamily']") &&
      code.includes("['fontWeight', 'fontWeight']") &&
      code.includes("['lineHeight', 'lineHeight']") &&
      code.includes("['letterSpacing', 'letterSpacing']"),
    "component docs should collect typography variable bindings beyond fontSize"
  );

  assert.ok(
    code.includes("typeof figma.getStyleByIdAsync === 'function'") &&
      code.includes("const _missingStyleIds = {}") &&
      code.includes("remoteStyle && remoteStyle.type === 'TEXT'"),
    "component docs should try to resolve non-local text style IDs before falling back to the raw style id"
  );
})();

const assert = require("assert");

const {
  buildTypographyVariableGroups,
  pickFloatVariableByValue,
  pickTypographyBinding,
  resolveVariableValue,
  scoreFloatVariableName,
} = require("../../packages/figlets-core/src/variable-binding.js");

function f(id, name, value) {
  return {
    id,
    name,
    resolvedType: "FLOAT",
    valuesByMode: { m: value },
  };
}

function alias(id, name, targetId) {
  return {
    id,
    name,
    resolvedType: "FLOAT",
    valuesByMode: { m: { type: "VARIABLE_ALIAS", id: targetId } },
  };
}

function s(id, name, value) {
  return {
    id,
    name,
    resolvedType: "STRING",
    valuesByMode: { m: value },
  };
}

{
  const vars = [
    f("shadow", "shadow/ambient/4/radius", 16),
    f("line", "type/title/md/line-height", 16),
    f("space", "space/component/lg", 16),
  ];
  const result = pickFloatVariableByValue(vars, 16, "spacing");
  assert.strictEqual(result.name, "space/component/lg");
}

{
  const vars = [
    f("shadow", "shadow/ambient/2/radius", 8),
    f("radius", "space/radius/md", 8),
    f("space", "space/stack/sm", 8),
  ];
  const result = pickFloatVariableByValue(vars, 8, "radius");
  assert.strictEqual(result.name, "space/radius/md");
}

{
  const vars = [
    f("shadow", "shadow/ambient/2/radius", 8),
    f("type", "type/body/sm/size", 8),
  ];
  const result = pickFloatVariableByValue(vars, 8, "spacing");
  assert.strictEqual(result, null, "spacing must not fall back to same-value shadow/type tokens");
}

{
  const vars = [
    f("none", "space/radius/none", 0),
  ];
  const result = pickFloatVariableByValue(vars, 0, "spacing");
  assert.strictEqual(result, null, "zero spacing must not bind to radius none");
}

{
  const vars = [
    f("space", "space/stack/xl", 24),
    f("radius", "space/radius/lg", 24),
    f("type", "type/title/md/line-height", 24),
  ];
  const result = pickFloatVariableByValue(vars, 24, "typography");
  assert.strictEqual(result.name, "type/title/md/line-height");
}

{
  const vars = [
    f("stroke", "stroke/default", 1),
    f("border", "space/border/default", 1),
    f("space", "space/stack/xxs", 1),
  ];
  const result = pickFloatVariableByValue(vars, 1, "border");
  assert.strictEqual(result.name, "space/border/default");
}

{
  const vars = [
    f("base", "space/4", 16),
    alias("alias", "space/component/lg", "base"),
  ];
  const varsById = new Map(vars.map(v => [v.id, v]));
  assert.strictEqual(resolveVariableValue(vars[1], varsById), 16);
  const result = pickFloatVariableByValue(vars, 16, "spacing", { varsById });
  assert.strictEqual(result.name, "space/component/lg");
}

{
  assert.ok(scoreFloatVariableName("space/component/lg", "spacing") > 0);
  assert.strictEqual(scoreFloatVariableName("shadow/ambient/4/radius", "spacing"), -1);
  assert.strictEqual(scoreFloatVariableName("color/surface/default", "spacing"), -1);
}

{
  const style = { id: "style-body", name: "type/body/md" };
  const binding = pickTypographyBinding({
    textStyles: [style],
    variables: [
      f("size", "type/body/md/size", 14),
      f("lh", "type/body/md/line-height", 21),
    ],
    patterns: ["type/body/md", "body/md"],
    role: "body",
  });
  assert.strictEqual(binding.kind, "style", "text styles have priority over typography variables");
  assert.strictEqual(binding.style.id, "style-body");
}

{
  const variables = [
    f("size", "type/body/md/size", 14),
    f("lh", "type/body/md/line-height", 21),
    f("weight", "type/body/md/weight", 400),
    s("family", "type/body/md/family", "Inter"),
  ];
  const groups = buildTypographyVariableGroups(variables);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].sizeValue, 14);
  assert.strictEqual(groups[0].lineHeightValue, 21);

  const binding = pickTypographyBinding({
    textStyles: [],
    variables,
    patterns: ["type/body/md", "body/md"],
    role: "body",
    groups,
  });
  assert.strictEqual(binding.kind, "variables", "typography variables are used when styles are absent");
  assert.strictEqual(binding.variables.sizeVar.name, "type/body/md/size");
  assert.strictEqual(binding.variables.lineHeightVar.name, "type/body/md/line-height");
  assert.strictEqual(binding.warning, null);
}

{
  const binding = pickTypographyBinding({
    textStyles: [],
    variables: [f("space", "space/component/lg", 16)],
    patterns: ["type/body/md", "body/md"],
    role: "body",
  });
  assert.strictEqual(binding.kind, "raw");
  assert.ok(binding.warning.includes("No typography style or typography variables"));
}

const assert = require("assert");
const {
  classifySemanticColorGrammar,
  classifyName,
} = require("../../packages/figlets-mcp-server/src/tools/semantic-color-grammar.js");

function sem(id, name) {
  return {
    id,
    name,
    resolvedType: "COLOR",
    variableCollectionId: "color",
    valuesByMode: {},
  };
}

module.exports = (() => {
  {
    const result = classifySemanticColorGrammar([
      sem("surface", "color/surface/default"),
      sem("on-surface", "color/on-surface/default"),
      sem("primary", "color/fill/primary"),
      sem("on-primary", "color/text/on-fill-primary"),
      sem("error-container", "color/fill/error-container"),
      sem("on-error-container", "color/text/on-fill-error-container"),
    ]);
    assert.ok(
      ["paired-context", "element-first"].includes(result.inferredGrammar),
      "paired context systems should be recognized as a known grammar"
    );
    assert.strictEqual(
      result.diagnostics.filter(item => item.kind === "invalid-name" || item.kind === "true-duplicate").length,
      0,
      "Material-like paired context names should not produce invalid or duplicate diagnostics"
    );
  }

  {
    const result = classifySemanticColorGrammar([
      sem("text-danger", "color/text/danger"),
      sem("icon-danger", "color/icon/danger"),
      sem("fill-danger", "color/fill/danger"),
      sem("text-on-fill-danger", "color/text/on-fill-danger"),
      sem("icon-on-fill-danger", "color/icon/on-fill-danger"),
    ]);
    assert.strictEqual(result.inferredGrammar, "element-first");
    assert.strictEqual(result.diagnostics.length, 0, "element-first on-fill roles should be clean");
  }

  {
    const result = classifySemanticColorGrammar([
      sem("fg-danger", "color/fg/danger"),
      sem("bg-danger-muted", "color/bg/danger/muted"),
      sem("bg-danger-emphasis", "color/bg/danger/emphasis"),
      sem("border-danger-muted", "color/border/danger/muted"),
      sem("fg-on-emphasis", "color/fg/on-color-danger"),
    ]);
    assert.ok(
      result.grammarCandidates.some(candidate => candidate.id === "intent-emphasis" && candidate.evidenceCount >= 2),
      "intent/emphasis systems should produce emphasis grammar evidence"
    );
    assert.strictEqual(
      result.diagnostics.filter(item => item.kind === "invalid-name").length,
      0,
      "intent/emphasis systems should not be invalid only because they have strength variants"
    );
  }

  {
    const item = classifyName("color/text/on-fill-danger");
    assert.strictEqual(item.assetRole, "text");
    assert.strictEqual(item.context, "on-fill");
    assert.strictEqual(item.family, "danger");
    assert.strictEqual(item.diagnostic, "clean");
  }

  {
    const result = classifySemanticColorGrammar([
      sem("bg-danger", "color/bg/danger"),
      sem("bg-on-danger", "color/bg/on-danger"),
    ]);
    const invalid = result.diagnostics.find(item => item.token === "color/bg/on-danger");
    assert.ok(invalid, "background on-* names should be diagnosed");
    assert.strictEqual(invalid.kind, "invalid-name");
  }

  {
    const result = classifySemanticColorGrammar([
      sem("text-danger", "color/text/danger"),
      sem("text-on-danger", "color/text/on-danger"),
    ]);
    const ambiguous = result.diagnostics.find(item => item.token === "color/text/on-danger");
    assert.ok(ambiguous, "plain on-danger foreground should be an advisory");
    assert.strictEqual(ambiguous.kind, "ambiguous-name");
    assert.strictEqual(
      result.diagnostics.some(item => item.kind === "true-duplicate"),
      false,
      "text/danger and text/on-danger should not automatically be treated as duplicates"
    );
  }

  {
    const result = classifySemanticColorGrammar([
      sem("fill-danger", "color/fill/danger"),
      sem("text-on-danger", "color/text/on-danger"),
      sem("icon-on-danger", "color/icon/on-danger"),
    ]);
    assert.strictEqual(
      result.diagnostics.some(item => item.kind === "ambiguous-name"),
      false,
      "shorthand on-danger should be clean when a matching fill/danger context exists"
    );
    const text = result.tokenClassifications.find(item => item.name === "color/text/on-danger");
    assert.strictEqual(text.context, "on-fill");
    assert.strictEqual(text.resolvedContextToken, "color/fill/danger");
  }

  {
    const result = classifySemanticColorGrammar([
      sem("text-danger", "color/text/danger"),
      sem("text-on-fill-danger", "color/text/on-fill-danger"),
      sem("fill-danger", "color/fill/danger"),
    ]);
    assert.strictEqual(
      result.diagnostics.some(item => item.kind === "true-duplicate"),
      false,
      "plain danger text and text on fill-danger are distinct contexts"
    );
  }

  {
    const result = classifySemanticColorGrammar([
      sem("one", "color/text/on-fill-danger"),
      sem("two", "color/fg/on-fill-danger"),
    ]);
    const duplicate = result.diagnostics.find(item => item.kind === "true-duplicate");
    assert.ok(duplicate, "same role/context/family through text and fg aliases should be a true duplicate");
    assert.deepStrictEqual(duplicate.tokens, ["color/fg/on-fill-danger", "color/text/on-fill-danger"]);
  }

  {
    const result = classifySemanticColorGrammar([
      sem("custom", "color/chroma/danger"),
    ]);
    assert.strictEqual(result.inferredGrammar, "unknown");
    assert.strictEqual(result.diagnostics[0].kind, "unknown-grammar");
  }

  {
    const result = classifySemanticColorGrammar([
      sem("scrim", "color/scrim/black/12"),
      sem("overlay", "color/scrim/overlay"),
      sem("shadow-key", "color/shadow/key"),
      sem("shadow-ambient", "color/shadow/ambient"),
    ]);
    assert.strictEqual(
      result.diagnostics.length,
      0,
      "generated scrim and shadow color utilities should not surface semantic naming advisories"
    );
    assert.strictEqual(classifyName("color/shadow/key").assetRole, "utility");
  }
})();

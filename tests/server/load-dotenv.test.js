const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadDotenv,
  parseDotenvLine
} = require("../../packages/figlets-mcp-server/src/utils/load-dotenv.js");

{
  assert.strictEqual(parseDotenvLine(""), null);
  assert.strictEqual(parseDotenvLine("# comment"), null);
  assert.deepStrictEqual(parseDotenvLine("FIGMA_ACCESS_TOKEN=test-token"), {
    key: "FIGMA_ACCESS_TOKEN",
    value: "test-token"
  });
  assert.deepStrictEqual(parseDotenvLine("NAME=\"hello world\""), {
    key: "NAME",
    value: "hello world"
  });
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "figlets-mcp-dotenv-"));
  const dotenvPath = path.join(tempDir, ".env");
  fs.writeFileSync(dotenvPath, "FIGMA_ACCESS_TOKEN=dotenv-token\nCUSTOM_VALUE='abc'\n", "utf8");

  delete process.env.FIGMA_ACCESS_TOKEN;
  delete process.env.CUSTOM_VALUE;

  const result = loadDotenv({ path: dotenvPath });

  assert.strictEqual(result.loaded, true);
  assert.strictEqual(result.values.FIGMA_ACCESS_TOKEN, "dotenv-token");
  assert.strictEqual(process.env.FIGMA_ACCESS_TOKEN, "dotenv-token");
  assert.strictEqual(process.env.CUSTOM_VALUE, "abc");
}

{
  const missingPath = path.join(os.tmpdir(), "figlets-mcp-no-dotenv-" + Date.now(), ".env");
  const result = loadDotenv({ path: missingPath });
  assert.strictEqual(result.loaded, false);
}

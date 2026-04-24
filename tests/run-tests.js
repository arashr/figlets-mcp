const fs = require("fs");
const path = require("path");

function getTestFiles(dirPath) {
  const entries = fs.readdirSync(dirPath);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      files.push.apply(files, getTestFiles(fullPath));
      continue;
    }

    if (/\.test\.js$/.test(entry)) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function main() {
  const testDir = path.join(__dirname);
  const testFiles = getTestFiles(testDir).filter(filePath => filePath !== __filename);
  let passed = 0;
  let failed = 0;

  for (const filePath of testFiles) {
    try {
      const result = require(filePath);
      if (result instanceof Promise) {
        await result;
      }
      process.stdout.write(`PASS ${path.relative(process.cwd(), filePath)}\n`);
      passed += 1;
    } catch (error) {
      process.stderr.write(`FAIL ${path.relative(process.cwd(), filePath)}\n`);
      process.stderr.write(`${error.stack}\n`);
      failed += 1;
    }
  }

  process.stdout.write(`\nTest files: ${testFiles.length}\nPassed: ${passed}\nFailed: ${failed}\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();

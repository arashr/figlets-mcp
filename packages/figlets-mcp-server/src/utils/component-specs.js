"use strict";

const fs = require("fs");
const path = require("path");

function _markdownFiles(directory) {
  const files = [];
  function visit(currentDirectory) {
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
        files.push(absolutePath);
      }
    }
  }
  visit(directory);
  return files;
}

function discoverComponentSpecs(projectPath) {
  const projectRoot = path.resolve(projectPath || process.cwd());
  const directory = path.join(projectRoot, "component-specs");
  if (!fs.existsSync(directory)) return { projectRoot, directory, specs: [] };

  const specs = [];
  const seenNames = new Map();

  for (const absolutePath of _markdownFiles(directory)) {
    const relativePath = path.relative(projectRoot, absolutePath).split(path.sep).join("/");
    const content = fs.readFileSync(absolutePath, "utf8");
    const heading = content.match(/^#\s+(.+?)\s*$/m);
    const name = heading && heading[1].trim()
      ? heading[1].trim()
      : path.basename(absolutePath, path.extname(absolutePath));
    if (seenNames.has(name)) {
      throw new Error(`Multiple component specs resolve to "${name}": ${seenNames.get(name)} and ${relativePath}.`);
    }
    seenNames.set(name, relativePath);
    specs.push({ name, path: relativePath, content });
  }

  return { projectRoot, directory, specs };
}

module.exports = { discoverComponentSpecs };

const fs = require("fs");
const path = require("path");

function parseDotenvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.charAt(0) === "#") {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();

  if (!key) {
    return null;
  }

  if (
    (value.charAt(0) === "\"" && value.charAt(value.length - 1) === "\"") ||
    (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")
  ) {
    value = value.slice(1, -1);
  }

  return {
    key: key,
    value: value
  };
}

function loadDotenv(options) {
  const opts = options || {};
  const dotenvPath = path.resolve(opts.path || path.join(process.cwd(), ".env"));

  if (!fs.existsSync(dotenvPath)) {
    return {
      path: dotenvPath,
      loaded: false,
      values: {}
    };
  }

  const content = fs.readFileSync(dotenvPath, "utf8");
  const values = {};

  content.split(/\r?\n/).forEach(function(line) {
    const parsed = parseDotenvLine(line);

    if (!parsed) {
      return;
    }

    values[parsed.key] = parsed.value;

    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  });

  return {
    path: dotenvPath,
    loaded: true,
    values: values
  };
}

module.exports = {
  loadDotenv: loadDotenv,
  parseDotenvLine: parseDotenvLine
};

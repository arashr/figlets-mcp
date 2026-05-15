"use strict";

// Single resolution point for the deterministic @figlets/core engine.
//
// - Packaged release tarball: resolves the bundled `node_modules/@figlets/core`
//   that scripts/build-server-tarball.js vendors into the tarball.
// - Monorepo / source checkout: falls back to the sibling package source so
//   `npm test` and local dev work without an install step.
//
// Every server tool must require figlets-core through this module. A relative
// `../../../figlets-core/...` path only resolves inside the monorepo layout and
// breaks in the standalone tarball, so those must never be used directly.

let core;
try {
  core = require("@figlets/core");
} catch (err) {
  core = require("../../figlets-core/src/index.js");
}

module.exports = core;

#!/usr/bin/env node
'use strict';

// Developer-only manual smoke prep. This mutates the open Figma file.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { ensureReceiverRunning } = require('../packages/figlets-mcp-server/src/utils/ensure-receiver.js');
const { getReceiverUrl } = require('../packages/figlets-mcp-server/src/utils/receiver-url.js');
const { getFilePaths, LOCAL_DIR } = require('../packages/figlets-mcp-server/src/utils/paths.js');
const { handlePrepareDsConfig } = require('../packages/figlets-mcp-server/src/tools/prepare-ds-config.js');
const {
  CONFIRMATION_PHRASE,
  buildBrokenDsFixturePlan,
  writeFixtureConfig,
} = require('../packages/figlets-mcp-server/src/dev/broken-ds-fixture.js');

const CONFIRM_FLAG = '--yes-i-understand-this-mutates-figma';

function usage() {
  return [
    'Usage: node scripts/prepare-broken-ds-fixture.js ' + CONFIRM_FLAG + ' [--seed <seed>] [--config <path>] [--expected-file-name <name>]',
    '',
    'WARNING: This is developer test prep only. It resets local variables, styles, and canvas content',
    'in the currently open Figma file, builds a Figlets-style DS, then intentionally removes tokens',
    'and creates raw binding-audit targets for manual smoke testing.',
    '',
    'Requirements: open a fresh/disposable Figma file, open the local Figlets Bridge plugin,',
    'and run the receiver with FIGLETS_DEV_BRIDGE=1.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { seed: 'bnn-37', configPath: path.resolve('.local/bnn-37-broken-fixture/design-system.config.js'), confirmed: false, expectedFileName: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === CONFIRM_FLAG) args.confirmed = true;
    else if (arg === '--seed') args.seed = argv[++i] || '';
    else if (arg === '--config') args.configPath = path.resolve(argv[++i] || '');
    else if (arg === '--expected-file-name') args.expectedFileName = argv[++i] || '';
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  return args;
}

function postJson(url, body, timeoutMs) {
  const payload = JSON.stringify(body || {});
  return new Promise((resolve) => {
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch (_) {}
        resolve({ statusCode: res.statusCode, body: parsed, raw: data });
      });
    });
    req.setTimeout(timeoutMs || 185000, () => {
      req.destroy();
      resolve({ statusCode: 0, body: { error: 'Request timed out.' } });
    });
    req.on('error', (err) => resolve({ statusCode: 0, body: { error: err.message } }));
    req.write(payload);
    req.end();
  });
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.confirmed) {
    console.error(usage());
    console.error('\nRefusing to mutate Figma without ' + CONFIRM_FLAG + '.');
    process.exit(2);
  }
  if (process.env.FIGLETS_DEV_BRIDGE !== '1') {
    throw new Error('FIGLETS_DEV_BRIDGE=1 is required for this developer-only fixture script.');
  }

  const written = writeFixtureConfig(args.configPath, { seed: args.seed });
  const prepared = handlePrepareDsConfig({ config_path: written.configPath });
  if (prepared.error) throw new Error(prepared.error);
  if (!prepared.readyToBuild) throw new Error('Fixture config is not ready to build: ' + prepared.message);

  await ensureReceiverRunning();
  const plan = buildBrokenDsFixturePlan({ seed: args.seed });
  plan.ds = require('../packages/figlets-mcp-server/src/figlets-core.js').dsConfig.readDsConfig(written.configPath);
  plan.configPath = written.configPath;
  plan.confirmation = CONFIRMATION_PHRASE;
  if (args.expectedFileName) plan.expectedFileName = args.expectedFileName;

  const response = await postJson(getReceiverUrl() + '/request-prepare-broken-ds-fixture', plan, 185000);
  if (response.statusCode !== 200) {
    throw new Error((response.body && response.body.error) || ('Fixture prep failed with status ' + response.statusCode));
  }
  const result = response.body.result || response.body;
  if (result.error) throw new Error(result.error);
  let scopedConfigPath = written.configPath;
  if (result.fileKey) {
    const paths = getFilePaths(result.fileKey);
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.copyFileSync(written.configPath, paths.config);
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(LOCAL_DIR, 'active-file.json'),
      JSON.stringify({ fileKey: result.fileKey, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
    scopedConfigPath = paths.config;
  }
  console.log(JSON.stringify({
    status: 'ok',
    seed: plan.seed,
    fileKey: result.fileKey || null,
    fileName: result.fileName || null,
    expectedFileName: args.expectedFileName || null,
    configPath: scopedConfigPath,
    stagingConfigPath: written.configPath,
    removedVariables: result.removedVariables || [],
    removedTextStyles: result.removedTextStyles || [],
    trimmedModes: result.trimmedModes || [],
    bindingAuditTargets: result.bindingAuditTargets || null,
    message: result.message || 'Broken DS fixture prepared.',
  }, null, 2));
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

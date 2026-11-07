'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { freshMcpClient } = require('../helpers/mcp-client');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-contrast-continuation-'));
const previousLocal = process.env.FIGLETS_LOCAL_DIR;
process.env.FIGLETS_LOCAL_DIR = tmp;
const core = require('../../packages/figlets-core/src/ds-config');
const { handlePrepareDsConfig, handleApplyDsConfigContrastRepairs } = require('../../packages/figlets-mcp-server/src/tools/prepare-ds-config');
const { handleApplyDsSetup } = require('../../packages/figlets-mcp-server/src/tools/apply-ds-setup');
const configPath = path.join(tmp, 'file', 'design-system.config.js');
fs.mkdirSync(path.dirname(configPath));
const seed = {
  project: { name: 'Contrast continuation' }, grid: { base: 4 },
  breakpoints: { modes: ['Desktop'], tier: 1 },
  typography: { scalePreset: 'material3', families: { sans: 'Inter', mono: 'JetBrains Mono' } },
  color: { scale: '50-950', algorithm: 'oklch', contrastAlgorithm: 'wcag', convention: 'role-based',
    brand: [{ name: 'primary', role: 'primary', hex: '#808080' }],
    semantics: { pairs: [{ bg: 'color/bg/custom', text: 'color/text/custom', icon: 'color/icon/custom',
      Light: { bg: 'color/neutral/50', text: 'color/neutral/50' },
      Dark: { bg: 'color/neutral/950', text: 'color/neutral/50' } }],
    icons: [{ token: 'color/icon/custom', Light: 'color/primary/50', Dark: 'color/primary/950' }] },
  },
};

module.exports = (async () => {
  let server;
  const previousUrl = process.env.FIGLETS_RECEIVER_URL;
  try {
    core.writeDsConfig(configPath, seed);
    const initial = await handlePrepareDsConfig({ config_path: configPath });
    assert.ok(!initial.error, initial.error);
    assert.strictEqual(initial.readyToBuild, false);
    assert.ok(initial.contrast.textFailureCount > 0);
    const ds = core.readDsConfig(configPath);
    const ramps = JSON.stringify(ds.color.ramps);
    const semantics = JSON.stringify(ds.color.semantics);
    const iconRepair = initial.semanticPairs.contrastRepairOptions.find(option => option.kind === 'icon' && option.icon === 'color/icon/custom' && option.mode === 'Light');
    assert.ok(iconRepair, 'middle-valued palette must expose an existing passing icon step');
    assert.ok(iconRepair.evidence.every(context => context.candidateRatio >= 3));
    assert.ok(iconRepair.suggestedIcon.startsWith('color/primary/'));
    const stale = JSON.parse(JSON.stringify(iconRepair));
    stale.evidence[0].rgb.r += .01;
    const beforeStale = fs.readFileSync(configPath, 'utf8');
    assert.ok(handleApplyDsConfigContrastRepairs({ config_path: configPath, repairs: [stale] }).error);
    assert.strictEqual(fs.readFileSync(configPath, 'utf8'), beforeStale);
    const applied = handleApplyDsConfigContrastRepairs({ config_path: configPath, repairs: [iconRepair] });
    assert.ok(!applied.error, applied.error);
    const repaired = core.readDsConfig(configPath);
    assert.strictEqual(JSON.stringify(repaired.color.ramps), ramps, 'semantic repair must not change primitives');
    assert.strictEqual(repaired.color.brand[0].hex, '#808080');
    assert.strictEqual(repaired.color.scale, '50-950');
    assert.strictEqual(repaired.color.semantics.icons.find(icon => icon.token === iconRepair.icon).Light, iconRepair.suggestedIcon);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(repaired.color.semantics.pairs)), JSON.parse(semantics).pairs);

    // Restore the declined repair, then honor the designer's continuation.
    core.writeDsConfig(configPath, ds);
    const accepted = await handlePrepareDsConfig({ config_path: configPath, continue_with_contrast_warnings: true });
    assert.strictEqual(accepted.setupApprovalPreview.status, 'ready');
    assert.strictEqual(accepted.readyToBuild, true, JSON.stringify(accepted.designMdExport?.lint));
    assert.ok(accepted.semanticPairs.failCount > 0, 'accepted does not mean passing');
    assert.ok(accepted.contrast.acceptedCount > 0);
    assert.strictEqual(JSON.stringify(core.readDsConfig(configPath).color.semantics), semantics, 'continuing must not apply declined aliases');
    const repeated = await handlePrepareDsConfig({ config_path: configPath });
    assert.strictEqual(repeated.readyToBuild, true);
    assert.strictEqual(repeated.contrast.blockingCount, 0);
    assert.strictEqual(repeated.continueInput, null);
    assert.ok(fs.readFileSync(accepted.designMdExport.path, 'utf8').includes('Designer chose to continue'));
    assert.ok(accepted.designMdExport.lint.findings.some(finding => finding.rule === 'semantic-contrast' && finding.accepted));

    let calls = 0;
    let payload;
    server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, pluginConnected: true })); return;
      }
      assert.strictEqual(req.url, '/request-ds-setup');
      calls++; let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { payload = JSON.parse(body); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ result: { collections: ['1. Primitives'], skipped: [] } })); });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.FIGLETS_RECEIVER_URL = 'http://127.0.0.1:' + server.address().port;
    const built = await handleApplyDsSetup({ config_path: configPath });
    assert.ok(!built.error, built.error);
    assert.strictEqual(calls, 1);
    assert.ok(built.contrast.acceptedCount > 0);
    assert.strictEqual(JSON.stringify(payload.DS.color.ramps), ramps);
    assert.strictEqual(JSON.stringify(payload.DS.color.semantics), semantics);

    // New evaluated colors invalidate the old acknowledgment, but cannot be
    // interpreted as permission to alter primitives or silently apply a repair.
    const changed = core.readDsConfig(configPath);
    changed.color.semantics.pairs[0].Light.bg = 'color/neutral/100';
    core.writeDsConfig(configPath, changed);
    const changedPreview = await handlePrepareDsConfig({ config_path: configPath });
    assert.strictEqual(changedPreview.readyToBuild, false);
    const changedBuild = await handleApplyDsSetup({ config_path: configPath });
    assert.ok(changedBuild.error);
    assert.strictEqual(calls, 1);
    const continuedAtApply = await handleApplyDsSetup({ config_path: configPath, continue_with_contrast_warnings: true });
    assert.ok(!continuedAtApply.error, continuedAtApply.error);
    assert.strictEqual(calls, 2);

    const broken = core.readDsConfig(configPath);
    broken.color.semantics.pairs[0].Light.bg = 'color/missing/500';
    core.writeDsConfig(configPath, broken);
    const unresolved = await handlePrepareDsConfig({ config_path: configPath, continue_with_contrast_warnings: true });
    assert.strictEqual(unresolved.readyToBuild, false);
    assert.ok(unresolved.contrast.referenceErrors.length);
    assert.ok((await handleApplyDsSetup({ config_path: configPath, continue_with_contrast_warnings: true })).error);
    assert.strictEqual(calls, 2);

    // An icon shared across light, middle, and dark backgrounds has no single
    // passing step. It must remain one stable advisory, not restart a repair.
    const incompatible = JSON.parse(JSON.stringify(seed));
    incompatible.color.semantics.pairs = [50, 500, 950].map(step => ({
      bg: 'color/bg/context-' + step, text: 'color/text/context-' + step, icon: 'color/icon/custom', min: null, minLc: null,
      Light: { bg: 'color/neutral/' + step, text: 'color/neutral/50' },
      Dark: { bg: 'color/neutral/' + step, text: 'color/neutral/50' },
    }));
    incompatible.color.semantics.icons[0].Light = 'color/primary/500';
    incompatible.color.semantics.icons[0].Dark = 'color/primary/500';
    core.writeDsConfig(configPath, incompatible);
    const iconOnly = await handlePrepareDsConfig({ config_path: configPath });
    assert.strictEqual(iconOnly.readyToBuild, true, JSON.stringify(iconOnly.contrast));
    assert.strictEqual(iconOnly.setupApprovalPreview.status, 'ready');
    assert.strictEqual(iconOnly.contrast.textFailureCount, 0);
    assert.ok(iconOnly.contrast.iconFailureCount > 0);
    const warning = iconOnly.contrast.warnings.find(item => item.icon === 'color/icon/custom' && item.mode === 'Light');
    assert.strictEqual(warning.contexts.length, 3);
    assert.strictEqual(warning.resolved, false);
    assert.ok(!iconOnly.semanticPairs.contrastRepairOptions.some(item => item.icon === 'color/icon/custom'), 'never invent a universal icon fix');
    const unchangedIcons = JSON.stringify(core.readDsConfig(configPath).color.semantics);
    const iconOnlyRepeated = await handlePrepareDsConfig({ config_path: configPath });
    assert.strictEqual(iconOnlyRepeated.readyToBuild, true);
    assert.strictEqual(JSON.stringify(core.readDsConfig(configPath).color.semantics), unchangedIcons);
    assert.ok(!(await handleApplyDsSetup({ config_path: configPath })).error);
    assert.strictEqual(calls, 3, 'icon advisories must not block the normal build route');

    // Test the registered tool schemas and callbacks in a new server process,
    // not just direct handlers. This catches a dropped continuation argument or
    // icon repair rejected by an outdated registration schema.
    const transportConfig = path.join(path.dirname(configPath), 'transport.config.js');
    core.writeDsConfig(transportConfig, seed);
    const client = await freshMcpClient();
    try {
      await client.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'contrast-regression', version: '1.0.0' } });
      const preview = await client.tool('prepare_ds_config', { config_path: transportConfig });
      assert.strictEqual(preview.readyToBuild, false);
      const option = preview.semanticPairs.contrastRepairOptions.find(item => item.kind === 'icon' && item.icon === 'color/icon/custom');
      assert.ok(option);
      const repair = await client.tool('apply_ds_config_contrast_repairs', { config_path: transportConfig, repairs: [option] });
      assert.strictEqual(repair.appliedCount, 1);
      const continued = await client.tool('prepare_ds_config', { config_path: transportConfig, continue_with_contrast_warnings: true });
      assert.strictEqual(continued.readyToBuild, true);
      assert.ok(continued.contrast.acceptedCount > 0);
      const builtThroughMcp = await client.tool('apply_ds_setup', { config_path: transportConfig });
      assert.ok(builtThroughMcp.contrast.acceptedCount > 0);
      assert.strictEqual(calls, 4);
    } finally { await client.close(); }

    // Two individually passing repairs can conflict when the text repair moves
    // the background. Reject the combination atomically instead of saving a
    // newly failing icon and sending the designer back into another fix loop.
    const combinationPath = path.join(path.dirname(configPath), 'combination.config.js');
    core.writeDsConfig(combinationPath, { color: {
      brand: [{ name: 'primary', role: 'primary', hex: '#808080' }], contrastAlgorithm: 'wcag',
      ramps: [
        { folder: 'color/primary', steps: [[50, 1, 1, 1], [500, .3, .3, .3], [950, 0, 0, 0]] },
        { folder: 'color/neutral', steps: [[50, 1, 1, 1], [500, .5, .5, .5], [950, 0, 0, 0]] },
        { folder: 'color/pale', steps: [[500, 1, 1, 1]] },
      ],
      semantics: { pairs: [{ bg: 'color/bg/custom', text: 'color/text/custom', icon: 'color/icon/custom',
        Light: { bg: 'color/neutral/50', text: 'color/pale/500' } }],
      icons: [{ token: 'color/icon/custom', Light: 'color/primary/50', Dark: 'color/primary/50' }] },
    } });
    const combination = core.readDsConfig(combinationPath);
    const validation = core.validateSemanticPairs(combination);
    const options = core.contrastRepairOptions(validation.pairRepairSuggestions, validation.iconRepairSuggestions);
    const textOption = options.find(item => item.background === 'color/bg/custom' && item.mode === 'Light');
    const iconOption = options.find(item => item.icon === 'color/icon/custom' && item.mode === 'Light');
    assert.ok(textOption?.suggestedBackground);
    assert.strictEqual(iconOption?.suggestedIcon, 'color/primary/500');
    const combinationBefore = fs.readFileSync(combinationPath, 'utf8');
    const conflict = handleApplyDsConfigContrastRepairs({ config_path: combinationPath, repairs: [textOption, iconOption] });
    assert.ok(conflict.error);
    assert.ok(conflict.blocked.some(item => item.reason.includes('combined semantic repairs')));
    assert.strictEqual(fs.readFileSync(combinationPath, 'utf8'), combinationBefore);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (previousUrl === undefined) delete process.env.FIGLETS_RECEIVER_URL; else process.env.FIGLETS_RECEIVER_URL = previousUrl;
    if (previousLocal === undefined) delete process.env.FIGLETS_LOCAL_DIR; else process.env.FIGLETS_LOCAL_DIR = previousLocal;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

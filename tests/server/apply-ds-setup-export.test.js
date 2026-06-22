'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-apply-export-'));
const configPath = path.join(tmp, 'file_apply', 'design-system.config.js');
const failingConfigPath = path.join(tmp, 'file_apply', 'failing-design-system.config.js');
fs.mkdirSync(path.dirname(configPath), { recursive: true });

fs.writeFileSync(configPath, `const DS = {
  project: { name: 'Apply Export' },
  color: {
    ramps: [
      { folder: 'color/primary', steps: [[500, 0.2, 0.4, 1]] },
      { folder: 'color/neutral', steps: [[50, 0.98, 0.98, 0.98], [950, 0.05, 0.05, 0.05]] }
    ],
    brand: [{ name: 'primary', hex: '#3366FF', role: 'primary' }],
    contrastAlgorithm: 'wcag',
    semantics: {
      icons: false,
      pairs: [{
        bg: 'color/bg/default',
        text: 'color/text/default',
        Light: { bg: 'color/neutral/50', text: 'color/neutral/950' },
        Dark: { bg: 'color/neutral/950', text: 'color/neutral/50' }
      }]
    }
  },
  typography: { scale: { 'body/md': { sizes: [16, 16, 16], lineHeights: [24, 24, 24], weight: 400, tracking: 0 } }, families: { sans: 'Inter' } },
  spacing: { semantic: { 'component/md': [16, 16, 16] }, radius: { md: 8 }, border: { default: 1 } },
  primitives: { spacing: [[1, 1], [8, 8], [16, 16]] }
};\n`, 'utf8');

fs.writeFileSync(failingConfigPath, `const DS = {
  project: { name: 'Apply Blocked' },
  color: {
    ramps: [{ folder: 'color/neutral', steps: [[50, 0.98, 0.98, 0.98], [950, 0.05, 0.05, 0.05]] }],
    brand: [{ name: 'neutral', hex: '#111111', role: 'primary' }],
    contrastAlgorithm: 'wcag',
    semantics: {
      pairs: [{
        bg: 'color/bg/default',
        text: 'color/text/default',
        Light: { bg: 'color/neutral/50', text: 'color/neutral/50' },
        Dark: { bg: 'color/neutral/950', text: 'color/neutral/950' }
      }]
    }
  },
  typography: { scale: { 'body/md': { sizes: [16, 16, 16], lineHeights: [24, 24, 24], weight: 400, tracking: 0 } }, families: { sans: 'Inter' } },
  spacing: { semantic: { 'component/md': [16, 16, 16] }, radius: { md: 8 }, border: { default: 1 } },
  primitives: { spacing: [[1, 1], [8, 8], [16, 16]] }
};\n`, 'utf8');

module.exports = (async () => {
  const oldUrl = process.env.FIGLETS_RECEIVER_URL;
  let requestCount = 0;
  let requestBody = null;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/request-ds-setup') {
      res.writeHead(404);
      res.end();
      return;
    }
    requestCount += 1;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { requestBody = JSON.parse(body || '{}'); } catch (_) { requestBody = null; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result: { collections: ['1. Primitives'], skipped: [] } }));
    });
  });

  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.FIGLETS_RECEIVER_URL = 'http://127.0.0.1:' + server.address().port;

    delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/tools/apply-ds-setup.js')];
    const { handleApplyDsSetup, _checkGeneratedSetupPrimitiveCoverage } = require('../../packages/figlets-mcp-server/src/tools/apply-ds-setup.js');
    const core = require('../../packages/figlets-core/src/ds-config');
    const readyDs = core.readDsConfig(configPath);
    const missingBorderPrimitive = core.generatePrimitivesData(readyDs);
    missingBorderPrimitive.floats = missingBorderPrimitive.floats.filter(item => item.name !== 'border/width/default');
    assert.ok(
      _checkGeneratedSetupPrimitiveCoverage(readyDs, missingBorderPrimitive).some(item => item.includes('border default value 1')),
      'setup proof should catch semantic values whose exact primitive was not generated'
    );

    const blocked = await handleApplyDsSetup({ config_path: failingConfigPath });
    assert.ok(blocked.error.includes('not ready to build'), 'apply_ds_setup should block configs that fail contrast');
    assert.strictEqual(blocked.contrastRepairTool, 'apply_ds_config_contrast_repairs');
    assert.ok(blocked.contrastRepairOptions.length > 0, 'blocked setup should expose structured contrast repair options');
    assert.strictEqual(requestCount, 0, 'blocked setup must not call the bridge');

    const result = await handleApplyDsSetup({ config_path: configPath });

    assert.ok(!result.error, 'apply_ds_setup should succeed');
    assert.strictEqual(requestCount, 1, 'ready setup should call the bridge exactly once');
    assert.ok(requestBody && requestBody.DS, 'apply_ds_setup should send a prepared setup payload with DS');
    assert.ok(requestBody.primitivesData, 'apply_ds_setup should send prepared primitive inventory to the bridge');
    assert.ok(requestBody.primitivesData.floats.some(item => item.name === 'border/width/default' && item.value === 1), 'prepared primitive inventory should include exact border primitive values');
    assert.strictEqual(requestBody.color, undefined, 'apply_ds_setup should not send raw DS as the top-level bridge payload');
    assert.ok(result.designMdExport && result.designMdExport.path, 'apply_ds_setup should expose DESIGN.md export path');
    assert.ok(fs.existsSync(result.designMdExport.path), 'DESIGN.md export should be written after setup');
    assert.ok(fs.readFileSync(result.designMdExport.path, 'utf8').includes('Apply Export'), 'export should use DS project name');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
    if (oldUrl === undefined) delete process.env.FIGLETS_RECEIVER_URL;
    else process.env.FIGLETS_RECEIVER_URL = oldUrl;
    delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/tools/apply-ds-setup.js')];
  }
})();

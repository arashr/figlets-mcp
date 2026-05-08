'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figlets-apply-export-'));
const configPath = path.join(tmp, 'file_apply', 'design-system.config.js');
fs.mkdirSync(path.dirname(configPath), { recursive: true });

fs.writeFileSync(configPath, `const DS = {
  project: { name: 'Apply Export' },
  color: {
    ramps: [{ folder: 'color/primary', steps: [[500, 0.2, 0.4, 1]] }],
    brand: [{ name: 'primary', hex: '#3366FF', role: 'primary' }]
  },
  typography: { scale: { 'body/md': { sizes: [16, 16, 16], lineHeights: [24, 24, 24], weight: 400, tracking: 0 } }, families: { sans: 'Inter' } },
  spacing: { semantic: { 'component/md': [16, 16, 16] }, radius: { md: 8 }, border: { default: 1 } },
  primitives: { spacing: [[4, 16]] }
};\n`, 'utf8');

module.exports = (async () => {
  const oldUrl = process.env.FIGLETS_RECEIVER_URL;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/request-ds-setup') {
      res.writeHead(404);
      res.end();
      return;
    }
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result: { collections: ['1. Primitives'], skipped: [] } }));
    });
  });

  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.FIGLETS_RECEIVER_URL = 'http://127.0.0.1:' + server.address().port;

    delete require.cache[require.resolve('../../packages/figlets-mcp-server/src/tools/apply-ds-setup.js')];
    const { handleApplyDsSetup } = require('../../packages/figlets-mcp-server/src/tools/apply-ds-setup.js');
    const result = await handleApplyDsSetup({ config_path: configPath });

    assert.ok(!result.error, 'apply_ds_setup should succeed');
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

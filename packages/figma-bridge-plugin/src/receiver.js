const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 1337;
const DEST_DIR = path.resolve(__dirname, '../../../.local');
const DEST_FILE = path.join(DEST_DIR, 'figma-data.json');

const server = http.createServer((req, res) => {
  // Handle CORS for Figma Plugin UI
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/sync') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (!fs.existsSync(DEST_DIR)) {
          fs.mkdirSync(DEST_DIR, { recursive: true });
        }
        
        fs.writeFileSync(DEST_FILE, body);
        console.log(`[success] Wrote payload to ${DEST_FILE}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('[error] Failed to write file:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Figma Bridge Receiver listening on http://localhost:${PORT}`);
    console.log(`Will write data to: ${DEST_FILE}`);
    console.log(`Run the Figlets Bridge plugin in Figma and click Sync!`);
  });
}

module.exports = server;

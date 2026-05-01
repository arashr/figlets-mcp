const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 1337;
const DEST_DIR = process.env.FIGLETS_LOCAL_DIR || path.resolve(__dirname, '../../../.local');
const DEST_FILE = path.join(DEST_DIR, 'figma-data.json');

let pendingPollResponse = null;
let pendingPollSessionId = null;
let pendingSyncRequest = null;
let pendingSelectionRequest = null;
let pendingShowcaseRequest = null;
let pendingDsSetupRequest = null;
let pendingDocBuildRequest = null;

const DEST_FILE_SELECTION = path.join(DEST_DIR, 'figma-selection.json');

function _getSessionId(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  return url.searchParams.get('sessionId') || req.headers['x-figlets-session'] || '';
}

function _notConnectedPayload() {
  return {
    error: 'Figma plugin is not connected or listening.',
    activeSessionId: pendingPollSessionId || null
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  // Handle CORS for Figma Plugin UI
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Figlets-Session');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Figma Plugin long-polls this endpoint
  if (req.method === 'GET' && pathname === '/poll') {
    const sessionId = url.searchParams.get('sessionId') || '';
    pendingPollResponse = res;
    pendingPollSessionId = sessionId || null;
    console.log(`[poll] Plugin connected${pendingPollSessionId ? ` (${pendingPollSessionId})` : ''}`);
    
    // Keep connection alive: if no sync requested within 30 seconds, send ping
    setTimeout(() => {
      if (pendingPollResponse === res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ command: 'ping' }));
        pendingPollResponse = null;
        pendingPollSessionId = null;
      }
    }, 30000);
    return;
  }

  // 2. MCP Agent calls this to trigger a global sync
  if (req.method === 'POST' && pathname === '/request-sync') {
    if (pendingPollResponse) {
      // Tell Figma to wake up and extract everything
      pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
      pendingPollResponse.end(JSON.stringify({ command: 'extract-all' }));
      pendingPollResponse = null;
      pendingPollSessionId = null;
      
      // Hold the agent's request open until Figma posts the payload back
      pendingSyncRequest = res;
      
      // Timeout after 60 seconds if Figma doesn't respond
      setTimeout(() => {
        if (pendingSyncRequest === res) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Sync timed out' }));
          pendingSyncRequest = null;
        }
      }, 60000);
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  // 3. MCP Agent calls this to trigger a selection sync
  if (req.method === 'POST' && pathname === '/request-selection') {
    if (pendingPollResponse) {
      pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
      pendingPollResponse.end(JSON.stringify({ command: 'extract-selection' }));
      pendingPollResponse = null;
      pendingPollSessionId = null;
      
      pendingSelectionRequest = res;
      
      setTimeout(() => {
        if (pendingSelectionRequest === res) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Selection sync timed out' }));
          pendingSelectionRequest = null;
        }
      }, 15000); // Selection is usually very fast
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  // 4. MCP Agent calls this to trigger a showcase build
  if (req.method === 'POST' && pathname === '/request-showcase') {
    if (pendingPollResponse) {
      pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
      pendingPollResponse.end(JSON.stringify({ command: 'build-showcase' }));
      pendingPollResponse = null;
      pendingPollSessionId = null;

      pendingShowcaseRequest = res;

      setTimeout(() => {
        if (pendingShowcaseRequest === res) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Showcase build timed out' }));
          pendingShowcaseRequest = null;
        }
      }, 120000); // Showcase can take a while
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  // 5. Figma Plugin posts the showcase result here
  if (req.method === 'POST' && pathname === '/sync-showcase') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingShowcaseRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingShowcaseRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingShowcaseRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingShowcaseRequest = null;
      }
    });
    return;
  }

  // 5b. MCP Agent calls this to trigger a component doc build
  if (req.method === 'POST' && pathname === '/request-doc-build') {
    if (pendingPollResponse) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let docPayload;
        try { docPayload = JSON.parse(body); } catch { docPayload = {}; }

        pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingPollResponse.end(JSON.stringify({ command: 'build-doc', data: docPayload }));
        pendingPollResponse = null;
        pendingPollSessionId = null;

        pendingDocBuildRequest = res;

        setTimeout(() => {
          if (pendingDocBuildRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Doc build timed out' }));
            pendingDocBuildRequest = null;
          }
        }, 120000);
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  // 5c. Figma Plugin posts the doc build result here
  if (req.method === 'POST' && pathname === '/sync-doc-build') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingDocBuildRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingDocBuildRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingDocBuildRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingDocBuildRequest = null;
      }
    });
    return;
  }

  // 6. MCP Agent calls this to trigger DS setup (creates all variable collections)
  if (req.method === 'POST' && pathname === '/request-ds-setup') {
    if (pendingPollResponse) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let dsPayload;
        try { dsPayload = JSON.parse(body); } catch { dsPayload = {}; }

        pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingPollResponse.end(JSON.stringify({ command: 'apply-ds-setup', data: dsPayload }));
        pendingPollResponse = null;
        pendingPollSessionId = null;

        pendingDsSetupRequest = res;

        setTimeout(() => {
          if (pendingDsSetupRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'DS setup timed out — building variables can take up to 3 minutes for large systems.' }));
            pendingDsSetupRequest = null;
          }
        }, 180000); // 3 minutes for large systems
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  // 6b. Figma Plugin posts the DS setup result here
  if (req.method === 'POST' && pathname === '/sync-ds-setup') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingDsSetupRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingDsSetupRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingDsSetupRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingDsSetupRequest = null;
      }
    });
    return;
  }

  // 7. Figma Plugin posts the global extracted data here
  if (req.method === 'POST' && pathname === '/sync') {
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

        if (pendingSyncRequest) {
          pendingSyncRequest.writeHead(200, { 'Content-Type': 'application/json' });
          pendingSyncRequest.end(JSON.stringify({ success: true, message: 'Sync complete', sessionId: _getSessionId(req) || null }));
          pendingSyncRequest = null;
        }
      } catch (err) {
        console.error('[error] Failed to write file:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));

        if (pendingSyncRequest) {
          pendingSyncRequest.writeHead(500, { 'Content-Type': 'application/json' });
          pendingSyncRequest.end(JSON.stringify({ error: err.message }));
          pendingSyncRequest = null;
        }
      }
    });
    return;
  }

  // 8. Figma Plugin posts the selection data here
  if (req.method === 'POST' && pathname === '/sync-selection') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (!fs.existsSync(DEST_DIR)) {
          fs.mkdirSync(DEST_DIR, { recursive: true });
        }
        
        fs.writeFileSync(DEST_FILE_SELECTION, body);
        console.log(`[success] Wrote selection to ${DEST_FILE_SELECTION}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));

        if (pendingSelectionRequest) {
          pendingSelectionRequest.writeHead(200, { 'Content-Type': 'application/json' });
          pendingSelectionRequest.end(JSON.stringify({ success: true, message: 'Selection synced', path: DEST_FILE_SELECTION, sessionId: _getSessionId(req) || null }));
          pendingSelectionRequest = null;
        }
      } catch (err) {
        console.error('[error] Failed to write file:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));

        if (pendingSelectionRequest) {
          pendingSelectionRequest.writeHead(500, { 'Content-Type': 'application/json' });
          pendingSelectionRequest.end(JSON.stringify({ error: err.message }));
          pendingSelectionRequest = null;
        }
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

if (require.main === module) {
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`Port ${PORT} is already in use — receiver is already running. Nothing to do.`);
      process.exit(0);
    } else {
      console.error(`Receiver error: ${err.message}`);
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log(`Figma Bridge Receiver listening on http://localhost:${PORT}`);
    console.log(`Will write data to: ${DEST_FILE}`);
    console.log(`Open the Figlets Bridge plugin in Figma Desktop to connect.`);
  });
}

module.exports = server;

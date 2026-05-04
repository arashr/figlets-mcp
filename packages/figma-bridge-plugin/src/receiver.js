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
let pendingQaAuditRequest = null;
let pendingUpdatePrimitivesRequest = null;
let activePluginCapabilities = [];
let lastPluginSessionId = null;
let lastPluginSeenAt = 0;

const DEST_FILE_SELECTION = path.join(DEST_DIR, 'figma-selection.json');

function _getSessionId(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  return url.searchParams.get('sessionId') || req.headers['x-figlets-session'] || '';
}

function _notConnectedPayload() {
  const recentlySeen = lastPluginSeenAt && (Date.now() - lastPluginSeenAt < 60000);
  return {
    error: recentlySeen
      ? 'Figma plugin was connected recently but is not listening for a new command yet.'
      : 'Figma plugin is not connected or listening.',
    activeSessionId: pendingPollSessionId || lastPluginSessionId || null,
    lastPluginSeenAt: lastPluginSeenAt || null,
    pluginRecentlySeen: Boolean(recentlySeen),
    pluginCapabilities: recentlySeen ? activePluginCapabilities : []
  };
}

function _parseCapabilities(raw) {
  if (!raw) return [];
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

function _pluginHasCapability(name) {
  return activePluginCapabilities.indexOf(name) !== -1;
}

function _clearPendingPoll() {
  pendingPollResponse = null;
  pendingPollSessionId = null;
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

  if (req.method === 'GET' && pathname === '/health') {
    const pluginRecentlySeen = Boolean(lastPluginSeenAt && (Date.now() - lastPluginSeenAt < 60000));
    const pluginCapabilities = (pendingPollResponse || pluginRecentlySeen) ? activePluginCapabilities : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      receiver: 'running',
      pluginConnected: Boolean(pendingPollResponse),
      pluginRecentlySeen: pluginRecentlySeen,
      activeSessionId: pendingPollSessionId || lastPluginSessionId || null,
      pluginCapabilities: pluginCapabilities,
      updatePrimitivesLive: pluginCapabilities.indexOf('update-primitives') !== -1,
      dataPath: DEST_FILE,
      selectionPath: DEST_FILE_SELECTION
    }));
    return;
  }

  // 1. Figma Plugin long-polls this endpoint
  if (req.method === 'GET' && pathname === '/poll') {
    const sessionId = url.searchParams.get('sessionId') || '';
    activePluginCapabilities = _parseCapabilities(url.searchParams.get('capabilities'));
    pendingPollResponse = res;
    pendingPollSessionId = sessionId || null;
    lastPluginSessionId = pendingPollSessionId;
    lastPluginSeenAt = Date.now();
    console.log(`[poll] Plugin connected${pendingPollSessionId ? ` (${pendingPollSessionId})` : ''}`);
    
    // Keep connection alive: if no sync requested within 30 seconds, send ping
    setTimeout(() => {
      if (pendingPollResponse === res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ command: 'ping' }));
        _clearPendingPoll();
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
      _clearPendingPoll();
      
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
      _clearPendingPoll();
      
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
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      let parsed;
      try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = {}; }

      if (pendingPollResponse) {
        pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingPollResponse.end(JSON.stringify({ command: 'build-showcase', data: parsed }));
        _clearPendingPoll();

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
    });
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
        _clearPendingPoll();

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

  // 5d. MCP Agent calls this to trigger a QA binding audit
  if (req.method === 'POST' && pathname === '/request-qa-audit') {
    if (pendingPollResponse) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let qaPayload;
        try { qaPayload = JSON.parse(body); } catch { qaPayload = {}; }

        pendingQaAuditRequest = res;

        setTimeout(() => {
          if (pendingQaAuditRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'QA audit timed out' }));
            pendingQaAuditRequest = null;
          }
        }, 120000);

        pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingPollResponse.end(JSON.stringify({ command: 'qa-audit', data: qaPayload }));
        _clearPendingPoll();
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  // 5e. Figma Plugin posts the QA audit result here
  if (req.method === 'POST' && pathname === '/sync-qa-audit') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingQaAuditRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingQaAuditRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingQaAuditRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingQaAuditRequest = null;
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
        _clearPendingPoll();

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

  // 6c. MCP Agent calls this to update specific primitive categories in place
  // (e.g. only color values, only spacing). Variable IDs are preserved so all
  // aliases from higher-level collections continue to resolve.
  if (req.method === 'POST' && pathname === '/request-update-primitives') {
    if (pendingPollResponse) {
      if (!_pluginHasCapability('update-primitives')) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'The Figlets Bridge plugin is connected but does not advertise the primitive-update command. If you are developing Figlets, reload the plugin from Figma Desktop so it loads the latest local code.',
          activeSessionId: pendingPollSessionId || null,
          pluginCapabilities: activePluginCapabilities
        }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let payload;
        try { payload = JSON.parse(body); } catch { payload = {}; }

        pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingPollResponse.end(JSON.stringify({ command: 'update-primitives', data: payload }));
        _clearPendingPoll();

        pendingUpdatePrimitivesRequest = res;

        setTimeout(() => {
          if (pendingUpdatePrimitivesRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Primitive update timed out.' }));
            pendingUpdatePrimitivesRequest = null;
          }
        }, 60000);
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  // 6d. Figma Plugin posts the primitive update result here
  if (req.method === 'POST' && pathname === '/sync-update-primitives') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingUpdatePrimitivesRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingUpdatePrimitivesRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingUpdatePrimitivesRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingUpdatePrimitivesRequest = null;
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

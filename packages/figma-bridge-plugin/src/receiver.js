const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 1337;
const DEST_DIR = process.env.FIGLETS_LOCAL_DIR || path.resolve(__dirname, '../../../.local');

let pendingPollResponse = null;
let pendingPollSessionId = null;
let pendingSyncRequest = null;
let pendingSelectionRequest = null;
let pendingShowcaseRequest = null;
let pendingDsSetupRequest = null;
let pendingDocBuildRequest = null;
let pendingQaAuditRequest = null;
let pendingUpdatePrimitivesRequest = null;
let pendingSetupRepairsRequest = null;
let pendingResetRequest = null;
let pendingSyncPreviousFileKey = null;
let activePluginCapabilities = [];
let lastPluginSessionId = null;
let lastPluginSeenAt = 0;
let lastFileKey = '';

function _getFileKey(req) {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  return (url.searchParams.get('fileKey') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function _filePaths(fileKey) {
  const dir = fileKey ? path.join(DEST_DIR, fileKey) : DEST_DIR;
  return {
    dir: dir,
    data:      path.join(dir, 'figma-data.json'),
    selection: path.join(dir, 'figma-selection.json'),
  };
}

function _writeActiveFile(fileKey) {
  try {
    fs.writeFileSync(
      path.join(DEST_DIR, 'active-file.json'),
      JSON.stringify({ fileKey: fileKey || null, updatedAt: new Date().toISOString() })
    );
  } catch (_) {}
}

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
    const healthPaths = _filePaths(lastFileKey);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      receiver: 'running',
      pluginConnected: Boolean(pendingPollResponse),
      pluginRecentlySeen: pluginRecentlySeen,
      activeSessionId: pendingPollSessionId || lastPluginSessionId || null,
      activeFileKey: lastFileKey,
      pluginCapabilities: pluginCapabilities,
      updatePrimitivesLive: pluginCapabilities.indexOf('update-primitives') !== -1,
      setupRepairsLive: pluginCapabilities.indexOf('setup-repairs') !== -1,
      dataPath: healthPaths.data,
      selectionPath: healthPaths.selection
    }));
    return;
  }

  // 1. Figma Plugin long-polls this endpoint
  if (req.method === 'GET' && pathname === '/poll') {
    const sessionId = url.searchParams.get('sessionId') || '';
    const pollFileKey = _getFileKey(req);
    if (pollFileKey) lastFileKey = pollFileKey;
    activePluginCapabilities = _parseCapabilities(url.searchParams.get('capabilities'));
    pendingPollResponse = res;
    pendingPollSessionId = sessionId || null;
    lastPluginSessionId = pendingPollSessionId;
    lastPluginSeenAt = Date.now();
    console.log('[poll] Plugin connected' + (pendingPollSessionId ? ' (' + pendingPollSessionId + ')' : '') + (pollFileKey ? ' file=' + pollFileKey : ''));
    
    // Keep connection alive: if no sync requested within 30 seconds, send ping
    const pollKeepaliveTimer = setTimeout(() => {
      if (pendingPollResponse === res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ command: 'ping' }));
        _clearPendingPoll();
      }
    }, 30000);
    if (pollKeepaliveTimer.unref) pollKeepaliveTimer.unref();
    return;
  }

  // 2. MCP Agent calls this to trigger a global sync
  if (req.method === 'POST' && pathname === '/request-sync') {
    if (pendingPollResponse) {
      pendingSyncPreviousFileKey = lastFileKey || '';
      // Tell Figma to wake up and extract everything
      pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
      pendingPollResponse.end(JSON.stringify({ command: 'extract-all' }));
      _clearPendingPoll();
      
      // Hold the agent's request open until Figma posts the payload back
      pendingSyncRequest = res;
      
      // Timeout after 60 seconds if Figma doesn't respond
      const syncTimer = setTimeout(() => {
        if (pendingSyncRequest === res) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Sync timed out' }));
          pendingSyncRequest = null;
        }
      }, 60000);
      if (syncTimer.unref) syncTimer.unref();
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
      
      const selectionTimer = setTimeout(() => {
        if (pendingSelectionRequest === res) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Selection sync timed out' }));
          pendingSelectionRequest = null;
        }
      }, 15000); // Selection is usually very fast
      if (selectionTimer.unref) selectionTimer.unref();
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

        const showcaseTimer = setTimeout(() => {
          if (pendingShowcaseRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Showcase build timed out' }));
            pendingShowcaseRequest = null;
          }
        }, 120000); // Showcase can take a while
        if (showcaseTimer.unref) showcaseTimer.unref();
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

        const docTimer = setTimeout(() => {
          if (pendingDocBuildRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Doc build timed out' }));
            pendingDocBuildRequest = null;
          }
        }, 120000);
        if (docTimer.unref) docTimer.unref();
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

        const qaTimer = setTimeout(() => {
          if (pendingQaAuditRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'QA audit timed out' }));
            pendingQaAuditRequest = null;
          }
        }, 120000);
        if (qaTimer.unref) qaTimer.unref();

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

        const dsSetupTimer = setTimeout(() => {
          if (pendingDsSetupRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'DS setup timed out — building variables can take up to 3 minutes for large systems.' }));
            pendingDsSetupRequest = null;
          }
        }, 180000); // 3 minutes for large systems
        if (dsSetupTimer.unref) dsSetupTimer.unref();
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

        const updatePrimitivesTimer = setTimeout(() => {
          if (pendingUpdatePrimitivesRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Primitive update timed out.' }));
            pendingUpdatePrimitivesRequest = null;
          }
        }, 60000);
        if (updatePrimitivesTimer.unref) updatePrimitivesTimer.unref();
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  // 6e. MCP Agent calls this to apply designer-approved setup repairs.
  if (req.method === 'POST' && pathname === '/request-setup-repairs') {
    if (pendingPollResponse) {
      if (!_pluginHasCapability('setup-repairs')) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'The Figlets Bridge plugin is connected but does not advertise the setup-repairs command. Reload the plugin in Figma Desktop so it loads the latest local code.',
          activeSessionId: pendingPollSessionId || null,
          pluginCapabilities: activePluginCapabilities
        }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let payload;
        try { payload = body ? JSON.parse(body) : {}; } catch { payload = {}; }

        pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingPollResponse.end(JSON.stringify({ command: 'apply-setup-repairs', data: payload }));
        _clearPendingPoll();

        pendingSetupRepairsRequest = res;

        const setupRepairTimer = setTimeout(() => {
          if (pendingSetupRepairsRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Setup repair timed out.' }));
            pendingSetupRepairsRequest = null;
          }
        }, 60000);
        if (setupRepairTimer.unref) setupRepairTimer.unref();
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/sync-setup-repairs') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingSetupRepairsRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingSetupRepairsRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingSetupRepairsRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingSetupRepairsRequest = null;
      }
    });
    return;
  }

  // 6g. MCP Agent calls this to reset local Figlets-created file content.
  if (req.method === 'POST' && pathname === '/request-reset-figlets-file') {
    if (pendingPollResponse) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let payload;
        try { payload = body ? JSON.parse(body) : {}; } catch { payload = {}; }

        pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingPollResponse.end(JSON.stringify({ command: 'reset-figlets-file', data: payload }));
        _clearPendingPoll();

        pendingResetRequest = res;

        const resetTimer = setTimeout(() => {
          if (pendingResetRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Reset timed out.' }));
            pendingResetRequest = null;
          }
        }, 60000);
        if (resetTimer.unref) resetTimer.unref();
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/sync-reset-figlets-file') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingResetRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingResetRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingResetRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingResetRequest = null;
      }
    });
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
      const fp = _filePaths(_getFileKey(req));
      const fileKey = _getFileKey(req);
      try {
        fs.mkdirSync(fp.dir, { recursive: true });
        fs.writeFileSync(fp.data, body);
        console.log('[success] Wrote payload to ' + fp.data);

        _writeActiveFile(fileKey);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, fileKey: fileKey || null, dataPath: fp.data }));

        if (pendingSyncRequest) {
          pendingSyncRequest.writeHead(200, { 'Content-Type': 'application/json' });
          pendingSyncRequest.end(JSON.stringify({
            success: true,
            message: 'Sync complete',
            sessionId: _getSessionId(req) || null,
            fileKey: fileKey || null,
            previousFileKey: pendingSyncPreviousFileKey || null,
            activeFileChanged: Boolean(pendingSyncPreviousFileKey && fileKey && pendingSyncPreviousFileKey !== fileKey),
            dataPath: fp.data
          }));
          pendingSyncRequest = null;
          pendingSyncPreviousFileKey = null;
        }
      } catch (err) {
        console.error('[error] Failed to write file:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));

        if (pendingSyncRequest) {
          pendingSyncRequest.writeHead(500, { 'Content-Type': 'application/json' });
          pendingSyncRequest.end(JSON.stringify({ error: err.message }));
          pendingSyncRequest = null;
          pendingSyncPreviousFileKey = null;
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
      const fp = _filePaths(_getFileKey(req));
      try {
        fs.mkdirSync(fp.dir, { recursive: true });
        fs.writeFileSync(fp.selection, body);
        console.log('[success] Wrote selection to ' + fp.selection);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));

        if (pendingSelectionRequest) {
          pendingSelectionRequest.writeHead(200, { 'Content-Type': 'application/json' });
          pendingSelectionRequest.end(JSON.stringify({ success: true, message: 'Selection synced', path: fp.selection, sessionId: _getSessionId(req) || null }));
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
    console.log('Figma Bridge Receiver listening on http://localhost:' + PORT);
    console.log('Will write data to: ' + path.join(DEST_DIR, '<fileKey>/figma-data.json'));
    console.log('Open the Figlets Bridge plugin in Figma Desktop to connect.');
  });
}

module.exports = server;

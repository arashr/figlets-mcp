const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 17337;
const PORT = Number(process.env.FIGLETS_RECEIVER_PORT || DEFAULT_PORT);
const DEST_DIR = process.env.FIGLETS_LOCAL_DIR || path.resolve(__dirname, '../../../.local');
const POLL_WAIT_TIMEOUT_MS = Number(process.env.FIGLETS_RECEIVER_POLL_WAIT_MS || 5000);

function _devBridgeCommandsEnabled() {
  const raw = String(process.env.FIGLETS_DEV_BRIDGE || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

let pendingPollResponse = null;
let pendingPollSessionId = null;
let pendingSyncRequest = null;
let pendingSelectionRequest = null;
let pendingShowcaseRequest = null;
let pendingDsSetupRequest = null;
let pendingDocBuildRequest = null;
let pendingQaAuditRequest = null;
let pendingUpdatePrimitivesRequest = null;
let pendingUpdateTokensRequest = null;
let pendingSetupRepairsRequest = null;
let pendingSemanticNamingConsolidationRequest = null;
let pendingFoundationRepairsRequest = null;
let pendingResetRequest = null;
let pendingRemoveTextStylesRequest = null;
let pendingTrimCollectionModesRequest = null;
let pendingBrokenDsFixtureRequest = null;
let pendingPollWait = null;
let pendingSyncPreviousFileKey = null;
let activePluginCapabilities = [];
let lastPluginSessionId = null;
let lastPluginSeenAt = 0;
let lastFileKey = '';

function _getFileKey(req) {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  return (url.searchParams.get('fileKey') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function _sanitizeFileKey(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function _readActiveFileKeyFromDisk() {
  try {
    const activePath = path.join(DEST_DIR, 'active-file.json');
    if (!fs.existsSync(activePath)) return '';
    const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
    return _sanitizeFileKey(active && active.fileKey);
  } catch (_) {
    return '';
  }
}

function _resolveFileKeyFromFileName(fileName) {
  const normalized = String(fileName || '').trim();
  if (!normalized) return '';
  try {
    const matches = [];
    for (const entry of fs.readdirSync(DEST_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidateKey = _sanitizeFileKey(entry.name);
      if (!candidateKey) continue;
      const dataPath = path.join(DEST_DIR, candidateKey, 'figma-data.json');
      if (!fs.existsSync(dataPath)) continue;
      let snapshot = null;
      try { snapshot = JSON.parse(fs.readFileSync(dataPath, 'utf8')); } catch (_) { continue; }
      if (snapshot && snapshot.fileName === normalized) matches.push(candidateKey);
    }
    if (matches.length === 1) return matches[0];
  } catch (_) {}
  return '';
}

function _resolveFileKey(req, parsedBody) {
  const fromQuery = _getFileKey(req);
  if (fromQuery) return fromQuery;
  const fromPayload = _sanitizeFileKey(parsedBody && parsedBody.fileKey);
  if (fromPayload) return fromPayload;
  const fromFileName = _resolveFileKeyFromFileName(parsedBody && parsedBody.fileName);
  if (fromFileName) return fromFileName;
  if (lastFileKey) return lastFileKey;
  return _readActiveFileKeyFromDisk() || '';
}

function _persistSessionFileKey(req, parsedBody) {
  const fileKey = _resolveFileKey(req, parsedBody);
  if (fileKey) {
    lastFileKey = fileKey;
    _writeActiveFile(fileKey);
  }
  return fileKey;
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
  const resolved = _sanitizeFileKey(fileKey) || lastFileKey || _readActiveFileKeyFromDisk();
  if (!resolved) return;
  lastFileKey = resolved;
  try {
    fs.writeFileSync(
      path.join(DEST_DIR, 'active-file.json'),
      JSON.stringify({ fileKey: resolved, updatedAt: new Date().toISOString() })
    );
  } catch (_) {}
}

function _getSessionId(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  return url.searchParams.get('sessionId') || req.headers['x-figlets-session'] || '';
}

function _notConnectedPayload() {
  const recentlySeen = _pluginRecentlySeen();
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

function _pluginRecentlySeen() {
  return Boolean(lastPluginSeenAt && (Date.now() - lastPluginSeenAt < 60000));
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

function _sendNotConnected(res) {
  res.writeHead(503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(_notConnectedPayload()));
}

function _dispatchOrWaitForPoll(res, dispatch) {
  if (pendingPollResponse) {
    dispatch();
    return true;
  }

  if (!_pluginRecentlySeen()) {
    return false;
  }

  if (pendingPollWait) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Figma plugin was connected recently, and another command is already waiting for the plugin to listen again.',
      activeSessionId: pendingPollSessionId || lastPluginSessionId || null,
      lastPluginSeenAt: lastPluginSeenAt || null,
      pluginRecentlySeen: true,
      pluginCapabilities: activePluginCapabilities
    }));
    return true;
  }

  const timer = setTimeout(() => {
    if (pendingPollWait && pendingPollWait.res === res) {
      pendingPollWait = null;
      _sendNotConnected(res);
    }
  }, POLL_WAIT_TIMEOUT_MS);
  if (timer.unref) timer.unref();

  pendingPollWait = { res: res, dispatch: dispatch, timer: timer };
  return true;
}

function _flushPendingPollWait() {
  if (!pendingPollWait || !pendingPollResponse) return false;
  const wait = pendingPollWait;
  pendingPollWait = null;
  clearTimeout(wait.timer);
  wait.dispatch();
  return true;
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
    const pluginRecentlySeen = _pluginRecentlySeen();
    const pluginCapabilities = (pendingPollResponse || pluginRecentlySeen) ? activePluginCapabilities : [];
    const healthPaths = _filePaths(lastFileKey);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      receiver: 'running',
      devBridgeEnabled: _devBridgeCommandsEnabled(),
      pluginConnected: Boolean(pendingPollResponse),
      pluginRecentlySeen: pluginRecentlySeen,
      activeSessionId: pendingPollSessionId || lastPluginSessionId || null,
      activeFileKey: lastFileKey,
      pluginCapabilities: pluginCapabilities,
      updatePrimitivesLive: pluginCapabilities.indexOf('update-primitives') !== -1,
      updateTokensLive: pluginCapabilities.indexOf('update-tokens') !== -1,
      setupRepairsLive: pluginCapabilities.indexOf('setup-repairs') !== -1,
      semanticNamingConsolidationLive: pluginCapabilities.indexOf('semantic-naming-consolidation') !== -1,
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

    if (_flushPendingPollWait()) {
      return;
    }
    
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
    if (_dispatchOrWaitForPoll(res, () => {
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
    })) return;
    _sendNotConnected(res);
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
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      let docPayload;
      try { docPayload = JSON.parse(body); } catch { docPayload = {}; }

      if (_dispatchOrWaitForPoll(res, () => {
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
      })) return;
      _sendNotConnected(res);
    });
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

  // 6d. MCP Agent calls this to apply approved narrow token updates in place.
  if (req.method === 'POST' && pathname === '/request-update-tokens') {
    if (pendingPollResponse) {
      if (!_pluginHasCapability('update-tokens')) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'The Figlets Bridge plugin is connected but does not advertise the token-update command. Reload the plugin in Figma Desktop so it loads the latest local code.',
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
        pendingPollResponse.end(JSON.stringify({ command: 'update-tokens', data: payload }));
        _clearPendingPoll();

        pendingUpdateTokensRequest = res;

        const updateTokensTimer = setTimeout(() => {
          if (pendingUpdateTokensRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Token update timed out.' }));
            pendingUpdateTokensRequest = null;
          }
        }, 60000);
        if (updateTokensTimer.unref) updateTokensTimer.unref();
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  // 6e. MCP Agent calls this to apply designer-approved setup repairs.
  if (req.method === 'POST' && pathname === '/request-foundation-repairs') {
    if (pendingPollResponse) {
      if (!_pluginHasCapability('foundation-repairs')) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'The Figlets Bridge plugin is connected but does not advertise the foundation-repairs command. Reload the plugin in Figma Desktop so it loads the latest local code.',
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
        pendingPollResponse.end(JSON.stringify({ command: 'apply-foundation-repairs', data: payload }));
        _clearPendingPoll();

        pendingFoundationRepairsRequest = res;

        const foundationRepairTimer = setTimeout(() => {
          if (pendingFoundationRepairsRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Foundation repair timed out.' }));
            pendingFoundationRepairsRequest = null;
          }
        }, 60000);
        if (foundationRepairTimer.unref) foundationRepairTimer.unref();
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/sync-foundation-repairs') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingFoundationRepairsRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingFoundationRepairsRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingFoundationRepairsRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingFoundationRepairsRequest = null;
      }
    });
    return;
  }

  // 6f. MCP Agent calls this to apply designer-approved setup repairs.
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
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }
      _persistSessionFileKey(req, parsed);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingSetupRepairsRequest) {
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingSetupRepairsRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingSetupRepairsRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingSetupRepairsRequest = null;
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/request-semantic-naming-consolidation') {
    if (pendingPollResponse) {
      if (!_pluginHasCapability('semantic-naming-consolidation')) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'The Figlets Bridge plugin is connected but does not advertise semantic naming consolidation. Reload the plugin in Figma Desktop so it loads the latest local code.',
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
        pendingPollResponse.end(JSON.stringify({ command: 'apply-semantic-naming-consolidation', data: payload }));
        _clearPendingPoll();

        pendingSemanticNamingConsolidationRequest = res;

        const semanticNamingTimer = setTimeout(() => {
          if (pendingSemanticNamingConsolidationRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Semantic naming consolidation timed out.' }));
            pendingSemanticNamingConsolidationRequest = null;
          }
        }, 60000);
        if (semanticNamingTimer.unref) semanticNamingTimer.unref();
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/sync-semantic-naming-consolidation') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }
      _persistSessionFileKey(req, parsed);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingSemanticNamingConsolidationRequest) {
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingSemanticNamingConsolidationRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingSemanticNamingConsolidationRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingSemanticNamingConsolidationRequest = null;
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

  if (req.method === 'POST' && pathname === '/request-remove-text-styles') {
    if (!_devBridgeCommandsEnabled()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'remove-text-styles is a developer-only bridge command and is disabled for designer flows.',
        hint: 'Set FIGLETS_DEV_BRIDGE=1 on the bridge receiver process for local validation scripts only.',
      }));
      return;
    }
    if (pendingPollResponse) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let payload;
        try { payload = body ? JSON.parse(body) : {}; } catch { payload = {}; }

        pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingPollResponse.end(JSON.stringify({ command: 'remove-text-styles', data: payload }));
        _clearPendingPoll();

        pendingRemoveTextStylesRequest = res;

        const removeTimer = setTimeout(() => {
          if (pendingRemoveTextStylesRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Text-style removal timed out.' }));
            pendingRemoveTextStylesRequest = null;
          }
        }, 30000);
        if (removeTimer.unref) removeTimer.unref();
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/sync-remove-text-styles') {
    if (!_devBridgeCommandsEnabled()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'remove-text-styles sync is disabled outside developer bridge mode.' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingRemoveTextStylesRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingRemoveTextStylesRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingRemoveTextStylesRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingRemoveTextStylesRequest = null;
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/request-trim-collection-modes') {
    if (!_devBridgeCommandsEnabled()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'trim-collection-modes is a developer-only bridge command and is disabled for designer flows.',
        hint: 'Set FIGLETS_DEV_BRIDGE=1 on the bridge receiver process for local validation scripts only.',
      }));
      return;
    }
    if (pendingPollResponse) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let payload;
        try { payload = body ? JSON.parse(body) : {}; } catch { payload = {}; }

        pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingPollResponse.end(JSON.stringify({ command: 'trim-collection-modes', data: payload }));
        _clearPendingPoll();

        pendingTrimCollectionModesRequest = res;

        const trimTimer = setTimeout(() => {
          if (pendingTrimCollectionModesRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Collection mode trim timed out.' }));
            pendingTrimCollectionModesRequest = null;
          }
        }, 30000);
        if (trimTimer.unref) trimTimer.unref();
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/sync-trim-collection-modes') {
    if (!_devBridgeCommandsEnabled()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'trim-collection-modes sync is disabled outside developer bridge mode.' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingTrimCollectionModesRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingTrimCollectionModesRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingTrimCollectionModesRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingTrimCollectionModesRequest = null;
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/request-prepare-broken-ds-fixture') {
    if (!_devBridgeCommandsEnabled()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'prepare-broken-ds-fixture is a developer-only bridge command and is disabled for designer flows.',
        hint: 'Set FIGLETS_DEV_BRIDGE=1 on the bridge receiver process for local validation scripts only.',
      }));
      return;
    }
    if (pendingPollResponse) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let payload;
        try { payload = body ? JSON.parse(body) : {}; } catch { payload = {}; }
        if (payload.confirmation !== 'RESET_AND_BREAK_DISPOSABLE_FIGMA_FILE') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Explicit confirmation is required before preparing a broken fixture.',
            requiredConfirmation: 'RESET_AND_BREAK_DISPOSABLE_FIGMA_FILE',
          }));
          return;
        }

        pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingPollResponse.end(JSON.stringify({ command: 'prepare-broken-ds-fixture', data: payload }));
        _clearPendingPoll();

        pendingBrokenDsFixtureRequest = res;

        const fixtureTimer = setTimeout(() => {
          if (pendingBrokenDsFixtureRequest === res) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Broken fixture prep timed out.' }));
            pendingBrokenDsFixtureRequest = null;
          }
        }, 185000);
        if (fixtureTimer.unref) fixtureTimer.unref();
      });
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_notConnectedPayload()));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/sync-prepare-broken-ds-fixture') {
    if (!_devBridgeCommandsEnabled()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'prepare-broken-ds-fixture sync is disabled outside developer bridge mode.' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingBrokenDsFixtureRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingBrokenDsFixtureRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingBrokenDsFixtureRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingBrokenDsFixtureRequest = null;
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

  // 6f. Figma Plugin posts the token update result here
  if (req.method === 'POST' && pathname === '/sync-update-tokens') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      if (pendingUpdateTokensRequest) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
        pendingUpdateTokensRequest.writeHead(200, { 'Content-Type': 'application/json' });
        pendingUpdateTokensRequest.end(JSON.stringify({ success: true, result: parsed }));
        pendingUpdateTokensRequest = null;
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
      let parsedBody = null;
      try { parsedBody = body ? JSON.parse(body) : null; } catch (_) { parsedBody = null; }
      const fileKey = _persistSessionFileKey(req, parsedBody);
      const fp = _filePaths(fileKey);
      try {
        fs.mkdirSync(fp.dir, { recursive: true });
        fs.writeFileSync(fp.data, body);
        console.log('[success] Wrote payload to ' + fp.data);

        if (fileKey) _writeActiveFile(fileKey);

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
      let parsedBody = null;
      try { parsedBody = body ? JSON.parse(body) : null; } catch (_) { parsedBody = null; }
      const fileKey = _persistSessionFileKey(req, parsedBody);
      const fp = _filePaths(fileKey);
      try {
        fs.mkdirSync(fp.dir, { recursive: true });
        fs.writeFileSync(fp.selection, body);
        console.log('[success] Wrote selection to ' + fp.selection);
        if (fileKey) _writeActiveFile(fileKey);

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

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
let pendingFigmaOperationsRequest = null;
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

  if (pendingPollWait) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Another command is already waiting for the plugin to listen again.',
      activeSessionId: pendingPollSessionId || lastPluginSessionId || null,
      lastPluginSeenAt: lastPluginSeenAt || null,
      pluginRecentlySeen: Boolean(_pluginRecentlySeen()),
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

function _readJsonBody(req, callback) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    let parsed;
    try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = {}; }
    callback(parsed, body);
  });
}

function _sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function _setPendingTimeout(route, res) {
  const timer = setTimeout(() => {
    if (route.getPending() === res) {
      _sendJson(res, 504, { error: route.timeoutError });
      route.setPending(null);
    }
  }, route.timeoutMs);
  if (timer.unref) timer.unref();
}

function _sendCapabilityMissing(res, route) {
  _sendJson(res, 409, {
    error: route.capabilityError,
    activeSessionId: pendingPollSessionId || null,
    pluginCapabilities: activePluginCapabilities
  });
}

function _sendDevBridgeDisabled(res, route, sync) {
  const payload = { error: sync ? route.devSyncError : route.devRequestError };
  if (!sync && route.devHint) payload.hint = route.devHint;
  _sendJson(res, 404, payload);
}

function _dispatchBridgeCommand(route, res, payload) {
  const dispatch = () => {
    if (route.capability && !_pluginHasCapability(route.capability)) {
      _sendCapabilityMissing(res, route);
      return;
    }

    route.setPending(res);
    _setPendingTimeout(route, res);

    pendingPollResponse.writeHead(200, { 'Content-Type': 'application/json' });
    pendingPollResponse.end(JSON.stringify({ command: route.command, data: payload }));
    _clearPendingPoll();
  };

  _dispatchOrWaitForPoll(res, dispatch);
}

function _handleBridgeCommandRequest(route, req, res) {
  if (route.devOnly && !_devBridgeCommandsEnabled()) {
    _sendDevBridgeDisabled(res, route, false);
    return;
  }

  _readJsonBody(req, payload => {
    if (route.validatePayload && !route.validatePayload(payload, res)) return;
    _dispatchBridgeCommand(route, res, payload);
  });
}

function _handleBridgeCommandSync(route, req, res) {
  if (route.devOnly && !_devBridgeCommandsEnabled()) {
    _sendDevBridgeDisabled(res, route, true);
    return;
  }

  _readJsonBody(req, parsed => {
    if (route.persistFileKey) _persistSessionFileKey(req, parsed);
    _sendJson(res, 200, { success: true });

    const pending = route.getPending();
    if (pending) {
      parsed.sessionId = parsed.sessionId || _getSessionId(req) || null;
      pending.writeHead(200, { 'Content-Type': 'application/json' });
      pending.end(JSON.stringify({ success: true, result: parsed }));
      route.setPending(null);
    }
  });
}

function _handlePersistedPluginSync(req, res, options) {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  req.on('end', () => {
    let parsedBody = null;
    try { parsedBody = body ? JSON.parse(body) : null; } catch (_) { parsedBody = null; }
    const fileKey = _persistSessionFileKey(req, parsedBody);
    const fp = _filePaths(fileKey);
    const writePath = fp[options.pathKey];
    try {
      fs.mkdirSync(fp.dir, { recursive: true });
      fs.writeFileSync(writePath, body);
      console.log('[success] Wrote ' + options.logLabel + ' to ' + writePath);

      if (fileKey) _writeActiveFile(fileKey);

      _sendJson(res, 200, options.ackPayload(fileKey, fp));

      const pending = options.getPending();
      if (pending) {
        pending.writeHead(200, { 'Content-Type': 'application/json' });
        pending.end(JSON.stringify(options.pendingPayload(req, fileKey, fp)));
        options.clearPending();
      }
    } catch (err) {
      console.error('[error] Failed to write file:', err);
      _sendJson(res, 500, { error: err.message });

      const pending = options.getPending();
      if (pending) {
        pending.writeHead(500, { 'Content-Type': 'application/json' });
        pending.end(JSON.stringify({ error: err.message }));
        options.clearPending();
      }
    }
  });
}

function _pendingAccessors(getter, setter) {
  return { getPending: getter, setPending: setter };
}

const DEV_BRIDGE_HINT = 'Set FIGLETS_DEV_BRIDGE=1 on the bridge receiver process for local validation scripts only.';
const BRIDGE_COMMAND_ROUTES = [
  Object.assign({
    requestPath: '/request-showcase',
    syncPath: '/sync-showcase',
    command: 'build-showcase',
    timeoutMs: 120000,
    timeoutError: 'Showcase build timed out',
  }, _pendingAccessors(() => pendingShowcaseRequest, value => { pendingShowcaseRequest = value; })),
  Object.assign({
    requestPath: '/request-doc-build',
    syncPath: '/sync-doc-build',
    command: 'build-doc',
    waitForPoll: true,
    timeoutMs: 120000,
    timeoutError: 'Doc build timed out',
  }, _pendingAccessors(() => pendingDocBuildRequest, value => { pendingDocBuildRequest = value; })),
  Object.assign({
    requestPath: '/request-qa-audit',
    syncPath: '/sync-qa-audit',
    command: 'qa-audit',
    waitForPoll: true,
    timeoutMs: 120000,
    timeoutError: 'QA audit timed out',
  }, _pendingAccessors(() => pendingQaAuditRequest, value => { pendingQaAuditRequest = value; })),
  Object.assign({
    requestPath: '/request-ds-setup',
    syncPath: '/sync-ds-setup',
    command: 'apply-ds-setup',
    timeoutMs: 180000,
    timeoutError: 'DS setup timed out — building variables can take up to 3 minutes for large systems.',
  }, _pendingAccessors(() => pendingDsSetupRequest, value => { pendingDsSetupRequest = value; })),
  Object.assign({
    requestPath: '/request-update-primitives',
    syncPath: '/sync-update-primitives',
    command: 'update-primitives',
    capability: 'update-primitives',
    capabilityError: 'The Figlets Bridge plugin is connected but does not advertise the primitive-update command. If you are developing Figlets, reload the plugin from Figma Desktop so it loads the latest local code.',
    timeoutMs: 60000,
    timeoutError: 'Primitive update timed out.',
  }, _pendingAccessors(() => pendingUpdatePrimitivesRequest, value => { pendingUpdatePrimitivesRequest = value; })),
  Object.assign({
    requestPath: '/request-update-tokens',
    syncPath: '/sync-update-tokens',
    command: 'update-tokens',
    capability: 'update-tokens',
    capabilityError: 'The Figlets Bridge plugin is connected but does not advertise the token-update command. Reload the plugin in Figma Desktop so it loads the latest local code.',
    timeoutMs: 60000,
    timeoutError: 'Token update timed out.',
  }, _pendingAccessors(() => pendingUpdateTokensRequest, value => { pendingUpdateTokensRequest = value; })),
  Object.assign({
    requestPath: '/request-foundation-repairs',
    syncPath: '/sync-foundation-repairs',
    command: 'apply-foundation-repairs',
    capability: 'foundation-repairs',
    capabilityError: 'The Figlets Bridge plugin is connected but does not advertise the foundation-repairs command. Reload the plugin in Figma Desktop so it loads the latest local code.',
    timeoutMs: 60000,
    timeoutError: 'Foundation repair timed out.',
  }, _pendingAccessors(() => pendingFoundationRepairsRequest, value => { pendingFoundationRepairsRequest = value; })),
  Object.assign({
    requestPath: '/request-setup-repairs',
    syncPath: '/sync-setup-repairs',
    command: 'apply-setup-repairs',
    capability: 'setup-repairs',
    capabilityError: 'The Figlets Bridge plugin is connected but does not advertise the setup-repairs command. Reload the plugin in Figma Desktop so it loads the latest local code.',
    persistFileKey: true,
    timeoutMs: 60000,
    timeoutError: 'Setup repair timed out.',
  }, _pendingAccessors(() => pendingSetupRepairsRequest, value => { pendingSetupRepairsRequest = value; })),
  Object.assign({
    requestPath: '/request-semantic-naming-consolidation',
    syncPath: '/sync-semantic-naming-consolidation',
    command: 'apply-semantic-naming-consolidation',
    capability: 'semantic-naming-consolidation',
    capabilityError: 'The Figlets Bridge plugin is connected but does not advertise semantic naming consolidation. Reload the plugin in Figma Desktop so it loads the latest local code.',
    persistFileKey: true,
    timeoutMs: 60000,
    timeoutError: 'Semantic naming consolidation timed out.',
  }, _pendingAccessors(() => pendingSemanticNamingConsolidationRequest, value => { pendingSemanticNamingConsolidationRequest = value; })),
  Object.assign({
    requestPath: '/request-figma-operations',
    syncPath: '/sync-figma-operations',
    command: 'apply-figma-operations',
    capability: 'figma-operations',
    capabilityError: 'The Figlets Bridge plugin is connected but does not advertise high-level Figma operations. Reload the plugin in Figma Desktop so it loads the latest local code.',
    persistFileKey: true,
    timeoutMs: 60000,
    timeoutError: 'Figma operations timed out.',
  }, _pendingAccessors(() => pendingFigmaOperationsRequest, value => { pendingFigmaOperationsRequest = value; })),
  Object.assign({
    requestPath: '/request-reset-figlets-file',
    syncPath: '/sync-reset-figlets-file',
    command: 'reset-figlets-file',
    timeoutMs: 60000,
    timeoutError: 'Reset timed out.',
  }, _pendingAccessors(() => pendingResetRequest, value => { pendingResetRequest = value; })),
  Object.assign({
    requestPath: '/request-remove-text-styles',
    syncPath: '/sync-remove-text-styles',
    command: 'remove-text-styles',
    devOnly: true,
    devRequestError: 'remove-text-styles is a developer-only bridge command and is disabled for designer flows.',
    devSyncError: 'remove-text-styles sync is disabled outside developer bridge mode.',
    devHint: DEV_BRIDGE_HINT,
    timeoutMs: 30000,
    timeoutError: 'Text-style removal timed out.',
  }, _pendingAccessors(() => pendingRemoveTextStylesRequest, value => { pendingRemoveTextStylesRequest = value; })),
  Object.assign({
    requestPath: '/request-trim-collection-modes',
    syncPath: '/sync-trim-collection-modes',
    command: 'trim-collection-modes',
    devOnly: true,
    devRequestError: 'trim-collection-modes is a developer-only bridge command and is disabled for designer flows.',
    devSyncError: 'trim-collection-modes sync is disabled outside developer bridge mode.',
    devHint: DEV_BRIDGE_HINT,
    timeoutMs: 30000,
    timeoutError: 'Collection mode trim timed out.',
  }, _pendingAccessors(() => pendingTrimCollectionModesRequest, value => { pendingTrimCollectionModesRequest = value; })),
  Object.assign({
    requestPath: '/request-prepare-broken-ds-fixture',
    syncPath: '/sync-prepare-broken-ds-fixture',
    command: 'prepare-broken-ds-fixture',
    devOnly: true,
    devRequestError: 'prepare-broken-ds-fixture is a developer-only bridge command and is disabled for designer flows.',
    devSyncError: 'prepare-broken-ds-fixture sync is disabled outside developer bridge mode.',
    devHint: DEV_BRIDGE_HINT,
    timeoutMs: 185000,
    timeoutError: 'Broken fixture prep timed out.',
    validatePayload(payload, res) {
      if (payload.confirmation === 'RESET_AND_BREAK_DISPOSABLE_FIGMA_FILE') return true;
      _sendJson(res, 400, {
        error: 'Explicit confirmation is required before preparing a broken fixture.',
        requiredConfirmation: 'RESET_AND_BREAK_DISPOSABLE_FIGMA_FILE',
      });
      return false;
    }
  }, _pendingAccessors(() => pendingBrokenDsFixtureRequest, value => { pendingBrokenDsFixtureRequest = value; })),
];

function _bridgeRouteForRequest(pathname) {
  return BRIDGE_COMMAND_ROUTES.find(route => route.requestPath === pathname) || null;
}

function _bridgeRouteForSync(pathname) {
  return BRIDGE_COMMAND_ROUTES.find(route => route.syncPath === pathname) || null;
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
      figmaOperationsLive: pluginCapabilities.indexOf('figma-operations') !== -1,
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
    if (_dispatchOrWaitForPoll(res, () => {
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
    })) return;
    _sendNotConnected(res);
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

  const bridgeRequestRoute = _bridgeRouteForRequest(pathname);
  if (req.method === 'POST' && bridgeRequestRoute) {
    _handleBridgeCommandRequest(bridgeRequestRoute, req, res);
    return;
  }

  const bridgeSyncRoute = _bridgeRouteForSync(pathname);
  if (req.method === 'POST' && bridgeSyncRoute) {
    _handleBridgeCommandSync(bridgeSyncRoute, req, res);
    return;
  }

  // 7. Figma Plugin posts the global extracted data here
  if (req.method === 'POST' && pathname === '/sync') {
    _handlePersistedPluginSync(req, res, {
      pathKey: 'data',
      logLabel: 'payload',
      getPending: () => pendingSyncRequest,
      clearPending: () => {
        pendingSyncRequest = null;
        pendingSyncPreviousFileKey = null;
      },
      ackPayload: (fileKey, fp) => ({ success: true, fileKey: fileKey || null, dataPath: fp.data }),
      pendingPayload: (syncReq, fileKey, fp) => ({
        success: true,
        message: 'Sync complete',
        sessionId: _getSessionId(syncReq) || null,
        fileKey: fileKey || null,
        previousFileKey: pendingSyncPreviousFileKey || null,
        activeFileChanged: Boolean(pendingSyncPreviousFileKey && fileKey && pendingSyncPreviousFileKey !== fileKey),
        dataPath: fp.data
      })
    });
    return;
  }

  // 8. Figma Plugin posts the selection data here
  if (req.method === 'POST' && pathname === '/sync-selection') {
    _handlePersistedPluginSync(req, res, {
      pathKey: 'selection',
      logLabel: 'selection',
      getPending: () => pendingSelectionRequest,
      clearPending: () => {
        pendingSelectionRequest = null;
      },
      ackPayload: () => ({ success: true }),
      pendingPayload: (syncReq, fileKey, fp) => ({
        success: true,
        message: 'Selection synced',
        path: fp.selection,
        sessionId: _getSessionId(syncReq) || null
      })
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

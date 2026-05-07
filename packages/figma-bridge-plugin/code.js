figma.showUI(__html__, { width: 320, height: 420, themeColors: true });

var _sessionLog = [];
var _sessionId = 'figlets-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

function _sanitizeFileKey(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function _makeLocalFileKey() {
  return 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function _getFigletsFileKey() {
  var realKey = _sanitizeFileKey(figma.fileKey || '');
  if (realKey) return realKey;

  try {
    var stored = _sanitizeFileKey(figma.root.getPluginData('figletsFileKey'));
    if (stored) return stored;

    var localKey = _makeLocalFileKey();
    figma.root.setPluginData('figletsFileKey', localKey);
    return localKey;
  } catch (e) {
    return '';
  }
}

function _appendSessionLog(message) {
  var entry = {
    ts: Date.now(),
    message: message
  };
  _sessionLog.push(entry);
  console.log("[figlets] log", JSON.stringify(entry));
  figma.ui.postMessage({ type: "session-log-entry", data: entry });
}

var _selectionCache = {
  current: {
    nodes: [],
    fileName: "",
    pageId: null,
    pageName: "",
    ts: 0,
    source: "startup"
  },
  lastNonEmpty: {
    nodes: [],
    fileName: "",
    pageId: null,
    pageName: "",
    ts: 0,
    source: "startup"
  }
};

function _selectionDebug(snapshot) {
  return {
    count: snapshot.nodes.length,
    names: snapshot.nodes.map(function(node) { return node.name; }),
    ids: snapshot.nodes.map(function(node) { return node.id; }),
    types: snapshot.nodes.map(function(node) { return node.type; }),
    fileName: snapshot.fileName,
    pageId: snapshot.pageId,
    pageName: snapshot.pageName,
    source: snapshot.source,
    ts: snapshot.ts
  };
}

function _captureSelectionSnapshot(source) {
  var selection = [];
  if (figma.currentPage && figma.currentPage.selection) {
    selection = figma.currentPage.selection.slice();
  }

  var snapshot = {
    nodes: selection,
    fileName: figma.root ? figma.root.name : "",
    pageId: figma.currentPage ? figma.currentPage.id : null,
    pageName: figma.currentPage ? figma.currentPage.name : "",
    ts: Date.now(),
    source: source || "unknown"
  };

  _selectionCache.current = snapshot;
  if (selection.length > 0) {
    _selectionCache.lastNonEmpty = snapshot;
  }

  console.log("[figlets] selection snapshot", JSON.stringify(_selectionDebug(snapshot)));
  figma.ui.postMessage({
    type: "selection-state",
      data: {
        count: snapshot.nodes.length,
        fileName: snapshot.fileName,
        pageName: snapshot.pageName,
        source: snapshot.source,
        names: snapshot.nodes.map(function(node) { return node.name; }),
      types: snapshot.nodes.map(function(node) { return node.type; })
    }
  });
  return snapshot;
}

_captureSelectionSnapshot("startup");
_appendSessionLog("Plugin session started.");
figma.on("selectionchange", function() {
  _captureSelectionSnapshot("selectionchange");
  _appendSessionLog("Selection changed.");
});
figma.on("currentpagechange", function() {
  _captureSelectionSnapshot("currentpagechange");
  _appendSessionLog("Current page changed to " + (figma.currentPage ? figma.currentPage.name : "unknown") + ".");
});

function serializeNode(node) {
  const result = {
    id: node.id,
    name: node.name,
    type: node.type
  };

  if ('description' in node) result.description = node.description || "";
  if ('documentationLinks' in node) result.documentationLinks = node.documentationLinks || [];
  if (node.type === 'COMPONENT_SET') {
    result.componentPropertyDefinitions = node.componentPropertyDefinitions;
  } else if (node.type === 'COMPONENT') {
    if (!node.parent || node.parent.type !== 'COMPONENT_SET') {
      result.componentPropertyDefinitions = node.componentPropertyDefinitions;
    }
  }

  if (
    node.type === 'INSTANCE' ||
    node.type === 'COMPONENT' ||
    node.type === 'COMPONENT_SET'
  ) {
    result.componentProperties = node.componentProperties;
  }

  if ('layoutMode' in node) result.layoutMode = node.layoutMode;
  if ('paddingTop' in node) {
    result.padding = {
      top: node.paddingTop,
      right: node.paddingRight,
      bottom: node.paddingBottom,
      left: node.paddingLeft
    };
  }
  if ('itemSpacing' in node) result.itemSpacing = node.itemSpacing;

  if ('children' in node && Array.isArray(node.children)) {
    result.children = node.children.map(child => serializeNode(child));
  }

  return result;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'ui-ready') {
    figma.ui.postMessage({
      type: 'session-log-history',
      data: _sessionLog.slice()
    });
    figma.ui.postMessage({
      type: 'session-meta',
      fileKey: _getFigletsFileKey(),
      data: {
        sessionId: _sessionId,
        fileKey: _getFigletsFileKey()
      }
    });
    _captureSelectionSnapshot("ui-ready");
    return;
  }

  if (msg.type === 'extract-all') {
    _appendSessionLog('Executing sync_figma_data.');
    var _fileKey = _getFigletsFileKey();
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();

    const componentNodes = figma.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });

    const payload = {
      fileKey: _fileKey,
      fileName: figma.root ? figma.root.name : "",
      collections: collections.map(c => ({
        id: c.id,
        name: c.name,
        variableIds: c.variableIds,
        modes: c.modes
      })),
      variables: variables.map(v => ({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        valuesByMode: v.valuesByMode
      })),
      textStyles: textStyles.map(s => ({
        id: s.id,
        name: s.name,
        fontName: s.fontName,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing
      })),
      effectStyles: effectStyles.map(s => ({
        id: s.id,
        name: s.name,
        effects: s.effects
      })),
      components: componentNodes.map(n => ({
        id: n.id,
        type: n.type,
        name: n.name,
        description: n.description || "",
        documentationLinks: n.documentationLinks || [],
        componentPropertyDefinitions: n.type === 'COMPONENT_SET' ? n.componentPropertyDefinitions : {},
        parentSetId: n.parent && n.parent.type === 'COMPONENT_SET' ? n.parent.id : null
      }))
    };

    figma.ui.postMessage({ type: 'data-extracted', fileKey: _fileKey, data: payload });
    _appendSessionLog('Completed sync_figma_data.');
  }

  if (msg.type === 'extract-selection') {
    try {
      _appendSessionLog('Executing inspect_component.');
      var liveSnapshot = _captureSelectionSnapshot("extract-selection");
      var chosenSnapshot = liveSnapshot;
      var usedFallback = false;
      var fallbackReason = "";
      var lastNonEmpty = _selectionCache.lastNonEmpty;

      if (
        liveSnapshot.nodes.length === 0 &&
        lastNonEmpty.nodes.length > 0 &&
        lastNonEmpty.pageId === liveSnapshot.pageId &&
        (liveSnapshot.ts - lastNonEmpty.ts) < 300000
      ) {
        chosenSnapshot = lastNonEmpty;
        usedFallback = true;
        fallbackReason = "Live selection was empty; using last non-empty snapshot from the same page.";
      }

      console.log("[figlets] extract-selection", JSON.stringify({
        live: _selectionDebug(liveSnapshot),
        lastNonEmpty: _selectionDebug(lastNonEmpty),
        chosenSource: chosenSnapshot.source,
        usedFallback: usedFallback,
        fallbackReason: fallbackReason
      }));

      var payload = {
        selection: chosenSnapshot.nodes.map(function(node) { return serializeNode(node); }),
        meta: {
          usedFallback: usedFallback,
          fallbackReason: fallbackReason,
          liveSelectionCount: liveSnapshot.nodes.length,
          cachedSelectionCount: lastNonEmpty.nodes.length,
          fileName: liveSnapshot.fileName,
          pageId: liveSnapshot.pageId,
          pageName: liveSnapshot.pageName,
          chosenSource: chosenSnapshot.source,
          cachedAgeMs: usedFallback ? (liveSnapshot.ts - lastNonEmpty.ts) : 0
        }
      };
      figma.ui.postMessage({ type: 'selection-extracted', fileKey: _getFigletsFileKey(), data: payload });
      _appendSessionLog('Completed inspect_component.');
    } catch (err) {
      _appendSessionLog('inspect_component failed: ' + (err && err.message ? err.message : 'serializeNode failed'));
      figma.ui.postMessage({ type: 'selection-extracted', fileKey: _getFigletsFileKey(), data: { error: err.message || 'serializeNode failed', selection: [] } });
    }
  }

  if (msg.type === 'sync-success') {
    figma.notify('Data synced to local machine successfully!');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // build-showcase — renders token showcase pages directly in Figma.
  // Equivalent of the figlets fig-ds-showcase skill, ported to run inside the
  // plugin so no agent reasoning is needed. All rendering stays on the machine.
  // ─────────────────────────────────────────────────────────────────────────
  if (msg.type === 'build-showcase') {
    try {
      _appendSessionLog('Executing build_ds_showcase.');
      const result = await _buildShowcase(msg.data || {});
      figma.ui.postMessage({ type: 'showcase-built', fileKey: _getFigletsFileKey(), data: result });
      _appendSessionLog('Completed build_ds_showcase.');
      figma.notify('Token showcase built!');
    } catch (err) {
      const _errMsg = err instanceof Error ? err.message : String(err);
      _appendSessionLog('build_ds_showcase failed: ' + _errMsg);
      figma.ui.postMessage({ type: 'showcase-built', fileKey: _getFigletsFileKey(), data: { error: _errMsg || 'Unknown error' } });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // apply-ds-setup — creates all 5 variable collections from a prepared config.
  // Config payload is produced by prepare_ds_config MCP tool (figlets-core).
  // ─────────────────────────────────────────────────────────────────────────
  if (msg.type === 'apply-ds-setup') {
    try {
      _appendSessionLog('Executing apply_ds_setup.');
      const result = await _applyDsSetup(msg.data);
      figma.ui.postMessage({ type: 'ds-setup-done', fileKey: _getFigletsFileKey(), data: result });
      _appendSessionLog('Completed apply_ds_setup.');
      figma.notify('Design system collections created!');
    } catch (err) {
      _appendSessionLog('apply_ds_setup failed: ' + err.message);
      figma.ui.postMessage({ type: 'ds-setup-done', fileKey: _getFigletsFileKey(), data: { error: err.message } });
    }
  }

  if (msg.type === 'reset-figlets-file') {
    try {
      _appendSessionLog('Executing reset_figlets_file.');
      const result = await _resetFigletsFile(msg.data || {});
      figma.ui.postMessage({ type: 'figlets-reset-done', fileKey: _getFigletsFileKey(), data: result });
      _appendSessionLog('Completed reset_figlets_file.');
      figma.notify('Figlets file content reset.');
    } catch (err) {
      _appendSessionLog('reset_figlets_file failed: ' + err.message);
      figma.ui.postMessage({ type: 'figlets-reset-done', fileKey: _getFigletsFileKey(), data: { error: err.message } });
    }
  }

  if (msg.type === 'update-primitives') {
    try {
      _appendSessionLog('Executing update_ds_primitives.');
      const result = await _updateDsPrimitives(msg.data || {});
      figma.ui.postMessage({ type: 'primitives-update-done', fileKey: _getFigletsFileKey(), data: result });
      if (result && result.error) {
        _appendSessionLog('update_ds_primitives failed: ' + result.error);
      } else {
        _appendSessionLog('Completed update_ds_primitives.');
        figma.notify('Primitives updated.');
      }
    } catch (err) {
      _appendSessionLog('update_ds_primitives failed: ' + err.message);
      figma.ui.postMessage({ type: 'primitives-update-done', fileKey: _getFigletsFileKey(), data: { error: err.message } });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // build-doc — generates a component spec sheet inside Figma and returns
  // markdown for the agent to write to component-specs/[Name].md.
  // Equivalent of figlets fig-document skill.
  // ─────────────────────────────────────────────────────────────────────────
  if (msg.type === 'build-doc') {
    try {
      _appendSessionLog('Executing generate_component_doc.');
      const result = await _buildComponentDoc(msg.data || {});
      figma.ui.postMessage({ type: 'doc-built', fileKey: _getFigletsFileKey(), data: result });
      _appendSessionLog(result && result.error ? ('generate_component_doc failed: ' + result.error) : 'Completed generate_component_doc.');
      if (!result.error) figma.notify('Component spec sheet built!');
    } catch (err) {
      const _errMsg = err instanceof Error ? err.message : String(err);
      _appendSessionLog('generate_component_doc failed: ' + _errMsg);
      figma.ui.postMessage({ type: 'doc-built', fileKey: _getFigletsFileKey(), data: { error: _errMsg || 'Unknown error' } });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // qa-audit — audits selection/page for raw values that should be bound to
  // design-system styles or variables.
  // ─────────────────────────────────────────────────────────────────────────
  if (msg.type === 'qa-audit') {
    try {
      _appendSessionLog('Executing qa_binding_audit.');
      const result = await _runQaBindingAudit(msg.data || {});
      if (msg.data && msg.data.local) result.local = true;
      figma.ui.postMessage({ type: 'qa-audit-done', fileKey: _getFigletsFileKey(), data: result });
      _appendSessionLog(result && result.error ? ('qa_binding_audit failed: ' + result.error) : 'Completed qa_binding_audit.');
      if (!result.error) figma.notify('QA audit complete.');
    } catch (err) {
      const _errMsg = err instanceof Error ? err.message : String(err);
      _appendSessionLog('qa_binding_audit failed: ' + _errMsg);
      figma.ui.postMessage({ type: 'qa-audit-done', fileKey: _getFigletsFileKey(), data: { error: _errMsg || 'Unknown error' } });
    }
  }
};

// ── Shared DS binding context ────────────────────────────────────────────────
// Central resolver for live Figma variable binding. It is intentionally role-
// based for color tokens: semantic names win; exact/nearest color matching is
// reserved for reporting workflows and should not drive automatic role binding.

async function _createDsBindingContext() {
  const allVars = await figma.variables.getLocalVariablesAsync();
  const allColls = await figma.variables.getLocalVariableCollectionsAsync();
  const textStyles = await figma.getLocalTextStylesAsync();
  const effectStyles = await figma.getLocalEffectStylesAsync();

  const varByName = {};
  const varById = {};
  const sortedVars = allVars.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  for (let i = 0; i < sortedVars.length; i++) {
    varByName[sortedVars[i].name] = sortedVars[i];
    varById[sortedVars[i].id] = sortedVars[i];
  }

  function resolveVarValue(v, depth) {
    if (!v) return null;
    if (depth === undefined) depth = 0;
    if (depth > 8) return null;
    const modeIds = Object.keys(v.valuesByMode || {});
    if (modeIds.length === 0) return null;
    const val = v.valuesByMode[modeIds[0]];
    if (!val && val !== 0) return null;
    if (typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
      const aliased = varById[val.id] || figma.variables.getVariableById(val.id);
      return aliased ? resolveVarValue(aliased, depth + 1) : null;
    }
    return val;
  }

  function groupByPath(vars, depth) {
    const groups = {};
    for (let i = 0; i < vars.length; i++) {
      const parts = String(vars[i].name).split('/');
      let key;
      if (depth !== undefined) key = parts.slice(0, depth).join('/');
      else key = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      if (!groups[key]) groups[key] = [];
      groups[key].push(vars[i]);
    }
    return groups;
  }

  const collIdSets = new Map(allColls.map(function (c) { return [c.id, new Set(c.variableIds || [])]; }));
  const dsCollections = allColls.slice()
    .sort(function (a, b) { return a.name.localeCompare(b.name); })
    .map(function (coll) {
      const vars = allVars.filter(function (v) { return (coll.variableIds || []).indexOf(v.id) >= 0; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      const colorVars = vars.filter(function (v) { return v.resolvedType === 'COLOR'; });
      const floatVars = vars.filter(function (v) { return v.resolvedType === 'FLOAT'; });
      const ids = collIdSets.get(coll.id) || new Set();
      let selfAliasCount = 0;
      let crossAliasCount = 0;
      for (let i = 0; i < vars.length; i++) {
        const modeIds = Object.keys(vars[i].valuesByMode || {});
        const val = modeIds.length ? vars[i].valuesByMode[modeIds[0]] : null;
        if (!val || typeof val !== 'object' || val.type !== 'VARIABLE_ALIAS') continue;
        if (ids.has(val.id)) selfAliasCount++;
        else crossAliasCount++;
      }
      const aliasCount = selfAliasCount + crossAliasCount;
      const modeNames = (coll.modes || []).map(function (m) { return m.name; });
      const hasLight = modeNames.some(function (n) { return /light|day|bright/i.test(n); });
      const hasDark = modeNames.some(function (n) { return /dark|night|dim/i.test(n); });
      const hasLightDark = hasLight && hasDark;
      const numericLeafCount = colorVars.filter(function (v) { return /^\d+$/.test(String(v.name).split('/').pop()); }).length;
      const hasNumericSteps = colorVars.length > 0 && numericLeafCount >= colorVars.length * 0.3;
      const crossAliasRatio = vars.length > 0 ? crossAliasCount / vars.length : 0;
      const totalAliasRatio = vars.length > 0 ? aliasCount / vars.length : 0;
      const isPrimitive = vars.length > 0 && !hasLightDark && (
        hasNumericSteps
          ? crossAliasRatio < 0.3
          : totalAliasRatio < 0.2 && crossAliasRatio < 0.1
      );
      const isAlias = vars.length > 0 && (
        hasLightDark || crossAliasRatio > 0.4 || (!hasNumericSteps && totalAliasRatio > 0.7)
      );
      return {
        id: coll.id,
        name: coll.name,
        modeNames,
        varCount: vars.length,
        colorVarCount: colorVars.length,
        floatVarCount: floatVars.length,
        aliasCount,
        selfAliasCount,
        crossAliasCount,
        isPrimitive,
        isAlias,
        hasLightDark,
        hasNumericSteps,
        hasMultipleModes: (coll.modes || []).length > 1,
        vars,
        groups: groupByPath(vars),
        topLevelGroups: groupByPath(vars, 1)
      };
    });

  function lum(c) {
    return [c.r, c.g, c.b]
      .map(function (v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce(function (sum, v, i) { return sum + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function sat(c) {
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    return max === 0 ? 0 : (max - min) / max;
  }
  function contrastRatio(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function rgb(v) {
    const val = resolveVarValue(v);
    return val && typeof val === 'object' && 'r' in val ? { r: val.r, g: val.g, b: val.b } : null;
  }
  function isDecorativeColorName(name) {
    return /(?:^|\/)(scrim|overlay|state|shadow|elevation)(?:\/|$)/i.test(String(name || ''));
  }

  const semanticColl = dsCollections.find(function (c) { return c.isAlias && c.colorVarCount > 0; });
  const semanticVars = semanticColl
    ? semanticColl.vars.filter(function (v) { return v.resolvedType === 'COLOR'; })
    : Object.keys(varByName).map(function (k) { return varByName[k]; }).filter(function (v) { return v.resolvedType === 'COLOR'; });
  const semanticRoleVars = semanticVars.filter(function (v) { return !isDecorativeColorName(v.name); });

  function bestBgVar() {
    for (let i = 0; i < semanticRoleVars.length; i++) {
      const name = semanticRoleVars[i].name;
      if (/(?:^|\/)on[-_]/i.test(name)) continue;
      if (/(?:surface|background|base|page)(?:[/_-]default)?$/i.test(name)) return semanticRoleVars[i];
    }
    let best = null, bestLum = -1;
    for (let i = 0; i < semanticRoleVars.length; i++) {
      const c = rgb(semanticRoleVars[i]);
      if (c && lum(c) > bestLum) { best = semanticRoleVars[i]; bestLum = lum(c); }
    }
    return best;
  }
  function bestTextVar() {
    for (let i = 0; i < semanticRoleVars.length; i++) {
      if (/(?:on[-_]surface|foreground)(?:[/_-]default)?$/i.test(semanticRoleVars[i].name)) return semanticRoleVars[i];
    }
    let best = null, bestLum = 2;
    for (let i = 0; i < semanticRoleVars.length; i++) {
      const c = rgb(semanticRoleVars[i]);
      if (c && lum(c) < bestLum) { best = semanticRoleVars[i]; bestLum = lum(c); }
    }
    return best;
  }
  function bestAccentVar() {
    let best = null, bestSat = -1;
    for (let i = 0; i < semanticRoleVars.length; i++) {
      const c = rgb(semanticRoleVars[i]);
      if (c && sat(c) > bestSat) { best = semanticRoleVars[i]; bestSat = sat(c); }
    }
    return best;
  }

  const bgVar = bestBgVar();
  const textVar = bestTextVar();
  const accVar = bestAccentVar();
  const bgRGB = rgb(bgVar) || { r: 1, g: 1, b: 1 };
  const textRGB = rgb(textVar) || { r: 0.1, g: 0.1, b: 0.1 };

  const SEG = {
    'surface': { BG: 3 }, 'background': { BG: 3 }, 'bg': { BG: 2 }, 'canvas': { BG: 2 },
    'base': { BG: 1 }, 'page': { BG: 1 }, 'fill': { BG: 1 }, 'container': { BG: 1, BRAND: 1 },
    'on-surface': { FG: 3 }, 'on_surface': { FG: 3 }, 'foreground': { FG: 3 }, 'fg': { FG: 2 },
    'text': { FG: 2 }, 'icon': { FG: 1 }, 'label': { FG: 1 }, 'content': { FG: 1 }, 'on': { FG: 1 },
    'on-brand': { FG: 2, BRAND: 2 }, 'on_brand': { FG: 2, BRAND: 2 },
    'on-primary': { FG: 2, BRAND: 2 }, 'on_primary': { FG: 2, BRAND: 2 },
    'brand': { BRAND: 2 }, 'primary': { BRAND: 2 }, 'accent': { ACCENT: 2 }, 'action': { BRAND: 1 }, 'interactive': { BRAND: 1 },
    'brand-variant': { BRAND: 1, BVAR: 3 }, 'brand_variant': { BRAND: 1, BVAR: 3 },
    'default': { DEFAULT: 1 }, 'variant': { VARIANT: 2 }, 'subtle': { VARIANT: 1 }, 'muted': { VARIANT: 2 },
    'secondary': { VARIANT: 1 }, 'sub': { VARIANT: 1 }, 'weak': { VARIANT: 1 }, 'strong': { STRONG: 1 },
    'outline': { OUTLINE: 3 }, 'border': { OUTLINE: 3 }, 'stroke': { OUTLINE: 2 }, 'divider': { OUTLINE: 3 },
    'separator': { OUTLINE: 3 }, 'line': { OUTLINE: 1 },
    'success': { SUCCESS: 3 }, 'positive': { SUCCESS: 2 }, 'confirm': { SUCCESS: 1 },
    'warning': { WARNING: 3 }, 'caution': { WARNING: 2 }, 'alert': { WARNING: 1 },
    'danger': { DANGER: 2 }, 'error': { DANGER: 2 }, 'destructive': { DANGER: 2 }
  };

  const ROLE = {
    onSurface: { FG: 3, BG: -4, VARIANT: -1, DEFAULT: 1, STRONG: 1 },
    onSurfaceVar: { FG: 3, BG: -4, VARIANT: 2 },
    surfaceDefault: { BG: 3, FG: -4, VARIANT: -1, DEFAULT: 2, BRAND: -2 },
    surfaceVariant: { BG: 3, FG: -4, VARIANT: 2 },
    surfaceBrand: { BG: 2, FG: -4, BRAND: 3 },
    brandVariant: { BG: 2, FG: -4, BVAR: 3, BRAND: 1 },
    onBrandVariant: { FG: 3, BG: -4, BRAND: 3, BVAR: 2 },
    outlineSubtle: { OUTLINE: 3, FG: -2, BG: -2 },
    outlineBrand: { OUTLINE: 3, FG: -2, BG: -2, BRAND: 3 },
    successBg: { SUCCESS: 3, BG: 2, FG: -3, OUTLINE: -2, WARNING: -6, DANGER: -6 },
    successBorder: { SUCCESS: 3, OUTLINE: 2, BG: -2, FG: -1, WARNING: -6, DANGER: -6 },
    successText: { SUCCESS: 3, FG: 2, BG: -3, OUTLINE: -2, WARNING: -6, DANGER: -6 },
    warningBg: { WARNING: 3, BG: 2, FG: -3, OUTLINE: -2, SUCCESS: -6, DANGER: -6 },
    warningBorder: { WARNING: 3, OUTLINE: 2, BG: -2, FG: -1, SUCCESS: -6, DANGER: -6 },
    warningText: { WARNING: 3, FG: 2, BG: -3, OUTLINE: -2, SUCCESS: -6, DANGER: -6 },
    dangerBg: { DANGER: 3, BG: 2, FG: -3, OUTLINE: -2, SUCCESS: -6, WARNING: -6 },
    dangerBorder: { DANGER: 3, OUTLINE: 2, BG: -2, FG: -1, SUCCESS: -6, WARNING: -6 },
    dangerText: { DANGER: 3, FG: 2, BG: -3, OUTLINE: -2, SUCCESS: -6, WARNING: -6 }
  };

  function pathCats(name) {
    const segments = String(name).toLowerCase().split('/');
    const cats = {};
    for (let i = 0; i < segments.length; i++) {
      const segCats = SEG[segments[i]];
      if (!segCats) continue;
      for (const cat in segCats) cats[cat] = (cats[cat] || 0) + segCats[cat];
    }
    return cats;
  }
  function segScore(name, role) {
    const cats = pathCats(name);
    const weights = ROLE[role];
    if (!weights) return 0;
    let total = 0;
    for (const cat in weights) total += weights[cat] * (cats[cat] || 0);
    return total;
  }

  const scored = Object.keys(varByName).map(function (k) {
    const v = varByName[k];
    if (v.resolvedType !== 'COLOR') return null;
    if (isDecorativeColorName(v.name)) return null;
    const c = rgb(v);
    if (!c) return null;
    return { v: v, rgb: c, lum: lum(c), sat: sat(c), contrast: contrastRatio(c, bgRGB), name: v.name.toLowerCase() };
  }).filter(Boolean);

  function pickColorRole(role, scorer, nameOnly, requiredCats, compareBg) {
    let best = null, bestSeg = 0;
    for (let i = 0; i < scored.length; i++) {
      const s = scored[i];
      const seg = segScore(s.name, role);
      if (seg <= 0) continue;
      if (requiredCats) {
        const cats = pathCats(s.name);
        let ok = true;
        for (let j = 0; j < requiredCats.length; j++) {
          if ((cats[requiredCats[j]] || 0) <= 0) { ok = false; break; }
        }
        if (!ok) continue;
      }
      if (best === null || seg > bestSeg || (seg === bestSeg && scorer(s) > scorer(best))) {
        best = s; bestSeg = seg;
      }
    }
    if (best) return best.v;
    if (nameOnly || requiredCats) return null;
    let funcBest = null, funcScore = 0;
    for (let i = 0; i < scored.length; i++) {
      const score = scorer(scored[i]);
      if (score > funcScore) { funcScore = score; funcBest = scored[i]; }
    }
    return funcBest ? funcBest.v : null;
  }

  function findContrastVar(against, minRatio) {
    minRatio = minRatio || 4.5;
    let best = null, bestRatio = 0;
    const preferred = Object.keys(varByName).map(function (k) { return varByName[k]; }).filter(function (v) {
      return v.resolvedType === 'COLOR' &&
        !isDecorativeColorName(v.name) &&
        /(?:on[-_]surface|foreground|(?:^|\/)text(?:[-_\/]|$))/i.test(v.name);
    });
    const candidates = preferred.length ? preferred : scored.map(function (s) { return s.v; });
    for (let i = 0; i < candidates.length; i++) {
      const c = rgb(candidates[i]);
      if (!c) continue;
      const ratio = contrastRatio(c, against);
      if (ratio >= minRatio && ratio > bestRatio) { bestRatio = ratio; best = candidates[i]; }
    }
    return best;
  }

  const colorRoles = {
    bg: bgVar || null,
    text: textVar || null,
    acc: accVar || null,
    onSurface: pickColorRole('onSurface', function (s) { return s.contrast >= 4.5 ? s.contrast : 0; }),
    onSurfaceVar: pickColorRole('onSurfaceVar', function (s) { return s.contrast >= 2 && s.contrast < 9 ? s.contrast : 0; }),
    surfaceDefault: pickColorRole('surfaceDefault', function (s) { return s.lum; }),
    surfaceVariant: pickColorRole('surfaceVariant', function (s) { return s.lum * (1 - s.sat); }),
    surfaceBrand: pickColorRole('surfaceBrand', function (s) { return s.sat * 0.5 + s.lum * 0.5; }),
    brandVariant: pickColorRole('brandVariant', function (s) { return s.sat * 0.4 + s.lum * 0.6; }),
    outlineSubtle: pickColorRole('outlineSubtle', function (s) {
      if (s.lum > 0.9 || s.lum < 0.05) return 0;
      const dist = Math.abs(s.lum - 0.6);
      if (dist > 0.5) return 0;
      return (1 - s.sat) * (1 - dist * 2);
    }, false, ['OUTLINE']),
    outlineBrand: pickColorRole('outlineBrand', function (s) { return s.sat * 0.5 + s.lum * 0.5; }, false, ['OUTLINE']),
    successBg: pickColorRole('successBg', function (s) { return s.sat; }, true, ['BG', 'SUCCESS']),
    successBorder: pickColorRole('successBorder', function (s) { return s.sat; }, true, ['OUTLINE', 'SUCCESS']),
    successText: pickColorRole('successText', function (s) { return s.contrast >= 4.5 ? s.contrast : 0; }, true, ['FG', 'SUCCESS']),
    dangerBg: pickColorRole('dangerBg', function (s) { return s.sat; }, true, ['BG', 'DANGER']),
    dangerBorder: pickColorRole('dangerBorder', function (s) { return s.sat; }, true, ['OUTLINE', 'DANGER']),
    dangerText: pickColorRole('dangerText', function (s) { return s.contrast >= 4.5 ? s.contrast : 0; }, true, ['FG', 'DANGER'])
  };
  if (!colorRoles.brandVariant) colorRoles.brandVariant = colorRoles.surfaceBrand || colorRoles.surfaceVariant || null;
  const brandRGB = rgb(colorRoles.brandVariant) || { r: 0.957, g: 0.953, b: 0.988 };
  colorRoles.onBrandVariant = pickColorRole('onBrandVariant', function (s) {
    const ratio = contrastRatio(s.rgb, brandRGB);
    return ratio >= 3 ? ratio : 0;
  }) || findContrastVar(brandRGB, 3) || colorRoles.text || null;
  if (!colorRoles.surfaceBrand) colorRoles.surfaceBrand = colorRoles.acc || null;
  if (!colorRoles.onSurfaceVar) colorRoles.onSurfaceVar = findContrastVar(bgRGB, 3) || colorRoles.text || null;

  function resolvedOrFallback(v, fallback) {
    const c = rgb(v);
    return c || fallback;
  }

  const floatVars = allVars.filter(function (v) { return v.resolvedType === 'FLOAT'; });
  function scoreFloatName(name, purpose) {
      const n = String(name).toLowerCase();
      if (purpose === 'typography') {
        if (!/(?:^|\/)(type|font|line-height|tracking|letter|weight|size)(?:\/|$|-)/i.test(n)) return -1;
        return (/^type\//.test(n) ? 50 : 20) + String(name).split('/').length;
      }
      if (purpose === 'border') {
        if (!/(?:^|\/)(border|stroke|outline)(?:\/|$|-)/i.test(n)) return -1;
        return (/^space\/border\//.test(n) ? 80 : 30) + String(name).split('/').length;
      }
      if (purpose === 'radius') {
        if (/shadow|elevation|blur|offset|type|font|line-height|tracking|weight/i.test(n)) return -1;
        if (!/(?:^|\/)(radius|corner|round)(?:\/|$|-)/i.test(n)) return -1;
        return (/^space\/radius\//.test(n) ? 80 : 30) + String(name).split('/').length;
      }
      if (/shadow|elevation|type|font|line-height|tracking|weight|radius|border|stroke/i.test(n)) return -1;
      if (!/(?:^|\/)(space|spacing|gap|padding|margin|inset|stack|layout|component|touch)(?:\/|$|-)/i.test(n)) return -1;
      return (/^space\//.test(n) ? 80 : 30) + String(name).split('/').length;
  }
  function pickFloatByValue(value, purpose) {
    const want = Number(value);
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < floatVars.length; i++) {
      const val = resolveVarValue(floatVars[i]);
      if (typeof val !== 'number' || Number(val) !== want) continue;
      const score = scoreFloatName(floatVars[i].name, purpose);
      if (score > bestScore) {
        best = floatVars[i];
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function pickFloatByNearest(value, purpose, preference, maxDistance) {
    const want = Number(value);
    if (!isFinite(want)) return null;
    preference = preference || 'nearest';
    if (maxDistance === undefined || maxDistance === null) maxDistance = 8;
    let best = null;
    let bestDistance = Infinity;
    let bestScore = -1;
    for (let i = 0; i < floatVars.length; i++) {
      const variable = floatVars[i];
      const score = scoreFloatName(variable.name, purpose);
      if (score < 0) continue;
      const val = resolveVarValue(variable);
      if (typeof val !== 'number' || !isFinite(val)) continue;
      const delta = val - want;
      if (preference === 'ceil' && delta < 0) continue;
      if (preference === 'floor' && delta > 0) continue;
      const distance = Math.abs(delta);
      if (distance === 0) return variable;
      if (distance > maxDistance) continue;
      if (distance < bestDistance || (distance === bestDistance && score > bestScore)) {
        best = variable;
        bestDistance = distance;
        bestScore = score;
      }
    }
    return best;
  }

  function pickTextStyleLike(patterns) {
    function norm(value) {
      return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
    }
    const lower = patterns.map(function (p) { return p.toLowerCase(); });
    const normalized = patterns.map(norm);
    for (let i = 0; i < textStyles.length; i++) {
      const name = textStyles[i].name.toLowerCase();
      const normalizedName = norm(name);
      for (let j = 0; j < lower.length; j++) {
        if (name.indexOf(lower[j]) >= 0 || normalizedName.indexOf(normalized[j]) >= 0) return textStyles[i];
      }
    }
    return null;
  }

  function normalizeName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function buildTypographyVariableGroups() {
    const groups = {};
    let sharedFamilyVar = null;
    for (let i = 0; i < allVars.length; i++) {
      const variable = allVars[i];
      if (!variable || !variable.name) continue;
      const name = String(variable.name);
      if (variable.resolvedType === 'STRING' && /(?:^|\/)(family|font-family|fontFamily)(?:\/|$|-)/i.test(name)) {
        if (!sharedFamilyVar) sharedFamilyVar = variable;
      }
      if (variable.resolvedType !== 'FLOAT' && variable.resolvedType !== 'STRING') continue;
      const parts = name.split('/');
      if (parts.length < 4) continue;
      if (!/^(type|typo|typography)$/i.test(parts[0])) continue;
      const prop = parts[parts.length - 1].toLowerCase();
      const key = parts.slice(0, -1).join('/');
      if (!groups[key]) groups[key] = { key: key };
      if (prop === 'size' || prop === 'font-size' || prop === 'fontsize') groups[key].sizeVar = variable;
      if (prop === 'line-height' || prop === 'lineheight' || prop === 'leading') groups[key].lineHeightVar = variable;
      if (prop === 'weight' || prop === 'font-weight' || prop === 'fontweight') groups[key].weightVar = variable;
      if (prop === 'tracking' || prop === 'letter-spacing' || prop === 'letterspacing') groups[key].trackingVar = variable;
      if (prop === 'family' || prop === 'font-family' || prop === 'fontfamily') groups[key].familyVar = variable;
    }
    return Object.keys(groups).sort().map(function (key) {
      const group = groups[key];
      group.familyVar = group.familyVar || sharedFamilyVar || null;
      group.sizeValue = group.sizeVar ? resolveVarValue(group.sizeVar) : null;
      group.lineHeightValue = group.lineHeightVar ? resolveVarValue(group.lineHeightVar) : null;
      group.weightValue = group.weightVar ? resolveVarValue(group.weightVar) : null;
      group.trackingValue = group.trackingVar ? resolveVarValue(group.trackingVar) : null;
      group.familyValue = group.familyVar ? resolveVarValue(group.familyVar) : null;
      return group;
    });
  }

  const typographyVariableGroups = buildTypographyVariableGroups();

  function pickTypographyVariableGroup(patterns) {
    const normalizedPatterns = (patterns || []).map(normalizeName);
    for (let i = 0; i < typographyVariableGroups.length; i++) {
      const group = typographyVariableGroups[i];
      const groupName = normalizeName(group.key);
      for (let j = 0; j < normalizedPatterns.length; j++) {
        const pattern = normalizedPatterns[j];
        if (pattern && (groupName.indexOf(pattern) >= 0 || pattern.indexOf(groupName) >= 0)) return group;
      }
    }
    return null;
  }

  function pickTypographyBinding(role, patterns) {
    const style = pickTextStyleLike(patterns);
    if (style) return { kind: 'style', role: role, style: style, warning: null };
    const variableGroup = pickTypographyVariableGroup(patterns);
    if (variableGroup && (variableGroup.sizeVar || variableGroup.lineHeightVar || variableGroup.weightVar || variableGroup.familyVar)) {
      return { kind: 'variables', role: role, variables: variableGroup, warning: null };
    }
    return {
      kind: 'raw',
      role: role,
      warning: 'No typography style or typography variables found for ' + role + '; using raw text values.'
    };
  }

  function paint(fallbackRGB, variable) {
    const base = { type: 'SOLID', color: fallbackRGB };
    return variable ? figma.variables.setBoundVariableForPaint(base, 'color', variable) : base;
  }
  function bindVar(node, prop, variable) {
    if (!variable) return false;
    try { node.setBoundVariable(prop, variable); return true; } catch (e) { return false; }
  }

  return {
    allVars,
    allColls,
    textStyles,
    effectStyles,
    varByName,
    varById,
    dsCollections,
    resolveVarValue,
    rgb,
    lum,
    sat,
    contrastRatio,
    colorRoles,
    pickColorRole,
    pickFloatByValue,
    pickFloatByNearest,
    pickTextStyleLike,
    pickTypographyBinding,
    pickTypographyVariableGroup,
    typographyVariableGroups,
    resolvedOrFallback,
    paint,
    bindVar
  };
}

async function _resetFigletsFile(opts) {
  opts = opts || {};
  var result = {
    removedVariables: 0,
    removedCollections: 0,
    removedTextStyles: 0,
    removedEffectStyles: 0,
    removedPages: 0,
    clearedPages: 0,
    removedNodes: 0
  };

  var vars = await figma.variables.getLocalVariablesAsync();
  for (var vi = 0; vi < vars.length; vi++) {
    try { vars[vi].remove(); result.removedVariables++; } catch (e) {}
  }

  var colls = await figma.variables.getLocalVariableCollectionsAsync();
  for (var ci = 0; ci < colls.length; ci++) {
    try { colls[ci].remove(); result.removedCollections++; } catch (e2) {}
  }

  var textStyles = await figma.getLocalTextStylesAsync();
  for (var ti = 0; ti < textStyles.length; ti++) {
    try { textStyles[ti].remove(); result.removedTextStyles++; } catch (e3) {}
  }

  var effectStyles = await figma.getLocalEffectStylesAsync();
  for (var ei = 0; ei < effectStyles.length; ei++) {
    try { effectStyles[ei].remove(); result.removedEffectStyles++; } catch (e4) {}
  }

  var pages = figma.root.children.slice();
  var keepPage = pages[0] || figma.currentPage;
  for (var pi = 0; pi < pages.length; pi++) {
    var page = pages[pi];
    if (page !== keepPage) {
      try { page.remove(); result.removedPages++; } catch (e5) {}
    }
  }

  if (keepPage) {
    await figma.setCurrentPageAsync(keepPage);
    var children = keepPage.children.slice();
    for (var ni = 0; ni < children.length; ni++) {
      try { children[ni].remove(); result.removedNodes++; } catch (e6) {}
    }
    keepPage.name = 'Page 1';
    result.clearedPages++;
  }

  return result;
}

async function _runQaBindingAudit(opts) {
  opts = opts || {};
  const shouldFix = !!opts.fix;
  const maxNodes = typeof opts.maxNodes === 'number' && opts.maxNodes > 0 ? opts.maxNodes : 2500;
  const deadlineMs = typeof opts.deadlineMs === 'number' && opts.deadlineMs > 0 ? opts.deadlineMs : 45000;
  const startedAt = Date.now();
  const _ds = await _createDsBindingContext();
  const scopeNodes = figma.currentPage.selection.length > 0
    ? figma.currentPage.selection.slice()
    : figma.currentPage.children.slice();
  const scopeLabel = figma.currentPage.selection.length > 0 ? 'selection' : 'page';
  const violations = [];
  const fixed = [];
  const failed = [];
  let auditedNodeCount = 0;
  let truncated = false;
  let truncateReason = '';

  function _rgbText(c) {
    return 'rgb(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255) + ')';
  }

  function _suggestion(kind, variable, confidence, reason) {
    if (!variable) return { kind: 'none', confidence: 'none', reason: reason || 'No semantic style or variable available.' };
    return {
      kind: kind || 'variable',
      name: variable.name,
      id: variable.id,
      confidence: confidence || 'high',
      reason: reason || 'Matched by binding policy.'
    };
  }

  function _nameText(node) {
    return String((node && node.name) || '').toLowerCase();
  }

  function _colorRoleFor(node, property) {
    const name = _nameText(node);
    if (property === 'Stroke color') {
      if (/brand|primary|accent|action|interactive/.test(name)) return 'outlineBrand';
      if (/success|positive|confirm/.test(name)) return 'successBorder';
      if (/danger|error|destructive/.test(name)) return 'dangerBorder';
      return 'outlineSubtle';
    }
    if (node.type === 'TEXT' || /text|label|icon|glyph|content/.test(name)) {
      if (/success|positive|confirm/.test(name)) return 'successText';
      if (/danger|error|destructive/.test(name)) return 'dangerText';
      if (/brand|primary|accent/.test(name)) return 'onBrandVariant';
      return 'onSurface';
    }
    if (/success|positive|confirm/.test(name)) return 'successBg';
    if (/danger|error|destructive/.test(name)) return 'dangerBg';
    if (/brand|primary|accent|action|interactive|cta|button/.test(name)) return 'surfaceBrand';
    if (/subtle|muted|secondary|variant|badge|chip|tag/.test(name)) return 'surfaceVariant';
    return 'surfaceDefault';
  }

  function _colorSuggestion(node, property) {
    const role = _colorRoleFor(node, property);
    const variable = _ds.colorRoles[role] || null;
    return _suggestion('variable', variable, variable ? 'medium' : 'none',
      variable ? 'Suggested from semantic role "' + role + '".' : 'No semantic color variable found for role "' + role + '".');
  }

  function _textRolePatterns(node) {
    const name = _nameText(node);
    if (/display|hero/.test(name)) return { role: 'display', patterns: ['type/display/lg', 'display/lg', 'display large'] };
    if (/headline|heading|title|h1|h2|h3/.test(name)) return { role: 'title', patterns: ['type/title/md', 'title/md', 'title medium', 'type/headline/md', 'headline/md'] };
    if (/label|caption|eyebrow|meta/.test(name)) return { role: 'label', patterns: ['type/label/md', 'label/md', 'type/label/sm', 'label/sm', 'caption'] };
    return { role: 'body', patterns: ['type/body/md', 'body/md', 'body medium', 'paragraph', 'type/body/sm', 'body/sm'] };
  }

  function _typographySuggestion(node) {
    const match = _textRolePatterns(node);
    const binding = _ds.pickTypographyBinding(match.role, match.patterns);
    if (binding.kind === 'style' && binding.style) {
      return {
        kind: 'textStyle',
        name: binding.style.name,
        id: binding.style.id,
        confidence: 'medium',
        reason: 'Text styles have priority; matched role "' + match.role + '".'
      };
    }
    if (binding.kind === 'variables' && binding.variables) {
      const variable = binding.variables.sizeVar || binding.variables.lineHeightVar || binding.variables.weightVar || binding.variables.familyVar;
      return _suggestion('typographyVariables', variable, variable ? 'medium' : 'none',
        variable ? 'Typography variables found for role "' + match.role + '".' : binding.warning);
    }
    return { kind: 'none', confidence: 'none', reason: binding.warning };
  }

  function _pushViolation(node, property, rawValue, type, details) {
    details = details || {};
    const violation = {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      property: property,
      rawValue: rawValue,
      type: type,
      suggestion: details.suggestion || { kind: 'none', confidence: 'none', reason: 'No suggestion.' }
    };
    if (details.fillIndex !== undefined) violation.fillIndex = details.fillIndex;
    if (details.strokeIndex !== undefined) violation.strokeIndex = details.strokeIndex;
    violations.push(violation);
    return violation;
  }

  function _applyQaFix(violation) {
    const node = figma.getNodeById(violation.nodeId);
    if (!node) return 'NODE_NOT_FOUND';
    const suggestion = violation.suggestion || {};
    if (!suggestion.id) return 'NO_SUGGESTION';
    if (suggestion.confidence !== 'high') return 'LOW_CONFIDENCE';
    const variable = _ds.varById[suggestion.id] || null;

    if (violation.property === 'Text style') {
      const style = _ds.textStyles.find(function (s) { return s.id === suggestion.id; });
      if (!style) return 'STYLE_NOT_FOUND';
      try { node.textStyleId = style.id; return 'OK'; } catch (e) { return e.message || 'STYLE_BIND_FAILED'; }
    }

    if (violation.property === 'Font size') {
      const binding = _typographySuggestion(node);
      if (binding.kind !== 'typographyVariables') return 'NO_TYPOGRAPHY_VARIABLES';
      const role = _textRolePatterns(node);
      const group = _ds.pickTypographyBinding(role.role, role.patterns).variables;
      if (!group) return 'NO_TYPOGRAPHY_VARIABLES';
      if (group.sizeVar) _ds.bindVar(node, 'fontSize', group.sizeVar);
      if (group.lineHeightVar) {
        if (typeof group.lineHeightValue === 'number') node.lineHeight = { value: group.lineHeightValue, unit: 'PIXELS' };
        _ds.bindVar(node, 'lineHeight', group.lineHeightVar);
      }
      if (group.trackingVar) {
        if (typeof group.trackingValue === 'number') node.letterSpacing = { value: group.trackingValue, unit: 'PIXELS' };
        _ds.bindVar(node, 'letterSpacing', group.trackingVar);
      }
      if (group.weightVar) _ds.bindVar(node, 'fontWeight', group.weightVar);
      if (group.familyVar) _ds.bindVar(node, 'fontFamily', group.familyVar);
      return 'OK';
    }

    if (!variable) return 'VAR_NOT_FOUND';
    if (violation.property === 'Fill color') {
      const fills = JSON.parse(JSON.stringify(node.fills));
      fills[violation.fillIndex || 0] = figma.variables.setBoundVariableForPaint(fills[violation.fillIndex || 0], 'color', variable);
      node.fills = fills;
      return 'OK';
    }
    if (violation.property === 'Stroke color') {
      const strokes = JSON.parse(JSON.stringify(node.strokes));
      strokes[violation.strokeIndex || 0] = figma.variables.setBoundVariableForPaint(strokes[violation.strokeIndex || 0], 'color', variable);
      node.strokes = strokes;
      return 'OK';
    }
    if (violation.property === 'Stroke weight') {
      const isFrameLike = node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET';
      if (node.type === 'TEXT' || !isFrameLike) _ds.bindVar(node, 'strokeWeight', variable);
      else ['strokeTopWeight','strokeBottomWeight','strokeLeftWeight','strokeRightWeight'].forEach(function (p) { _ds.bindVar(node, p, variable); });
      return 'OK';
    }
    if (violation.property === 'Corner radius') {
      ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'].forEach(function (p) { _ds.bindVar(node, p, variable); });
      return 'OK';
    }
    if (['paddingTop','paddingBottom','paddingLeft','paddingRight','itemSpacing','counterAxisSpacing'].indexOf(violation.property) >= 0) {
      _ds.bindVar(node, violation.property, variable);
      return 'OK';
    }
    return 'UNKNOWN_PROPERTY';
  }

  function _auditNode(node) {
    if (truncated) return;
    if (!node || node.type === 'INSTANCE') return;
    if (auditedNodeCount >= maxNodes) {
      truncated = true;
      truncateReason = 'MAX_NODES';
      return;
    }
    if ((Date.now() - startedAt) > deadlineMs) {
      truncated = true;
      truncateReason = 'DEADLINE';
      return;
    }

    auditedNodeCount++;

    if (node.fills && Array.isArray(node.fills)) {
      for (let i = 0; i < node.fills.length; i++) {
        const fill = node.fills[i];
        if (fill && fill.type === 'SOLID' && !(node.boundVariables && node.boundVariables.fills && node.boundVariables.fills[i])) {
          _pushViolation(node, 'Fill color', _rgbText(fill.color), 'color', { fillIndex: i, suggestion: _colorSuggestion(node, 'Fill color') });
        }
      }
    }

    if (node.strokes && Array.isArray(node.strokes)) {
      for (let i = 0; i < node.strokes.length; i++) {
        const stroke = node.strokes[i];
        if (stroke && stroke.type === 'SOLID' && !(node.boundVariables && node.boundVariables.strokes && node.boundVariables.strokes[i])) {
          _pushViolation(node, 'Stroke color', _rgbText(stroke.color), 'color', { strokeIndex: i, suggestion: _colorSuggestion(node, 'Stroke color') });
        }
      }
    }

    if (node.strokes && node.strokes.length > 0 && typeof node.strokeWeight === 'number' && node.strokeWeight !== 0) {
      const swBound = node.boundVariables && (
        node.boundVariables.strokeWeight ||
        (
          node.boundVariables.strokeTopWeight &&
          node.boundVariables.strokeRightWeight &&
          node.boundVariables.strokeBottomWeight &&
          node.boundVariables.strokeLeftWeight
        )
      );
      if (!swBound) {
        const variable = _ds.pickFloatByValue(node.strokeWeight, 'border');
        _pushViolation(node, 'Stroke weight', node.strokeWeight + 'px', 'border', {
          suggestion: _suggestion('variable', variable, variable ? 'high' : 'none', variable ? 'Exact value and border semantics.' : 'No exact border variable found.')
        });
      }
    }

    if (node.type !== 'TEXT' && typeof node.cornerRadius === 'number' && node.cornerRadius !== 0) {
      if (!(node.boundVariables && node.boundVariables.topLeftRadius)) {
        const variable = _ds.pickFloatByValue(node.cornerRadius, 'radius');
        _pushViolation(node, 'Corner radius', node.cornerRadius + 'px', 'border', {
          suggestion: _suggestion('variable', variable, variable ? 'high' : 'none', variable ? 'Exact value and radius semantics.' : 'No exact radius variable found.')
        });
      }
    }

    if (node.layoutMode && node.layoutMode !== 'NONE') {
      ['paddingTop','paddingBottom','paddingLeft','paddingRight','itemSpacing','counterAxisSpacing'].forEach(function (prop) {
        if (typeof node[prop] === 'number' && node[prop] !== 0 && !(node.boundVariables && node.boundVariables[prop])) {
          const variable = _ds.pickFloatByValue(node[prop], 'spacing');
          _pushViolation(node, prop, node[prop] + 'px', 'spacing', {
            suggestion: _suggestion('variable', variable, variable ? 'high' : 'none', variable ? 'Exact value and spacing semantics.' : 'No exact spacing variable found.')
          });
        }
      });
    }

    if (node.type === 'TEXT') {
      if (_ds.textStyles.length > 0) {
        if (!node.textStyleId || node.textStyleId === figma.mixed) {
          _pushViolation(node, 'Text style', node.fontSize !== figma.mixed ? node.fontSize + 'px' : 'mixed', 'typography', {
            suggestion: _typographySuggestion(node)
          });
        }
      } else if (node.fontSize !== figma.mixed && !(node.boundVariables && node.boundVariables.fontSize)) {
        _pushViolation(node, 'Font size', node.fontSize + 'px', 'typography', {
          suggestion: _typographySuggestion(node)
        });
      }
    }

    if ('children' in node && node.children) {
      for (let i = 0; i < node.children.length; i++) {
        if (truncated) break;
        _auditNode(node.children[i]);
      }
    }
  }

  for (let i = 0; i < scopeNodes.length; i++) {
    if (truncated) break;
    _auditNode(scopeNodes[i]);
  }

  if (shouldFix) {
    for (let i = 0; i < violations.length; i++) {
      const v = violations[i];
      if (!v.suggestion || v.suggestion.confidence !== 'high') continue;
      const result = _applyQaFix(v);
      if (result === 'OK') fixed.push({ nodeId: v.nodeId, nodeName: v.nodeName, property: v.property, boundTo: v.suggestion.name });
      else failed.push({ nodeId: v.nodeId, nodeName: v.nodeName, property: v.property, reason: result });
    }
  }

  const byType = {};
  for (let i = 0; i < violations.length; i++) byType[violations[i].type] = (byType[violations[i].type] || 0) + 1;

  return {
    scope: scopeLabel,
    fileName: figma.root ? figma.root.name : '',
    pageName: figma.currentPage ? figma.currentPage.name : '',
    selectedCount: figma.currentPage.selection.length,
    checkedRootCount: scopeNodes.length,
    auditedNodeCount: auditedNodeCount,
    truncated: truncated,
    truncateReason: truncateReason,
    maxNodes: maxNodes,
    deadlineMs: deadlineMs,
    violationCount: violations.length,
    byType: byType,
    fixApplied: shouldFix,
    fixedCount: fixed.length,
    failedCount: failed.length,
    fixed: fixed,
    failed: failed,
    violations: violations
  };
}

// ── Showcase implementation ──────────────────────────────────────────────────
// Ported from figlets skills/fig-ds-showcase — all rendering via Figma Plugin API.

async function _buildShowcase(opts) {
  opts = opts || {};
  const _numericFallback = opts.numericFallback || {};

  // ── detect-ds-structure ────────────────────────────────────────────────────

  const _dsStruct_allVars  = await figma.variables.getLocalVariablesAsync();
  const _dsStruct_allColls = await figma.variables.getLocalVariableCollectionsAsync();
  const textStyles          = await figma.getLocalTextStylesAsync();
  const effectStyles        = await figma.getLocalEffectStylesAsync();
  const _binding = await _createDsBindingContext();
  const _showcaseBindingWarnings = [];
  const _showcaseBindingWarningSet = {};
  function _warnShowcaseBinding(message) {
    if (!message || _showcaseBindingWarningSet[message]) return;
    _showcaseBindingWarningSet[message] = true;
    _showcaseBindingWarnings.push(message);
  }

  const varByName = Object.fromEntries(
    [..._dsStruct_allVars]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(v => [v.name, v])
  );

  function resolveVarValue(v, _depth) {
    if (!v) return null;
    if (_depth === undefined) _depth = 0;
    if (_depth > 8) return null;
    const modeId = Object.keys(v.valuesByMode)[0];
    const val = v.valuesByMode[modeId];
    if (!val && val !== 0) return null;
    if (typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
      const aliased = figma.variables.getVariableById(val.id);
      return aliased ? resolveVarValue(aliased, _depth + 1) : null;
    }
    return val;
  }

  function groupByPath(vars, depth) {
    const groups = {};
    for (const v of vars) {
      const parts = v.name.split('/');
      let key;
      if (depth !== undefined) {
        key = parts.slice(0, depth).join('/');
      } else {
        key = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(v);
    }
    return groups;
  }

  const _collIdSets = new Map(
    _dsStruct_allColls.map(c => [c.id, new Set(c.variableIds)])
  );

  const dsCollections = [..._dsStruct_allColls]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(coll => {
      const vars = _dsStruct_allVars
        .filter(v => coll.variableIds.includes(v.id))
        .sort((a, b) => a.name.localeCompare(b.name));

      const colorVars     = vars.filter(v => v.resolvedType === 'COLOR');
      const floatVars     = vars.filter(v => v.resolvedType === 'FLOAT');
      const colorVarCount = colorVars.length;
      const floatVarCount = floatVars.length;
      const myIds         = _collIdSets.get(coll.id);

      let selfAliasCount  = 0;
      let crossAliasCount = 0;
      for (const v of vars) {
        const modeId = Object.keys(v.valuesByMode)[0];
        const val    = v.valuesByMode[modeId];
        if (!val || typeof val !== 'object' || val.type !== 'VARIABLE_ALIAS') continue;
        if (myIds.has(val.id)) selfAliasCount++;
        else crossAliasCount++;
      }
      const aliasCount = selfAliasCount + crossAliasCount;

      const modeNames    = coll.modes.map(m => m.name);
      const hasLightMode = modeNames.some(n => /light|day|bright/i.test(n));
      const hasDarkMode  = modeNames.some(n => /dark|night|dim/i.test(n));
      const hasLightDark = hasLightMode && hasDarkMode;

      const numericLeafCount = colorVars.filter(v => /^\d+$/.test(v.name.split('/').pop())).length;
      const hasNumericSteps  = colorVarCount > 0 && numericLeafCount >= colorVarCount * 0.3;

      const crossAliasRatio = vars.length > 0 ? crossAliasCount / vars.length : 0;
      const totalAliasRatio = vars.length > 0 ? aliasCount       / vars.length : 0;

      const isPrimitive = vars.length === 0
        ? false
        : !hasLightDark &&
          (hasNumericSteps
            ? crossAliasRatio < 0.3
            : totalAliasRatio < 0.2 && crossAliasRatio < 0.1);

      const isAlias = vars.length > 0
        && (hasLightDark || crossAliasRatio > 0.4 || (!hasNumericSteps && totalAliasRatio > 0.7));

      const _rawColorGroups = colorVarCount > 0 ? groupByPath(colorVars) : {};
      const colorGroups = Object.fromEntries(
        Object.keys(_rawColorGroups)
          .sort((a, b) => a.localeCompare(b))
          .map(k => [k, _rawColorGroups[k]])
      );

      return {
        id: coll.id,
        name: coll.name,
        modeNames,
        varCount: vars.length,
        colorVarCount,
        floatVarCount,
        aliasCount,
        selfAliasCount,
        crossAliasCount,
        isPrimitive,
        isAlias,
        hasLightDark,
        hasNumericSteps,
        hasMultipleModes: coll.modes.length > 1,
        vars,
        colorGroups,
        groups: groupByPath(vars),
        topLevelGroups: groupByPath(vars, 1),
      };
    });

  // ── showcase-shared ────────────────────────────────────────────────────────

  function _lum({ r, g, b }) {
    return [r, g, b]
      .map(c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function _hex({ r, g, b }) {
    const h = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  function _sat({ r, g, b }) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  }
  function _contrastRatio(c1, c2) {
    const L1 = _lum(c1), L2 = _lum(c2);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  }

  const _configuredCollections = opts.DS && opts.DS.collections ? opts.DS.collections : null;
  const _configuredPrimName = _configuredCollections ? _configuredCollections.primitives : null;
  const _configuredColorName = _configuredCollections ? _configuredCollections.color : null;
  const _configuredTypoName = _configuredCollections ? _configuredCollections.typography : null;
  const _configuredSpacingName = _configuredCollections ? _configuredCollections.spacing : null;
  const _configuredElevationName = _configuredCollections ? _configuredCollections.elevation : null;

  const _semColl = _configuredColorName
    ? dsCollections.find(c => c.name === _configuredColorName && c.colorVarCount > 0)
    : dsCollections.find(c => c.isAlias && c.colorVarCount > 0);
  const _primColls = _configuredPrimName
    ? dsCollections.filter(c => c.name === _configuredPrimName && c.colorVarCount > c.floatVarCount)
    : dsCollections.filter(c => c.isPrimitive && c.colorVarCount > c.floatVarCount);
  const _semanticColls = _configuredColorName
    ? dsCollections.filter(c => c.name === _configuredColorName && c.colorVarCount > 0)
    : dsCollections.filter(c => c.isAlias && c.colorVarCount > 0);
  const _floatColls    = dsCollections.filter(c =>
    c.floatVarCount > c.colorVarCount &&
    (!_configuredTypoName || c.name !== _configuredTypoName || c.floatVarCount > 0) &&
    (!_configuredSpacingName || c.name !== _configuredSpacingName || c.floatVarCount > 0) &&
    (!_configuredElevationName || c.name !== _configuredElevationName || c.floatVarCount > 0) &&
    (!_configuredCollections ||
      c.name === _configuredTypoName ||
      c.name === _configuredSpacingName ||
      c.name === _configuredElevationName ||
      (!c.isAlias || (c.colorVarCount === 0 && c.floatVarCount > 0))) &&
    (!c.isAlias || (c.colorVarCount === 0 && c.floatVarCount > 0))
  );



  const _semVars = _semColl
    ? _semColl.vars.filter(v => v.resolvedType === 'COLOR')
    : Object.values(varByName).filter(v => v.resolvedType === 'COLOR');

  function _resolvedRGB(v) {
    const c = resolveVarValue(v);
    return c && 'r' in c ? { r: c.r, g: c.g, b: c.b } : null;
  }
  function _isDecorativeColorName(name) {
    return /(?:^|\/)(scrim|overlay|state|shadow|elevation)(?:\/|$)/i.test(String(name || ''));
  }
  const _semRoleVars = _semVars.filter(v => !_isDecorativeColorName(v.name));

  const _bgRaw = (() => {
    const named = _semRoleVars.find(v => {
      if (/(?:^|\/)on[-_]/i.test(v.name)) return false;
      return /(?:surface|background|base|page)(?:[/_-]default)?$/i.test(v.name);
    });
    if (named) return { v: named };
    return _semRoleVars.map(v => ({ v, l: _resolvedRGB(v) ? _lum(_resolvedRGB(v)) : 0 })).sort((a, b) => b.l - a.l)[0];
  })();
  const _textRaw = (() => {
    const named = _semRoleVars.find(v => /(?:on[-_]surface|foreground)(?:[/_-]default)?$/i.test(v.name));
    if (named) return { v: named };
    return _semRoleVars.map(v => ({ v, l: _resolvedRGB(v) ? _lum(_resolvedRGB(v)) : 1 })).sort((a, b) => a.l - b.l)[0];
  })();
  const _accRaw  = _semRoleVars.map(v => ({ v, s: _resolvedRGB(v) ? _sat(_resolvedRGB(v)) : 0 })).sort((a, b) => b.s - a.s)[0];

  const _bgColor   = _bgRaw   ? _resolvedRGB(_bgRaw.v)   : { r: 1,   g: 1,   b: 1   };
  const _textColor = _textRaw ? _resolvedRGB(_textRaw.v) : { r: 0.1, g: 0.1, b: 0.1 };
  const _accColor  = _accRaw  ? _resolvedRGB(_accRaw.v)  : { r: 0,   g: 0.47,b: 1   };

  const _subColor = {
    r: _bgColor.r * 0.6 + _textColor.r * 0.4,
    g: _bgColor.g * 0.6 + _textColor.g * 0.4,
    b: _bgColor.b * 0.6 + _textColor.b * 0.4,
  };

  const _sortedStyles  = textStyles.slice().sort((a, b) => b.fontSize - a.fontSize);

  const _fontSet = new Map();
  for (const s of textStyles) {
    const k = `${s.fontName.family}::${s.fontName.style}`;
    if (!_fontSet.has(k)) _fontSet.set(k, s.fontName);
  }
  _fontSet.set('Inter::Regular', { family: 'Inter', style: 'Regular' });
  _fontSet.set('Inter::Medium',  { family: 'Inter', style: 'Medium'  });

  const _dsFamily = textStyles.length > 0 ? textStyles[0].fontName.family : 'Inter';
  _fontSet.set(`${_dsFamily}::Regular`, { family: _dsFamily, style: 'Regular' });

  // Resolve semibold style name — varies by foundry ('SemiBold', 'Semi Bold', etc.).
  // Try candidates in order; first one that loads wins.
  const _SEMIBOLD_CANDIDATES = ['SemiBold', 'Semi Bold', 'Semibold', 'Demi Bold', 'DemiBold', 'Bold'];
  let _semiboldStyle = 'Regular';
  for (const _sc of _SEMIBOLD_CANDIDATES) {
    try { await figma.loadFontAsync({ family: _dsFamily, style: _sc }); _semiboldStyle = _sc; break; } catch (_) {}
  }
  _fontSet.set(`${_dsFamily}::${_semiboldStyle}`, { family: _dsFamily, style: _semiboldStyle });

  // Load all remaining fonts — individual failures are silently skipped.
  await Promise.all([..._fontSet.values()].map(f => figma.loadFontAsync(f).catch(() => {})));

  const _C = {
    outlineSubtle:  { r: 0.894, g: 0.894, b: 0.906 },
    surfaceDefault: { r: 0.980, g: 0.980, b: 0.980 },
    surfaceVariant: { r: 0.957, g: 0.957, b: 0.961 },
    brandVariant:   { r: 0.957, g: 0.953, b: 0.988 },
    onBrandVariant: { r: 0.271, g: 0.247, b: 0.616 },
    successBg:      { r: 0.086, g: 0.502, b: 0.239 },
    successBorder:  { r: 0.086, g: 0.639, b: 0.290 },
    successText:    { r: 0.980, g: 0.980, b: 0.980 },
    warningBg:      { r: 0.706, g: 0.325, b: 0.035 },
    warningBorder:  { r: 0.851, g: 0.533, b: 0.024 },
    warningText:    { r: 0.980, g: 0.980, b: 0.980 },
    onSurface:      { r: 0.094, g: 0.094, b: 0.106 },
    onSurfaceLight: { r: 0.980, g: 0.980, b: 0.980 },
  };

  function _findVar(...names) {
    for (const n of names) if (varByName[n]) return varByName[n];
    return null;
  }

  function _paint(fallbackRGB, varOrNull) {
    const base = { type: 'SOLID', color: fallbackRGB };
    return varOrNull
      ? figma.variables.setBoundVariableForPaint(base, 'color', varOrNull)
      : base;
  }

  // ── Semantic variable map ─────────────────────────────────────────────────
  // Two-layer scoring system — every path segment contributes to semantic
  // categories, and each role defines how much it cares about each category.
  //
  //   Layer 1 — _SEG: segment keyword → semantic categories (always >= 0).
  //     Each slash-separated segment is looked up. Its category contributions
  //     accumulate into a per-path map.
  //     "on-surface"    → { FG: 3 }
  //     "brand-variant" → { BRAND: 1, BVAR: 3 }
  //
  //   Layer 2 — _ROLE: role → category weights (positive = reward, negative = penalty).
  //     Final score = dot product of path category map with role weights.
  //     "onBrandVariant" = { FG: 3, BG: -4, BRAND: 3, BVAR: 2 }
  //
  // Why this beats per-role flat dictionaries:
  //   - "on-surface/brand-variant" scores 18 for onBrandVariant regardless of
  //     what the qualifier after "on-surface" is — no manual enumeration needed.
  //   - "on-surface/default" scores 9 (no BRAND/BVAR) — correctly loses.
  //   - "surface/brand-variant" scores -3 (BG*-4 dominates) — excluded.
  //   - "fg/primary", "foreground/brand", "text/brand-variant" all bind correctly
  //     to their roles via category accumulation, no explicit entry required.
  //   - Functional fallback (contrast/lum/sat) only runs when NO variable
  //     scores above zero — DS has entirely non-semantic naming.

  // _SEG: segment keyword → semantic category contributions (always non-negative).
  const _SEG = {
    // BG family — indicates a background / surface token
    'surface':       { BG: 3 },
    'background':    { BG: 3 },
    'bg':            { BG: 2 },
    'canvas':        { BG: 2 },
    'base':          { BG: 1 },
    'page':          { BG: 1 },
    'fill':          { BG: 1 },
    'container':     { BG: 1, BRAND: 1 },
    // FG family — indicates a foreground / text token
    'on-surface':    { FG: 3 },
    'on_surface':    { FG: 3 },
    'foreground':    { FG: 3 },
    'fg':            { FG: 2 },
    'text':          { FG: 2 },
    'icon':          { FG: 1 },
    'label':         { FG: 1 },
    'content':       { FG: 1 },
    'on':            { FG: 1 },
    // On-brand variants (FG that lives on a brand surface)
    'on-brand':      { FG: 2, BRAND: 2 },
    'on_brand':      { FG: 2, BRAND: 2 },
    'on-primary':    { FG: 2, BRAND: 2 },
    'on_primary':    { FG: 2, BRAND: 2 },
    // Brand / primary family
    'brand':         { BRAND: 2 },
    'primary':       { BRAND: 2 },
    'accent':        { ACCENT: 2 },
    'action':        { BRAND: 1 },
    'interactive':   { BRAND: 1 },
    // Brand-variant (a secondary brand surface, distinct from main brand)
    'brand-variant': { BRAND: 1, BVAR: 3 },
    'brand_variant': { BRAND: 1, BVAR: 3 },
    // Modifiers
    'default':       { DEFAULT: 1 },
    'variant':       { VARIANT: 2 },
    'subtle':        { VARIANT: 1 },
    'muted':         { VARIANT: 2 },
    'secondary':     { VARIANT: 1 },
    'sub':           { VARIANT: 1 },
    'weak':          { VARIANT: 1 },
    'strong':        { STRONG: 1 },
    // Outline / border family
    'outline':       { OUTLINE: 3 },
    'border':        { OUTLINE: 3 },
    'stroke':        { OUTLINE: 2 },
    'divider':       { OUTLINE: 3 },
    'separator':     { OUTLINE: 3 },
    'line':          { OUTLINE: 1 },
    // Status families — combined with BG/FG/OUTLINE to resolve bg/text/border.
    // Note: 'danger' and 'error' get their own DANGER category, not WARNING, so
    // they never bleed into warning badge slots when warning tokens are missing.
    'success':       { SUCCESS: 3 },
    'positive':      { SUCCESS: 2 },
    'confirm':       { SUCCESS: 1 },
    'warning':       { WARNING: 3 },
    'caution':       { WARNING: 2 },
    'alert':         { WARNING: 1 },
    'danger':        { DANGER: 2 },
    'error':         { DANGER: 2 },
  };

  // _ROLE: semantic role → category weights. Positive rewards, negative penalises.
  // Final score = dot product of path category accumulator with role weights.
  const _ROLE = {
    onSurface:      { FG: 3, BG: -4, VARIANT: -1, DEFAULT: 1, STRONG: 1 },
    onSurfaceVar:   { FG: 3, BG: -4, VARIANT: 2 },
    surfaceDefault: { BG: 3, FG: -4, VARIANT: -1, DEFAULT: 2, BRAND: -2 },
    surfaceVariant: { BG: 3, FG: -4, VARIANT: 2 },
    surfaceBrand:   { BG: 2, FG: -4, BRAND: 3 },
    brandVariant:   { BG: 2, FG: -4, BVAR: 3, BRAND: 1 },
    onBrandVariant: { FG: 3, BG: -4, BRAND: 3, BVAR: 2 },
    outlineSubtle:  { OUTLINE: 3, FG: -2, BG: -2 },
    outlineBrand:   { OUTLINE: 3, FG: -2, BG: -2, BRAND: 3 },
    successBg:      { SUCCESS: 3, BG: 2, FG: -3, OUTLINE: -2, WARNING: -6, DANGER: -6 },
    successBorder:  { SUCCESS: 3, OUTLINE: 2, BG: -2, FG: -1, WARNING: -6, DANGER: -6 },
    successText:    { SUCCESS: 3, FG: 2, BG: -3, OUTLINE: -2, WARNING: -6, DANGER: -6 },
    warningBg:      { WARNING: 3, BG: 2, FG: -3, OUTLINE: -2, SUCCESS: -6, DANGER: -6 },
    warningBorder:  { WARNING: 3, OUTLINE: 2, BG: -2, FG: -1, SUCCESS: -6, DANGER: -6 },
    warningText:    { WARNING: 3, FG: 2, BG: -3, OUTLINE: -2, SUCCESS: -6, DANGER: -6 },
  };

  // Accumulate category scores from each slash-separated path segment.
  function _pathCats(name) {
    var segments = name.toLowerCase().split('/');
    var cats = {};
    for (var i = 0; i < segments.length; i++) {
      var segCats = _SEG[segments[i]];
      if (!segCats) continue;
      for (var cat in segCats) {
        cats[cat] = (cats[cat] || 0) + segCats[cat];
      }
    }
    return cats;
  }

  // Dot-product of a path's accumulated categories with a role's weight vector.
  function _segScore(name, role) {
    var pathCats = _pathCats(name);
    var roleWeights = _ROLE[role];
    if (!roleWeights) return 0;
    var total = 0;
    for (var rcat in roleWeights) {
      total += roleWeights[rcat] * (pathCats[rcat] || 0);
    }
    return total;
  }

  // Pick the best variable for a semantic role:
  //   1. Score every COLOR var by summing its path segment scores for the role.
  //   2. Optionally require certain categories to be present (requiredCats array).
  //      A variable that doesn't contribute to a required category is skipped.
  //   3. Take the variable with the highest positive score (scorer breaks ties).
  //   4. If nothing qualifies: status tokens return null (nameOnly=true);
  //      structural tokens fall back to the functional scorer as a last resort.
  function _semPick(role, scorer, nameOnly, requiredCats) {
    var best = null, bestSeg = 0;
    for (var i = 0; i < _scored.length; i++) {
      var s = _scored[i];
      var seg = _segScore(s.name, role);
      if (seg <= 0) continue;
      if (requiredCats) {
        var pCats = _pathCats(s.name);
        var ok = true;
        for (var ci = 0; ci < requiredCats.length; ci++) {
          if ((pCats[requiredCats[ci]] || 0) <= 0) { ok = false; break; }
        }
        if (!ok) continue;
      }
      if (best === null || seg > bestSeg || (seg === bestSeg && scorer(s) > scorer(best))) {
        best = s; bestSeg = seg;
      }
    }
    if (best !== null) return best.v;

    // Purpose-locked roles: never cross purpose boundaries via functional fallback
    if (nameOnly || requiredCats) return null;

    // Functional last resort — DS has no recognisable semantic naming at all
    var funcBest = null, funcScore = 0;
    for (var j = 0; j < _scored.length; j++) {
      var sc = scorer(_scored[j]);
      if (sc > funcScore) { funcScore = sc; funcBest = _scored[j]; }
    }
    return funcBest ? funcBest.v : null;
  }

  const _allColorVars = Object.values(varByName).filter(v => v.resolvedType === 'COLOR' && !_isDecorativeColorName(v.name));
  const _scored = _allColorVars.map(v => {
    const rgb = _resolvedRGB(v);
    if (!rgb) return null;
    return {
      v,
      rgb,
      lum: _lum(rgb),
      sat: _sat(rgb),
      contrast: _contrastRatio(rgb, _bgColor),
      name: v.name.toLowerCase(),
    };
  }).filter(Boolean);

  const _V = {
    bg:   _bgRaw  && _bgRaw.v  ? _bgRaw.v  : null,
    text: _textRaw && _textRaw.v ? _textRaw.v : null,
    acc:  _accRaw  && _accRaw.v  ? _accRaw.v  : null,

    onSurface:    _semPick('onSurface',    s => s.contrast >= 4.5 ? s.contrast : 0),
    onSurfaceVar: _semPick('onSurfaceVar', s => s.contrast >= 2 && s.contrast < 9 ? s.contrast : 0),
    surfaceDefault: _semPick('surfaceDefault', s => s.lum),
    surfaceVariant: _semPick('surfaceVariant', s => s.lum * (1 - s.sat)),
    surfaceBrand:   _semPick('surfaceBrand',   s => s.sat * 0.5 + s.lum * 0.5),
    brandVariant:   _semPick('brandVariant',   s => s.sat * 0.4 + s.lum * 0.6),

    // Resolved after brandVariant is settled below
    onBrandVariant: null,

    outlineSubtle: _semPick('outlineSubtle', s => {
      if (s.lum > 0.9 || s.lum < 0.05) return 0;
      var dist = Math.abs(s.lum - 0.6);
      if (dist > 0.5) return 0;
      return (1 - s.sat) * (1 - dist * 2);
    }, false, ['OUTLINE']),
    outlineBrand: _semPick('outlineBrand', s => {
      if (s.lum < 0.05 || s.lum > 0.95) return 0;
      var dist = Math.abs(s.lum - 0.4);
      if (dist > 0.5) return 0;
      return s.sat * (1 - dist * 1.5);
    }, false, ['OUTLINE']),

    // Status tokens — null if the DS has no recognisable status-named variables.
    // requiredCats enforces purpose: fills must come from surface/bg tokens,
    // borders from outline/border tokens, text from fg/text tokens.
    successBg:     _semPick('successBg',     s => s.sat,                               true, ['BG',      'SUCCESS']),
    successBorder: _semPick('successBorder', s => s.sat,                               true, ['OUTLINE', 'SUCCESS']),
    successText:   _semPick('successText',   s => s.contrast >= 4.5 ? s.contrast : 0, true, ['FG',      'SUCCESS']),
    warningBg:     _semPick('warningBg',     s => s.sat,                               true, ['BG',      'WARNING']),
    warningBorder: _semPick('warningBorder', s => s.sat,                               true, ['OUTLINE', 'WARNING']),
    warningText:   _semPick('warningText',   s => s.contrast >= 4.5 ? s.contrast : 0, true, ['FG',      'WARNING']),
  };

  // Showcase chrome should prefer explicit generic tokens over scored brand
  // foregrounds. The segment scorer may correctly identify color/text/on-brand
  // as a foreground, but it is only readable on brand fills, not on table rows.
  _V.textSub = _findVar(
    'color/text/subtle', 'text/subtle',
    'color/text/muted', 'text/muted',
    'color/on-surface/variant', 'on-surface/variant'
  ) || _V.onSurfaceVar;

  _V.brandVariant = _findVar(
    'color/bg/brand-subtle',
    'color/surface/brand-variant',
    'color/surface/primary-container',
    'color/bg/brand'
  ) || _V.brandVariant;

  _V.onBrandVariant = _findVar(
    'color/text/brand',
    'color/on-surface/brand-variant',
    'color/text/on-brand',
    'color/on-brand'
  ) || _V.onBrandVariant;

  // Kept for onBrandVariant fallback below — scans all vars by contrast
  function _findContrastVar(bgRGB, minRatio) {
    minRatio = minRatio || 4.5;
    var best = null, bestRatio = 0;
    var preferred = Object.values(varByName).filter(function(v) {
      return v.resolvedType === 'COLOR' &&
        !_isDecorativeColorName(v.name) &&
        /(?:on[-_]surface|foreground|(?:^|\/)text(?:[-_\/]|$))/i.test(v.name);
    });
    var candidates = preferred.length ? preferred : Object.values(varByName).filter(function(v) {
      return v.resolvedType === 'COLOR' && !_isDecorativeColorName(v.name);
    });
    for (var i = 0; i < candidates.length; i++) {
      var v = candidates[i];
      var raw = resolveVarValue(v);
      if (!raw || !('r' in raw)) continue;
      var ratio = _contrastRatio({ r: raw.r, g: raw.g, b: raw.b }, bgRGB);
      if (ratio >= minRatio && ratio > bestRatio) { bestRatio = ratio; best = v; }
    }
    return best;
  }

  // brandVariant: if not found above, try surfaceBrand role as a wider net
  if (!_V.brandVariant) {
    _V.brandVariant = _semPick('surfaceBrand', s => s.sat * 0.4 + s.lum * 0.6)
      || _V.surfaceVariant || null;
  }

  // onBrandVariant: scored against the actual brand surface, not the default bg
  if (!_V.onBrandVariant) {
    var _bvRaw = _V.brandVariant ? resolveVarValue(_V.brandVariant) : null;
    var _bvRGB = _bvRaw && 'r' in _bvRaw ? { r: _bvRaw.r, g: _bvRaw.g, b: _bvRaw.b } : _C.brandVariant;
    _V.onBrandVariant = _semPick(
      'onBrandVariant',
      s => { var c = _contrastRatio(s.rgb, _bvRGB); return c >= 3 ? c : 0; }
    ) || _findContrastVar(_bvRGB) || _V.text || null;
  }

  // surfaceBrand final fallback: accent color is the closest proxy
  if (!_V.surfaceBrand) {
    _V.surfaceBrand = _V.acc || null;
  }

  // textSub final fallback: best contrast at 3:1+ on the default surface
  if (!_V.textSub) {
    _V.textSub = _findContrastVar(_bgColor, 3) || _V.text || null;
  }

  // ── Resolved-color map (_RC) ──────────────────────────────────────────────
  // Every entry resolves its _V variable to an actual RGB, then falls back to
  // the hardcoded _C constant only if the variable is null or unresolvable.
  // Use _RC.xxx as the color argument in _paint()/_tDS() so that even the
  // static fallback shown when a variable is absent reflects the live DS palette.

  function _resolvedOrFallback(v, hardcode) {
    if (!v) return hardcode;
    const rgb = _resolvedRGB(v);
    return rgb ? rgb : hardcode;
  }

  const _RC = {
    outlineSubtle:  _resolvedOrFallback(_V.outlineSubtle,  _C.outlineSubtle),
    surfaceDefault: _resolvedOrFallback(_V.surfaceDefault, _C.surfaceDefault),
    surfaceVariant: _resolvedOrFallback(_V.surfaceVariant, _C.surfaceVariant),
    surfaceBrand:   _resolvedOrFallback(_V.surfaceBrand,   _accColor),
    brandVariant:   _resolvedOrFallback(_V.brandVariant,   _C.brandVariant),
    onBrandVariant: _resolvedOrFallback(_V.onBrandVariant, _C.onBrandVariant),
    onSurface:      _resolvedOrFallback(_V.onSurface,      _C.onSurface),
    successBg:      _resolvedOrFallback(_V.successBg,      _C.successBg),
    successBorder:  _resolvedOrFallback(_V.successBorder,  _C.successBorder),
    successText:    _resolvedOrFallback(_V.successText,    _C.successText),
    warningBg:      _resolvedOrFallback(_V.warningBg,      _C.warningBg),
    warningBorder:  _resolvedOrFallback(_V.warningBorder,  _C.warningBorder),
    warningText:    _resolvedOrFallback(_V.warningText,    _C.warningText),
  };

  function _textFill(color, v) {
    // Use the explicit variable when provided. No hex auto-lookup — that binds
    // semantically wrong variables on DSes with non-standard naming.
    return [_paint(color, v != null ? v : null)];
  }

  function _t(str, size, color, medium, v) {
    const t = figma.createText();
    t.characters = String(str);
    t.fontSize = size;
    t.fontName = { family: 'Inter', style: medium ? 'Medium' : 'Regular' };
    t.fills = _textFill(color, v);
    return t;
  }

  function _tDS(str, size, color, semibold, v) {
    const t = figma.createText();
    t.characters = String(str);
    t.fontSize = size;
    t.fontName = { family: _dsFamily, style: semibold ? _semiboldStyle : 'Regular' };
    t.fills = _textFill(color, v);
    return t;
  }

  function _pickFloatVarByValue(value, purpose) {
    return _binding.pickFloatByValue(value, purpose);
  }

  function _bindNumericProp(node, prop, value, purpose) {
    if (!node || !(prop in node) || typeof value !== 'number' || !isFinite(value)) return false;
    var variable = _pickFloatVarByValue(value, purpose);
    var fallbackMode = _numericFallback[purpose];
    if (!variable && fallbackMode && fallbackMode !== 'exact' && _binding.pickFloatByNearest) {
      variable = _binding.pickFloatByNearest(value, purpose, fallbackMode, _numericFallback.maxDistance);
    }
    if (!variable) {
      _warnShowcaseBinding('No ' + purpose + ' variable found for value ' + value + '; using raw ' + prop + '.');
      return false;
    }
    try {
      if (_binding.bindVar(node, prop, variable)) return true;
    } catch (_) {}
    try { node.setBoundVariable(prop, variable); return true; } catch (_) {
      _warnShowcaseBinding('Could not bind ' + prop + ' to ' + variable.name + '; using raw value.');
      return false;
    }
  }

  function _fontStyleWeight(styleName) {
    const s = String(styleName || '').toLowerCase();
    if (/thin|hairline/.test(s)) return 100;
    if (/extra\s*light|ultra\s*light/.test(s)) return 200;
    if (/light/.test(s)) return 300;
    if (/regular|book|normal/.test(s)) return 400;
    if (/medium/.test(s)) return 500;
    if (/semi\s*bold|semibold|demi\s*bold|demibold/.test(s)) return 600;
    if (/bold/.test(s)) return 700;
    if (/black|heavy/.test(s)) return 900;
    return 400;
  }

  function _pickTextStyleForText(node) {
    if (!node || node.type !== 'TEXT' || !textStyles.length) return null;
    const size = typeof node.fontSize === 'number' ? node.fontSize : null;
    if (!size) return null;
    const fontName = node.fontName && typeof node.fontName === 'object' ? node.fontName : null;
    const nodeWeight = fontName ? _fontStyleWeight(fontName.style) : 400;
    const nodeName = String(node.name || '').toLowerCase();
    const chars = String(node.characters || '').trim();
    const wantsLabel = /token|badge|tag|label|th|meta|aa|\([0-9]+\)/i.test(nodeName) || chars.length <= 18;
    const wantsTitle = /title|heading|header|section|component/i.test(nodeName) || size >= 18;
    const wantsBody = /description|body|caption/i.test(nodeName) || (!wantsLabel && !wantsTitle);

    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < textStyles.length; i++) {
      const s = textStyles[i];
      const styleName = String(s.name || '').toLowerCase();
      const sWeight = _fontStyleWeight(s.fontName && s.fontName.style);
      const sizeDelta = Math.abs(Number(s.fontSize || 0) - size);
      let score = 100 - (sizeDelta * 18) - (Math.abs(sWeight - nodeWeight) / 100) * 4;
      if (fontName && s.fontName && s.fontName.family === fontName.family) score += 8;
      if (wantsLabel && /label/.test(styleName)) score += 14;
      if (wantsTitle && /title|headline|display/.test(styleName)) score += 14;
      if (wantsBody && /body/.test(styleName)) score += 14;
      if (!wantsTitle && /display|headline/.test(styleName)) score -= 20;
      if (sizeDelta === 0) score += 18;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return bestScore > 0 ? best : null;
  }

  function _applyTextStyleBinding(node) {
    if (!node || node.type !== 'TEXT' || node.textStyleId) return false;
    const style = _pickTextStyleForText(node);
    if (!style) {
      _bindNumericProp(node, 'fontSize', node.fontSize, 'typography');
      if (node.lineHeight && typeof node.lineHeight === 'object' && node.lineHeight.unit === 'PIXELS') {
        _bindNumericProp(node, 'lineHeight', node.lineHeight.value, 'typography');
      }
      return false;
    }
    const fills = Array.isArray(node.fills) ? node.fills.slice() : node.fills;
    const name = node.name;
    const maxLines = node.maxLines;
    const textTruncation = node.textTruncation;
    try {
      node.textStyleId = style.id;
      node.name = name;
      if (Array.isArray(fills)) node.fills = fills;
      if (maxLines !== undefined) node.maxLines = maxLines;
      if (textTruncation !== undefined) node.textTruncation = textTruncation;
      return true;
    } catch (_) {
      return false;
    }
  }

  function _bindShowcaseNodeProperties(root) {
    function bindNode(node) {
      if (!node) return;
      const spacingProps = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing'];
      for (let i = 0; i < spacingProps.length; i++) {
        const prop = spacingProps[i];
        if (prop in node && typeof node[prop] === 'number' && node[prop] !== 0) {
          _bindNumericProp(node, prop, node[prop], 'spacing');
        }
      }
      const radiusProps = ['cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'];
      for (let i = 0; i < radiusProps.length; i++) {
        const prop = radiusProps[i];
        if (prop in node && typeof node[prop] === 'number' && node[prop] !== 0) {
          _bindNumericProp(node, prop, node[prop], 'radius');
        }
      }
      const hasVisibleStroke = Array.isArray(node.strokes) && node.strokes.some(p => p && p.visible !== false);
      if (hasVisibleStroke) {
        const isFrameLike = node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET';
        const borderProps = isFrameLike
          ? ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight']
          : ['strokeWeight'];
        for (let i = 0; i < borderProps.length; i++) {
          const prop = borderProps[i];
          if (prop in node && typeof node[prop] === 'number' && node[prop] !== 0) {
            _bindNumericProp(node, prop, node[prop], 'border');
          }
        }
      }
      _applyTextStyleBinding(node);
      if ('children' in node && node.type !== 'INSTANCE') {
        for (let i = 0; i < node.children.length; i++) bindNode(node.children[i]);
      }
    }
    bindNode(root);
  }

  function _f(name, dir) {
    dir = dir || 'VERTICAL';
    const f = figma.createFrame();
    f.name = name;
    f.layoutMode = dir;
    f.primaryAxisSizingMode = 'AUTO';
    f.counterAxisSizingMode = 'AUTO';
    f.fills = [];
    return f;
  }

  function _appendFill(child, parent) {
    parent.appendChild(child);
    child.layoutSizingHorizontal = 'FILL';
    child.layoutSizingVertical   = 'HUG';
  }

  function _addToFrame(child, frame) {
    frame.appendChild(child);
    child.layoutSizingHorizontal = 'FILL';
    child.layoutSizingVertical   = 'HUG';
  }

  function _addRow(row, parent) {
    parent.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    row.layoutSizingVertical   = 'HUG';
  }

  function _metaCell(label) {
    const c = _f('Meta', 'HORIZONTAL');
    c.paddingLeft = 12; c.paddingRight = 12;
    c.paddingTop = 12;  c.paddingBottom = 12;
    c.primaryAxisAlignItems = 'CENTER';
    c.counterAxisAlignItems = 'CENTER';
    c.appendChild(_t(label, 11, _textColor, false, _V.text));
    return c;
  }

  function _tableRow(name) {
    const r = _f(name, 'HORIZONTAL');
    r.itemSpacing = 0;
    r.counterAxisAlignItems = 'CENTER';
    return r;
  }

  function _addTableDivider(parent) {
    const d = figma.createRectangle();
    d.name = 'Divider';
    d.resize(1, 1);
    d.fills = [_paint(_RC.outlineSubtle, _V.outlineSubtle)];
    parent.appendChild(d);
    d.layoutSizingHorizontal = 'FILL';
  }

  const _C_successBgV  = _V.successBg;
  const _C_successBdV  = _V.successBorder;
  const _C_successTxtV = _V.successText;
  const _C_warningBgV  = _V.warningBg;
  const _C_warningBdV  = _V.warningBorder;
  const _C_warningTxtV = _V.warningText;

  function _buildBadge(ratio) {
    let bg, border, fg, bgV, bdV, fgV, sign, score;
    if (ratio >= 7) {
      bg = _RC.successBg; border = _RC.successBorder; fg = _RC.successText;
      bgV = _C_successBgV; bdV = _C_successBdV; fgV = _C_successTxtV;
      sign = '✓'; score = 'AAA';
    } else if (ratio >= 4.5) {
      bg = _RC.successBg; border = _RC.successBorder; fg = _RC.successText;
      bgV = _C_successBgV; bdV = _C_successBdV; fgV = _C_successTxtV;
      sign = '✓'; score = 'AA';
    } else if (ratio >= 3) {
      bg = _RC.warningBg; border = _RC.warningBorder; fg = _RC.warningText;
      bgV = _C_warningBgV; bdV = _C_warningBdV; fgV = _C_warningTxtV;
      sign = '~'; score = 'AA*';
    } else {
      bg = _RC.warningBg; border = _RC.warningBorder; fg = _RC.warningText;
      bgV = _C_warningBgV; bdV = _C_warningBdV; fgV = _C_warningTxtV;
      sign = '✗'; score = 'Fail';
    }
    const badge = _f('Contrast Badge', 'HORIZONTAL');
    badge.paddingLeft = 8; badge.paddingRight = 8;
    badge.paddingTop  = 4; badge.paddingBottom = 4;
    badge.itemSpacing = 4;
    badge.cornerRadius = 8;
    badge.primaryAxisAlignItems = 'CENTER';
    badge.counterAxisAlignItems = 'CENTER';
    badge.fills = [_paint(bg, bgV)];
    if (bdV) {
      badge.strokes = [_paint(border, bdV)];
      badge.strokeWeight = 1;
      badge.strokeAlign  = 'INSIDE';
    } else {
      badge.strokes = [];
    }
    badge.appendChild(_tDS(sign,  10, fg, true, fgV));
    badge.appendChild(_tDS(score, 10, fg, true, fgV));
    return badge;
  }

  function _buildGroupHeader(label) {
    const row = _f('Group Header', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 12; row.paddingBottom = 12;
    row.fills = [_paint(_RC.surfaceVariant, _V.surfaceVariant)];
    const t = _tDS((label || 'Other').toUpperCase(), 11, _subColor, true, _V.textSub);
    row.appendChild(t);
    t.layoutSizingHorizontal = 'FILL';
    return row;
  }

  function _buildSectionHeader(title, description) {
    const block = _f('Section Header 1.0.0', 'VERTICAL');
    block.itemSpacing = 8;
    const h = _tDS(title, 24, _textColor, false, _V.text);
    block.appendChild(h);
    h.layoutSizingHorizontal = 'FILL';
    if (description) {
      const d = _tDS(description, 16, _subColor, false, _V.textSub);
      block.appendChild(d);
      d.layoutSizingHorizontal = 'FILL';
    }
    return block;
  }

  function _buildTag(label) {
    const tag = _f('Tag 1.0.0', 'HORIZONTAL');
    tag.paddingLeft = 8;  tag.paddingRight = 8;
    tag.paddingTop  = 4;  tag.paddingBottom = 4;
    tag.itemSpacing = 4;
    tag.cornerRadius = 8;
    tag.primaryAxisAlignItems = 'CENTER';
    tag.counterAxisAlignItems = 'CENTER';
    tag.fills = [_paint(_RC.brandVariant, _V.brandVariant)];
    tag.appendChild(_tDS(label, 12, _RC.onBrandVariant, true, _V.onBrandVariant));
    return tag;
  }

  function _buildTokenBadge(label) {
    const badge = _f('TokenBadge', 'HORIZONTAL');
    badge.paddingLeft = 12; badge.paddingRight  = 12;
    badge.paddingTop  = 4;  badge.paddingBottom = 4;
    badge.cornerRadius = 4;
    badge.primaryAxisAlignItems = 'CENTER';
    badge.counterAxisAlignItems = 'CENTER';
    badge.fills = [_paint(_RC.brandVariant, _V.brandVariant)];
    badge.appendChild(_tDS(label, 12, _RC.onBrandVariant, true, _V.onBrandVariant));
    return badge;
  }

  const _PRIMITIVE_COLOR_DESC = 'Primitive ramp values used to construct semantic color roles and visual states.';
  const _SEMANTIC_COLOR_DESC = 'Semantic color tokens mapped to UI roles, foreground pairings, and accessibility checks.';
  const _SCRIM_TABLE_DESC = 'Overlay opacity tokens for dimming background content behind modal surfaces.';

  function _buildTable(title, description) {
    const table = _f('Table 1.0.0', 'VERTICAL');
    table.itemSpacing = 0;
    table.fills   = [_paint(_RC.surfaceDefault, _V.surfaceDefault)];
    table.strokes = [_paint(_RC.outlineSubtle,  _V.outlineSubtle)];
    table.strokeWeight = 0.5;
    table.strokeAlign  = 'INSIDE';
    table.cornerRadius = 16;
    table.clipsContent = true;

    if (title) {
      const titleRow = _f('Table Title', 'VERTICAL');
      titleRow.paddingLeft = 16; titleRow.paddingRight  = 16;
      titleRow.paddingTop  = 16; titleRow.paddingBottom = description ? 12 : 16;
      titleRow.itemSpacing = 4;
      const titleText = _tDS(title, 18, _textColor, true, _V.text);
      titleRow.appendChild(titleText);
      titleText.layoutSizingHorizontal = 'FILL';
      if (description) {
        const descText = _tDS(description, 13, _subColor, false, _V.textSub);
        descText.name = 'DS Description';
        titleRow.appendChild(descText);
        descText.layoutSizingHorizontal = 'FILL';
      }
      table.appendChild(titleRow);
      titleRow.layoutSizingHorizontal = 'FILL';
      _addTableDivider(table);
    }

    return table;
  }

  function _typeVarDesc(key) {
    var parts = String(key || '').split('/');
    var role = parts.length > 1 ? parts[1] : 'type';
    var size = parts.length > 2 ? parts[2] : 'default';
    return 'Typography token for ' + role + ' text at the ' + size + ' size.';
  }

  function _textStyleDesc(style) {
    var name = style && style.name ? style.name : 'this style';
    return 'Text style for ' + name + '; use it to keep font, size, line height, and weight consistent.';
  }

  function _colorTableDesc(label) {
    var s = String(label || '').toLowerCase();
    if (/icon/.test(s)) return 'Foreground icon tokens shown against their intended or highest-contrast surfaces.';
    if (/outline|border|stroke/.test(s)) return 'Outline and border color tokens for dividers, controls, and focusable surfaces.';
    if (/surface|bg|background/.test(s)) return 'Surface color tokens paired with readable foreground examples.';
    return 'Semantic color tokens shown with accessible foreground or preview pairings.';
  }

  function _spacingGroupDesc(groupPath, visualType) {
    var label = String(groupPath || '').split('/').pop() || groupPath || 'spacing';
    if (visualType === 'inset') return 'Inset scale for internal padding in component containers.';
    if (visualType === 'touch') return 'Touch target scale for interactive hit areas.';
    if (visualType === 'radius') return 'Corner radius scale for rounded components and surfaces.';
    if (visualType === 'border') return 'Border width scale for strokes, outlines, and separators.';
    return 'Spacing scale for layout gaps, stacks, and ' + label + ' rhythm.';
  }

  function _buildTableHeading(cols, gap) {
    gap = gap !== undefined ? gap : 16;
    const heading = _f('Table Heading', 'HORIZONTAL');
    heading.paddingLeft = 16; heading.paddingRight  = 16;
    heading.paddingTop  = 16; heading.paddingBottom = 16;
    heading.itemSpacing = gap;
    heading.fills = [_paint(_RC.brandVariant, _V.brandVariant)];
    heading.counterAxisAlignItems = 'CENTER';
    for (const col of cols) {
      const cell = _f('Th', 'HORIZONTAL');
      cell.primaryAxisAlignItems = col.center ? 'CENTER' : 'MIN';
      cell.counterAxisAlignItems = 'CENTER';
      const headText = _tDS(col.text.toUpperCase(), 12, _textColor, true, _V.text);
      cell.appendChild(headText);
      heading.appendChild(cell);
      if (col.flex) {
        cell.layoutSizingHorizontal = 'FILL';
      } else {
        cell.layoutSizingHorizontal = 'FIXED';
        cell.resize(col.width || 128, cell.height || 1);
      }
      cell.layoutSizingVertical = 'HUG';
    }
    return heading;
  }

  function _pickReadableNeutralExtreme(swatchRGB) {
    var best = null;
    var bestContrast = 0;
    for (var i = 0; i < _scored.length; i++) {
      var s = _scored[i];
      if (!/^color\/neutral\//i.test(s.name)) continue;
      if (/(?:scrim|overlay|surface|foreground|text|on[-_]surface|shadow|elevation)/i.test(s.name)) continue;
      if (s.rgb.a !== undefined && s.rgb.a < 0.95) continue;
      var ratio = _contrastRatio(swatchRGB, s.rgb);
      if (ratio < 4.5) continue;
      if (ratio > bestContrast) {
        best = s;
        bestContrast = ratio;
      }
    }
    return best ? { fg: best.rgb, varRef: best.v, show: true, neutralExtreme: true } : null;
  }

  function _swatchIndicator(swatchRGB, allowNeutralFallback) {
    var candidates = [
      { fg: _RC.onSurface, varRef: _V.onSurface },
      { fg: _RC.onBrandVariant, varRef: _V.onBrandVariant },
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].varRef && _contrastRatio(swatchRGB, candidates[i].fg) >= 4.5) {
        return { fg: candidates[i].fg, varRef: candidates[i].varRef, show: true };
      }
    }
    if (allowNeutralFallback) {
      var neutral = _pickReadableNeutralExtreme(swatchRGB);
      if (neutral) return neutral;
    }
    return { fg: null, varRef: null, show: false };
  }

  function _buildSwatch(swatchRGB, fgRGB, sampleText, opts) {
    opts = opts || {};
    const { stepLabel = null, hexLabel = null, swatchVar = null, fgVar = null, sampleFontSize = 10, forceIndicator = false } = opts;

    const swatch = _f('Color Swatch 1.0.0', 'VERTICAL');
    swatch.itemSpacing = 8;
    swatch.counterAxisAlignItems = 'CENTER';

    const container = figma.createFrame();
    container.name = 'Color Container';
    container.layoutMode = 'NONE';
    container.resize(80, 56);
    container.cornerRadius = 8;
    container.fills   = [_paint(swatchRGB, swatchVar)];
    container.strokes = [_paint(_RC.outlineSubtle, _V.outlineSubtle)];
    container.strokeWeight = 0.5;
    container.strokeAlign  = 'INSIDE';

    const ratio = _contrastRatio(swatchRGB, fgRGB);
    if ((forceIndicator || ratio >= 4.5) && sampleText) {
      const aaText = _tDS(sampleText, sampleFontSize, fgRGB, true, fgVar);
      aaText.name = 'Aa';
      aaText.x = 7; aaText.y = 7;
      container.appendChild(aaText);

      const dot = figma.createFrame();
      dot.name = 'Contrast Indicator';
      dot.resize(6, 6);
      dot.cornerRadius = 9999;
      dot.layoutMode = 'NONE';
      dot.fills = [_paint(fgRGB, fgVar)];
      dot.x = 80 - 6.75 - 6;
      dot.y = 56 - 7 - 6;
      dot.constraints = { horizontal: 'MAX', vertical: 'MAX' };
      container.appendChild(dot);
    }

    swatch.appendChild(container);
    container.layoutSizingHorizontal = 'FILL';
    container.layoutSizingVertical   = 'FIXED';
    container.resize(container.width, 56);

    if (stepLabel || hexLabel) {
      const labels = _f('Variable', 'VERTICAL');
      labels.itemSpacing = 4;
      labels.counterAxisAlignItems = 'MIN';
      if (stepLabel) {
        const st = _tDS(stepLabel, 10, _textColor, true, _V.text);
        labels.appendChild(st);
        st.layoutSizingHorizontal = 'FILL';
      }
      if (hexLabel) {
        const ht = _tDS(hexLabel, 10, _subColor, false, _V.textSub);
        labels.appendChild(ht);
        ht.layoutSizingHorizontal = 'FILL';
      }
      swatch.appendChild(labels);
      labels.layoutSizingHorizontal = 'FILL';
    }

    return swatch;
  }

  function _sortSteps(vars) {
    return vars.slice().sort((a, b) => {
      const aS = a.name.split('/').pop(), bS = b.name.split('/').pop();
      const aN = parseInt(aS, 10),       bN = parseInt(bS, 10);
      return (!isNaN(aN) && !isNaN(bN)) ? aN - bN : 0;
    });
  }

  function _buildPrimSwatchRow(rampName, vars) {
    const row = _f('Table / Row / Primary Color Swatches 1.0.0', 'VERTICAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 16; row.paddingBottom = 16;
    row.itemSpacing = 16;
    row.fills = [_paint(_RC.surfaceDefault, _V.surfaceDefault)];

    const title = _tDS(rampName, 16, _textColor, true, _V.text);
    row.appendChild(title);
    title.layoutSizingHorizontal = 'FILL';

    const strip = _f('Swatches', 'HORIZONTAL');
    strip.itemSpacing = 8;
    strip.counterAxisAlignItems = 'MIN';

    for (const v of vars) {
      const stepName = v.name.split('/').pop();
      const rawVal   = resolveVarValue(v);
      const swatchRGB = rawVal && 'r' in rawVal
        ? { r: rawVal.r, g: rawVal.g, b: rawVal.b }
        : { r: 0.8, g: 0.8, b: 0.8 };
      const ind = _swatchIndicator(swatchRGB, true);
      const fgRGB = ind.show ? ind.fg : _textColor;
      const swatch = _buildSwatch(swatchRGB, fgRGB, ind.show ? 'Aa' : null, {
        stepLabel: stepName,
        hexLabel:  rawVal && 'r' in rawVal ? _hex(rawVal) : '—',
        swatchVar: v,
        fgVar: ind.varRef,
      });
      strip.appendChild(swatch);
      swatch.layoutSizingHorizontal = 'FILL';
      swatch.layoutSizingVertical   = 'HUG';
    }

    row.appendChild(strip);
    strip.layoutSizingHorizontal = 'FILL';
    return row;
  }

  // Outline/border token row — surface bg fill + outline color as stroke, no contrast columns.
  function _buildOutlineRow(token, description, outlineRGB, outlineVar) {
    const row = _f('Table / Row / Outline Token 1.0.0', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 16; row.paddingBottom = 16;
    row.itemSpacing = 16;
    row.counterAxisAlignItems = 'CENTER';
    row.fills = [_paint(_RC.surfaceDefault, _V.surfaceDefault)];

    const tokenCell = _f('TokenCell', 'VERTICAL');
    tokenCell.itemSpacing = 8;
    tokenCell.counterAxisAlignItems = 'MIN';
    tokenCell.primaryAxisAlignItems = 'CENTER';
    const _outTag = _buildTag(token);
    tokenCell.appendChild(_outTag);
    _outTag.layoutSizingHorizontal = 'HUG';
    const _outDesc = _tDS(description || 'Border color token for outlines, dividers, and low-emphasis structure.', 12, _subColor, false, _V.textSub);
    _outDesc.name = 'DS Description';
    tokenCell.appendChild(_outDesc);
    _outDesc.layoutSizingHorizontal = 'FILL';
    row.appendChild(tokenCell);
    tokenCell.layoutSizingHorizontal = 'FILL';
    tokenCell.layoutSizingVertical   = 'HUG';

    const container = figma.createFrame();
    container.name = 'Outline Container';
    container.layoutMode = 'NONE';
    container.resize(80, 56);
    container.cornerRadius = 8;
    container.fills   = [_paint(_bgColor, _V.bg)];
    container.strokes = [_paint(outlineRGB, outlineVar)];
    container.strokeWeight = 2;
    container.strokeAlign  = 'INSIDE';

    const swatchCell = _f('SwatchCell', 'VERTICAL');
    swatchCell.primaryAxisAlignItems = 'CENTER';
    swatchCell.counterAxisAlignItems = 'CENTER';
    swatchCell.appendChild(container);
    container.layoutSizingHorizontal = 'FILL';
    container.layoutSizingVertical   = 'FIXED';
    container.resize(container.width, 56);
    row.appendChild(swatchCell);
    swatchCell.layoutSizingHorizontal = 'FILL';
    swatchCell.layoutSizingVertical   = 'HUG';

    return row;
  }

  function _buildSemColorRow(token, description, bgRGB, fgRGB, bgVar, opts) {
    opts = opts || {};
    var fgVar    = opts.fgVar    !== undefined ? opts.fgVar    : null;
    var hasPairing = opts.hasPairing !== undefined ? opts.hasPairing : true;
    const ratio = _contrastRatio(bgRGB, fgRGB);
    const row = _f('Table / Row / Semantic Color Pairs 1.0.0', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 16; row.paddingBottom = 16;
    row.itemSpacing = 16;
    row.counterAxisAlignItems = 'CENTER';
    row.fills = [_paint(_RC.surfaceDefault, _V.surfaceDefault)];

    const tokenCell = _f('TokenCell', 'VERTICAL');
    tokenCell.itemSpacing = 8;
    tokenCell.counterAxisAlignItems = 'MIN';
    tokenCell.primaryAxisAlignItems = 'CENTER';
    const _semTag = _buildTag(token);
    tokenCell.appendChild(_semTag);
    _semTag.layoutSizingHorizontal = 'HUG';
    const _semRowDesc = _tDS(description || 'Semantic color token for role-based UI surfaces and states.', 12, _subColor, false, _V.textSub);
    _semRowDesc.name = 'DS Description';
    tokenCell.appendChild(_semRowDesc);
    _semRowDesc.layoutSizingHorizontal = 'FILL';
    row.appendChild(tokenCell);
    tokenCell.layoutSizingHorizontal = 'FILL';
    tokenCell.layoutSizingVertical   = 'HUG';

    const swatchCell = _f('SwatchCell', 'VERTICAL');
    swatchCell.primaryAxisAlignItems = 'CENTER';
    swatchCell.counterAxisAlignItems = 'CENTER';
    const swatch = _buildSwatch(bgRGB, fgRGB, opts.isIcon ? '☻' : (opts.previewText || token), {
      swatchVar: bgVar,
      fgVar: fgVar,
      sampleFontSize: opts.isIcon ? 16 : 10,
      forceIndicator: opts.isIcon ? true : false,
    });
    swatchCell.appendChild(swatch);
    swatch.layoutSizingHorizontal = 'FILL';
    row.appendChild(swatchCell);
    swatchCell.layoutSizingHorizontal = 'FILL';
    swatchCell.layoutSizingVertical   = 'FILL';

    if (hasPairing) {
      const metricCell = _f('MetricCell', 'HORIZONTAL');
      metricCell.primaryAxisAlignItems = 'CENTER';
      metricCell.counterAxisAlignItems = 'CENTER';
      metricCell.appendChild(_tDS(`${ratio.toFixed(2)}:1`, 14, _textColor, false, _V.text));
      row.appendChild(metricCell);
      metricCell.layoutSizingHorizontal = 'FIXED';
      metricCell.resize(128, 1);
      metricCell.layoutSizingVertical   = 'FILL';

      const badgeCell = _f('BadgeCell', 'HORIZONTAL');
      badgeCell.primaryAxisAlignItems = 'CENTER';
      badgeCell.counterAxisAlignItems = 'CENTER';
      badgeCell.appendChild(_buildBadge(ratio));
      row.appendChild(badgeCell);
      badgeCell.layoutSizingHorizontal = 'FIXED';
      badgeCell.resize(128, 1);
      badgeCell.layoutSizingVertical   = 'FILL';
    }

    return row;
  }

  function _buildTypoRow(style) {
    const row = _f('Table / Row / Typography 1.0.0', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 16; row.paddingBottom = 16;
    row.itemSpacing = 16;
    row.counterAxisAlignItems = 'CENTER';
    row.fills = [_paint(_RC.surfaceDefault, _V.surfaceDefault)];

    const tokenCell = _f('Table Cell', 'VERTICAL');
    tokenCell.itemSpacing = 8;
    tokenCell.counterAxisAlignItems = 'MIN';
    tokenCell.primaryAxisAlignItems = 'CENTER';
    const _typoTag = _buildTag(style.name);
    tokenCell.appendChild(_typoTag);
    _typoTag.layoutSizingHorizontal = 'HUG';
    const _typoDesc = _tDS((style.description && style.description.trim()) || _textStyleDesc(style), 12, _subColor, false, _V.textSub);
    _typoDesc.name = 'DS Description';
    tokenCell.appendChild(_typoDesc);
    _typoDesc.layoutSizingHorizontal = 'FILL';
    row.appendChild(tokenCell);
    tokenCell.layoutSizingHorizontal = 'FILL';
    tokenCell.layoutSizingVertical   = 'HUG';

    const sampleCell = _f('Table Cell', 'VERTICAL');
    sampleCell.primaryAxisAlignItems = 'CENTER';
    sampleCell.counterAxisAlignItems = 'MIN';
    sampleCell.clipsContent = true;
    const sampleText = figma.createText();
    sampleText.textStyleId    = style.id;
    sampleText.characters     = 'The quick brown fox jumps over the lazy dog';
    sampleText.fills          = _textFill(_textColor, _V.text);
    sampleText.maxLines       = 1;
    sampleText.textTruncation = 'ENDING';
    sampleCell.appendChild(sampleText);
    row.appendChild(sampleCell);
    sampleCell.layoutSizingHorizontal = 'FILL';
    sampleCell.layoutSizingVertical   = 'HUG';
    sampleText.layoutSizingHorizontal = 'FILL';

    const sizeCell = _f('Table Cell', 'VERTICAL');
    sizeCell.primaryAxisAlignItems = 'CENTER';
    sizeCell.counterAxisAlignItems = 'MIN';
    sizeCell.appendChild(_tDS(`${style.fontSize}px`, 14, _textColor, false, _V.text));
    row.appendChild(sizeCell);
    sizeCell.layoutSizingHorizontal = 'FIXED';
    sizeCell.resize(128, 1);
    sizeCell.layoutSizingVertical   = 'FILL';

    const lhVal = typeof style.lineHeight === 'object' && style.lineHeight.unit !== 'AUTO'
      ? `${Math.round(style.lineHeight.value)}${style.lineHeight.unit === 'PERCENT' ? '%' : 'px'}`
      : 'auto';
    const lhCell = _f('Table Cell', 'VERTICAL');
    lhCell.primaryAxisAlignItems = 'CENTER';
    lhCell.counterAxisAlignItems = 'MIN';
    lhCell.appendChild(_tDS(lhVal, 14, _textColor, false, _V.text));
    row.appendChild(lhCell);
    lhCell.layoutSizingHorizontal = 'FIXED';
    lhCell.resize(128, 1);
    lhCell.layoutSizingVertical   = 'FILL';

    const wtCell = _f('Table Cell', 'VERTICAL');
    wtCell.primaryAxisAlignItems = 'CENTER';
    wtCell.counterAxisAlignItems = 'MIN';
    wtCell.appendChild(_tDS(style.fontName.style, 14, _textColor, false, _V.text));
    row.appendChild(wtCell);
    wtCell.layoutSizingHorizontal = 'FIXED';
    wtCell.resize(128, 1);
    wtCell.layoutSizingVertical   = 'FILL';

    return row;
  }

  function _buildTypoVarRow(group) {
    const { key, sizeVar, lhVar, weightVar, familyVar, sizeVal, lhVal, weightVal } = group;
    const row = _f('Table / Row / Typography Var 1.0.0', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 16; row.paddingBottom = 16;
    row.itemSpacing = 16;
    row.counterAxisAlignItems = 'CENTER';
    row.fills = [_paint(_RC.surfaceDefault, _V.surfaceDefault)];

    const tokenCell = _f('Table Cell', 'VERTICAL');
    tokenCell.itemSpacing = 8;
    tokenCell.counterAxisAlignItems = 'MIN';
    tokenCell.primaryAxisAlignItems = 'CENTER';
    const _tag = _buildTag(key);
    tokenCell.appendChild(_tag);
    _tag.layoutSizingHorizontal = 'HUG';
    const _desc = _tDS(_typeVarDesc(key), 12, _subColor, false, _V.textSub);
    _desc.name = 'DS Description';
    tokenCell.appendChild(_desc);
    _desc.layoutSizingHorizontal = 'FILL';
    row.appendChild(tokenCell);
    tokenCell.layoutSizingHorizontal = 'FILL';
    tokenCell.layoutSizingVertical   = 'HUG';

    const sampleCell = _f('Table Cell', 'VERTICAL');
    sampleCell.primaryAxisAlignItems = 'CENTER';
    sampleCell.counterAxisAlignItems = 'MIN';
    sampleCell.clipsContent = true;
    const sampleText = figma.createText();
    // Resolve the effective family variable: per-token first, shared fallback second.
    var _effFamVar = familyVar || _sharedFamilyVar;
    var _effFamRaw = _effFamVar ? resolveVarValue(_effFamVar) : null;
    var _effFamStr = (typeof _effFamRaw === 'string') ? _effFamRaw : _dsFamily;
    sampleText.fontName  = { family: _effFamStr, style: 'Regular' };
    sampleText.characters = 'The quick brown fox';
    sampleText.fontSize   = sizeVal ? Math.min(Math.max(Math.round(sizeVal), 8), 60) : 16;
    sampleText.fills      = _textFill(_textColor, _V.text);
    sampleText.maxLines   = 1;
    sampleText.textTruncation = 'ENDING';
    if (sizeVar) { try { sampleText.setBoundVariable('fontSize', sizeVar); } catch (_) {} }
    if (lhVar && lhVal !== null) {
      try {
        sampleText.lineHeight = { value: lhVal, unit: 'PIXELS' };
        sampleText.setBoundVariable('lineHeight', lhVar);
      } catch (_) {}
    }
    if (_effFamVar) { try { sampleText.setBoundVariable('fontFamily', _effFamVar); } catch (_) {} }
    if (weightVar)  { try { sampleText.setBoundVariable('fontWeight',  weightVar);  } catch (_) {} }
    sampleCell.appendChild(sampleText);
    row.appendChild(sampleCell);
    sampleCell.layoutSizingHorizontal = 'FILL';
    sampleCell.layoutSizingVertical   = 'HUG';
    sampleText.layoutSizingHorizontal = 'FILL';

    const sizeLabel = sizeVal !== null ? `${Math.round(sizeVal)}px` : '—';
    const sizeCl = _f('Table Cell', 'VERTICAL');
    sizeCl.primaryAxisAlignItems = 'CENTER'; sizeCl.counterAxisAlignItems = 'MIN';
    sizeCl.appendChild(_tDS(sizeLabel, 14, _textColor, false, _V.text));
    row.appendChild(sizeCl);
    sizeCl.layoutSizingHorizontal = 'FIXED'; sizeCl.resize(128, 1); sizeCl.layoutSizingVertical = 'FILL';

    const lhLabel = lhVal !== null ? String(Math.round(lhVal * 10) / 10) : '—';
    const lhCl = _f('Table Cell', 'VERTICAL');
    lhCl.primaryAxisAlignItems = 'CENTER'; lhCl.counterAxisAlignItems = 'MIN';
    lhCl.appendChild(_tDS(lhLabel, 14, _textColor, false, _V.text));
    row.appendChild(lhCl);
    lhCl.layoutSizingHorizontal = 'FIXED'; lhCl.resize(128, 1); lhCl.layoutSizingVertical = 'FILL';

    const wtLabel = weightVal !== null ? String(Math.round(weightVal)) : '—';
    const wtCl = _f('Table Cell', 'VERTICAL');
    wtCl.primaryAxisAlignItems = 'CENTER'; wtCl.counterAxisAlignItems = 'MIN';
    wtCl.appendChild(_tDS(wtLabel, 14, _textColor, false, _V.text));
    row.appendChild(wtCl);
    wtCl.layoutSizingHorizontal = 'FIXED'; wtCl.resize(128, 1); wtCl.layoutSizingVertical = 'FILL';

    return row;
  }

  function _buildSpacingVisual(type, value) {
    const px = value !== null && isFinite(value) ? Math.round(value) : 1;

    if (type === 'spacing') {
      const size = Math.min(Math.max(px, 2), 128);
      const sq = figma.createRectangle();
      sq.resize(size, size);
      sq.fills = [_paint(_RC.surfaceBrand, _V.surfaceBrand)];
      sq.cornerRadius = 2;
      return sq;
    }

    if (type === 'inset') {
      const displayPx = Math.min(Math.max(px, 2), 32);
      const outer = figma.createFrame();
      outer.name = 'Inset Visual';
      outer.layoutMode = 'NONE';
      outer.resize(40 + displayPx * 2, 40 + displayPx * 2);
      outer.fills = [_paint(_RC.brandVariant, _V.brandVariant)];
      outer.strokes = [_paint(_accColor, _V.outlineBrand)];
      outer.strokeWeight = 1;
      outer.strokeAlign = 'INSIDE';
      outer.cornerRadius = 4;
      outer.clipsContent = true;
      const inner = figma.createRectangle();
      inner.resize(40, 40);
      inner.x = displayPx;
      inner.y = displayPx;
      inner.fills = [_paint(_RC.surfaceBrand, _V.surfaceBrand)];
      inner.cornerRadius = 2;
      outer.appendChild(inner);
      return outer;
    }

    if (type === 'touch') {
      const size = Math.max(px, 16);
      const el = figma.createEllipse();
      el.resize(size, size);
      el.fills       = [_paint(_RC.brandVariant, _V.brandVariant)];
      el.strokes     = [_paint(_accColor,        _V.outlineBrand)];
      el.strokeWeight = 2;
      el.strokeAlign  = 'INSIDE';
      el.dashPattern  = [4, 4];
      return el;
    }

    if (type === 'radius') {
      const sq = figma.createRectangle();
      sq.resize(56, 56);
      sq.fills        = [_paint(_RC.brandVariant, _V.brandVariant)];
      sq.strokes      = [_paint(_accColor,        _V.outlineBrand)];
      sq.strokeWeight  = 1;
      sq.strokeAlign   = 'INSIDE';
      sq.cornerRadius  = px;
      return sq;
    }

    const sq = figma.createRectangle();
    sq.resize(56, 56);
    sq.fills        = [_paint(_RC.brandVariant, _V.brandVariant)];
    sq.strokes      = [_paint(_accColor,        _V.outlineBrand)];
    sq.strokeWeight  = Math.max(px, 0.5);
    sq.strokeAlign   = 'INSIDE';
    sq.cornerRadius  = 2;
    return sq;
  }

  function _buildSpacingRow(v, px, visualType) {
    const pxNum    = px !== null && isFinite(px) ? Math.round(px) : 0;
    const desc     = (v.description && v.description.trim()) ? v.description.trim() : _floatTokenDesc(v.name, visualType, px);

    const row = _f('Table / Row / Spacing & Effects 1.0.0', 'HORIZONTAL');
    row.paddingLeft = 16; row.paddingRight  = 16;
    row.paddingTop  = 16; row.paddingBottom = 16;
    row.itemSpacing = 8;
    row.counterAxisAlignItems = 'CENTER';
    row.fills = [_paint(_RC.surfaceDefault, _V.surfaceDefault)];

    const tokenCell = _f('Container', 'VERTICAL');
    tokenCell.itemSpacing = 4;
    tokenCell.counterAxisAlignItems = 'MIN';
    tokenCell.primaryAxisAlignItems = 'CENTER';
    const badge = _buildTokenBadge(v.name);
    tokenCell.appendChild(badge);
    const _spDesc = _tDS(desc, 12, _subColor, false, _V.textSub);
    _spDesc.name = 'DS Description';
    tokenCell.appendChild(_spDesc);
    _spDesc.layoutSizingHorizontal = 'FILL';
    row.appendChild(tokenCell);
    tokenCell.layoutSizingHorizontal = 'FILL';
    tokenCell.layoutSizingVertical   = 'HUG';

    const visualCell = _f('Visual', 'HORIZONTAL');
    visualCell.counterAxisAlignItems = 'CENTER';
    visualCell.clipsContent = true;
    const visual = _buildSpacingVisual(visualType, px);
    visualCell.appendChild(visual);
    row.appendChild(visualCell);
    visualCell.layoutSizingHorizontal = 'FIXED';
    visualCell.resize(64, 1);
    visualCell.layoutSizingVertical   = 'HUG';

    const valueCell = _f('Text', 'HORIZONTAL');
    valueCell.itemSpacing = 4;
    valueCell.counterAxisAlignItems = 'CENTER';
    const valStr = px !== null ? `${pxNum}px` : '—';
    const rawStr = px !== null ? `(${pxNum})` : '';
    const valText = _tDS(valStr, 12, _textColor, false, _V.onSurface);
    valueCell.appendChild(valText);
    if (rawStr) {
      const rawText = _tDS(rawStr, 12, _subColor, false, _V.textSub);
      valueCell.appendChild(rawText);
    }
    row.appendChild(valueCell);
    valueCell.layoutSizingHorizontal = 'FIXED';
    valueCell.resize(104, 1);
    valueCell.layoutSizingVertical   = 'HUG';

    return row;
  }

  function _groupVisualType(groupPath, resolvedValues) {
    const vals = resolvedValues.filter(v => v !== null && isFinite(v));
    if (!vals.length) return 'bar';
    const normalVals    = vals.filter(v => v < 500);
    const effectiveVals = normalVals.length >= Math.ceil(vals.length * 0.5) ? normalVals : vals;
    const effectiveMax  = Math.max(...effectiveVals);
    const posVals       = effectiveVals.filter(v => v > 0);
    const effectiveMin  = posVals.length ? Math.min(...posVals) : 0;
    if (/inset|padding|pad(?:ding)?|internal[-_]?space/i.test(groupPath)) return 'inset';
    if (effectiveMax <= 8 && vals.length <= 8) return 'border';
    if (/radius|corner|round|pill|curve/i.test(groupPath) && effectiveMax <= 128) return 'radius';
    if (effectiveMax <= 24 && vals.length <= 16 && effectiveMin > 0 && effectiveMax / effectiveMin >= 8) return 'radius';
    if (/touch|tap[-_]?target|hit[-_]?area|minimum[-_]?size|interactive[-_]?size/i.test(groupPath)) return 'touch';
    return 'bar';
  }

  function _tokenDesc(name) {
    const segs = name.toLowerCase().split('/').filter(s => s !== 'color');
    const last = segs[segs.length - 1];
    const has  = k => segs.some(s => s === k || s.startsWith(k + '-'));
    const qualifier = segs.find(s => !['surface','on-surface','outline','border','icon','state','on','color'].includes(s) && !s.startsWith('on-')) || last;

    if (has('elevation') || has('shadow')) {
      if (last === '0' || last === 'none') return 'No-shadow elevation for flat surfaces.';
      return 'Shadow style for layered surfaces and raised UI.';
    }
    if (has('scrim') || has('overlay')) {
      return 'Overlay color for dimming background content behind modal UI.';
    }

    if (has('icon')) {
      if (qualifier === 'brand')   return 'Brand-colored icon.';
      if (qualifier === 'default' || qualifier === 'icon') return 'Default icon color.';
      if (qualifier === 'subtle')  return 'Low-emphasis icon color.';
      if (qualifier === 'inverse') return 'Icon color for inverted surfaces.';
      return `${qualifier} icon color.`;
    }
    if (segs.some(s => s.startsWith('on-'))) {
      const onSeg = segs.find(s => s.startsWith('on-'));
      const surface = onSeg.replace('on-', '');
      if (surface === 'surface') {
        if (last === 'default') return 'Primary text and icon color on any surface.';
        if (last === 'variant') return 'Secondary text for labels and captions.';
      }
      return `Foreground for ${surface}-colored surfaces.`;
    }
    if (has('surface')) {
      if (last === 'default') return 'Default background for cards and panels.';
      if (last === 'variant') return 'Secondary background for nested containers.';
      return `${qualifier} surface background.`;
    }
    if (has('outline') || has('border')) {
      if (last === 'default') return 'Default border for inputs and cards.';
      if (last === 'subtle')  return 'Low-emphasis border for dividers.';
      return `${qualifier} border color.`;
    }
    return null;
  }

  function _floatTokenDesc(name, visualType, px) {
    var n = String(name || '').toLowerCase();
    var valueText = px !== null && isFinite(px) ? ' Resolves to ' + Math.round(px) + 'px.' : '';
    if (visualType === 'inset' || /inset|padding|pad/.test(n)) return 'Inset token for internal spacing inside components.' + valueText;
    if (visualType === 'touch' || /touch|tap|hit/.test(n)) return 'Touch target token for interactive hit areas.' + valueText;
    if (visualType === 'radius' || /radius|corner|round/.test(n)) return 'Radius token for rounded corners.' + valueText;
    if (visualType === 'border' || /border|stroke|outline/.test(n)) return 'Border width token for strokes and outlines.' + valueText;
    return 'Spacing token for layout gaps, stacks, and rhythm.' + valueText;
  }

  // Return the last two slash-separated segments of a variable path, which gives
  // designers just enough context to identify a token without showing the full path.
  // e.g. "color/surface/brand" → "surface/brand"
  //      "color/on-surface/brand-variant" → "on-surface/brand-variant"
  //      "brand" → "brand"
  function _tokenLabel(name) {
    var parts = name.split('/');
    return parts.length >= 2 ? parts.slice(-2).join('/') : name;
  }

  // ── Page setup ───────────────────────────────────────────────────────────────

  let _page = figma.root.children.find(p => p.name === '00 · Tokens');
  if (!_page) {
    _page = figma.createPage();
    _page.name = '00 · Tokens';
  }
  await figma.setCurrentPageAsync(_page);

  const _SECTION_GAP = 100;
  const _existingShowcases = _page.children.filter(
    n => (n.type === 'FRAME' || n.type === 'SECTION') && n.name.startsWith('Token Showcase')
  );
  let _sectionX = _existingShowcases.length > 0
    ? Math.max(..._existingShowcases.map(n => n.x + n.width)) + _SECTION_GAP
    : 0;

  function _makeShowcaseFrame(name) {
    const f = figma.createFrame();
    f.name = `Token Showcase — ${name}`;
    f.layoutMode = 'VERTICAL';
    f.primaryAxisSizingMode = 'AUTO';
    f.counterAxisSizingMode = 'FIXED';
    f.resize(1200, 100);
    f.itemSpacing   = 48;
    f.paddingTop    = 48; f.paddingBottom = 48;
    f.paddingLeft   = 48; f.paddingRight  = 48;
    f.fills = [_paint(_bgColor, _V.bg)];
    return f;
  }

  function _placeShowcaseSection(sectionName, frame, xOverride) {
    // Use a Section if available (Figma API ≥ 1.2), otherwise fall back to a plain frame.
    var container;
    try {
      container = figma.createSection();
    } catch (_) {
      container = null;
    }
    if (!container || typeof container.appendChild !== 'function') {
      // Fallback: rename the frame itself and place directly on the page.
      frame.name = `Token Showcase — ${sectionName}`;
      const posX = xOverride !== null && xOverride !== undefined ? xOverride : _sectionX;
      frame.x = posX;
      frame.y = 0;
      _page.appendChild(frame);
      _sectionX = posX + frame.width + _SECTION_GAP;
      return frame;
    }
    container.name = `Token Showcase — ${sectionName}`;
    try { container.fills = [_paint(_bgColor, _V.bg)]; } catch (_) {}
    _page.appendChild(container);
    container.appendChild(frame);
    frame.x = 0;
    frame.y = 0;
    const posX = xOverride !== null && xOverride !== undefined ? xOverride : _sectionX;
    container.x = posX;
    container.y = 0;
    container.resizeWithoutConstraints(frame.width, frame.height);
    _sectionX = posX + frame.width + _SECTION_GAP;
    return container;
  }

  // ── Colors section ───────────────────────────────────────────────────────────

  function _rankPrimitiveRamp(name) {
    var n = String(name || '').toLowerCase();
    var leaf = n.split('/').pop();
    var order = {
      'neutral': 100,
      'neutral-variant': 110,
      'red': 200,
      'danger': 205,
      'error': 205,
      'green': 210,
      'success': 210,
      'yellow': 220,
      'warning': 220,
      'blue': 230,
      'info': 230
    };
    if (order[leaf] !== undefined) return order[leaf];
    return 10;
  }

  function _rankSemanticName(name) {
    var n = String(name || '').toLowerCase();
    var leaf = n.split('/').pop();
    var rank = 100;
    if (/(^|\/)(surface|bg|background)(\/|$)/.test(n)) rank = 0;
    else if (/(^|\/)(on-surface|text|fg|foreground)(\/|$)/.test(n)) rank = 20;
    else if (/(^|\/)(outline|border|stroke)(\/|$)/.test(n)) rank = 30;
    else if (/(^|\/)icon(\/|$)/.test(n)) rank = 40;
    else if (/(^|\/)(state|overlay|scrim)(\/|$)/.test(n)) rank = 70;

    if (/brand|primary/.test(leaf)) rank += 5;
    if (/neutral|default|variant|subtle|muted/.test(leaf)) rank += 10;
    if (/success|positive|confirm|green/.test(leaf)) rank += 100;
    if (/warning|caution|yellow/.test(leaf)) rank += 110;
    if (/danger|error|destructive|red/.test(leaf)) rank += 120;
    if (/info|blue/.test(leaf)) rank += 130;
    if (/disabled/.test(leaf)) rank += 140;
    return rank;
  }

  function _sortSemanticVars(vars) {
    return vars.slice().sort(function(a, b) {
      var ar = _rankSemanticName(a.name);
      var br = _rankSemanticName(b.name);
      return ar !== br ? ar - br : a.name.localeCompare(b.name);
    });
  }

  function _sortSemanticGroups(groups) {
    return groups.slice().sort(function(a, b) {
      var ar = _rankSemanticName(a.key || a.label);
      var br = _rankSemanticName(b.key || b.label);
      return ar !== br ? ar - br : String(a.label).localeCompare(String(b.label));
    });
  }

  const _prevColors = _page.children.find(n =>
    (n.type === 'FRAME' || n.type === 'SECTION') && n.name === 'Token Showcase — Colors'
  );
  const _myColorsX = _prevColors ? _prevColors.x : _sectionX;

  if (_primColls.length || _semanticColls.length) {
    if (_prevColors) _prevColors.remove();
    const _colorsFrame = _makeShowcaseFrame('Colors');
    _addToFrame(_buildSectionHeader('Colors', 'Primitive ramps and their semantic surface / foreground pairs.'), _colorsFrame);

    if (_primColls.length) {
      const _primTable = _buildTable('Primitives', _PRIMITIVE_COLOR_DESC);

      for (const coll of _primColls) {
        const _colorVars = coll.vars.filter(v => {
          if (v.resolvedType !== 'COLOR') return false;
          const raw = resolveVarValue(v);
          if (raw && raw.a !== undefined && raw.a < 0.95) return false;
          return true;
        });
        const _rampMap = groupByPath(_colorVars);

        const _rampEntries = Object.entries(_rampMap).sort(function(a, b) {
          var ar = _rankPrimitiveRamp(a[0]);
          var br = _rankPrimitiveRamp(b[0]);
          return ar !== br ? ar - br : a[0].localeCompare(b[0]);
        });

        for (const [rampName, vars] of _rampEntries) {
          const sortedVars = _sortSteps(vars);
          const primRow = _buildPrimSwatchRow(rampName || coll.name, sortedVars);
          _primTable.appendChild(primRow);
          primRow.layoutSizingHorizontal = 'FILL';
          _addTableDivider(_primTable);
        }
      }

      _appendFill(_primTable, _colorsFrame);
    }

    if (_semanticColls.length) {
      const _semVarRGB = new Map();
      for (const coll of _semanticColls) {
        for (const v of coll.vars.filter(v => v.resolvedType === 'COLOR')) {
          const raw = resolveVarValue(v);
          if (raw && 'r' in raw) _semVarRGB.set(v.name, { r: raw.r, g: raw.g, b: raw.b });
        }
      }

      const _configSemanticPairs = (
        opts.DS &&
        opts.DS.color &&
        opts.DS.color.semantics &&
        Array.isArray(opts.DS.color.semantics.pairs)
      ) ? opts.DS.color.semantics.pairs : [];

      if (_configSemanticPairs.length) {
        const _semTable = _buildTable('Semantic Colors', _SEMANTIC_COLOR_DESC);
        const _semHeading = _buildTableHeading([
          { text: 'Token',    flex: true },
          { text: 'Example',  flex: true },
          { text: 'Contrast', width: 128, center: true },
          { text: 'WCAG',     width: 128, center: true },
        ], 16);
        _semTable.appendChild(_semHeading);
        _semHeading.layoutSizingHorizontal = 'FILL';
        _addTableDivider(_semTable);

        for (const pair of _configSemanticPairs) {
          const bgVar = varByName[pair.bg] || null;
          const fgVar = varByName[pair.text] || null;
          const bgRaw = bgVar ? resolveVarValue(bgVar) : null;
          const fgRaw = fgVar ? resolveVarValue(fgVar) : null;
          if (!bgRaw || !fgRaw || !('r' in bgRaw) || !('r' in fgRaw)) continue;
          const bgRGB = { r: bgRaw.r, g: bgRaw.g, b: bgRaw.b };
          const fgRGB = { r: fgRaw.r, g: fgRaw.g, b: fgRaw.b };
          const bgLabel = _tokenLabel(pair.bg);
          const fgLabel = _tokenLabel(pair.text);
          const leaf = String(pair.bg || '').split('/').pop();
          const desc = 'Paired with ' + fgLabel + '.';
          const row = _buildSemColorRow(bgLabel + ' + ' + fgLabel, desc, bgRGB, fgRGB, bgVar, {
            fgVar: fgVar,
            hasPairing: true,
            previewText: leaf
          });
          _semTable.appendChild(row);
          row.layoutSizingHorizontal = 'FILL';
          _addTableDivider(_semTable);
        }

        _appendFill(_semTable, _colorsFrame);
      } else {
      function _findFgPair(bgVarName) {
        const parts = bgVarName.split('/');
        for (let i = parts.length - 1; i >= 0; i--) {
          const candidate = [...parts];
          candidate[i] = 'on-' + candidate[i];
          const rgb = _semVarRGB.get(candidate.join('/'));
          if (rgb) return rgb;
        }
        return null;
      }

      const _allSemGroupEntries = [];
      for (const coll of _semanticColls) {
        if (!coll.colorVarCount) continue;
        const colorGroups = coll.colorGroups || groupByPath(coll.vars.filter(v => v.resolvedType === 'COLOR'));
        for (const entry of Object.entries(colorGroups)) _allSemGroupEntries.push(entry);
      }

      const _mainGroups   = [];
      const _bottomGroups = [];

      for (const [groupKey, groupVars] of _allSemGroupEntries) {
        const nonOnVars = _sortSemanticVars(groupVars.filter(v => !v.name.split('/').some(seg => /^on[-_]/i.test(seg))));
        const bgPairedRows = [], bgUnpairedRows = [], fgRows = [];

        for (const v of nonOnVars) {
          const raw = resolveVarValue(v);
          if (!raw || !('r' in raw)) continue;
          if (raw.a !== undefined && raw.a < 0.95) continue;

          const isIcon    = /(?:^|\/)icon(?:\/|$)/i.test(v.name);
          const isOutline = /(?:^|\/)(?:outline|border|stroke)(?:\/|$)/i.test(v.name);
          const tokenLeaf  = v.name.split('/').pop();
          const tokenLabel = _tokenLabel(v.name);
          const desc       = _tokenDesc(v.name);

          if (isOutline) {
            // Outline tokens: surface bg + stroke — no contrast columns
            const outlineRGB = { r: raw.r, g: raw.g, b: raw.b };
            const row = _buildOutlineRow(tokenLabel, desc, outlineRGB, v);
            bgUnpairedRows.push(row);
          } else if (isIcon) {
            // Icons are foreground colors — find the best surface to show them on.
            // Priority 1: semantic pairing (replace 'icon' with 'surface' in the path),
            //   e.g. color/icon/inverse → color/surface/inverse (a dark surface).
            //   Use if it gives ≥ 3:1 contrast against the icon color.
            // Priority 2: default surface (the neutral page background).
            //   Use when no semantic pairing exists or its contrast is poor.
            var iconRGB = { r: raw.r, g: raw.g, b: raw.b };
            var iconPathParts = v.name.split('/');
            var iconSegIdx    = iconPathParts.findIndex(function(p) { return /^icon$/i.test(p); });
            var semSurfacePath = iconSegIdx >= 0
              ? iconPathParts.map(function(p, i) { return i === iconSegIdx ? 'surface' : p; }).join('/')
              : null;
            var semSurfaceRaw = semSurfacePath ? (_semVarRGB.get(semSurfacePath) || null) : null;
            var semSurfaceVar = semSurfacePath ? (varByName[semSurfacePath] || null) : null;
            var semContrast   = semSurfaceRaw ? _contrastRatio(iconRGB, semSurfaceRaw) : 0;

            var defSurfaceVar = _V.surfaceDefault || _V.bg || null;
            var defSurfaceRaw = defSurfaceVar ? resolveVarValue(defSurfaceVar) : null;
            var defSurfaceRGB = defSurfaceRaw && 'r' in defSurfaceRaw
              ? { r: defSurfaceRaw.r, g: defSurfaceRaw.g, b: defSurfaceRaw.b }
              : _bgColor;
            var defContrast   = _contrastRatio(iconRGB, defSurfaceRGB);

            // Use semantic surface if it gives meaningfully better contrast; otherwise default.
            var useSemanticPair = semSurfaceRaw && semContrast >= 3 && semContrast >= defContrast * 0.8;
            var iconSurfaceRGB = useSemanticPair ? semSurfaceRaw : defSurfaceRGB;
            var iconSurfaceVar = useSemanticPair ? semSurfaceVar : defSurfaceVar;

            // Luminance-based fallback for light icons (e.g. icon/inverse, icon/on-dark).
            // If the icon is very light and neither the semantic surface nor the default
            // surface provides good contrast, scan for the darkest available surface variable.
            if (!useSemanticPair && _lum(iconRGB) > 0.6) {
              var _darkestVar = null, _darkestLum = Infinity;
              var _allVarValues = Object.values(varByName);
              for (var _di = 0; _di < _allVarValues.length; _di++) {
                var _dv = _allVarValues[_di];
                if (_dv.resolvedType !== 'COLOR') continue;
                if (!/(?:surface|background|base|page)/i.test(_dv.name)) continue;
                if (/(?:^|\/)on[-_]/i.test(_dv.name)) continue; // exclude on-surface, on-background, etc.
                var _dRaw = resolveVarValue(_dv);
                if (!_dRaw || !('r' in _dRaw)) continue;
                var _dLum = _lum({ r: _dRaw.r, g: _dRaw.g, b: _dRaw.b });
                if (_dLum < _darkestLum) { _darkestLum = _dLum; _darkestVar = { v: _dv, raw: _dRaw }; }
              }
              if (_darkestVar) {
                var _darkRGB = { r: _darkestVar.raw.r, g: _darkestVar.raw.g, b: _darkestVar.raw.b };
                if (_contrastRatio(iconRGB, _darkRGB) > _contrastRatio(iconRGB, iconSurfaceRGB)) {
                  iconSurfaceRGB = _darkRGB;
                  iconSurfaceVar = _darkestVar.v;
                }
              }
            }

            var iconSurfaceLabel = iconSurfaceVar ? _tokenLabel(iconSurfaceVar.name) : null;
            var iconDesc = desc ? desc : '';
            if (iconSurfaceLabel) iconDesc = (iconDesc ? iconDesc + ' ' : '') + 'Shown on ' + iconSurfaceLabel + '.';
            fgRows.push(_buildSemColorRow(
              tokenLabel, iconDesc || null,
              iconSurfaceRGB, iconRGB,
              iconSurfaceVar, { isIcon: true, fgVar: v, hasPairing: true, previewText: tokenLeaf }
            ));
          } else {
            const bgRGB = { r: raw.r, g: raw.g, b: raw.b };
            // Try to find the fg pairing both as RGB and as a variable.
            // Pass 1: try prefixing each segment with 'on-' (e.g. color/bg/danger → color/on-bg/danger,
            //         color/surface/brand → color/on-surface/brand).
            var fgPairName = null;
            var fgPairParts = v.name.split('/');
            for (var pi = fgPairParts.length - 1; pi >= 0; pi--) {
              var cand = fgPairParts.slice();
              cand[pi] = 'on-' + cand[pi];
              var candName = cand.join('/');
              if (_semVarRGB.has(candName)) { fgPairName = candName; break; }
            }
            // Pass 2 — variant fallback (Material 3 convention).
            // Tokens ending in '-variant' (e.g. color/surface/danger-variant) share a single
            // foreground token (on-surface/default) rather than having a per-category counterpart.
            // Also handle role-based subtle tokens (e.g. color/bg/brand-subtle → color/text/brand).
            if (!fgPairName) {
              var lastName = fgPairParts[fgPairParts.length - 1];
              if (lastName && lastName.endsWith('-variant')) {
                // Find the on-surface/default counterpart in the same namespace.
                var nsParts = fgPairParts.slice(0, -1); // everything before the leaf
                var onNsDefault = nsParts.map(function(p) { return p === 'surface' ? 'on-surface' : p; }).join('/') + '/default';
                if (_semVarRGB.has(onNsDefault)) {
                  fgPairName = onNsDefault;
                } else {
                  // Cross-namespace fallback: try color/on-surface/default directly.
                  var crossDefault = 'color/on-surface/default';
                  if (_semVarRGB.has(crossDefault)) fgPairName = crossDefault;
                }
              } else if (lastName && lastName.endsWith('-subtle')) {
                // Role-based subtle: color/bg/brand-subtle → color/text/brand
                var subtleBase = lastName.replace(/-subtle$/, '');
                var subtleNsParts = fgPairParts.slice(0, -1);
                var onSubtle = subtleNsParts.map(function(p) { return /^bg|surface/.test(p) ? 'text' : p; }).join('/') + '/' + subtleBase;
                if (_semVarRGB.has(onSubtle)) fgPairName = onSubtle;
              }
            }
            const fgRGB    = fgPairName ? _semVarRGB.get(fgPairName) : null;
            const fgVar    = fgPairName ? (varByName[fgPairName] || null) : null;
            const hasPairing = !!fgRGB;
            const effectiveFg = fgRGB || (function() {
              var ind = _swatchIndicator(bgRGB);
              return ind.show ? ind.fg : _textColor;
            })();
            var pairingNote = fgPairName ? ('Paired with ' + _tokenLabel(fgPairName) + '.') : null;
            var rowDesc = (desc && pairingNote) ? (desc + ' ' + pairingNote) : (pairingNote || desc);
            const row = _buildSemColorRow(tokenLabel, rowDesc, bgRGB, effectiveFg, v, { fgVar: fgVar, hasPairing: hasPairing, previewText: tokenLeaf });
            if (hasPairing) bgPairedRows.push(row);
            else bgUnpairedRows.push(row);
          }
        }

        if (!bgPairedRows.length && !bgUnpairedRows.length && !fgRows.length) continue;
        const groupLabel = groupKey.split('/').pop() || groupKey;

        if (bgPairedRows.length) {
          _mainGroups.push({ key: groupKey, label: groupLabel, rows: [...bgPairedRows, ...bgUnpairedRows] });
          if (fgRows.length) _bottomGroups.push({ key: groupKey, label: groupLabel, rows: fgRows });
        } else {
          _bottomGroups.push({ key: groupKey, label: groupLabel, rows: [...fgRows, ...bgUnpairedRows] });
        }
      }

      if (_mainGroups.length) {
        const _semTable = _buildTable('Semantic Colors', _SEMANTIC_COLOR_DESC);
        const _semHeading = _buildTableHeading([
          { text: 'Token',    flex: true },
          { text: 'Example',  flex: true },
          { text: 'Contrast', width: 128, center: true },
          { text: 'WCAG',     width: 128, center: true },
        ], 16);
        _semTable.appendChild(_semHeading);
        _semHeading.layoutSizingHorizontal = 'FILL';
        _addTableDivider(_semTable);

        for (const { label, rows } of _sortSemanticGroups(_mainGroups)) {
          const headerRow = _buildGroupHeader(label);
          _semTable.appendChild(headerRow);
          headerRow.layoutSizingHorizontal = 'FILL';
          _addTableDivider(_semTable);
          for (const row of rows) {
            _semTable.appendChild(row);
            row.layoutSizingHorizontal = 'FILL';
            _addTableDivider(_semTable);
          }
        }
        _appendFill(_semTable, _colorsFrame);
      }

      for (const { label, rows } of _sortSemanticGroups(_bottomGroups)) {
        const _btTable = _buildTable(label, _colorTableDesc(label));
        const _btHeading = _buildTableHeading([
          { text: 'Token',   flex: true },
          { text: 'Example', flex: true },
        ], 16);
        _btTable.appendChild(_btHeading);
        _btHeading.layoutSizingHorizontal = 'FILL';
        _addTableDivider(_btTable);
        for (const row of rows) {
          _btTable.appendChild(row);
          row.layoutSizingHorizontal = 'FILL';
          _addTableDivider(_btTable);
        }
        _appendFill(_btTable, _colorsFrame);
      }
      }
    }

    _placeShowcaseSection('Colors', _colorsFrame, _myColorsX);
  }

  // ── Typography section ───────────────────────────────────────────────────────

  // Detect variable-based typography groups: type/{role}/{size} with /size, /line-height, /weight props.
  const _typoVarGroups = [];
  const _ROLE_ORDER = { display: 0, headline: 1, title: 2, body: 3, label: 4 };
  const _SIZE_ORDER = { lg: 0, md: 1, sm: 2 };
  for (const coll of _floatColls) {
    const _tvars = coll.vars.filter(v => /^type\/(?:display|headline|title|body|label)\//i.test(v.name));
    if (!_tvars.length) continue;
    const _roleMap = {};
    for (const v of _tvars) {
      const key = v.name.split('/').slice(0, 3).join('/');
      if (!_roleMap[key]) _roleMap[key] = [];
      _roleMap[key].push(v);
    }
    Object.keys(_roleMap).sort((a, b) => {
      const [, rA, sA] = a.split('/'); const [, rB, sB] = b.split('/');
      const rd = (_ROLE_ORDER[rA] !== undefined ? _ROLE_ORDER[rA] : 99) - (_ROLE_ORDER[rB] !== undefined ? _ROLE_ORDER[rB] : 99);
      return rd !== 0 ? rd : (_SIZE_ORDER[sA] !== undefined ? _SIZE_ORDER[sA] : 99) - (_SIZE_ORDER[sB] !== undefined ? _SIZE_ORDER[sB] : 99);
    }).forEach(key => {
      const gv = _roleMap[key];
      const sizeVar   = gv.find(v => v.name.endsWith('/size'));
      const lhVar     = gv.find(v => v.name.endsWith('/line-height'));
      const weightVar = gv.find(v => v.name.endsWith('/weight'));
      const familyVar = gv.find(v => v.name.endsWith('/family'));
      const sRaw = sizeVar   ? resolveVarValue(sizeVar)   : null;
      const lRaw = lhVar     ? resolveVarValue(lhVar)     : null;
      const wRaw = weightVar ? resolveVarValue(weightVar) : null;
      _typoVarGroups.push({
        key, sizeVar, lhVar, weightVar, familyVar,
        sizeVal:   typeof sRaw === 'number' ? sRaw : null,
        lhVal:     typeof lRaw === 'number' ? lRaw : null,
        weightVal: typeof wRaw === 'number' ? wRaw : null,
      });
    });
  }

  // Shared family variable fallback: used when a token group has no per-token /family var.
  // Search all float collections for the first STRING variable whose name contains 'family'.
  var _sharedFamilyVar = null;
  for (var _sfci = 0; _sfci < _floatColls.length && !_sharedFamilyVar; _sfci++) {
    var _sfVars = _floatColls[_sfci].vars;
    for (var _sfvi = 0; _sfvi < _sfVars.length && !_sharedFamilyVar; _sfvi++) {
      if (_sfVars[_sfvi].resolvedType === 'STRING' && /family/i.test(_sfVars[_sfvi].name)) {
        _sharedFamilyVar = _sfVars[_sfvi];
      }
    }
  }

  // Pre-load any font families referenced by the var-based type groups so that
  // fontName can be set to the variable's resolved value before binding.
  var _familyFontsToLoad = [];
  for (var _ffgi = 0; _ffgi < _typoVarGroups.length; _ffgi++) {
    var _ffv = _typoVarGroups[_ffgi].familyVar || _sharedFamilyVar;
    if (_ffv) {
      var _ffStr = resolveVarValue(_ffv);
      if (typeof _ffStr === 'string') {
        var _ffKey = _ffStr + '::Regular';
        if (!_fontSet.has(_ffKey)) {
          _fontSet.set(_ffKey, { family: _ffStr, style: 'Regular' });
          _familyFontsToLoad.push({ family: _ffStr, style: 'Regular' });
        }
      }
    }
  }
  if (_familyFontsToLoad.length) {
    await Promise.all(_familyFontsToLoad.map(function(f) { return figma.loadFontAsync(f).catch(function() {}); }));
  }

  const _prevTypography = _page.children.find(n =>
    (n.type === 'FRAME' || n.type === 'SECTION') && n.name === 'Token Showcase — Typography'
  );
  const _myTypographyX = _prevTypography ? _prevTypography.x : _sectionX;

  if (_sortedStyles.length || _typoVarGroups.length) {
    if (_prevTypography) _prevTypography.remove();
    const _typoFrame = _makeShowcaseFrame('Typography');
    _addToFrame(_buildSectionHeader('Typography', 'Type scale — sizes, weights, and line heights.'), _typoFrame);

    const _typoTable = _buildTable(null);
    const _typoHeading = _buildTableHeading([
      { text: 'Token',       flex: true },
      { text: 'Example',     flex: true },
      { text: 'Size',        width: 128 },
      { text: 'Line Height', width: 128 },
      { text: 'Weight',      width: 128 },
    ], 16);
    _typoTable.appendChild(_typoHeading);
    _typoHeading.layoutSizingHorizontal = 'FILL';
    _addTableDivider(_typoTable);

    for (const style of _sortedStyles) {
      const row = _buildTypoRow(style);
      _typoTable.appendChild(row);
      row.layoutSizingHorizontal = 'FILL';
      _addTableDivider(_typoTable);
    }

    // Var-based rows are a fallback path only — shown when the DS has no text styles.
    if (!_sortedStyles.length) {
      for (const group of _typoVarGroups) {
        const row = _buildTypoVarRow(group);
        _typoTable.appendChild(row);
        row.layoutSizingHorizontal = 'FILL';
        _addTableDivider(_typoTable);
      }
    }

    _appendFill(_typoTable, _typoFrame);
    _placeShowcaseSection('Typography', _typoFrame, _myTypographyX);
  }

  // ── Spacing section ──────────────────────────────────────────────────────────

  const _prevSpacing = _page.children.find(n =>
    (n.type === 'FRAME' || n.type === 'SECTION') && n.name === 'Token Showcase — Spacing'
  );
  const _mySpacingX = _prevSpacing ? _prevSpacing.x : _sectionX;
  if (_floatColls.length) {
    if (_prevSpacing) _prevSpacing.remove();

    const _barGroups    = [];
    const _insetGroups  = [];
    const _touchGroups  = [];
    const _radiusGroups = [];
    const _borderGroups = [];

    for (const coll of _floatColls) {
      const _floatVarsInColl = coll.vars.filter(v => v.resolvedType === 'FLOAT');
      const _groups = groupByPath(_floatVarsInColl);

      for (const [groupPath, vars] of Object.entries(_groups)) {
        if (/^(?:type|typo|typography|font|text(?:[\/-]|$)|label|body|heading|display|caption|letter|tracking|leading|line[-_]?height|font[-_]?size|font[-_]?weight)/i.test(groupPath)) continue;
        const _resolved  = vars.map(v => { const n = resolveVarValue(v); return typeof n === 'number' ? n : null; });
        const _sorted    = vars.map((v, i) => ({ v, val: _resolved[i] }))
                               .sort((a, b) => (a.val != null ? a.val : Infinity) - (b.val != null ? b.val : Infinity));
        const sortedVars   = _sorted.map(p => p.v);
        const sortedValues = _sorted.map(p => p.val);
        const type = _groupVisualType(groupPath, sortedValues);
        const entry = { groupPath: groupPath || coll.name, sortedVars, sortedValues };
        if (type === 'inset') _insetGroups.push(entry);
        else if (type === 'touch')  _touchGroups.push(entry);
        else if (type === 'radius') _radiusGroups.push(entry);
        else if (type === 'border') _borderGroups.push(entry);
        else _barGroups.push(entry);
      }
    }

    const _spacingFrame = _makeShowcaseFrame('Spacing');
    _addToFrame(_buildSectionHeader('Spacing', 'Scale, border radius, and border width tokens.'), _spacingFrame);

    function _buildGroupTable(groupPath, sortedVars, sortedValues, parentCol, visualType) {
      const svType = visualType === 'bar' ? 'spacing' : visualType;
      const table = _buildTable(groupPath.split('/').pop() || groupPath, _spacingGroupDesc(groupPath, svType));
      for (let i = 0; i < sortedVars.length; i++) {
        const row = _buildSpacingRow(sortedVars[i], sortedValues[i], svType);
        table.appendChild(row);
        row.layoutSizingHorizontal = 'FILL';
        _addTableDivider(table);
      }
      _appendFill(table, parentCol);
    }

    const _spTwoCols = _f('Two Columns', 'HORIZONTAL');
    _spTwoCols.itemSpacing = 24;
    _spTwoCols.counterAxisAlignItems = 'MIN';

    if (_barGroups.length || _insetGroups.length) {
      const _leftCol = _f('Spacing', 'VERTICAL');
      _leftCol.itemSpacing = 32;
      _spTwoCols.appendChild(_leftCol);
      _leftCol.layoutSizingHorizontal = 'FILL';
      for (const { groupPath, sortedVars, sortedValues } of _barGroups) {
        _buildGroupTable(groupPath, sortedVars, sortedValues, _leftCol, 'bar');
      }
      for (const { groupPath, sortedVars, sortedValues } of _insetGroups) {
        _buildGroupTable(groupPath, sortedVars, sortedValues, _leftCol, 'inset');
      }
    }

    if (_touchGroups.length || _radiusGroups.length || _borderGroups.length) {
      const _rightCol = _f('Effects', 'VERTICAL');
      _rightCol.itemSpacing = 32;
      _spTwoCols.appendChild(_rightCol);
      _rightCol.layoutSizingHorizontal = 'FILL';
      for (const { groupPath, sortedVars, sortedValues } of _touchGroups) {
        _buildGroupTable(groupPath, sortedVars, sortedValues, _rightCol, 'touch');
      }
      for (const { groupPath, sortedVars, sortedValues } of _radiusGroups) {
        _buildGroupTable(groupPath, sortedVars, sortedValues, _rightCol, 'radius');
      }
      for (const { groupPath, sortedVars, sortedValues } of _borderGroups) {
        _buildGroupTable(groupPath, sortedVars, sortedValues, _rightCol, 'border');
      }
    }

    _appendFill(_spTwoCols, _spacingFrame);
    _placeShowcaseSection('Spacing', _spacingFrame, _mySpacingX);
  }

  // ── Elevation section ────────────────────────────────────────────────────────

  const _elevationStyles = effectStyles
    .filter(s => s.effects.some(e => e.type === 'DROP_SHADOW'))
    .sort((a, b) => {
      const aE = a.effects.find(e => e.type === 'DROP_SHADOW');
      const bE = b.effects.find(e => e.type === 'DROP_SHADOW');
      return (aE ? aE.radius : 0) - (bE ? bE.radius : 0);
    });

  const _prevElevation = _page.children.find(n =>
    (n.type === 'FRAME' || n.type === 'SECTION') && n.name === 'Token Showcase — Elevation'
  );
  const _myElevationX = _prevElevation ? _prevElevation.x : _sectionX;

  if (_elevationStyles.length) {
    if (_prevElevation) _prevElevation.remove();
    const _elevFrame = _makeShowcaseFrame('Elevation');
    _addToFrame(_buildSectionHeader('Elevation', 'Drop shadows for layering depth.'), _elevFrame);

    const _elevTable = _buildTable('Elevation', 'Shadow styles for layered surfaces, popovers, and raised UI.');
    _elevTable.clipsContent = false;
    const _elevHeading = _buildTableHeading([
      { text: 'Token',    flex: true },
      { text: 'Preview',  width: 96  },
      { text: 'Offset Y', width: 96  },
      { text: 'Blur',     width: 96  },
      { text: 'Spread',   width: 96  },
    ], 8);
    _elevTable.appendChild(_elevHeading);
    _elevHeading.layoutSizingHorizontal = 'FILL';
    _addTableDivider(_elevTable);

    for (const style of _elevationStyles) {
      const shadow = style.effects.find(e => e.type === 'DROP_SHADOW');
      const row = _tableRow(style.name);
      row.fills    = [_paint(_RC.surfaceDefault, _V.surfaceDefault)];
      row.paddingLeft = 16; row.paddingRight  = 16;
      row.paddingTop  = 16; row.paddingBottom = 16;
      row.itemSpacing = 8;

      const tokenCell = _f('TokenCell', 'VERTICAL');
      tokenCell.paddingLeft = 12; tokenCell.paddingRight  = 12;
      tokenCell.paddingTop  = 12; tokenCell.paddingBottom = 12;
      tokenCell.itemSpacing = 8;
      tokenCell.counterAxisAlignItems = 'MIN';
      tokenCell.primaryAxisAlignItems = 'CENTER';
      const _elevTag = _buildTag(style.name.split('/').pop());
      tokenCell.appendChild(_elevTag);
      _elevTag.layoutSizingHorizontal = 'HUG';
      const _elevDesc = _tDS(_tokenDesc(style.name) || 'Shadow style for layered surfaces and raised UI.', 12, _subColor, false, _V.textSub);
      _elevDesc.name = 'DS Description';
      tokenCell.appendChild(_elevDesc);
      _elevDesc.layoutSizingHorizontal = 'FILL';
      row.appendChild(tokenCell);
      tokenCell.layoutSizingHorizontal = 'FILL';
      tokenCell.layoutSizingVertical   = 'FILL';

      const card = figma.createFrame();
      card.resize(56, 40);
      card.clipsContent = false;
      card.cornerRadius = 8;
      card.fills = [_paint(_bgColor, _V.bg)];
      card.effectStyleId = style.id;
      const previewCell = _f('Visual', 'HORIZONTAL');
      previewCell.clipsContent = false;
      previewCell.paddingTop = 8; previewCell.paddingBottom = 8;
      previewCell.paddingLeft = 12; previewCell.paddingRight = 12;
      previewCell.primaryAxisAlignItems = 'CENTER';
      previewCell.counterAxisAlignItems = 'CENTER';
      previewCell.appendChild(card);
      row.appendChild(previewCell);
      previewCell.layoutSizingHorizontal = 'FIXED';
      previewCell.resize(96, 1);
      previewCell.layoutSizingVertical   = 'FILL';

      const offsetY = shadow ? `${shadow.offset.y}px`   : '—';
      const blur    = shadow ? `${shadow.radius}px`      : '—';
      const spread  = shadow ? `${shadow.spread != null ? shadow.spread : 0}px` : '—';
      for (const val of [offsetY, blur, spread]) {
        const mc = _metaCell(val);
        row.appendChild(mc);
        mc.layoutSizingHorizontal = 'FIXED';
        mc.resize(96, 1);
        mc.layoutSizingVertical   = 'FILL';
      }

      _addRow(row, _elevTable);
      _addTableDivider(_elevTable);
    }

    _appendFill(_elevTable, _elevFrame);
    _placeShowcaseSection('Elevation', _elevFrame, _myElevationX);
  }

  // ── Scrims section ───────────────────────────────────────────────────────────

  const _scrimVars = Object.values(varByName)
    .filter(v => {
      if (v.resolvedType !== 'COLOR') return false;
      const c = resolveVarValue(v);
      if (!c || !('r' in c)) return false;
      return (c.a !== undefined ? c.a : 1) < 0.95;
    })
    .sort((a, b) => {
      const aA = (() => { const c = resolveVarValue(a); return c ? (c.a != null ? c.a : 1) : 1; })();
      const bA = (() => { const c = resolveVarValue(b); return c ? (c.a != null ? c.a : 1) : 1; })();
      return Math.abs(aA - bA) > 0.01 ? aA - bA : a.name.localeCompare(b.name);
    });

  const _prevScrims = _page.children.find(n =>
    (n.type === 'FRAME' || n.type === 'SECTION') && n.name === 'Token Showcase — Scrims'
  );
  const _myScrimsX = _prevScrims ? _prevScrims.x : _sectionX;

  if (_scrimVars.length) {
    if (_prevScrims) _prevScrims.remove();
    const _scrimFrame = _makeShowcaseFrame('Scrims');
    _addToFrame(_buildSectionHeader('Overlays & Scrims', 'Scrim and overlay opacity tokens.'), _scrimFrame);

    const _scrimTable = _buildTable('Overlays & Scrims', _SCRIM_TABLE_DESC);
    const _scrimHeading = _buildTableHeading([
      { text: 'Token',   flex: true },
      { text: 'Preview', width: 96  },
      { text: 'Opacity', width: 96, center: true },
    ], 8);
    _scrimTable.appendChild(_scrimHeading);
    _scrimHeading.layoutSizingHorizontal = 'FILL';
    _addTableDivider(_scrimTable);

    const _scrimGroups = {};
    for (const v of _scrimVars) {
      const parts = v.name.split('/');
      const key   = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      if (!_scrimGroups[key]) _scrimGroups[key] = [];
      _scrimGroups[key].push(v);
    }

    for (const [groupPath, groupVars] of Object.entries(_scrimGroups)) {
      if (Object.keys(_scrimGroups).length > 1 && groupPath) {
        const groupHeader = _buildGroupHeader(groupPath.split('/').pop() || groupPath);
        _scrimTable.appendChild(groupHeader);
        groupHeader.layoutSizingHorizontal = 'FILL';
        _addTableDivider(_scrimTable);
      }

      for (const scrimVar of groupVars) {
        const scrimResolved = resolveVarValue(scrimVar);
        const scrimRGB   = scrimResolved && 'r' in scrimResolved
          ? { r: scrimResolved.r, g: scrimResolved.g, b: scrimResolved.b }
          : { r: 0, g: 0, b: 0 };
        const scrimAlpha = scrimResolved && scrimResolved.a !== undefined ? scrimResolved.a : 0.5;
        const desc       = (scrimVar.description && scrimVar.description.trim()) ? scrimVar.description.trim() : null;

        const row = _tableRow(scrimVar.name);
        row.fills    = [_paint(_RC.surfaceDefault, _V.surfaceDefault)];
        row.paddingLeft = 16; row.paddingRight  = 16;
        row.paddingTop  = 16; row.paddingBottom = 16;
        row.itemSpacing = 8;

        const tokenCell = _f('TokenCell', 'VERTICAL');
        tokenCell.paddingLeft = 12; tokenCell.paddingRight  = 12;
        tokenCell.paddingTop  = 12; tokenCell.paddingBottom = 12;
        tokenCell.itemSpacing = 8;
        tokenCell.counterAxisAlignItems = 'MIN';
        tokenCell.primaryAxisAlignItems = 'CENTER';
        const _scrimTag = _buildTag(scrimVar.name.split('/').pop());
        tokenCell.appendChild(_scrimTag);
        _scrimTag.layoutSizingHorizontal = 'HUG';
        const scrimDescText = _tokenDesc(scrimVar.name);
        const _scrimDesc = _tDS(scrimDescText || desc || 'Scrim token for layered overlays and dimmed backgrounds.', 12, _subColor, false, _V.textSub);
        _scrimDesc.name = 'DS Description';
        tokenCell.appendChild(_scrimDesc);
        _scrimDesc.layoutSizingHorizontal = 'FILL';
        row.appendChild(tokenCell);
        tokenCell.layoutSizingHorizontal = 'FILL';
        tokenCell.layoutSizingVertical   = 'FILL';

        const demo = figma.createFrame();
        demo.resize(56, 40);
        demo.layoutMode = 'NONE';
        demo.cornerRadius = 4;
        demo.fills = [
          _paint(_bgColor, _V.bg),
          figma.variables.setBoundVariableForPaint(
            { type: 'SOLID', color: scrimRGB, opacity: scrimAlpha },
            'color',
            scrimVar
          ),
        ];
        const demoCell = _f('Visual', 'HORIZONTAL');
        demoCell.paddingTop = 8; demoCell.paddingBottom = 8;
        demoCell.paddingLeft = 12; demoCell.paddingRight = 12;
        demoCell.primaryAxisAlignItems = 'CENTER';
        demoCell.counterAxisAlignItems = 'CENTER';
        demoCell.appendChild(demo);
        row.appendChild(demoCell);
        demoCell.layoutSizingHorizontal = 'FIXED';
        demoCell.resize(96, 1);
        demoCell.layoutSizingVertical   = 'FILL';

        const opacityCell = _metaCell(`${Math.round(scrimAlpha * 100)}%`);
        row.appendChild(opacityCell);
        opacityCell.layoutSizingHorizontal = 'FIXED';
        opacityCell.resize(96, 1);
        opacityCell.layoutSizingVertical   = 'FILL';

        _addRow(row, _scrimTable);
        _addTableDivider(_scrimTable);
      }
    }

    _appendFill(_scrimTable, _scrimFrame);
    _placeShowcaseSection('Scrims', _scrimFrame, _myScrimsX);
  }

  // ── Finale ───────────────────────────────────────────────────────────────────

  const _showcaseNodes = _page.children
    .filter(n => n.name.startsWith('Token Showcase'));

  const _builtSections = _showcaseNodes.map(n => n.name.replace('Token Showcase — ', ''));

  for (const _showcaseNode of _showcaseNodes) {
    _bindShowcaseNodeProperties(_showcaseNode);
  }
  await new Promise(function(resolve) { setTimeout(resolve, 0); });
  for (const _showcaseNode of _showcaseNodes) {
    _bindShowcaseNodeProperties(_showcaseNode);
  }
  try {
    const _prevSelection = figma.currentPage.selection.slice();
    figma.currentPage.selection = _showcaseNodes;
    var _qaPass = null;
    try {
      _qaPass = await _runQaBindingAudit({ fix: true });
    } finally {
      figma.currentPage.selection = _prevSelection;
    }
    if (_qaPass && _qaPass.failedCount) {
      _warnShowcaseBinding('QA binding pass left ' + _qaPass.failedCount + ' unresolved gap(s).');
    }
  } catch (_) {}


  if (_showcaseNodes.length) {
    figma.viewport.scrollAndZoomIntoView(_showcaseNodes);
  }

  return {
    sections: _builtSections,
    layout: 'horizontal, 100px gap between Figma sections',
    bindingWarnings: _showcaseBindingWarnings
  };
}

// ── DS Setup implementation ──────────────────────────────────────────────────
// Creates all 5 variable collections from a prepared DS config payload.
// Input: the full DS object (from design-system.config.js after running prepare_ds_config).

async function _applyDsSetup(DS) {
  if (!DS) throw new Error('No DS config data received.');

  var built = [];
  var skipped = [];

  // ── helpers ──────────────────────────────────────────────────────────────────

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    };
  }

  function sanitize(s) { return String(s).replace('.', '-'); }

  async function getOrCreateCollection(name, initialMode) {
    var existing = await figma.variables.getLocalVariableCollectionsAsync();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].name === name) {
        // Collection exists — check if it has any variables at all
        var allVars = await figma.variables.getLocalVariablesAsync();
        var varCount = 0;
        for (var j = 0; j < allVars.length; j++) {
          if (allVars[j].variableCollectionId === existing[i].id) { varCount++; break; }
        }
        if (varCount > 0) return { collection: existing[i], existed: true };
        // Empty shell — rename the first mode and treat as new
        if (initialMode && existing[i].modes[0]) {
          existing[i].renameMode(existing[i].modes[0].modeId, initialMode);
        }
        return { collection: existing[i], existed: false };
      }
    }
    var coll = figma.variables.createVariableCollection(name);
    if (initialMode && coll.modes[0]) {
      coll.renameMode(coll.modes[0].modeId, initialMode);
    }
    return { collection: coll, existed: false };
  }

  // Build a map from variable name → variable id within a given collection
  async function buildVarMap(collectionId) {
    var allVars = await figma.variables.getLocalVariablesAsync();
    var map = {};
    for (var i = 0; i < allVars.length; i++) {
      if (allVars[i].variableCollectionId === collectionId) {
        map[allVars[i].name] = allVars[i].id;
      }
    }
    return map;
  }

  function buildModeMap(collection, modeNames) {
    var map = {};
    for (var i = 0; i < modeNames.length; i++) {
      var modeName = modeNames[i];
      var existingModeId = null;
      for (var j = 0; j < collection.modes.length; j++) {
        if (collection.modes[j].name === modeName) { existingModeId = collection.modes[j].modeId; break; }
      }
      if (existingModeId !== null) {
        map[modeName] = existingModeId;
      } else if (i === 0 && collection.modes[0]) {
        map[modeName] = collection.modes[0].modeId;
      } else {
        map[modeName] = collection.addMode(modeName);
      }
    }
    return map;
  }

  var _typePrefixSetup = (DS.naming && DS.naming.typePrefix) ? DS.naming.typePrefix : 'type';
  var _fontFamilyPatternSetup = (DS.naming && DS.naming.fontFamily) ? DS.naming.fontFamily : 'font/{variant}';

  // ── Collection 1 — Primitives ─────────────────────────────────────────────

  var primName = (DS.collections && DS.collections.primitives) ? DS.collections.primitives : '1. Primitives';
  var _primRes = await getOrCreateCollection(primName, 'Default');
  var primColl = _primRes.collection;
  var primModeId = primColl.modes[0].modeId;

  // Check if Primitives is missing COLOR vars (user may have deleted ramps but kept FLOAT/STRING vars)
  var _primHasColors = false;
  if (_primRes.existed) {
    var _primCheckVars = await figma.variables.getLocalVariablesAsync();
    for (var _pci = 0; _pci < _primCheckVars.length; _pci++) {
      if (_primCheckVars[_pci].variableCollectionId === primColl.id && _primCheckVars[_pci].resolvedType === 'COLOR') {
        _primHasColors = true; break;
      }
    }
  }

  if (_primRes.existed && _primHasColors) {
    skipped.push(primName + ' (already exists — skipped)');
  } else {
    // Merge mode: skip vars that already exist (collection may have existing FLOAT/STRING vars)
    var _primMergeMap = await buildVarMap(primColl.id);

    // 1A — color ramps
    if (DS.color && DS.color.ramps) {
      for (var ri = 0; ri < DS.color.ramps.length; ri++) {
        var ramp = DS.color.ramps[ri];
        for (var si = 0; si < ramp.steps.length; si++) {
          var step = ramp.steps[si];
          var vName = ramp.folder + '/' + step[0];
          if (_primMergeMap[vName]) continue;
          var v = figma.variables.createVariable(vName, primColl, 'COLOR');
          v.setValueForMode(primModeId, { r: step[1], g: step[2], b: step[3] });
        }
      }
    }

    // 1A-ii — scrims (COLOR with alpha)
    var SCRIMS = [
      { name: 'color/scrim/black/4',  r: 0, g: 0, b: 0, a: 0.04 },
      { name: 'color/scrim/black/8',  r: 0, g: 0, b: 0, a: 0.08 },
      { name: 'color/scrim/black/12', r: 0, g: 0, b: 0, a: 0.12 },
      { name: 'color/scrim/black/20', r: 0, g: 0, b: 0, a: 0.20 },
      { name: 'color/scrim/black/40', r: 0, g: 0, b: 0, a: 0.40 },
      { name: 'color/scrim/black/60', r: 0, g: 0, b: 0, a: 0.60 },
      { name: 'color/scrim/white/8',  r: 1, g: 1, b: 1, a: 0.08 },
      { name: 'color/scrim/white/12', r: 1, g: 1, b: 1, a: 0.12 },
      { name: 'color/scrim/white/16', r: 1, g: 1, b: 1, a: 0.16 },
      { name: 'color/scrim/white/20', r: 1, g: 1, b: 1, a: 0.20 },
    ];
    for (var sci = 0; sci < SCRIMS.length; sci++) {
      var sc = SCRIMS[sci];
      if (_primMergeMap[sc.name]) continue;
      var sv = figma.variables.createVariable(sc.name, primColl, 'COLOR');
      sv.setValueForMode(primModeId, { r: sc.r, g: sc.g, b: sc.b, a: sc.a });
    }

    // 1A-iii — shadow FLOAT primitives
    var SHADOW_FLOATS = [
      { name: 'shadow/1/offset-y', value: 1 }, { name: 'shadow/1/radius', value: 2 },
      { name: 'shadow/2/offset-y', value: 4 }, { name: 'shadow/2/radius', value: 8 },
      { name: 'shadow/3/offset-y', value: 8 }, { name: 'shadow/3/radius', value: 16 },
      { name: 'shadow/4/offset-y', value: 12 }, { name: 'shadow/4/radius', value: 24 },
      { name: 'shadow/5/offset-y', value: 16 }, { name: 'shadow/5/radius', value: 32 },
      { name: 'shadow/ambient/2/radius', value: 8 }, { name: 'shadow/ambient/3/radius', value: 12 },
      { name: 'shadow/ambient/4/radius', value: 16 }, { name: 'shadow/ambient/5/radius', value: 20 },
    ];
    for (var sfi = 0; sfi < SHADOW_FLOATS.length; sfi++) {
      var sf = SHADOW_FLOATS[sfi];
      if (_primMergeMap[sf.name]) continue;
      var sfv = figma.variables.createVariable(sf.name, primColl, 'FLOAT');
      sfv.setValueForMode(primModeId, sf.value);
    }

    // 1B — type primitives (FLOAT + STRING)
    var _tp = _typePrefixSetup;
    var TYPE_WEIGHTS = [
      { name: _tp + '/weight/regular', value: 400 }, { name: _tp + '/weight/medium', value: 500 },
      { name: _tp + '/weight/semibold', value: 600 }, { name: _tp + '/weight/bold', value: 700 },
    ];
    var TYPE_LH = [
      { name: _tp + '/line-height/tight', value: 1.2 }, { name: _tp + '/line-height/snug', value: 1.35 },
      { name: _tp + '/line-height/normal', value: 1.5 }, { name: _tp + '/line-height/relaxed', value: 1.65 },
      { name: _tp + '/line-height/loose', value: 1.8 },
    ];
    var TYPE_TRACKING = [
      { name: _tp + '/tracking/tight', value: -0.02 }, { name: _tp + '/tracking/snug', value: -0.01 },
      { name: _tp + '/tracking/normal', value: 0 }, { name: _tp + '/tracking/open', value: 0.01 },
      { name: _tp + '/tracking/wide', value: 0.02 }, { name: _tp + '/tracking/wider', value: 0.05 },
      { name: _tp + '/tracking/widest', value: 0.1 },
    ];
    var TYPE_SIZES = [
      { name: _tp + '/size/2xs', value: 10 }, { name: _tp + '/size/xs', value: 12 },
      { name: _tp + '/size/sm', value: 14 }, { name: _tp + '/size/md', value: 16 },
      { name: _tp + '/size/lg', value: 18 }, { name: _tp + '/size/xl', value: 20 },
      { name: _tp + '/size/2xl', value: 24 }, { name: _tp + '/size/3xl', value: 30 },
      { name: _tp + '/size/4xl', value: 36 }, { name: _tp + '/size/5xl', value: 48 },
      { name: _tp + '/size/6xl', value: 60 }, { name: _tp + '/size/7xl', value: 72 },
    ];

    var allTypeFloats = TYPE_WEIGHTS.concat(TYPE_LH).concat(TYPE_TRACKING).concat(TYPE_SIZES);
    for (var tfi = 0; tfi < allTypeFloats.length; tfi++) {
      var tf = allTypeFloats[tfi];
      if (_primMergeMap[tf.name]) continue;
      var tfv = figma.variables.createVariable(tf.name, primColl, 'FLOAT');
      tfv.setValueForMode(primModeId, tf.value);
    }

    // Font family strings
    var _ff = _fontFamilyPatternSetup;
    var families = (DS.typography && DS.typography.families) ? DS.typography.families : {};
    var famEntries = [
      { key: 'sans',  value: families.sans  || 'Inter' },
      { key: 'mono',  value: families.mono  || 'JetBrains Mono' },
    ];
    if (families.serif) famEntries.push({ key: 'serif', value: families.serif });
    for (var fami = 0; fami < famEntries.length; fami++) {
      var fam = famEntries[fami];
      var famVarName = _ff.replace('{variant}', fam.key);
      if (_primMergeMap[famVarName]) continue;
      var famv = figma.variables.createVariable(famVarName, primColl, 'STRING');
      famv.setValueForMode(primModeId, fam.value);
    }

    // 1C — spacing primitives
    if (DS.primitives && DS.primitives.spacing) {
      for (var spi = 0; spi < DS.primitives.spacing.length; spi++) {
        var sp = DS.primitives.spacing[spi];
        var spVarName = 'space/' + sanitize(sp[0]);
        if (_primMergeMap[spVarName]) continue;
        var spv = figma.variables.createVariable(spVarName, primColl, 'FLOAT');
        spv.setValueForMode(primModeId, sp[1]);
      }
    }

    // Hide primitives from publishing
    try { primColl.hiddenFromPublishing = true; } catch (e) {}

    built.push(primName);
  }

  // ── Collection 2 — Color Semantics ────────────────────────────────────────

  var semName = (DS.collections && DS.collections.color) ? DS.collections.color : '2. Color';
  var _semRes = await getOrCreateCollection(semName, 'Light');
  var semColl = _semRes.collection;

  // Check if Color collection's vars are missing aliases (created before Primitives had ramp vars)
  var _semNeedsRepair = false;
  if (_semRes.existed) {
    var _semCheckVars = await figma.variables.getLocalVariablesAsync();
    var _semHasAlias = false;
    for (var _sci = 0; _sci < _semCheckVars.length; _sci++) {
      var _scv = _semCheckVars[_sci];
      if (_scv.variableCollectionId !== semColl.id) continue;
      var _scvModeIds = Object.keys(_scv.valuesByMode || {});
      for (var _scmi = 0; _scmi < _scvModeIds.length; _scmi++) {
        var _scvVal = _scv.valuesByMode[_scvModeIds[_scmi]];
        if (_scvVal && _scvVal.type === 'VARIABLE_ALIAS') { _semHasAlias = true; break; }
      }
      if (_semHasAlias) break;
    }
    _semNeedsRepair = !_semHasAlias;
  }

  if (_semRes.existed && _semNeedsRepair) {
    // Primitives ramp vars now exist — rewire the empty semantic aliases
    var _repAllVars = await figma.variables.getLocalVariablesAsync();
    var _repPrimMap = {};
    var _repSemVarObj = {};
    for (var _rvi = 0; _rvi < _repAllVars.length; _rvi++) {
      if (_repAllVars[_rvi].variableCollectionId === primColl.id) {
        _repPrimMap[_repAllVars[_rvi].name] = _repAllVars[_rvi].id;
      }
      if (_repAllVars[_rvi].variableCollectionId === semColl.id) {
        _repSemVarObj[_repAllVars[_rvi].name] = _repAllVars[_rvi];
      }
    }

    var _repLightModeId = semColl.modes[0].modeId;
    var _repDarkModeId = null;
    for (var _rmi2 = 0; _rmi2 < semColl.modes.length; _rmi2++) {
      if (/dark/i.test(semColl.modes[_rmi2].name)) { _repDarkModeId = semColl.modes[_rmi2].modeId; break; }
    }

    function _repAlias(primName) {
      var id = _repPrimMap[primName];
      return id ? { type: 'VARIABLE_ALIAS', id: id } : null;
    }

    function _repSetAlias(tokenName, lightRef, darkRef) {
      var v = _repSemVarObj[tokenName];
      if (!v) return;
      if (lightRef) { var _rla = _repAlias(lightRef); if (_rla) v.setValueForMode(_repLightModeId, _rla); }
      if (darkRef && _repDarkModeId) { var _rda = _repAlias(darkRef); if (_rda) v.setValueForMode(_repDarkModeId, _rda); }
    }

    if (DS.color && DS.color.semantics) {
      var _repSem = DS.color.semantics;
      // Pairs (deduplicated token map)
      var _repTokMap = {};
      var _repPairs = _repSem.pairs || [];
      for (var _rpi2 = 0; _rpi2 < _repPairs.length; _rpi2++) {
        var _rp2 = _repPairs[_rpi2];
        if (!_repTokMap[_rp2.bg])   _repTokMap[_rp2.bg]   = { L: _rp2.Light ? _rp2.Light.bg   : null, D: _rp2.Dark ? _rp2.Dark.bg   : null };
        if (!_repTokMap[_rp2.text]) _repTokMap[_rp2.text] = { L: _rp2.Light ? _rp2.Light.text : null, D: _rp2.Dark ? _rp2.Dark.text : null };
      }
      var _repTokNames = Object.keys(_repTokMap);
      for (var _rti2 = 0; _rti2 < _repTokNames.length; _rti2++) {
        var _rtn2 = _repTokNames[_rti2];
        _repSetAlias(_rtn2, _repTokMap[_rtn2].L, _repTokMap[_rtn2].D);
      }
      // Icons
      var _repIcons = _repSem.icons || [];
      for (var _rii2 = 0; _rii2 < _repIcons.length; _rii2++) {
        var _ri2 = _repIcons[_rii2];
        _repSetAlias(_ri2.token, _ri2.Light, _ri2.Dark);
      }
      // Unpaired (borders, surfaces, scrims, shadows)
      var _repUnpaired = _repSem.unpaired || [];
      var _repCreated = {};
      for (var _rui2 = 0; _rui2 < _repUnpaired.length; _rui2++) {
        var _ru2 = _repUnpaired[_rui2];
        if (_repCreated[_ru2.token]) continue;
        _repCreated[_ru2.token] = true;
        var _ruL = (typeof _ru2.Light === 'string') ? _ru2.Light : null;
        var _ruD = (typeof _ru2.Dark  === 'string') ? _ru2.Dark  : null;
        _repSetAlias(_ru2.token, _ruL, _ruD);
      }
    }

    built.push(semName + ' (aliases repaired)');
  } else if (_semRes.existed) {
    skipped.push(semName + ' (already exists — skipped)');
  } else {
    // Add Dark mode
    var darkModeId = semColl.addMode('Dark');
    var lightModeId = semColl.modes[0].modeId;

    var primVarMap = await buildVarMap(primColl.id);

    function makeAlias(primitiveVarName) {
      var id = primVarMap[primitiveVarName];
      if (!id) return null;
      return { type: 'VARIABLE_ALIAS', id: id };
    }

    if (DS.color && DS.color.semantics) {
      var sem = DS.color.semantics;

      // bg+text pairs — build a deduplicated token map first, then create each variable once.
      // DS.color.semantics.pairs is a RELATIONSHIPS list: the same token (e.g. color/bg/default
      // or color/on-surface/default) can appear as the bg or text counterpart in multiple pairs.
      // Creating a Figma variable for every pair entry would crash on the 2nd duplicate name.
      var tokenMap = {}; // name → { Light: primitiveRef | null, Dark: primitiveRef | null }

      var pairs = sem.pairs || [];
      for (var pi = 0; pi < pairs.length; pi++) {
        var pair = pairs[pi];
        if (!tokenMap[pair.bg]) {
          tokenMap[pair.bg] = {
            Light: pair.Light ? pair.Light.bg   : null,
            Dark:  pair.Dark  ? pair.Dark.bg    : null,
          };
        }
        if (!tokenMap[pair.text]) {
          tokenMap[pair.text] = {
            Light: pair.Light ? pair.Light.text : null,
            Dark:  pair.Dark  ? pair.Dark.text  : null,
          };
        }
      }

      var tokenNames = Object.keys(tokenMap);
      for (var ti = 0; ti < tokenNames.length; ti++) {
        var tName  = tokenNames[ti];
        var tEntry = tokenMap[tName];
        var tVar   = figma.variables.createVariable(tName, semColl, 'COLOR');
        if (tEntry.Light) {
          var tLAlias = makeAlias(tEntry.Light);
          if (tLAlias) tVar.setValueForMode(lightModeId, tLAlias);
        }
        if (tEntry.Dark) {
          var tDAlias = makeAlias(tEntry.Dark);
          if (tDAlias) tVar.setValueForMode(darkModeId, tDAlias);
        }
      }

      // icon tokens
      var icons = sem.icons || [];
      for (var ii = 0; ii < icons.length; ii++) {
        var icon = icons[ii];
        var iconVar = figma.variables.createVariable(icon.token, semColl, 'COLOR');
        if (icon.Light) { var ilAlias = makeAlias(icon.Light); if (ilAlias) iconVar.setValueForMode(lightModeId, ilAlias); }
        if (icon.Dark)  { var idAlias = makeAlias(icon.Dark);  if (idAlias) iconVar.setValueForMode(darkModeId,  idAlias); }
      }

      // unpaired tokens (borders, surfaces, scrims, shadows)
      var unpaired = sem.unpaired || [];
      var createdSemTokens = new Set();
      for (var upi = 0; upi < unpaired.length; upi++) {
        var up = unpaired[upi];
        if (createdSemTokens.has(up.token)) continue;
        createdSemTokens.add(up.token);
        var upVar = figma.variables.createVariable(up.token, semColl, 'COLOR');
        if (up.Light) {
          if (typeof up.Light === 'string' && up.Light.startsWith('color/scrim/')) {
            var scrimAlias = makeAlias(up.Light);
            if (scrimAlias) upVar.setValueForMode(lightModeId, scrimAlias);
          } else if (typeof up.Light === 'string') {
            var upLAlias = makeAlias(up.Light);
            if (upLAlias) upVar.setValueForMode(lightModeId, upLAlias);
          }
        }
        if (up.Dark) {
          if (typeof up.Dark === 'string' && up.Dark.startsWith('color/scrim/')) {
            var scrimDAlias = makeAlias(up.Dark);
            if (scrimDAlias) upVar.setValueForMode(darkModeId, scrimDAlias);
          } else if (typeof up.Dark === 'string') {
            var upDAlias = makeAlias(up.Dark);
            if (upDAlias) upVar.setValueForMode(darkModeId, upDAlias);
          }
        }
      }
    }

    built.push(semName);
  }

  // ── Collection 3 — Typography ─────────────────────────────────────────────

  var typoName = (DS.collections && DS.collections.typography) ? DS.collections.typography : '3. Typography';
  var modes3 = (DS.breakpoints && DS.breakpoints.modes) ? DS.breakpoints.modes : ['Mobile', 'Tablet', 'Desktop'];
  var _typoRes = await getOrCreateCollection(typoName, modes3[0]);
  var typoColl = _typoRes.collection;
  var _typoMergeMap = await buildVarMap(typoColl.id);
  var _typoNeedsMerge = false;
  if (_typoRes.existed && DS.typography && DS.typography.scale) {
    var _typoPrefixCheck = (DS.naming && DS.naming.textStyle) ? DS.naming.textStyle.split('/')[0] : 'type';
    var _typoScaleCheck = DS.typography.scale || {};
    for (var _tckRole in _typoScaleCheck) {
      if (!_typoScaleCheck.hasOwnProperty(_tckRole)) continue;
      var _tckBase = _typoPrefixCheck + '/' + _tckRole;
      if (!_typoMergeMap[_tckBase + '/size'] ||
          !_typoMergeMap[_tckBase + '/line-height'] ||
          !_typoMergeMap[_tckBase + '/weight'] ||
          !_typoMergeMap[_tckBase + '/tracking']) {
        _typoNeedsMerge = true;
        break;
      }
    }
  }

  if (_typoRes.existed && !_typoNeedsMerge) {
    skipped.push(typoName + ' (already exists — skipped)');
  } else {
    // Merge mode: skip vars that already exist.
    var typoModeMap = buildModeMap(typoColl, modes3);

    var primVarMapForTypo = await buildVarMap(primColl.id);

    function typoAlias(name) {
      var id = primVarMapForTypo[name];
      return id ? { type: 'VARIABLE_ALIAS', id: id } : null;
    }

    function sizeTokenName(px) {
      var sizeMap = { 10:'2xs', 12:'xs', 14:'sm', 16:'md', 18:'lg', 20:'xl', 24:'2xl', 30:'3xl', 36:'4xl', 48:'5xl', 60:'6xl', 72:'7xl' };
      return sizeMap[px] ? (_typePrefixSetup + '/size/' + sizeMap[px]) : (_typePrefixSetup + '/size/' + px);
    }

    var _tp3 = _typePrefixSetup;
    var scale = (DS.typography && DS.typography.scale) ? DS.typography.scale : {};
    var weightMap = { 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold' };
    var trackingMap = { '-0.02': 'tight', '-0.01': 'snug', '0': 'normal', '0.01': 'open', '0.02': 'wide', '0.05': 'wider', '0.1': 'widest' };

    var typoPrefix = (DS.naming && DS.naming.textStyle) ? DS.naming.textStyle.split('/')[0] : 'type';

    for (var role in scale) {
      if (!scale.hasOwnProperty(role)) continue;
      var roleDef = scale[role];
      var sizes = roleDef.sizes || [];
      var lineHeights = roleDef.lineHeights || [];
      var weight = roleDef.weight || 400;
      var tracking = roleDef.tracking != null ? roleDef.tracking : 0;

      var tokenBase = typoPrefix + '/' + role;

      // size variable
      if (!_typoMergeMap[tokenBase + '/size']) {
        var sizeVar = figma.variables.createVariable(tokenBase + '/size', typoColl, 'FLOAT');
        for (var mi = 0; mi < modes3.length; mi++) {
          var modeName = modes3[mi];
          var modeId3 = typoModeMap[modeName];
          var sizePx = sizes[mi] != null ? sizes[mi] : sizes[sizes.length - 1];
          var sizeAlias = typoAlias(sizeTokenName(sizePx));
          if (sizeAlias) sizeVar.setValueForMode(modeId3, sizeAlias);
          else sizeVar.setValueForMode(modeId3, sizePx);
        }
      }

      // line-height variable (px, not ratio — raw computed value)
      if (!_typoMergeMap[tokenBase + '/line-height']) {
        var lhVar = figma.variables.createVariable(tokenBase + '/line-height', typoColl, 'FLOAT');
        for (var lhi = 0; lhi < modes3.length; lhi++) {
          var lhModeId = typoModeMap[modes3[lhi]];
          var lhPx = lineHeights[lhi] != null ? lineHeights[lhi] : lineHeights[lineHeights.length - 1];
          lhVar.setValueForMode(lhModeId, lhPx);
        }
      }

      // weight variable (alias to primitive)
      if (!_typoMergeMap[tokenBase + '/weight']) {
        var weightVar = figma.variables.createVariable(tokenBase + '/weight', typoColl, 'FLOAT');
        var weightPrimName = _tp3 + '/weight/' + (weightMap[weight] || 'regular');
        var weightAlias = typoAlias(weightPrimName);
        for (var wi = 0; wi < modes3.length; wi++) {
          var wModeId = typoModeMap[modes3[wi]];
          if (weightAlias) weightVar.setValueForMode(wModeId, weightAlias);
          else weightVar.setValueForMode(wModeId, weight);
        }
      }

      // tracking variable (alias to primitive)
      if (!_typoMergeMap[tokenBase + '/tracking']) {
        var trackingVar = figma.variables.createVariable(tokenBase + '/tracking', typoColl, 'FLOAT');
        var trackingKey = String(tracking);
        var trackingPrimName = _tp3 + '/tracking/' + (trackingMap[trackingKey] || trackingKey);
        var trackingAlias = typoAlias(trackingPrimName);
        for (var tri = 0; tri < modes3.length; tri++) {
          var trModeId = typoModeMap[modes3[tri]];
          if (trackingAlias) trackingVar.setValueForMode(trModeId, trackingAlias);
          else trackingVar.setValueForMode(trModeId, tracking);
        }
      }

      // family variable (alias to font/sans)
      var famAlias3 = typoAlias(_fontFamilyPatternSetup.replace('{variant}', 'sans'));
      if (famAlias3 && !_typoMergeMap[tokenBase + '/family']) {
        var famVar3 = figma.variables.createVariable(tokenBase + '/family', typoColl, 'STRING');
        for (var fmi = 0; fmi < modes3.length; fmi++) {
          famVar3.setValueForMode(typoModeMap[modes3[fmi]], famAlias3);
        }
      }
    }

    built.push(_typoRes.existed ? typoName + ' (missing vars merged)' : typoName);
  }

  // ── Collection 4 — Spacing ────────────────────────────────────────────────

  var spacingName = (DS.collections && DS.collections.spacing) ? DS.collections.spacing : '4. Spacing';
  var _spacingRes = await getOrCreateCollection(spacingName, modes3[0]);
  var spacingColl = _spacingRes.collection;
  var _spaceMergeMap = await buildVarMap(spacingColl.id);
  var _spacingNeedsMerge = false;
  if (_spacingRes.existed && DS.spacing) {
    var _semCheck = DS.spacing.semantic || {};
    for (var _sk in _semCheck) {
      if (!_semCheck.hasOwnProperty(_sk)) continue;
      if (!_spaceMergeMap['space/' + _sk]) { _spacingNeedsMerge = true; break; }
    }
    if (!_spacingNeedsMerge) {
      var _radCheck = DS.spacing.radius || {};
      for (var _rk in _radCheck) {
        if (!_radCheck.hasOwnProperty(_rk)) continue;
        if (!_spaceMergeMap['space/radius/' + _rk]) { _spacingNeedsMerge = true; break; }
      }
    }
    if (!_spacingNeedsMerge) {
      var _borderCheck = DS.spacing.border || {};
      for (var _bk in _borderCheck) {
        if (!_borderCheck.hasOwnProperty(_bk)) continue;
        if (!_spaceMergeMap['space/border/' + _bk]) { _spacingNeedsMerge = true; break; }
      }
    }
  }

  if (_spacingRes.existed && !_spacingNeedsMerge) {
    skipped.push(spacingName + ' (already exists — skipped)');
  } else {
    // Merge mode: skip vars that already exist.
    var spaceModeMap = buildModeMap(spacingColl, modes3);

    var primVarMapForSpacing = await buildVarMap(primColl.id);

    function spaceAlias(step) {
      var name = 'space/' + sanitize(step);
      var id = primVarMapForSpacing[name];
      return id ? { type: 'VARIABLE_ALIAS', id: id } : null;
    }

    if (DS.spacing) {
      // Semantic spacing tokens (responsive)
      var semantic = DS.spacing.semantic || {};
      for (var semKey in semantic) {
        if (!semantic.hasOwnProperty(semKey)) continue;
        var spSemName = 'space/' + semKey;
        if (_spaceMergeMap[spSemName]) continue;
        var vals = semantic[semKey];
        var semVar = figma.variables.createVariable(spSemName, spacingColl, 'FLOAT');
        for (var seMi = 0; seMi < modes3.length; seMi++) {
          var seModeId = spaceModeMap[modes3[seMi]];
          var seVal = vals[seMi] != null ? vals[seMi] : vals[vals.length - 1];
          var seAlias = spaceAlias(seVal);
          if (seAlias) semVar.setValueForMode(seModeId, seAlias);
          else semVar.setValueForMode(seModeId, seVal);
        }
      }

      // Radius tokens (mode-invariant)
      var radius = DS.spacing.radius || {};
      for (var radKey in radius) {
        if (!radius.hasOwnProperty(radKey)) continue;
        var radVarName = 'space/radius/' + radKey;
        if (_spaceMergeMap[radVarName]) continue;
        var radVar = figma.variables.createVariable(radVarName, spacingColl, 'FLOAT');
        for (var rmi = 0; rmi < modes3.length; rmi++) {
          radVar.setValueForMode(spaceModeMap[modes3[rmi]], radius[radKey]);
        }
      }

      // Border width tokens (mode-invariant)
      var border = DS.spacing.border || {};
      for (var bKey in border) {
        if (!border.hasOwnProperty(bKey)) continue;
        var bVarName = 'space/border/' + bKey;
        if (_spaceMergeMap[bVarName]) continue;
        var bVar = figma.variables.createVariable(bVarName, spacingColl, 'FLOAT');
        for (var bmi = 0; bmi < modes3.length; bmi++) {
          bVar.setValueForMode(spaceModeMap[modes3[bmi]], border[bKey]);
        }
      }
    }

    built.push(_spacingRes.existed ? spacingName + ' (missing vars merged)' : spacingName);
  }

  // ── Collection 5 — Elevation (Effect Styles) ─────────────────────────────

  var elevName = (DS.collections && DS.collections.elevation) ? DS.collections.elevation : '5. Elevation';
  var _elevRes = await getOrCreateCollection(elevName, 'Default');
  var elevColl = _elevRes.collection;

  if (_elevRes.existed) {
    skipped.push(elevName + ' (already exists — skipped)');
  } else {
    var elevModeId = elevColl.modes[0].modeId;

    // Shadow FLOAT variables (re-alias from primitives)
    var primVarMapForElev = await buildVarMap(primColl.id);

    var ELEV_LEVELS = [
      { level: 1, key: 'xs' },
      { level: 2, key: 'sm' },
      { level: 3, key: 'md' },
      { level: 4, key: 'lg' },
      { level: 5, key: 'xl' },
    ];

    for (var eli = 0; eli < ELEV_LEVELS.length; eli++) {
      var el = ELEV_LEVELS[eli];
      var l = el.level;

      var offsetYId = primVarMapForElev['shadow/' + l + '/offset-y'];
      var radiusId  = primVarMapForElev['shadow/' + l + '/radius'];

      var elevOffsetVar = figma.variables.createVariable('elevation/' + el.key + '/offset-y', elevColl, 'FLOAT');
      var elevRadiusVar = figma.variables.createVariable('elevation/' + el.key + '/radius', elevColl, 'FLOAT');
      if (offsetYId) elevOffsetVar.setValueForMode(elevModeId, { type: 'VARIABLE_ALIAS', id: offsetYId });
      if (radiusId)  elevRadiusVar.setValueForMode(elevModeId, { type: 'VARIABLE_ALIAS', id: radiusId });
    }

    built.push(elevName);

    // Create Effect Styles for elevation/0 through elevation/5
    var semVarMapForElev = await buildVarMap(semColl.id);
    var keyColorId     = semVarMapForElev['color/shadow/key'];
    var ambientColorId = semVarMapForElev['color/shadow/ambient'];

    var EFFECT_LEVELS = [
      { name: 'elevation/0',  shadows: [] },
      { name: 'elevation/1',  shadows: [{ offsetY: 1,  radius: 2,  ambient: false }] },
      { name: 'elevation/2',  shadows: [{ offsetY: 4,  radius: 8,  ambient: true,  ambRadius: 8  }] },
      { name: 'elevation/3',  shadows: [{ offsetY: 8,  radius: 16, ambient: true,  ambRadius: 12 }] },
      { name: 'elevation/4',  shadows: [{ offsetY: 12, radius: 24, ambient: true,  ambRadius: 16 }] },
      { name: 'elevation/5',  shadows: [{ offsetY: 16, radius: 32, ambient: true,  ambRadius: 20 }] },
    ];

    for (var efli = 0; efli < EFFECT_LEVELS.length; efli++) {
      var eff = EFFECT_LEVELS[efli];
      var style = figma.createEffectStyle();
      style.name = eff.name;

      if (eff.shadows.length === 0) {
        style.effects = [];
      } else {
        var effectArr = [];
        for (var shi = 0; shi < eff.shadows.length; shi++) {
          var sh = eff.shadows[shi];
          // Key shadow
          effectArr.push({
            type: 'DROP_SHADOW',
            color: { r: 0, g: 0, b: 0, a: 0.2 },
            offset: { x: 0, y: sh.offsetY },
            radius: sh.radius,
            spread: 0,
            visible: true,
            blendMode: 'NORMAL',
          });
          // Ambient shadow (levels 2-5)
          if (sh.ambient) {
            effectArr.push({
              type: 'DROP_SHADOW',
              color: { r: 0, g: 0, b: 0, a: 0.08 },
              offset: { x: 0, y: 0 },
              radius: sh.ambRadius,
              spread: 0,
              visible: true,
              blendMode: 'NORMAL',
            });
          }
        }
        style.effects = effectArr;

        // Bind color variables to shadows
        if (keyColorId && style.effects.length > 0) {
          try {
            style.setBoundVariableForEffect(0, 'color', figma.variables.getVariableById(keyColorId));
          } catch (e) {}
        }
        if (ambientColorId && eff.shadows[0] && eff.shadows[0].ambient && style.effects.length > 1) {
          try {
            style.setBoundVariableForEffect(1, 'color', figma.variables.getVariableById(ambientColorId));
          } catch (e) {}
        }
      }
    }
  }

  return {
    collections: built,
    skipped: skipped,
    message: built.length > 0
      ? 'Created: ' + built.join(', ') + (skipped.length ? '. Skipped: ' + skipped.join(', ') : '')
      : 'All collections already exist. ' + skipped.join(', '),
  };
}

// ── In-place primitive update ────────────────────────────────────────────────
// Updates existing variables and Color semantic aliases without recreating
// collections. Variable IDs stay intact, so component bindings keep resolving.
//
// To add a new category later (e.g. shadow values once they become DS-driven),
// add one entry to UPDATE_PRIMITIVE_SPECS that yields { name, type, value } rows
// from the DS config — the rest of the loop is generic.
//
// ES6-era only: no `??`, `?.`, `**`. Figma plugin sandbox does not support them.

function _updatePrimSanitize(n) {
  return String(n).replace(/\./g, '_');
}

var UPDATE_PRIMITIVE_SPECS = {
  color: function (DS) {
    var entries = [];
    if (!DS || !DS.color || !Array.isArray(DS.color.ramps)) return entries;
    for (var ri = 0; ri < DS.color.ramps.length; ri++) {
      var ramp = DS.color.ramps[ri];
      for (var si = 0; si < ramp.steps.length; si++) {
        var s = ramp.steps[si];
        entries.push({
          name: ramp.folder + '/' + s[0],
          type: 'COLOR',
          value: { r: s[1], g: s[2], b: s[3] },
        });
      }
    }
    return entries;
  },
  spacing: function (DS) {
    var entries = [];
    if (!DS || !DS.primitives || !Array.isArray(DS.primitives.spacing)) return entries;
    for (var i = 0; i < DS.primitives.spacing.length; i++) {
      var sp = DS.primitives.spacing[i];
      entries.push({
        name: 'space/' + _updatePrimSanitize(sp[0]),
        type: 'FLOAT',
        value: sp[1],
      });
    }
    return entries;
  },
  'color-semantics': function () {
    return null;
  },
};

function _colorEqual(a, b) {
  if (!a || !b) return false;
  var dr = (a.r || 0) - (b.r || 0);
  var dg = (a.g || 0) - (b.g || 0);
  var db = (a.b || 0) - (b.b || 0);
  var aa = a.a == null ? 1 : a.a;
  var ba = b.a == null ? 1 : b.a;
  var dA = aa - ba;
  return Math.abs(dr) < 1e-6 && Math.abs(dg) < 1e-6 && Math.abs(db) < 1e-6 && Math.abs(dA) < 1e-6;
}

function _aliasEqual(a, b) {
  return Boolean(a && b && a.type === 'VARIABLE_ALIAS' && b.type === 'VARIABLE_ALIAS' && a.id === b.id);
}

// Resolve a primitive target by exact name; if missing, fall back to the
// nearest existing numeric step in the same ramp (e.g. green/950 -> green/900).
// Returns null only when the ramp has no numeric siblings at all. The caller
// surfaces substitutions in the report so the agent can prompt the designer
// to fill the gap, but the live update keeps moving.
function _resolveSemanticTarget(byName, targetName) {
  if (!targetName) return null;
  if (byName[targetName]) return { variable: byName[targetName], substituted: false };

  var match = String(targetName).match(/^(.*)\/(\d+)$/);
  if (!match) return null;
  var prefix = match[1] + '/';
  var targetStep = parseInt(match[2], 10);

  var best = null;
  var names = Object.keys(byName);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (name.indexOf(prefix) !== 0) continue;
    var rest = name.slice(prefix.length);
    if (!/^\d+$/.test(rest)) continue;
    var step = parseInt(rest, 10);
    var distance = Math.abs(step - targetStep);
    if (best === null || distance < best.distance || (distance === best.distance && step < best.step)) {
      best = { name: name, step: step, distance: distance };
    }
  }
  if (!best) return null;
  return {
    variable: byName[best.name],
    substituted: true,
    originalName: targetName,
    fallbackName: best.name,
  };
}

function _modeIdByName(collection, name, fallbackIndex) {
  if (!collection || !collection.modes || collection.modes.length === 0) return null;
  var wanted = String(name || '').toLowerCase();
  for (var i = 0; i < collection.modes.length; i++) {
    if (String(collection.modes[i].name || '').toLowerCase() === wanted) return collection.modes[i].modeId;
  }
  var idx = typeof fallbackIndex === 'number' ? fallbackIndex : 0;
  return collection.modes[idx] ? collection.modes[idx].modeId : collection.modes[0].modeId;
}

function _semanticColorEntries(DS) {
  var entries = [];
  var sem = DS && DS.color ? DS.color.semantics : null;
  if (!sem) return entries;
  var tokenMap = {};
  var pairs = sem.pairs || [];
  for (var pi = 0; pi < pairs.length; pi++) {
    var pair = pairs[pi];
    if (!tokenMap[pair.bg]) {
      tokenMap[pair.bg] = {
        Light: pair.Light ? pair.Light.bg : null,
        Dark: pair.Dark ? pair.Dark.bg : null,
      };
    }
    if (!tokenMap[pair.text]) {
      tokenMap[pair.text] = {
        Light: pair.Light ? pair.Light.text : null,
        Dark: pair.Dark ? pair.Dark.text : null,
      };
    }
  }
  var icons = sem.icons || [];
  for (var ii = 0; ii < icons.length; ii++) {
    tokenMap[icons[ii].token] = {
      Light: icons[ii].Light || null,
      Dark: icons[ii].Dark || null,
    };
  }
  var unpaired = sem.unpaired || [];
  for (var ui = 0; ui < unpaired.length; ui++) {
    tokenMap[unpaired[ui].token] = {
      Light: unpaired[ui].Light || null,
      Dark: unpaired[ui].Dark || null,
    };
  }
  var names = Object.keys(tokenMap);
  for (var ni = 0; ni < names.length; ni++) {
    entries.push({ name: names[ni], type: 'COLOR', Light: tokenMap[names[ni]].Light, Dark: tokenMap[names[ni]].Dark });
  }
  return entries;
}

async function _updateDsPrimitives(payload) {
  var DS = (payload && payload.DS) || {};
  var createMissing = !!(payload && payload.createMissing);
  var pruneOffScale    = !!(payload && payload.pruneOffScale);
  var pruneUnusedRamps = !!(payload && payload.pruneUnusedRamps);
  var requested = (payload && Array.isArray(payload.categories) && payload.categories.length > 0)
    ? payload.categories
    : Object.keys(UPDATE_PRIMITIVE_SPECS);

  var primName = (DS.collections && DS.collections.primitives) ? DS.collections.primitives : '1. Primitives';

  var allColls = await figma.variables.getLocalVariableCollectionsAsync();
  var primColl = null;
  for (var ci = 0; ci < allColls.length; ci++) {
    if (allColls[ci].name === primName) { primColl = allColls[ci]; break; }
  }
  if (!primColl) {
    return {
      error: 'Primitives collection "' + primName + '" not found in this Figma file. Run apply_ds_setup first to create it.',
    };
  }

  var primModeId = primColl.modes[0].modeId;
  var allVars = await figma.variables.getLocalVariablesAsync();
  var byName = {};
  var allByName = {};
  for (var vi = 0; vi < allVars.length; vi++) {
    var v = allVars[vi];
    allByName[v.name] = v;
    if (v.variableCollectionId === primColl.id) byName[v.name] = v;
  }
  var colorName = (DS.collections && DS.collections.color) ? DS.collections.color : '2. Color';
  var colorColl = null;
  for (var cc = 0; cc < allColls.length; cc++) {
    if (allColls[cc].name === colorName) { colorColl = allColls[cc]; break; }
  }
  var colorByName = {};
  for (var cv = 0; cv < allVars.length; cv++) {
    if (colorColl && allVars[cv].variableCollectionId === colorColl.id) colorByName[allVars[cv].name] = allVars[cv];
  }

  var report = {};
  var unknown = [];

  for (var ri2 = 0; ri2 < requested.length; ri2++) {
    var cat = requested[ri2];
    var spec = UPDATE_PRIMITIVE_SPECS[cat];
    if (!spec) { unknown.push(cat); continue; }

    if (cat === 'color-semantics') {
      var semEntries = _semanticColorEntries(DS);
      var semUpdated = 0;
      var semUnchanged = 0;
      var semCreated = 0;
      var semUnmatched = [];
      var semSubstituted = [];
      var semTypeMismatch = [];

      if (!colorColl) {
        report[cat] = {
          entries: semEntries.length,
          created: 0,
          updated: 0,
          unchanged: 0,
          unmatched: [colorName],
          substituted: [],
          typeMismatch: [],
        };
        continue;
      }

      var lightModeId = _modeIdByName(colorColl, 'Light', 0);
      var darkModeId = _modeIdByName(colorColl, 'Dark', 1);

      for (var sei = 0; sei < semEntries.length; sei++) {
        var semEntry = semEntries[sei];
        var semVar = colorByName[semEntry.name];
        if (!semVar) {
          if (createMissing) {
            try {
              semVar = figma.variables.createVariable(semEntry.name, colorColl, 'COLOR');
              colorByName[semEntry.name] = semVar;
              allByName[semEntry.name] = semVar;
              semCreated += 1;
            } catch (semCreateErr) {
              semUnmatched.push(semEntry.name);
              continue;
            }
          } else {
            semUnmatched.push(semEntry.name);
            continue;
          }
        }
        if (semVar.resolvedType !== 'COLOR') {
          semTypeMismatch.push({ name: semEntry.name, expected: 'COLOR', actual: semVar.resolvedType });
          continue;
        }

        var changed = false;
        var missingAlias = false;
        if (semEntry.Light && lightModeId) {
          var lightLookup = _resolveSemanticTarget(byName, semEntry.Light);
          if (!lightLookup) {
            missingAlias = true;
            semUnmatched.push(semEntry.name + ' Light -> ' + semEntry.Light);
          } else {
            if (lightLookup.substituted) {
              semSubstituted.push({
                token: semEntry.name,
                mode: 'Light',
                requested: lightLookup.originalName,
                used: lightLookup.fallbackName,
              });
            }
            var lightAlias = { type: 'VARIABLE_ALIAS', id: lightLookup.variable.id };
            if (!_aliasEqual(semVar.valuesByMode[lightModeId], lightAlias)) {
              semVar.setValueForMode(lightModeId, lightAlias);
              changed = true;
            }
          }
        }
        if (semEntry.Dark && darkModeId) {
          var darkLookup = _resolveSemanticTarget(byName, semEntry.Dark);
          if (!darkLookup) {
            missingAlias = true;
            semUnmatched.push(semEntry.name + ' Dark -> ' + semEntry.Dark);
          } else {
            if (darkLookup.substituted) {
              semSubstituted.push({
                token: semEntry.name,
                mode: 'Dark',
                requested: darkLookup.originalName,
                used: darkLookup.fallbackName,
              });
            }
            var darkAlias = { type: 'VARIABLE_ALIAS', id: darkLookup.variable.id };
            if (!_aliasEqual(semVar.valuesByMode[darkModeId], darkAlias)) {
              semVar.setValueForMode(darkModeId, darkAlias);
              changed = true;
            }
          }
        }
        if (changed) semUpdated += 1;
        else if (!missingAlias) semUnchanged += 1;
      }

      report[cat] = {
        entries: semEntries.length,
        created: semCreated,
        updated: semUpdated,
        unchanged: semUnchanged,
        unmatched: semUnmatched,
        substituted: semSubstituted,
        typeMismatch: semTypeMismatch,
      };
      continue;
    }

    var entries = spec(DS);
    var updated = 0;
    var unchanged = 0;
    var created = 0;
    var unmatched = [];
    var typeMismatch = [];

    for (var ei = 0; ei < entries.length; ei++) {
      var entry = entries[ei];
      var existing = byName[entry.name];
      if (!existing) {
        if (createMissing) {
          try {
            existing = figma.variables.createVariable(entry.name, primColl, entry.type);
            byName[entry.name] = existing;
            existing.setValueForMode(primModeId, entry.value);
            created += 1;
          } catch (err) {
            unmatched.push(entry.name);
          }
        } else {
          unmatched.push(entry.name);
        }
        continue;
      }
      if (existing.resolvedType !== entry.type) {
        typeMismatch.push({ name: entry.name, expected: entry.type, actual: existing.resolvedType });
        continue;
      }
      var current = existing.valuesByMode[primModeId];
      var same = entry.type === 'COLOR'
        ? _colorEqual(current, entry.value)
        : current === entry.value;
      if (same) { unchanged += 1; continue; }
      existing.setValueForMode(primModeId, entry.value);
      updated += 1;
    }

    report[cat] = {
      entries: entries.length,
      created: created,
      updated: updated,
      unchanged: unchanged,
      unmatched: unmatched,
      typeMismatch: typeMismatch,
    };
  }

  var pruneCount = 0;
  if (pruneOffScale && DS.color && Array.isArray(DS.color.ramps) && DS.color.ramps.length > 0) {
    var validStepsByFolder = {};
    for (var pri = 0; pri < DS.color.ramps.length; pri++) {
      var rampDef = DS.color.ramps[pri];
      var validSet = {};
      for (var psi = 0; psi < rampDef.steps.length; psi++) {
        validSet[String(rampDef.steps[psi][0])] = true;
      }
      validStepsByFolder[rampDef.folder + '/'] = validSet;
    }
    var byNameKeys = Object.keys(byName);
    for (var bki = 0; bki < byNameKeys.length; bki++) {
      var bkName = byNameKeys[bki];
      var matchedFolder = null;
      var folderKeys = Object.keys(validStepsByFolder);
      for (var fki = 0; fki < folderKeys.length; fki++) {
        if (bkName.indexOf(folderKeys[fki]) === 0) { matchedFolder = folderKeys[fki]; break; }
      }
      if (!matchedFolder) continue;
      var leafStep = bkName.slice(matchedFolder.length);
      if (!/^\d+$/.test(leafStep)) continue;
      if (!validStepsByFolder[matchedFolder][leafStep]) {
        try { byName[bkName].remove(); pruneCount++; } catch (e) {}
      }
    }
  }

  var msgParts = [];
  for (var k in report) {
    if (Object.prototype.hasOwnProperty.call(report, k)) {
      var subCount = report[k].substituted ? report[k].substituted.length : 0;
      msgParts.push(k + ': ' + report[k].updated + ' updated, ' + report[k].unchanged + ' unchanged' +
        (report[k].created ? ', ' + report[k].created + ' created' : '') +
        (subCount ? ', ' + subCount + ' substituted' : '') +
        (report[k].unmatched.length ? ', ' + report[k].unmatched.length + ' missing' : ''));
    }
  }
  if (pruneCount) msgParts.push('pruned ' + pruneCount + ' off-scale steps');

  var pruneRampCount = 0;
  if (pruneUnusedRamps && DS.color && Array.isArray(DS.color.ramps) && DS.color.ramps.length > 0) {
    var configuredFolders = {};
    for (var cri = 0; cri < DS.color.ramps.length; cri++) {
      configuredFolders[DS.color.ramps[cri].folder] = true;
    }
    var allPrimKeys = Object.keys(byName);
    for (var uki = 0; uki < allPrimKeys.length; uki++) {
      var ukName = allPrimKeys[uki];
      // Match exactly color/<name>/<digits> — three segments, numeric leaf.
      var ukParts = ukName.split('/');
      if (ukParts.length !== 3) continue;
      if (ukParts[0] !== 'color') continue;
      if (!/^\d+$/.test(ukParts[2])) continue;
      var rampFolder = 'color/' + ukParts[1];
      if (configuredFolders[rampFolder]) continue;
      try { byName[ukName].remove(); pruneRampCount++; } catch (e) {}
    }
    if (pruneRampCount && report['color']) {
      report['color'].prunedRamps = pruneRampCount;
    }
  }
  if (pruneRampCount) msgParts.push('pruned ' + pruneRampCount + ' variables from unused ramps');

  return {
    collection: primName,
    categories: requested,
    unknownCategories: unknown,
    report: report,
    pruned: pruneCount + pruneRampCount,
    message: msgParts.length ? msgParts.join('; ') : 'No categories processed.',
  };
}

// ── Component documentation implementation ───────────────────────────────────
// Ported from figlets skills/fig-document — runs entirely inside the plugin.
// Renders a spec sheet inside Figma + writes [SPEC] block to the component
// description + returns the markdown body for component-specs/[Name].md.
//
// ES6-era only: no `??`, `?.`, `**`. Figma plugin sandbox does not support them.

async function _buildComponentDoc(opts) {
  const compId = opts && opts.componentId ? String(opts.componentId) : '';
  const compName = opts && opts.componentName ? String(opts.componentName) : '';
  const agentDescription = (opts && typeof opts.description === 'string') ? opts.description.trim() : '';
  const usageDo = (opts && opts.usageDo && opts.usageDo.length > 0)
    ? opts.usageDo
    : [];
  const usageDont = (opts && opts.usageDont && opts.usageDont.length > 0)
    ? opts.usageDont
    : [];
  const variantDesc = (opts && opts.variantDescriptions) ? opts.variantDescriptions : {};

  if (!compId && !compName) return { error: 'componentName or componentId is required' };
  if (!agentDescription) return { error: 'description is required. Agent must provide a component-specific summary.' };
  if (usageDo.length < 2) return { error: 'usageDo must contain at least 2 component-specific rules.' };
  if (usageDont.length < 2) return { error: 'usageDont must contain at least 2 component-specific misuse rules.' };

  // ── Find component on current page ─────────────────────────────────────────
  let _comp = null;
  if (compId) {
    _comp = figma.currentPage.findOne(function (n) {
      return (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && n.id === compId;
    });
  }
  if (!_comp && compName) {
    _comp = figma.currentPage.findOne(function (n) {
      return (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && n.name === compName;
    });
  }
  if (!_comp && compName) {
    _comp = figma.currentPage.findOne(function (n) {
      return (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && n.name.indexOf(compName) === 0;
    });
  }
  if (!_comp) return { error: 'Component not found on current page: ' + (compName || compId) };

  const compSet = _comp;
  const _isSet = compSet.type === 'COMPONENT_SET';
  const _children = _isSet ? compSet.children : [compSet];
  let _defaultV = compSet;
  if (_isSet) {
    _defaultV = null;
    for (let i = 0; i < _children.length; i++) {
      if (_children[i].name.indexOf('Default') >= 0 || _children[i].name.indexOf('Full') >= 0) { _defaultV = _children[i]; break; }
    }
    if (!_defaultV) _defaultV = _children[0];
  }

  const compMeta = {
    type: compSet.type,
    width: _defaultV.width,
    height: _defaultV.height,
    variantCount: _children.length,
    variants: _children.map(function (c) { return c.name; }),
    componentPropertyDefinitions: compSet.componentPropertyDefinitions || {},
    description: compSet.description || ''
  };

  // ── Variables and text styles ──────────────────────────────────────────────
  const _ds = await _createDsBindingContext();
  const _allVars = _ds.allVars;
  const _allTextStyles = _ds.textStyles;
  const varById = {};
  for (let i = 0; i < _allVars.length; i++) varById[_allVars[i].id] = _allVars[i];
  const textStyleById = {};
  for (let i = 0; i < _allTextStyles.length; i++) textStyleById[_allTextStyles[i].id] = _allTextStyles[i];

  function _resolveAlias(varId) {
    let depth = 0;
    let cur = varById[varId];
    while (cur && depth < 8) {
      const modes = Object.keys(cur.valuesByMode);
      if (modes.length === 0) return null;
      const raw = cur.valuesByMode[modes[0]];
      if (raw && raw.type === 'VARIABLE_ALIAS') {
        cur = varById[raw.id];
        depth++;
        continue;
      }
      if (raw && typeof raw === 'object' && raw.r !== undefined) return { type: 'COLOR', val: raw };
      if (typeof raw === 'number') return { type: 'FLOAT', val: raw };
      return null;
    }
    return null;
  }

  function _toHex(r, g, b) {
    function _h(c) {
      const i = Math.round(Math.max(0, Math.min(1, c)) * 255);
      const s = i.toString(16);
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + _h(r) + _h(g) + _h(b);
  }

  function _paint(fallbackRGB, varOrNull) {
    return _ds.paint(fallbackRGB, varOrNull);
  }

  function _bindVar(node, prop, variable) {
    if (!variable) return;
    _ds.bindVar(node, prop, variable);
  }

  // ── Anatomy bounds ─────────────────────────────────────────────────────────
  const _compBounds = _defaultV.absoluteBoundingBox;
  const elements = [];
  function _collectEl(node, depth) {
    if (!node.absoluteBoundingBox) return;
    if (depth > 0 && node.type !== 'INSTANCE') {
      const nb = node.absoluteBoundingBox;
      elements.push({
        name: node.name, type: node.type, depth: depth,
        x: Math.round(nb.x - _compBounds.x), y: Math.round(nb.y - _compBounds.y),
        w: Math.round(nb.width), h: Math.round(nb.height)
      });
    }
    if ('children' in node && node.type !== 'INSTANCE') {
      for (let i = 0; i < node.children.length; i++) _collectEl(node.children[i], depth + 1);
    }
  }
  _collectEl(_defaultV, 0);

  // ── Token bindings on default variant ──────────────────────────────────────
  function _collectBind(node, acc) {
    if (node.type === 'INSTANCE') return acc;
    const bv = node.boundVariables || {};
    const _props = [
      ['fills', 'Fill'], ['strokes', 'Stroke'],
      ['paddingTop', 'paddingTop'], ['paddingBottom', 'paddingBottom'],
      ['paddingLeft', 'paddingLeft'], ['paddingRight', 'paddingRight'],
      ['itemSpacing', 'itemSpacing'], ['counterAxisSpacing', 'counterAxisSpacing'],
      ['fontSize', 'fontSize'],
      ['topLeftRadius', 'cornerRadius'],
      ['strokeTopWeight', 'strokeWeight']
    ];
    for (let i = 0; i < _props.length; i++) {
      const key = _props[i][0], label = _props[i][1];
      if (bv[key]) {
        const e = Array.isArray(bv[key]) ? bv[key][0] : bv[key];
        if (e && e.id) acc.push({ node: node.name, property: label, varId: e.id });
      }
    }
    if (node.type === 'TEXT' && node.textStyleId) {
      acc.push({ node: node.name, property: 'textStyle', styleId: node.textStyleId });
    }
    if ('children' in node) {
      for (let i = 0; i < node.children.length; i++) _collectBind(node.children[i], acc);
    }
    return acc;
  }
  const _rawBinds = _collectBind(_defaultV, []);

  // Pre-fetch any varIds we don't have locally (library/remote variables).
  // figma.variables.getVariableByIdAsync resolves both local and library vars.
  const _missingIds = {};
  for (let i = 0; i < _rawBinds.length; i++) {
    const id = _rawBinds[i].varId;
    if (id && !varById[id]) _missingIds[id] = true;
  }
  const _missingIdList = Object.keys(_missingIds);
  for (let i = 0; i < _missingIdList.length; i++) {
    try {
      const remote = await figma.variables.getVariableByIdAsync(_missingIdList[i]);
      if (remote) varById[_missingIdList[i]] = remote;
    } catch (e) {}
  }

  const resolved = [];
  for (let i = 0; i < _rawBinds.length; i++) {
    const b = _rawBinds[i];
    if (b.varId) {
      const v = varById[b.varId];
      const tokenName = v ? v.name : b.varId;
      let resolvedVal = '—';
      const res = _resolveAlias(b.varId);
      if (res && res.type === 'COLOR') resolvedVal = _toHex(res.val.r, res.val.g, res.val.b);
      else if (res && res.type === 'FLOAT') resolvedVal = res.val + 'px';
      resolved.push({ node: b.node, property: b.property, token: tokenName, resolvedVal: resolvedVal });
    } else if (b.styleId) {
      const style = textStyleById[b.styleId];
      let lh = '';
      if (style) {
        if (typeof style.lineHeight === 'object') {
          lh = (style.lineHeight && style.lineHeight.value !== undefined) ? style.lineHeight.value : '?';
        } else {
          lh = style.lineHeight;
        }
      }
      resolved.push({
        node: b.node, property: 'Text style',
        token: style ? style.name : b.styleId,
        resolvedVal: style ? (style.fontSize + 'px / ' + lh) : '—'
      });
    }
  }

  // ── Fonts ──────────────────────────────────────────────────────────────────
  let _fam = 'Inter', _fReg = 'Regular', _fSemi = 'Semi Bold', _fBold = 'Bold';
  if (_allTextStyles.length > 0) {
    _fam = _allTextStyles[0].fontName.family;
    const _sf = [];
    for (let i = 0; i < _allTextStyles.length; i++) {
      if (_allTextStyles[i].fontName.family === _fam) _sf.push(_allTextStyles[i].fontName.style);
    }
    function _findStyle(re) {
      for (let i = 0; i < _sf.length; i++) if (re.test(_sf[i])) return _sf[i];
      return null;
    }
    _fSemi = _findStyle(/semi.?bold/i) || 'Semi Bold';
    _fBold = _findStyle(/^bold$/i) || 'Bold';
    _fReg  = _findStyle(/^regular$/i) || 'Regular';
  }
  async function _loadFontSafe(family, candidates) {
    for (let i = 0; i < candidates.length; i++) {
      try { await figma.loadFontAsync({ family: family, style: candidates[i] }); return candidates[i]; } catch (e) {}
    }
    return null;
  }
  try { await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); } catch (e) {}
  const _regOk  = await _loadFontSafe(_fam, [_fReg, 'Regular']);
  const _semOk  = await _loadFontSafe(_fam, [_fSemi, 'Semi Bold', 'SemiBold', 'Demi Bold', 'DemiBold', 'Bold']);
  const _boldOk = await _loadFontSafe(_fam, [_fBold, 'Bold']);
  if (_regOk)  _fReg = _regOk;
  if (_semOk)  _fSemi = _semOk;
  if (_boldOk) _fBold = _boldOk;
  if (!_regOk && !_semOk && !_boldOk) {
    return { error: 'Could not load any font for "' + _fam + '". Spec sheet aborted.' };
  }

  // ── DS-adaptive palette ────────────────────────────────────────────────────
  const _vPaper   = _ds.colorRoles.surfaceDefault || _ds.colorRoles.bg;
  const _vSurface = _ds.colorRoles.surfaceVariant || _ds.colorRoles.surfaceDefault || _ds.colorRoles.bg;
  const _vInk     = _ds.colorRoles.onSurface || _ds.colorRoles.text;
  const _vSubtle  = _ds.colorRoles.onSurfaceVar || _ds.colorRoles.onSurface || _ds.colorRoles.text;
  const _vBadge   = _ds.colorRoles.dangerBg || _ds.colorRoles.dangerBorder;
  const _vBorder  = _ds.colorRoles.outlineSubtle;
  const _vDo      = _ds.colorRoles.successBorder || _ds.colorRoles.successBg || _ds.colorRoles.onSurface;
  const _vDont    = _ds.colorRoles.dangerBorder || _ds.colorRoles.dangerBg || _ds.colorRoles.onSurface;
  const _cPaper   = _ds.resolvedOrFallback(_vPaper, { r: 0.961, g: 0.941, b: 0.922 });
  const _cSurface = _ds.resolvedOrFallback(_vSurface, { r: 0.937, g: 0.918, b: 0.898 });
  const _cInk     = _ds.resolvedOrFallback(_vInk, { r: 0.071, g: 0.071, b: 0.078 });
  const _cSubtle  = _ds.resolvedOrFallback(_vSubtle, { r: 0.439, g: 0.439, b: 0.569 });
  const _cBadge   = _ds.resolvedOrFallback(_vBadge, { r: 0.863, g: 0.133, b: 0.000 });
  const _cBorder  = _ds.resolvedOrFallback(_vBorder, { r: 0.851, g: 0.831, b: 0.804 });
  const _cDo      = _ds.resolvedOrFallback(_vDo, { r: 0.133, g: 0.545, b: 0.133 });
  const _cDont    = _ds.resolvedOrFallback(_vDont, { r: 0.863, g: 0.133, b: 0.000 });

  const _docSpace = {
    padS: _ds.pickFloatByValue(8, 'spacing'),
    padM: _ds.pickFloatByValue(12, 'spacing'),
    padL: _ds.pickFloatByValue(16, 'spacing'),
    padXL: _ds.pickFloatByValue(24, 'spacing'),
    pad2XL: _ds.pickFloatByValue(40, 'spacing'),
    gapDoc: _ds.pickFloatByValue(56, 'spacing'),
    radius: _ds.pickFloatByValue(8, 'radius'),
    border: _ds.pickFloatByValue(1, 'border'),
    borderStrong: _ds.pickFloatByValue(2, 'border')
  };

  const _docTextRoles = {
    title: ['type/display/lg', 'display/lg', 'display large', 'type/headline/lg', 'headline/lg', 'title/lg', 'title large'],
    subtitle: ['type/body/lg', 'body/lg', 'body large', 'type/body/md', 'body/md', 'body medium', 'paragraph'],
    sectionLabel: ['type/label/sm', 'label/sm', 'label small', 'caption', 'overline'],
    bodyStrong: ['type/label/md', 'label/md', 'label medium', 'type/body/md', 'body/md', 'body medium'],
    body: ['type/body/md', 'body/md', 'body medium', 'paragraph', 'type/body/sm', 'body/sm', 'body small'],
    mono: ['code', 'mono', 'type/body/sm', 'body/sm', 'body small']
  };
  const _docTypeBindings = {};
  Object.keys(_docTextRoles).forEach(function (role) {
    _docTypeBindings[role] = _ds.pickTypographyBinding(role, _docTextRoles[role]);
  });
  const _docBindingWarnings = [];
  const _docBindingWarningSet = {};

  function _warnBinding(message) {
    if (!message || _docBindingWarningSet[message]) return;
    _docBindingWarningSet[message] = true;
    _docBindingWarnings.push(message);
  }
  Object.keys(_docSpace).forEach(function (key) {
    if (!_docSpace[key]) _warnBinding('No numeric variable found for doc ' + key + '; using raw layout value.');
  });
  [
    ['paper surface', _vPaper],
    ['surface', _vSurface],
    ['primary text', _vInk],
    ['secondary text', _vSubtle],
    ['border', _vBorder]
  ].forEach(function (item) {
    if (!item[1]) _warnBinding('No color variable found for doc ' + item[0] + '; using raw color value.');
  });

  function _hasMeaningfulAnatomy(root) {
    if (!('children' in root) || !root.children || root.children.length === 0) return false;
    for (let i = 0; i < root.children.length; i++) {
      const c = root.children[i];
      if (c.type !== 'INSTANCE') return true;
    }
    return false;
  }

  function _applyTextRole(t, role, fallbackSize, fallbackStyle, fallbackColor, colorVar) {
    const binding = _docTypeBindings[role] || { kind: 'raw', warning: 'No typography style or typography variables found for ' + role + '; using raw text values.' };
    if (binding.kind === 'style' && binding.style) {
      try { t.textStyleId = binding.style.id; } catch (e) {}
    } else {
      const vars = binding.kind === 'variables' && binding.variables ? binding.variables : null;
      t.fontName = { family: _fam, style: fallbackStyle };
      t.fontSize = fallbackSize;
      if (vars) {
        if (vars.familyValue && typeof vars.familyValue === 'string') {
          try { t.fontName = { family: vars.familyValue, style: fallbackStyle }; } catch (e) {}
        }
        if (typeof vars.sizeValue === 'number') t.fontSize = vars.sizeValue;
        if (typeof vars.lineHeightValue === 'number') t.lineHeight = { value: vars.lineHeightValue, unit: 'PIXELS' };
        if (typeof vars.trackingValue === 'number') t.letterSpacing = { value: vars.trackingValue, unit: 'PIXELS' };
        if (vars.sizeVar) _bindVar(t, 'fontSize', vars.sizeVar);
        if (vars.lineHeightVar) _bindVar(t, 'lineHeight', vars.lineHeightVar);
        if (vars.trackingVar) _bindVar(t, 'letterSpacing', vars.trackingVar);
        if (vars.weightVar) _bindVar(t, 'fontWeight', vars.weightVar);
        if (vars.familyVar) _bindVar(t, 'fontFamily', vars.familyVar);
      } else {
        _warnBinding(binding.warning);
      }
    }
    t.fills = [_paint(fallbackColor, colorVar)];
  }

  // ── Doc frame inside Documentation section ────────────────────────────────
  let _docSec = figma.currentPage.findOne(function (n) {
    return n.type === 'SECTION' && n.name === 'Documentation';
  });
  if (!_docSec) {
    _docSec = figma.createSection();
    _docSec.name = 'Documentation';
    figma.currentPage.appendChild(_docSec);
  }

  // If we're rebuilding the same component, remember its position so the new
  // sheet lands in place — instances and viewport stay stable for the user.
  const _old = figma.currentPage.findOne(function (n) { return n.name === compName + ' · Spec'; });
  let _rebuildX, _rebuildY;
  if (_old) {
    _rebuildX = _old.x;
    _rebuildY = _old.y;
    _old.remove();
  }

  const doc = figma.createFrame();
  doc.name = compName + ' · Spec';
  doc.layoutMode = 'VERTICAL';
  doc.resize(1400, 100);
  doc.primaryAxisSizingMode = 'AUTO'; doc.counterAxisSizingMode = 'FIXED';
  doc.paddingTop = 64; doc.paddingBottom = 64; doc.paddingLeft = 60; doc.paddingRight = 60;
  doc.itemSpacing = 56;
  doc.fills = [_paint(_cPaper, _vPaper)];
  _bindVar(doc, 'itemSpacing', _docSpace.gapDoc);
  _bindVar(doc, 'paddingTop', _docSpace.pad2XL);
  _bindVar(doc, 'paddingBottom', _docSpace.pad2XL);
  _docSec.appendChild(doc);

  // Position: rebuild → reuse old coords; new component → land to the right of
  // the rightmost existing · Spec sheet (if any) with a 100px gap.
  if (_rebuildX !== undefined) {
    doc.x = _rebuildX;
    doc.y = _rebuildY;
  } else {
    const _SHEET_GAP = 100;
    const _siblings = _docSec.children;
    let _rightmost = 0;
    let _topY = 0;
    let _hasAny = false;
    for (let i = 0; i < _siblings.length; i++) {
      const s = _siblings[i];
      if (s === doc) continue;
      if (s.type !== 'FRAME') continue;
      if (! / · Spec$/.test(s.name)) continue;
      const right = s.x + s.width;
      if (!_hasAny || right > _rightmost) {
        _rightmost = right;
        _topY = s.y;
        _hasAny = true;
      }
    }
    if (_hasAny) {
      doc.x = _rightmost + _SHEET_GAP;
      doc.y = _topY;
    }
  }

  function _mkLabel(parent, text) {
    const t = figma.createText();
    t.characters = text;
    t.letterSpacing = { value: 2, unit: 'PIXELS' };
    _applyTextRole(t, 'sectionLabel', 11, _fSemi, _cSubtle, _vSubtle);
    parent.appendChild(t); t.textAutoResize = 'WIDTH_AND_HEIGHT';
    return t;
  }
  function _mkRow(parent, w, isHdr) {
    const row = figma.createFrame();
    row.name = isHdr ? 'Header Row' : 'Row'; row.layoutMode = 'HORIZONTAL';
    row.counterAxisAlignItems = 'MIN'; row.itemSpacing = 0;
    row.paddingTop = 12; row.paddingBottom = 12; row.paddingLeft = 0; row.paddingRight = 0;
    row.primaryAxisSizingMode = 'FIXED'; row.resize(w, 1); row.counterAxisSizingMode = 'AUTO';
    row.fills = isHdr ? [_paint(_cSurface, _vSurface)] : [];
    _bindVar(row, 'paddingTop', _docSpace.padM);
    _bindVar(row, 'paddingBottom', _docSpace.padM);
    parent.appendChild(row); return row;
  }
  function _mkCell(row, text, width, style) {
    const isH = style === 'header-text', isMono = style === 'mono';
    const cell = figma.createFrame();
    cell.name = 'Cell'; cell.layoutMode = 'VERTICAL';
    cell.paddingTop = 0; cell.paddingBottom = 0; cell.paddingLeft = 16; cell.paddingRight = 16;
    _bindVar(cell, 'paddingLeft', _docSpace.padL);
    _bindVar(cell, 'paddingRight', _docSpace.padL);
    cell.fills = []; row.appendChild(cell); cell.resize(width, 1);
    cell.primaryAxisSizingMode = 'AUTO'; cell.counterAxisSizingMode = 'FIXED';
    const t = figma.createText();
    t.characters = String(text);
    _applyTextRole(t, isH ? 'sectionLabel' : isMono ? 'mono' : 'body', 12, isH ? _fSemi : _fReg, isH ? _cInk : isMono ? _cSubtle : _cInk, isH ? _vInk : isMono ? _vSubtle : _vInk);
    cell.appendChild(t); t.textAutoResize = 'HEIGHT';
    return cell;
  }
  function _mkTable(parent, name) {
    const t = figma.createFrame();
    t.name = name; t.layoutMode = 'VERTICAL';
    t.itemSpacing = 0; t.fills = []; t.cornerRadius = 6; t.clipsContent = true;
    _bindVar(t, 'cornerRadius', _docSpace.radius);
    parent.appendChild(t); t.layoutSizingHorizontal = 'FILL'; t.resize(1280, 1);
    t.primaryAxisSizingMode = 'AUTO'; t.counterAxisSizingMode = 'FIXED';
    return t;
  }

  // Section A — Header
  const _secA = figma.createFrame();
  _secA.name = 'Section A · Header'; _secA.layoutMode = 'VERTICAL';
  _secA.primaryAxisSizingMode = 'AUTO'; _secA.counterAxisSizingMode = 'FIXED';
  _secA.itemSpacing = 8; _secA.fills = [];
  _bindVar(_secA, 'itemSpacing', _docSpace.padS);
  doc.appendChild(_secA); _secA.layoutSizingHorizontal = 'FILL';

  const _tTitle = figma.createText();
  _tTitle.characters = compName;
  _applyTextRole(_tTitle, 'title', 40, _fBold, _cInk, _vInk);
  _secA.appendChild(_tTitle); _tTitle.textAutoResize = 'WIDTH_AND_HEIGHT';

  // Prefer agent-supplied description, then existing component description (with [SPEC]
  // block stripped), then a placeholder prompting the agent to provide one.
  let _subtitleText = '';
  if (agentDescription) {
    _subtitleText = agentDescription;
  } else if (compMeta.description) {
    _subtitleText = compMeta.description.replace(/\[SPEC\][\s\S]*?\[\/SPEC\]\n*/g, '').trim();
  }
  if (!_subtitleText) {
    _subtitleText = '_[Add a 1-2 sentence description: what this component is and when to use it]_';
  }
  const _tSub = figma.createText();
  _tSub.characters = _subtitleText;
  _applyTextRole(_tSub, 'subtitle', 16, _fReg, _cSubtle, _vSubtle);
  _secA.appendChild(_tSub);
  // Wrap inside the section's width: FILL horizontal + HEIGHT auto-resize.
  _tSub.layoutSizingHorizontal = 'FILL';
  _tSub.textAutoResize = 'HEIGHT';

  _mkLabel(doc, 'VARIANTS');
  const _secC = figma.createFrame();
  _secC.name = 'Section B · Variants'; _secC.layoutMode = 'HORIZONTAL';
  _secC.layoutWrap = 'WRAP';
  _secC.counterAxisAlignItems = 'MIN'; _secC.itemSpacing = 24; _secC.counterAxisSpacing = 24;
  _secC.paddingTop = 24; _secC.paddingBottom = 24; _secC.paddingLeft = 24; _secC.paddingRight = 24;
  _secC.fills = [_paint(_cSurface, _vSurface)]; _secC.cornerRadius = 8;
  _secC.strokes = [_paint(_cBorder, _vBorder)]; _secC.strokeWeight = 1;
  _bindVar(_secC, 'paddingTop', _docSpace.padXL);
  _bindVar(_secC, 'paddingBottom', _docSpace.padXL);
  _bindVar(_secC, 'paddingLeft', _docSpace.padXL);
  _bindVar(_secC, 'paddingRight', _docSpace.padXL);
  _bindVar(_secC, 'itemSpacing', _docSpace.padXL);
  _bindVar(_secC, 'counterAxisSpacing', _docSpace.padXL);
  _bindVar(_secC, 'cornerRadius', _docSpace.radius);
  _bindVar(_secC, 'strokeWeight', _docSpace.border);
  doc.appendChild(_secC); _secC.layoutSizingHorizontal = 'FILL'; _secC.counterAxisSizingMode = 'AUTO';
  for (let i = 0; i < _children.length; i++) {
    const _v = _children[i];
    const _vf = figma.createFrame();
    _vf.layoutMode = 'VERTICAL'; _vf.primaryAxisSizingMode = 'AUTO'; _vf.counterAxisSizingMode = 'AUTO';
    _vf.primaryAxisAlignItems = 'CENTER'; _vf.itemSpacing = 8; _vf.fills = [];
    _bindVar(_vf, 'itemSpacing', _docSpace.padS);
    _secC.appendChild(_vf); _vf.appendChild(_v.createInstance());
    const _vl = figma.createText();
    _vl.characters = _v.name.replace(/,\s*/g, '\n');
    _applyTextRole(_vl, 'sectionLabel', 11, _fSemi, _cInk, _vInk);
    _vl.textAlignHorizontal = 'CENTER';
    _vf.appendChild(_vl); _vl.textAutoResize = 'WIDTH_AND_HEIGHT';
    if (variantDesc[_v.name]) {
      const _vdt = figma.createText();
      _vdt.characters = variantDesc[_v.name];
      _applyTextRole(_vdt, 'body', 10, _fReg, _cSubtle, _vSubtle);
      _vdt.textAlignHorizontal = 'CENTER';
      _vf.appendChild(_vdt); _vdt.textAutoResize = 'WIDTH_AND_HEIGHT';
    }
  }

  // Section D — Properties table
  const _propKeys = Object.keys(compMeta.componentPropertyDefinitions);
  if (_propKeys.length > 0) {
    _mkLabel(doc, 'COMPONENT PROPERTIES');
    const _tblD = _mkTable(doc, 'Properties Table');
    const _dHdr = _mkRow(_tblD, 1280, true);
    _mkCell(_dHdr, 'PROPERTY', 427, 'header-text');
    _mkCell(_dHdr, 'TYPE', 427, 'header-text');
    _mkCell(_dHdr, 'DEFAULT', 426, 'header-text');
    for (let i = 0; i < _propKeys.length; i++) {
      const key = _propKeys[i];
      const def = compMeta.componentPropertyDefinitions[key];
      const r = _mkRow(_tblD, 1280, false);
      r.fills = i % 2 === 1 ? [_paint(_cSurface, _vSurface)] : [];
      _mkCell(r, key.replace(/#[^#]+$/, ''), 427, 'body');
      _mkCell(r, def.type, 427, 'mono');
      _mkCell(r, String(def.defaultValue !== undefined ? def.defaultValue : '—'), 426, 'body');
    }
  }

  // Section F — Sizing
  // Property -> token-name table for the default variant. Smart-group padding
  // when 4 sides share a token; collapse to (Y) + (X) if Y-pair and X-pair
  // each share. Dimensions are shown plainly. Never show raw VariableID.
  // Uses the proven _mkTable/_mkRow/_mkCell helpers — same as Properties Table.
  // Map property -> token name (only resolved variables; never raw VariableID:).
  const _propTokens = {};
  for (let i = 0; i < resolved.length; i++) {
    const b = resolved[i];
    if (b.node !== _defaultV.name && b.node !== compName) continue;
    if (typeof b.token === 'string' && b.token.indexOf('VariableID:') === 0) continue;
    _propTokens[b.property] = b.token;
  }

  const _sizingRows = [];
  _sizingRows.push(['Dimensions (default)', _defaultV.width + ' x ' + _defaultV.height + ' px'
    + (compMeta.variantCount > 1 ? '   (' + compMeta.variantCount + ' variants)' : '')]);

  const _pT = _propTokens['paddingTop'];
  const _pB = _propTokens['paddingBottom'];
  const _pL = _propTokens['paddingLeft'];
  const _pR = _propTokens['paddingRight'];
  if (_pT || _pB || _pL || _pR) {
    if (_pT && _pT === _pB && _pT === _pL && _pT === _pR) {
      _sizingRows.push(['Padding (all sides)', _pT]);
    } else if (_pT && _pT === _pB && _pL && _pL === _pR) {
      _sizingRows.push(['Padding (vertical)', _pT]);
      _sizingRows.push(['Padding (horizontal)', _pL]);
    } else {
      if (_pT) _sizingRows.push(['Padding (top)', _pT]);
      if (_pR) _sizingRows.push(['Padding (right)', _pR]);
      if (_pB) _sizingRows.push(['Padding (bottom)', _pB]);
      if (_pL) _sizingRows.push(['Padding (left)', _pL]);
    }
  }
  if (_propTokens['itemSpacing']) _sizingRows.push(['Gap (primary axis)', _propTokens['itemSpacing']]);
  if (_propTokens['counterAxisSpacing']) _sizingRows.push(['Gap (counter axis)', _propTokens['counterAxisSpacing']]);
  if (_propTokens['cornerRadius']) _sizingRows.push(['Corner radius', _propTokens['cornerRadius']]);
  if (_propTokens['strokeWeight']) _sizingRows.push(['Stroke weight', _propTokens['strokeWeight']]);

  if (_sizingRows.length > 0) {
    _mkLabel(doc, 'SIZING');
    const _tblF = _mkTable(doc, 'Sizing Table');
    const _fHdr = _mkRow(_tblF, 1280, true);
    _mkCell(_fHdr, 'LAYOUT FACT', 360, 'header-text');
    _mkCell(_fHdr, 'TOKEN / VALUE', 920, 'header-text');
    for (let i = 0; i < _sizingRows.length; i++) {
      const r = _mkRow(_tblF, 1280, false);
      r.fills = i % 2 === 1 ? [_paint(_cSurface, _vSurface)] : [];
      _mkCell(r, _sizingRows[i][0], 360, 'body');
      _mkCell(r, _sizingRows[i][1], 920, 'body');
    }
  }

  // Section G — Anatomy
  const _hasAnatomySection = elements.length > 0 && _hasMeaningfulAnatomy(_defaultV);
  if (_hasAnatomySection) {
    _mkLabel(doc, 'ANATOMY');
    const _wrapper = figma.createFrame();
    _wrapper.name = 'Anatomy Wrapper'; _wrapper.layoutMode = 'HORIZONTAL';
    _wrapper.primaryAxisSizingMode = 'FIXED'; _wrapper.counterAxisSizingMode = 'FIXED';
    _wrapper.clipsContent = false; _wrapper.fills = [];
    _wrapper.resize(_defaultV.width, _defaultV.height);
    doc.appendChild(_wrapper);
    const _anatInst = _defaultV.createInstance();
    _wrapper.appendChild(_anatInst);
    _anatInst.layoutPositioning = 'ABSOLUTE'; _anatInst.x = 0; _anatInst.y = 0;
    const _BS = 18;
    const _usedBadgeSlots = {};
    for (let idx = 0; idx < elements.length; idx++) {
      const el = elements[idx];
      const n = idx + 1;
      let bx = Math.round(el.x);
      let by;
      if (el.y - _BS - 4 >= 0) {
        by = Math.round(el.y - _BS - 4);
      } else if (el.y + el.h + 4 + _BS <= _defaultV.height) {
        by = Math.round(el.y + el.h + 4);
      } else {
        by = Math.round(el.y);
      }
      const slotKey = Math.round(bx / 8) + ':' + Math.round(by / 8);
      const slotCount = _usedBadgeSlots[slotKey] || 0;
      _usedBadgeSlots[slotKey] = slotCount + 1;
      if (slotCount > 0) {
        bx += (slotCount % 3) * (_BS + 4);
        by += Math.floor(slotCount / 3) * (_BS + 4);
      }
      if (bx + _BS > _defaultV.width) bx = Math.max(0, Math.round(_defaultV.width - _BS));
      if (by + _BS > _defaultV.height) by = Math.max(0, Math.round(_defaultV.height - _BS));
      const _b = figma.createEllipse();
      _b.name = 'Badge ' + n; _b.resize(_BS, _BS);
      _b.fills = [_paint(_cBadge, _vBadge)];
      _wrapper.appendChild(_b);
      _b.layoutPositioning = 'ABSOLUTE'; _b.x = bx; _b.y = by;
      const _nt = figma.createText();
      _nt.characters = String(n);
      _applyTextRole(_nt, 'sectionLabel', n >= 10 ? 8 : 9, _fBold, { r: 1, g: 1, b: 1 }, null);
      _nt.textAlignHorizontal = 'CENTER'; _nt.textAlignVertical = 'CENTER';
      _nt.resize(_BS, _BS);
      _wrapper.appendChild(_nt);
      _nt.layoutPositioning = 'ABSOLUTE'; _nt.x = bx; _nt.y = by;
    }
    // Anatomy legend table
    const _tblG = _mkTable(doc, 'Anatomy Legend');
    const _gHdr = _mkRow(_tblG, 1280, true);
    _mkCell(_gHdr, '#', 80, 'header-text');
    _mkCell(_gHdr, 'ELEMENT', 500, 'header-text');
    _mkCell(_gHdr, 'TYPE', 700, 'header-text');
    for (let idx = 0; idx < elements.length; idx++) {
      const el = elements[idx];
      const r = _mkRow(_tblG, 1280, false);
      r.fills = idx % 2 === 1 ? [_paint(_cSurface, _vSurface)] : [];
      _mkCell(r, String(idx + 1), 80, 'body');
      _mkCell(r, el.name, 500, 'body');
      _mkCell(r, el.type, 700, 'mono');
    }
  }

  // Section H — Usage
  _mkLabel(doc, 'USAGE');
  const _secH = figma.createFrame();
  _secH.name = 'Section H · Usage'; _secH.layoutMode = 'HORIZONTAL';
  _secH.primaryAxisSizingMode = 'FIXED'; _secH.counterAxisSizingMode = 'AUTO';
  _secH.itemSpacing = 24; _secH.fills = [];
  _bindVar(_secH, 'itemSpacing', _docSpace.padXL);
  doc.appendChild(_secH); _secH.layoutSizingHorizontal = 'FILL';
  function _mkUsagePanel(parent, label, rules, borderColor) {
    const panel = figma.createFrame();
    panel.name = label; panel.layoutMode = 'VERTICAL';
    panel.primaryAxisSizingMode = 'AUTO'; panel.counterAxisSizingMode = 'FIXED';
    panel.itemSpacing = 8;
    panel.paddingTop = 20; panel.paddingBottom = 20; panel.paddingLeft = 20; panel.paddingRight = 20;
    panel.fills = []; panel.cornerRadius = 8;
    panel.strokes = [_paint(borderColor, label === 'Do' ? _vDo : _vDont)]; panel.strokeWeight = 2;
    _bindVar(panel, 'paddingTop', _docSpace.padL);
    _bindVar(panel, 'paddingBottom', _docSpace.padL);
    _bindVar(panel, 'paddingLeft', _docSpace.padL);
    _bindVar(panel, 'paddingRight', _docSpace.padL);
    _bindVar(panel, 'itemSpacing', _docSpace.padS);
    _bindVar(panel, 'cornerRadius', _docSpace.radius);
    _bindVar(panel, 'strokeWeight', _docSpace.borderStrong);
    parent.appendChild(panel); panel.layoutSizingHorizontal = 'FILL';
    const lbl = figma.createText();
    lbl.characters = label;
    _applyTextRole(lbl, 'bodyStrong', 13, _fSemi, borderColor, label === 'Do' ? _vDo : _vDont);
    panel.appendChild(lbl); lbl.textAutoResize = 'WIDTH_AND_HEIGHT';
    for (let i = 0; i < rules.length; i++) {
      const rt = figma.createText();
      rt.characters = '• ' + rules[i];
      _applyTextRole(rt, 'body', 12, _fReg, _cInk, _vInk);
      panel.appendChild(rt); rt.layoutSizingHorizontal = 'FILL'; rt.textAutoResize = 'HEIGHT';
    }
  }
  _mkUsagePanel(_secH, 'Do', usageDo, _cDo);
  _mkUsagePanel(_secH, "Don't", usageDont, _cDont);

  // ── Update component description with [SPEC] block ─────────────────────────
  let _propsForSpec = '';
  for (let i = 0; i < _propKeys.length; i++) {
    if (i > 0) _propsForSpec += ', ';
    _propsForSpec += _propKeys[i].replace(/#[^#]+$/, '') + ' (' + compMeta.componentPropertyDefinitions[_propKeys[i]].type + ')';
  }
  if (!_propsForSpec) _propsForSpec = 'none';
  let _tokensForSpec = '';
  for (let i = 0; i < Math.min(5, resolved.length); i++) {
    if (i > 0) _tokensForSpec += ', ';
    _tokensForSpec += resolved[i].property + '=' + resolved[i].token;
  }
  const _specBlock =
    '[SPEC]\n' +
    'component: ' + compName + '\n' +
    'variants: ' + compMeta.variants.join(' | ') + '\n' +
    'properties: ' + _propsForSpec + '\n' +
    'tokens: ' + _tokensForSpec + '\n' +
    'spec-file: component-specs/' + compName + '.md\n' +
    '[/SPEC]\n\n';
  const _humanDesc = agentDescription ? agentDescription + '\n\n' : '';
  compSet.description = _humanDesc + _specBlock;

  // ── Build markdown (port of write-spec.js) ────────────────────────────────
  function _parseVariantProps(name) {
    const out = {};
    const parts = name.split(',');
    for (let i = 0; i < parts.length; i++) {
      const kv = parts[i].trim().split('=');
      if (kv.length === 2 && kv[0] && kv[1] !== undefined) out[kv[0].trim()] = kv[1].trim();
    }
    return out;
  }
  const _dimensions = {};
  for (let i = 0; i < compMeta.variants.length; i++) {
    const parsed = _parseVariantProps(compMeta.variants[i]);
    const keys = Object.keys(parsed);
    for (let j = 0; j < keys.length; j++) {
      if (!_dimensions[keys[j]]) _dimensions[keys[j]] = {};
      _dimensions[keys[j]][parsed[keys[j]]] = true;
    }
  }
  function _dimImpl(values) {
    const stateNames = { Default: 1, Hover: 1, Focus: 1, Active: 1, Disabled: 1, Pressed: 1 };
    let allStates = true;
    for (let i = 0; i < values.length; i++) if (!stateNames[values[i]]) { allStates = false; break; }
    return allStates ? 'ComponentSet (prototype-wired)' : 'ComponentSet variant';
  }

  const _compProps = [];
  for (let i = 0; i < _propKeys.length; i++) {
    const k = _propKeys[i];
    const d = compMeta.componentPropertyDefinitions[k];
    _compProps.push({ name: k, type: d.type, defaultValue: d.defaultValue !== undefined ? String(d.defaultValue) : '—' });
  }

  const _sizing = [];
  for (let i = 0; i < Math.min(_children.length, 10); i++) {
    _sizing.push({ name: _children[i].name, width: Math.round(_children[i].width), height: Math.round(_children[i].height) });
  }

  const _anatomyMd = [];
  let _anatIdx = 1;
  function _walkAnatomy(node, depth) {
    if (node.type === 'INSTANCE') return;
    if (depth > 0 && node.name && node.name.charAt(0) !== '_') {
      const bv = node.boundVariables || {};
      let token = '—';
      if (bv.fills && bv.fills[0] && bv.fills[0].id) {
        const v = varById[bv.fills[0].id];
        if (v) token = v.name;
      } else if (node.type === 'TEXT' && node.textStyleId) {
        const s = textStyleById[node.textStyleId];
        if (s) token = s.name;
      }
      _anatomyMd.push({ idx: _anatIdx++, name: node.name, type: node.type, token: token, depth: depth });
    }
    if ('children' in node) {
      for (let i = 0; i < node.children.length; i++) _walkAnatomy(node.children[i], depth + 1);
    }
  }
  _walkAnatomy(_defaultV, 0);

  function _mdRow(cells) { return '| ' + cells.join(' | ') + ' |'; }
  function _mdTable(header, rows) {
    const lines = [_mdRow(header), _mdRow(header.map(function () { return '---'; }))];
    for (let i = 0; i < rows.length; i++) lines.push(_mdRow(rows[i]));
    return lines.join('\n');
  }

  const _dimKeys = Object.keys(_dimensions);
  const _variantsTable = _dimKeys.length > 0
    ? _mdTable(['Dimension', 'Values', 'Implementation'],
        _dimKeys.map(function (k) {
          const vals = Object.keys(_dimensions[k]);
          return [k, vals.join(' · '), _dimImpl(vals)];
        }))
    : '_(Single component — no variant dimensions)_';

  const _vdKeys = Object.keys(variantDesc);
  const _variantDescTable = _vdKeys.length > 0
    ? _mdTable(['Variant', 'Purpose'], _vdKeys.map(function (k) { return [k, variantDesc[k]]; }))
    : '';

  const _propsTable = _compProps.length > 0
    ? _mdTable(['Property', 'Type', 'Default', 'Description'],
        _compProps.map(function (p) { return [p.name, p.type, p.defaultValue, '']; }))
    : '';

  const _bindingsTable = resolved.length > 0
    ? _mdTable(['Node', 'Property', 'Token', 'Resolved Value'],
        resolved.map(function (b) { return [b.node, b.property, b.token, b.resolvedVal]; }))
    : '';

  const _sizingTable = _sizing.length > 0
    ? _mdTable(['Variant', 'Width', 'Height'],
        _sizing.map(function (s) { return [s.name, s.width + 'px', s.height + 'px']; }))
    : '';

  const _anatomyTable = (_hasMeaningfulAnatomy(_defaultV) && _anatomyMd.length > 0)
    ? _mdTable(['#', 'Element', 'Type', 'Primary Token', 'Notes'],
        _anatomyMd.map(function (a) {
          const indent = a.depth > 1 ? new Array(a.depth).join('  ') : '';
          return [a.idx, indent + a.name, a.type, a.token, ''];
        }))
    : '';

  const _md = [];
  _md.push('# ' + compName);
  _md.push('');
  _md.push('> ' + (agentDescription ? agentDescription : '_[Add a 1-2 sentence description: what this component is and when to use it]_'));
  _md.push('');
  _md.push('---');
  _md.push('');
  _md.push('## Variants');
  _md.push('');
  _md.push(_variantsTable);
  _md.push('');
  if (_variantDescTable) {
    _md.push('### Variant purposes');
    _md.push('');
    _md.push(_variantDescTable);
    _md.push('');
  }
  _md.push('---');
  _md.push('');
  if (_propsTable) {
    _md.push('## Component Properties');
    _md.push('');
    _md.push(_propsTable);
    _md.push('');
    _md.push('---');
    _md.push('');
  }
  if (_bindingsTable) {
    _md.push('## Token Bindings');
    _md.push('');
    _md.push(_bindingsTable);
    _md.push('');
    _md.push('---');
    _md.push('');
  }
  if (_sizingTable) {
    _md.push('## Sizing');
    _md.push('');
    _md.push(_sizingTable);
    _md.push('');
    _md.push('---');
    _md.push('');
  }
  if (_anatomyTable) {
    _md.push('## Anatomy');
    _md.push('');
    _md.push(_anatomyTable);
    _md.push('');
    _md.push('---');
    _md.push('');
  }
  _md.push('## Usage Rules');
  _md.push('');
  _md.push('**Do:**');
  for (let i = 0; i < usageDo.length; i++) _md.push('- ' + usageDo[i]);
  _md.push('');
  _md.push("**Don't:**");
  for (let i = 0; i < usageDont.length; i++) _md.push('- ' + usageDont[i]);
  _md.push('');
  _md.push('---');
  _md.push('');
  _md.push('## Figma');
  _md.push('');
  _md.push('- **File:** ' + figma.root.name);
  _md.push('- **Page:** ' + figma.currentPage.name);
  _md.push('- **Section:** Documentation');
  _md.push('- **ComponentSet ID:** ' + compSet.id);
  _md.push('- **Spec Frame:** Documentation · ' + compName + ' · Spec');

  try { figma.viewport.scrollAndZoomIntoView([doc]); } catch (e) {}

  return {
    componentName: compName,
    markdown: _md.join('\n'),
    path: 'component-specs/' + compName + '.md',
    componentMeta: {
      type: compMeta.type,
      variantCount: compMeta.variantCount,
      width: compMeta.width,
      height: compMeta.height,
      propertyCount: _compProps.length
    },
    bindingsCount: resolved.length,
    bindingWarnings: _docBindingWarnings,
    anatomyCount: _anatomyMd.length,
    selectionContext: {
      fileName: figma.root ? figma.root.name : '',
      pageName: figma.currentPage ? figma.currentPage.name : '',
      pageId: figma.currentPage ? figma.currentPage.id : '',
      componentName: compName,
      componentId: _comp.id,
      componentType: _comp.type
    },
    specSheet: { page: figma.currentPage.name, frame: compName + ' · Spec' }
  };
}

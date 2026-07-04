const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const codePath = path.join(repoRoot, "packages/figma-bridge-plugin/code.js");
const uiPath = path.join(repoRoot, "packages/figma-bridge-plugin/ui.html");
const manifestPath = path.join(repoRoot, "packages/figma-bridge-plugin/manifest.json");
const toolPath = path.join(repoRoot, "packages/figlets-mcp-server/src/tools/qa-binding-audit.js");

const code = fs.readFileSync(codePath, "utf8");
const ui = fs.readFileSync(uiPath, "utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const tool = fs.readFileSync(toolPath, "utf8");
const colorSuggestionStart = code.indexOf("function _colorSuggestion");

assert.ok(
  code.includes("outlineBrand: pickColorRole('outlineBrand'"),
  "QA color roles must expose outlineBrand for brand/primary/accent strokes"
);

assert.ok(
  code.includes("if (suggestion.confidence !== 'high') return 'LOW_CONFIDENCE';"),
  "fix apply must reject non-high-confidence suggestions at bind time"
);

assert.ok(
  code.includes("const approvedSuggestions = Array.isArray(opts.approvedSuggestions)") &&
    code.includes("function _applyQaApprovedSuggestion(violation, approval)") &&
    code.includes("function _validateApprovedSuggestion(violation, approval)") &&
    code.includes("violations[i].issueNumber = i + 1") &&
    code.includes("issueNumber: violation.issueNumber || null") &&
    code.includes("return 'STALE_RAW_VALUE';") &&
    code.includes("return 'SUGGESTION_MISMATCH';") &&
    code.includes("designerDecisionApplyInput") &&
    code.includes("approved_suggestions"),
  "QA audit must expose and validate designer-approved suggestions without weakening fix:true"
);

assert.ok(
  code.includes("function _fixabilityForViolation(violation)") &&
    code.includes("violation.fixability = _fixabilityForViolation(violation)") &&
    code.includes("if (v.fixability !== 'fixableNow') continue") &&
    code.includes("byFixability: byFixability") &&
    code.includes("repairPlan: repairPlan") &&
    code.includes("tool: 'qa_binding_audit'"),
  "QA audit must classify fixability, expose repairPlan, and apply fix=true only for fixableNow"
);

assert.ok(
  code.includes("function _exactTextStyleForNode(node)") &&
    code.includes("function _typographyCandidates(node, limit)") &&
    code.includes("rawTypography") &&
    code.includes("confidence: 'medium'"),
  "Typography QA must distinguish exact text-style matches from role-only suggestions"
);

assert.ok(
  code.includes("return _augmentSuggestion(_suggestion('variable', variable, variable ? (ambiguousStateSurface ? 'medium' : 'high') : 'none')") &&
    !code.includes("Semantic color variable \"") &&
    !code.includes("Matched by binding policy"),
  "Semantic color suggestions must expose structured fields without prose reasons"
);

assert.ok(
  code.includes("function _colorCandidates(rawColor, kind, limit)") &&
    code.includes("function _colorDistanceMetrics(rawColor, tokenColor)") &&
    code.includes("function _nodeFactPacket(node, rawColor, kind)") &&
    code.includes("function _hasStateLikeContext(node)") &&
    code.includes("function _isGenericStateSurfaceToken(name)") &&
    code.includes("ambiguousStateSurface") &&
    code.includes("ambiguousStateSurface ? 'medium' : 'high'") &&
    code.includes("facts.rawFill") &&
    code.includes("textDescendants") &&
    code.includes("suggestion.candidates = extras.candidates") &&
    code.includes("visualWins") &&
    !code.includes("Candidate selected from nearest available color token; review before binding."),
  "QA color binding must expose fact-only candidate data and downgrade visual/name ambiguity to designer-decision"
);

assert.ok(
  code.includes("function _typographyCandidates(node, limit)") &&
    code.includes("function _styleDistanceForNode(node, style)") &&
    code.includes("rawTypography") &&
    code.includes("candidates: candidates"),
  "QA typography binding must expose ranked text-style candidates for agent/designer decisions"
);

assert.ok(
  code.includes("function _approvedCandidateSuggestion(violation, approval)") &&
    code.includes("function _exactApprovedSuggestion(violation, approval)") &&
    code.includes("function _findApprovedVariable(approval)") &&
    code.includes("function _findApprovedTextStyle(approval)") &&
    code.includes("variable.resolvedType !== 'COLOR'") &&
    code.includes("variable.resolvedType !== 'FLOAT'") &&
    code.includes("exactDesignerChoice: true") &&
    code.includes("const candidates = Array.isArray(suggestion.candidates) ? suggestion.candidates : []") &&
    code.includes("candidate.token") &&
    code.includes("candidate.name") &&
    code.includes("issueNumber: violation.issueNumber") &&
    code.includes("boundTo: approved && approved.name || violation.suggestion.name") &&
    code.includes("violation.suggestion = approved") &&
    code.includes("violation.suggestion = originalSuggestion"),
  "Approved QA binding must allow exact candidate or designer-named existing token/style entries from the audit finding without widening fix:true"
);

assert.ok(
  code.includes("function isIconColorName(name)") &&
    code.includes("'icon': { ICON: 3 }") &&
    code.includes("'on-danger': { FG: 2, DANGER: 2 }") &&
    code.includes("ICON: -8") &&
    code.includes("function adjustedSegScore(name, role, score)") &&
    code.includes("role === 'dangerText' && /(?:^|\\/)on[-_]danger") &&
    code.includes("function isIntentOrContextTextName(name)") &&
    code.includes("function scoreGenericTextName(name)") &&
    code.includes("function isGenericTextRole(role)") &&
    code.includes("if (isGenericTextRole(role) && isIntentOrContextTextName(s.name)) continue;") &&
    code.includes("if (isGenericTextRole(role) && isIntentOrContextTextName(scored[i].name)) continue;") &&
    code.includes("SUCCESS: -6, WARNING: -6, DANGER: -6") &&
    code.includes("lum: c ? lum(c) : 0") &&
    code.includes("if (isTextRole(role) && isIconColorName(s.name)) continue;") &&
    code.includes("if (isTextRole(role) && isIconColorName(scored[i].name)) continue;") &&
    code.includes("if (node.type !== 'TEXT' && /icon|glyph/.test(name))") &&
    code.includes("return 'iconDefault';"),
  "Shared color-role picker must consider unresolved semantic color variables by name, avoid color/icon/* and status/context tokens for generic text roles, and preserve icon roles for icon nodes"
);

assert.ok(
  code.includes("function _surfaceTextSuggestion(node, rawColor)") &&
    code.includes("let cursor = node && node.parent;") &&
    code.includes("function _pairedForegroundForSurface(surfaceVariable)") &&
    code.includes("function _foregroundCandidatesForSurfaceName(name)") &&
    code.includes("function _isQaIconColorName(name)") &&
    code.includes("!_isQaIconColorName(variable.name)") &&
    !code.includes("!isIconColorName(variable.name)) return variable") &&
    !code.includes("Paired foreground \"") &&
    code.includes("property === 'Fill color' && node.type === 'TEXT'") &&
    code.indexOf("const surfaceSuggestion = _surfaceTextSuggestion(node, rawColor);", colorSuggestionStart) <
      code.indexOf("const role = _colorRoleFor(node, property);", colorSuggestionStart),
  "Text fill QA must prefer the nearest surface/background paired foreground before falling back to layer-name color roles"
);

assert.ok(
  !code.includes("suggestion.reason") &&
    !code.includes("reason: violation.suggestion.reason") &&
    !code.includes("reason: 'No suggestion.'"),
  "QA suggestion payloads must not include prose reason fields; agents should infer from facts and candidates"
);

assert.ok(
  code.includes("const _vDoText  = _ds.colorRoles.successText") &&
    code.includes("const _vDontText = _ds.colorRoles.dangerText") &&
    code.includes("label === 'Do' ? _vDoText : _vDontText") &&
    !code.includes("_applyTextRole(lbl, 'bodyStrong', 13, _fSemi, borderColor"),
  "Component-doc usage labels must bind text fills to semantic text roles from the shared resolver, not border variables"
);

assert.ok(
  code.includes("const _vBadgeText = _ds.colorRoles.dangerText") &&
    code.includes("const _cBadgeText = _ds.resolvedOrFallback(_vBadgeText") &&
    code.includes("_applyTextRole(_nt, 'sectionLabel', n >= 10 ? 8 : 9, _fBold, _cBadgeText, _vBadgeText)") &&
    code.includes("badgeTextVariable: _vBadgeText ? _vBadgeText.name : null") &&
    code.includes("firstBadgeTextFillVariable = _boundPaintColorVarName(_fill)") &&
    code.includes("bindingDiagnostics: _docBindingDiagnostics") &&
    !code.includes("_applyTextRole(_nt, 'sectionLabel', n >= 10 ? 8 : 9, _fBold, { r: 1, g: 1, b: 1 }, null)"),
  "Component-doc anatomy badge numbers must bind to the shared danger text role instead of raw white and report smoke diagnostics"
);

assert.ok(
  code.includes("title: ['type/headline/lg'") &&
    code.includes("'type/title/md'") &&
    !code.includes("title: ['type/display/lg'"),
  "Component-doc title typography must prefer headline/title styles and avoid display/lg by default"
);

assert.ok(
  code.includes("if (msg.data && msg.data.local) result.local = true;"),
  "Local plugin QA buttons must mark results so the UI can render them without receiver round-trip"
);

assert.ok(
  ui.includes("Started local QA safe bind.") &&
    ui.includes("_renderQaReport(msg.data)") &&
    ui.includes("Applying high-confidence bindings only."),
  "Plugin UI must expose designer-facing QA check and safe-bind controls"
);

assert.ok(
  code.includes("figma.showUI(__html__, { width: 296, height: 348, themeColors: true });") &&
    /var _bridgeBuild = '0\.1\.0-dev\+bnn\d+\.\d{8}\.\d+';/.test(code) &&
    code.includes("if (msg.type === 'ui-resize')") &&
    code.includes("figma.ui.resize(msg.expanded ? 576 : 296, 348);") &&
    ui.includes("id=\"log-toggle\"") &&
    ui.includes("class=\"log-column\"") &&
    ui.includes("function _setLogOpen(open)") &&
    ui.includes("parent.postMessage({ pluginMessage: { type: 'ui-resize', expanded: _isLogOpen } }, '*');") &&
    !ui.includes("<div id=\"session-meta\">Session: pending</div>"),
  "Plugin UI must default to the compact Figma design and reveal the log in an expanded panel"
);

assert.ok(
  manifest.name === "Figlets Bridge Dev" &&
    !Object.prototype.hasOwnProperty.call(manifest, "id"),
  "Development bridge manifest must be visibly distinct and avoid a hardcoded plugin id so stale Figma dev imports are easier to spot"
);

assert.ok(
  ui.includes("id=\"session-meta\" class=\"log-session\"") &&
    ui.includes("Bridge: pending") &&
    ui.includes("Bridge: ' + bridgeBuild") &&
    ui.includes("metaEl.title = msg.data && msg.data.sessionId ? 'Session: ' + msg.data.sessionId : '';") &&
    ui.includes("title=\"") &&
    ui.includes(">Documentable</span>") &&
    ui.includes(">Undocumentable</span>") &&
    ui.includes("id=\"qa-check\"") &&
    ui.includes("id=\"qa-fix\"") &&
    !ui.includes("id=\"ui-tooltip\""),
  "Plugin UI must show the bridge build in the log panel while retaining the session ID as a tooltip for diagnostics"
);

assert.ok(
  ui.includes("background: #121212;") &&
    ui.includes("background: #c9fb8c;") &&
    ui.includes("color: #e7ffcd;") &&
    ui.includes("border: 1px solid #5d8227;") &&
    ui.includes("border-radius: 9999px;"),
  "Plugin UI must use the FigWords design tokens (bg #121212, brand #c9fb8c, text-brand #e7ffcd, border-brand #5d8227, pill radius)"
);

assert.ok(
  ui.includes("#qa-report.has-report") &&
    ui.includes("display: block;") &&
    ui.includes("el.className = 'has-report';") &&
    ui.includes("_renderQaReport(msg.data);"),
  "Plugin UI must show local QA results in the QA panel, not only the session log"
);

assert.ok(
  code.includes("const _ds = await _createDsBindingContext();"),
  "QA and documentation flows must use the shared live binding resolver"
);

assert.ok(
  code.includes("function _componentDocTarget(component)") &&
    code.includes("component.parent && component.parent.type === 'COMPONENT_SET'") &&
    code.includes("selectedVariantName") &&
    code.includes("documentedVariantSelection") &&
    code.includes("Documented parent component set") &&
    !code.includes("componentPropertyDefinitions: compSet.componentPropertyDefinitions || {}"),
  "Component docs must promote selected variant components to their parent component set instead of calling componentPropertyDefinitions on a variant"
);

assert.ok(
  code.includes("function _isDocPrivateNodeName(name)") &&
    code.includes("first === '_' || first === '.'") &&
    code.includes("function _absoluteDocX(node)") &&
    code.includes("function _positionDocumentationSection(section, frame, target)") &&
    code.includes("function _syncDocumentationSectionBounds(section, frame)") &&
    code.includes("componentX: _absoluteDocX(compSet)") &&
    code.includes("section.resizeWithoutConstraints(frame.width, frame.height)") &&
    code.includes("if (_isDocPrivateNodeName(node.name)) return"),
  "Component docs must position the documentation section beside the component, fit the section to frame content, and ignore private _/. anatomy layers"
);

assert.ok(
  code.includes("function _collectSlotDocs(root, propertyDefinitions)") &&
    code.includes("node.type === 'SLOT'") &&
    code.includes("limitViolations") &&
    code.includes("slotSettings") &&
    code.includes("allowPreferredValuesOnly") &&
    code.includes("minChildren") &&
    code.includes("maxChildren") &&
    code.includes("stretchChildOnInsert") &&
    code.includes("displayEmptyByDefault") &&
    code.includes("preferredValues") &&
    code.includes("## Slots") &&
    code.includes("SLOTS"),
  "Component docs must include slot property settings, preferred value limits, default content, and limit violations in Figma and markdown output"
);

assert.ok(
  code.includes("function _mkTable(parent, name)") &&
    code.includes("t.strokes = [_paint(_cBorder, _vBorder)]; t.strokeWeight = 1;") &&
    code.includes("_bindVar(t, 'strokeWeight', _docSpace.border);"),
  "Component doc tables must draw a single border on the table container, not on row/cell helpers"
);

assert.ok(
  code.includes("function _getFigletsFileKey()") &&
    code.includes("figma.root.getPluginData('figletsFileKey')") &&
    code.includes("figma.root.setPluginData('figletsFileKey', localKey)") &&
    code.includes("fileKey: _fileKey") &&
    ui.includes("'&fileKey=' +"),
  "Keyless Figma drafts must get a persisted local file identity for per-file .local routing"
);

assert.ok(
  code.includes("const maxNodes = typeof opts.maxNodes === 'number'") &&
    code.includes("truncateReason = 'MAX_NODES';") &&
    code.includes("truncateReason = 'DEADLINE';") &&
    code.includes("auditedNodeCount: auditedNodeCount"),
  "QA page audits must be bounded and report truncation instead of hanging on very large pages"
);

assert.ok(
  code.includes("const _binding = await _createDsBindingContext();"),
  "Showcase flow must use the shared live binding resolver"
);

assert.ok(
  code.includes("if (_binding.bindVar(node, prop, variable)) return true;"),
  "Showcase numeric binding must apply variables through the shared binding context"
);

assert.ok(
  code.includes("function isDecorativeColorName(name)") &&
    code.includes("function _isDecorativeColorName(name)") &&
    code.includes("!isDecorativeColorName(v.name)") &&
    code.includes("!_isDecorativeColorName(v.name)"),
  "Shared resolver and showcase color-role fallbacks must exclude scrim/overlay colors from text and foreground binding"
);

assert.ok(
  code.includes("sq.cornerRadius  = px;") && !code.includes("sq.cornerRadius  = Math.min(px, 28);"),
  "Showcase radius visuals must use token values directly so full radius can bind instead of producing raw 28px gaps"
);

assert.ok(
  code.includes("function _rankPrimitiveRamp(name)") &&
    code.includes("function _rankSemanticName(name)") &&
    code.includes("const _rampEntries = Object.entries(_rampMap).sort") &&
    code.includes("for (const { label, rows } of _sortSemanticGroups(_mainGroups))"),
  "Showcase colors must use deterministic primitive and semantic ordering"
);

assert.ok(
  code.includes("for (var _oldShowcaseIndex = 0; _oldShowcaseIndex < _existingShowcases.length; _oldShowcaseIndex++)") &&
    code.includes("let _sectionX = 0;") &&
    code.includes("_placeShowcaseSection('Primitive Colors', _primitiveColorsFrame, _myColorsX);") &&
    code.includes("'Light Semantics'") &&
    code.includes("'Dark Semantics'"),
  "Showcase rebuild must place primitive colors first, then light/dark semantic sections before the remaining sections"
);

assert.ok(
  code.includes("const _configSemanticPairs = (") &&
    code.includes("Array.isArray(opts.DS.color.semantics.pairs)") &&
    code.includes("for (const pair of _configSemanticPairs)") &&
    code.includes("varByName[pair.bg]") &&
    code.includes("varByName[pair.text]") &&
    code.includes("const _extraBgGroups = {};") &&
    code.includes("if (_seenConfigBgRefs[v.name]) continue;") &&
    code.includes("const defaultFgRef = varByName['color/text/default']") &&
    code.includes("hasPairing: !!defaultFgInfo"),
  "Showcase semantic color rows must use prepared DS.color.semantics.pairs and still surface extra bg/surface/fill variables with default foreground badges when available"
);

assert.ok(
  code.includes("function _configStandaloneRows(items, kind, modeName, pairedRoleNames)") &&
    code.includes("_configSemantics.unpaired") &&
    code.includes("const _pairedOutlineNames = _pairedOutlineRoleNames(_configSemanticPairs);") &&
    code.includes("Standalone Outline Roles") &&
    !code.includes("Standalone Icon Roles"),
  "Config-backed showcase must render only truly standalone outline roles and omit standalone icon tables"
);

assert.ok(
  code.includes("const lcLabel = (lcAbs >= 75 ? '✓ ' : '✗ ') + 'Lc ' + Math.round(lcAbs);") &&
    code.includes("const ratioLabel = (ratio >= 4.5 ? '✓ ' : '✗ ') + ((Math.round(ratio * 100) / 100).toFixed(2) + ':1');") &&
    code.includes("const secondaryText = _tDS(secondaryLabel, 12, _textColor, false, _V.text);"),
  "Semantic contrast cells must mark APCA and WCAG independently and use the same color for both values"
);

assert.ok(
  code.includes("_V.textSub = _findVar(") &&
    code.includes("'color/text/subtle'") &&
    code.includes("'color/text/muted'") &&
    code.includes("_V.brandVariant = _findVar(") &&
    code.includes("'color/bg/brand-subtle'") &&
    code.includes("_V.onBrandVariant = _findVar(") &&
    code.includes("'color/text/brand'") &&
    code.includes("if (!_V.onBrandVariant) {"),
  "Showcase chrome must prefer explicit generic/brand-subtle tokens before scored brand foregrounds"
);

assert.ok(
  code.includes("function pickFloatByNearest(value, purpose, preference, maxDistance)") &&
    code.includes("pickFloatByNearest,"),
  "Shared binding context must expose purpose-aware numeric nearest fallback"
);

assert.ok(
  code.includes("'color-semantics': function ()") &&
    code.includes("function _semanticColorEntries(DS)") &&
    code.includes("semVar.setValueForMode(lightModeId, lightAlias)") &&
    code.includes("semVar.setValueForMode(darkModeId, darkAlias)"),
  "Primitive update flow must also refresh existing Color semantic aliases without recreating collections"
);

assert.ok(
  code.includes("function _resolveSemanticTarget(byName, targetName)") &&
    code.includes("substituted: true") &&
    code.includes("substituted: semSubstituted"),
  "Semantic alias updates must fall back to the nearest existing primitive step instead of skipping when an exact-name target is missing"
);

assert.ok(
  code.includes("variable = _binding.pickFloatByNearest(value, purpose, fallbackMode, _numericFallback.maxDistance);"),
  "Showcase numeric fallback must come from the shared binding context"
);

assert.ok(
  !code.includes("itemSpacing = 6;") &&
    !code.includes("cornerRadius = 16;"),
  "Generated showcase chrome must avoid raw values that have no exact generated spacing/radius token"
);

assert.ok(
  code.includes("return { fg: candidates[i].fg, varRef: candidates[i].varRef, show: true };"),
  "Showcase primitive swatch indicators must preserve semantic foreground variables"
);

assert.ok(
  code.includes("function _buildPrimitiveContrastSwatch(swatchRGB, stepLabel, hexLabel, swatchVar)") &&
    code.includes("const topText = _tDS(_contrastLabel(top.lc, top.ratio, 75, 4.5), 9, top.fg, true, top.varRef);") &&
    code.includes("const bottomText = _tDS(_contrastLabel(bottom.lc, bottom.ratio, 75, 4.5), 9, swatchRGB, true, swatchVar);") &&
    code.includes("swatch.layoutGrow = 1;") &&
    code.includes("_setMinWidth(swatch, 56);"),
  "Showcase primitive swatches must bind split contrast labels to variables and flex within the row"
);

assert.ok(
  code.includes("function _lcLabel(lc, threshold)") &&
    code.includes("return (lc >= threshold ? '✓ ' : '✗ ') + 'Lc ' + lc;") &&
    code.includes("function _wcagLabel(ratio, threshold)") &&
    code.includes("if (ratio >= 7) return '✓ AAA';") &&
    code.includes("if (ratio >= 4.5) return '✓ AA';") &&
    code.includes("if (ratio >= 3) return threshold <= 3 ? '✓ 3:1' : '~ Large';") &&
    code.includes("function _contrastLabel(lc, ratio, lcThreshold, ratioThreshold)") &&
    code.includes("if (_showcaseContrastAlgorithm === 'wcag')") &&
    code.includes("var lcAbs = Math.abs(_apcaLc(fgRGB, bgRGB));") &&
    code.includes("const ratio = _contrastRatio(bgRGB, fgRGB);") &&
    code.includes("_buildBadge(ratio)"),
  "Showcase semantic pair rows must compute APCA Lc and WCAG ratio and surface pass/fail via _buildBadge (Option A: pill in the right column, raw Lc/ratio overlay inside the swatch)"
);

assert.ok(
  code.includes("lc * 100 - 2.7") &&
    code.includes("lc * 100 + 2.7") &&
    !code.includes("lc * 100 - 12.5") &&
    !code.includes("lc * 100 + 12.5"),
  "Bridge APCA formula must use 0.0.98G low-output offset 0.027 (2.7 after scaling)"
);

assert.ok(
  code.includes("function _pickReadableNeutralExtreme(swatchRGB)") &&
    code.includes("if (!/^color\\/neutral\\//i.test(s.name)) continue;") &&
    code.includes("scrim|overlay|surface|foreground|text|on[-_]surface|shadow|elevation") &&
    code.includes("_pickNeutralTextForSwatch(swatchRGB)"),
  "Showcase primitive swatches must fall back only to readable neutral-ramp variables when semantic variables do not contrast"
);

assert.ok(
  !code.includes("rawFallback"),
  "Showcase accessibility indicators must not use raw color fallback"
);

assert.ok(
  !code.includes("[Describe what these tokens are used for]") &&
    !code.includes("Usage inferred from the token name and scale position.") &&
    code.includes("function _floatTokenDesc(name, visualType, px)") &&
    code.includes("function _typeVarDesc(key)") &&
    code.includes("function _colorTableDesc(label)") &&
    code.includes("function _spacingGroupDesc(groupPath, visualType)"),
  "Showcase descriptions must be specific generated copy, not placeholder text"
);

assert.ok(
  code.includes("outer.strokes = [_paint(_accColor, _V.outlineBrand)];") &&
    code.includes("inner.fills = [_paint(_RC.surfaceBrand, _V.surfaceBrand)];"),
  "Inset spacing visual must use the same brand/outline palette as other spacing visuals"
);

assert.ok(
  code.includes("_elevTable.clipsContent = true;") &&
    code.includes("previewCell.clipsContent = false;") &&
    code.includes("card.clipsContent = false;") &&
    code.includes("card.strokes = [_paint(_RC.outlineSubtle, _V.outlineSubtle)];") &&
    code.includes("card.layoutSizingHorizontal = 'FILL';"),
  "Elevation table clips for its border while preview children stay unclipped and fill the preview column"
);

assert.ok(
  code.includes("const _elevHeading = _buildTableHeading([") &&
    code.includes("{ text: 'Roles',    flex: true }") &&
    code.includes("{ text: 'Preview',  flex: true }") &&
    code.includes("{ text: 'Offset Y', width: 96, center: true }") &&
    code.includes("], 16);") &&
    code.includes("row.itemSpacing = 16;") &&
    !code.includes("tokenCell.paddingLeft = 12; tokenCell.paddingRight  = 12;") &&
    code.includes("previewCell.layoutSizingHorizontal = 'FILL';") &&
    code.includes("const _scrimHeading = _buildTableHeading([") &&
    code.includes("{ text: 'Roles',   flex: true }") &&
    code.includes("{ text: 'Preview', flex: true }") &&
    code.includes("demoCell.layoutSizingHorizontal = 'FILL';") &&
    code.includes("demo.strokes = [_paint(_RC.outlineSubtle, _V.outlineSubtle)];") &&
    code.includes("demo.layoutSizingHorizontal = 'FILL';"),
  "Elevation and scrim headers must match semantic table header treatment"
);

assert.ok(
  code.includes("try { container.fills = [_paint(_bgColor, _V.bg)]; } catch (_) {}"),
  "Showcase Section wrappers must not keep Figma's raw default fill"
);

assert.ok(
  code.includes("const borderProps = isFrameLike") &&
    code.includes("? ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight']") &&
    code.includes(": ['strokeWeight'];"),
  "Showcase final binding pass must bind vector stroke weights via strokeWeight"
);

assert.ok(
  code.includes("node.boundVariables.strokeWeight ||") &&
    code.includes("node.boundVariables.strokeTopWeight") &&
    code.includes("node.boundVariables.strokeRightWeight") &&
    code.includes("node.boundVariables.strokeBottomWeight") &&
    code.includes("node.boundVariables.strokeLeftWeight"),
  "QA stroke-weight audit must accept Figma's side-specific boundVariables shape"
);

assert.ok(
  code.includes("await new Promise(function(resolve) { setTimeout(resolve, 0); });"),
  "Showcase binding pass should yield before reapplying bindings to materialized Figma nodes"
);

assert.ok(
  code.includes("async function _ensureTypographyTextStyles(DS, typoColl, modes)") &&
    code.includes("figma.createTextStyle()") &&
    code.includes("textStyle.name = styleName;") &&
    code.includes("textStyle.setBoundVariable('fontSize'") &&
    code.includes("textStyle.setBoundVariable('lineHeight'") &&
    code.includes("var _textStyleResult = await _ensureTypographyTextStyles(DS, typoColl, modes3);") &&
    code.includes("built.push('Text styles (' + _textStyleResult.created + ' created)');"),
  "DS setup must create and bind typography text styles, not only typography variables"
);

assert.ok(
  code.includes("if (/(^|\\/)(?:elevation|shadow)(?:\\/|$)/i.test(groupPath) || /elevation/i.test(coll.name)) continue;") &&
    code.includes("const _elevationStyles = effectStyles") &&
    code.includes("_placeShowcaseSection('Elevation', _elevFrame, _myElevationX);"),
  "Showcase spacing must exclude elevation/shadow numeric variables so elevation renders only in its own section"
);

assert.ok(
  code.includes("const displayPx = Math.min(Math.max(Math.round(px / 4), 4), 26);") &&
    code.includes("const innerSize = 32;") &&
    code.includes("outer.resize(innerSize + displayPx * 2, innerSize + displayPx * 2);") &&
    code.includes("inner.resize(innerSize, innerSize);"),
  "Showcase inset visuals must keep the inner content size fixed and grow the outer padding box so inset values read differently"
);

assert.ok(
  code.includes("visualCell.resize(visualType === 'inset' ? 96 : 64, 1);"),
  "Showcase inset visual cells must be wide enough to show the larger padding box without clipping"
);

assert.ok(
  code.includes("function _scopeForVariableName(name, type)") &&
    code.includes("function _setVariableScopesForName(variable, name, type)") &&
    code.includes("async function _applyVariableScopesToCollection(collectionId, opts)") &&
    code.includes("if (opts.hideFromPickers)") &&
    code.includes("if (_setVariableScopes(allVars[i], [])) scoped += 1;") &&
    code.includes("if (second === 'radius') return ['CORNER_RADIUS'];") &&
    code.includes("if (second === 'border' || second === 'stroke') return ['STROKE_FLOAT'];") &&
    code.includes("return ['GAP'];") &&
    code.includes("return ['WIDTH_HEIGHT'];") &&
    code.includes("return ['FONT_SIZE'];") &&
    code.includes("return ['LINE_HEIGHT'];") &&
    code.includes("return ['LETTER_SPACING'];") &&
    code.includes("return ['FONT_WEIGHT'];") &&
    code.includes("return ['FONT_FAMILY'];") &&
    code.includes("return ['TEXT_FILL'];") &&
    code.includes("return ['STROKE_COLOR'];") &&
    code.includes("return ['EFFECT_COLOR'];") &&
    code.includes("return ['EFFECT_FLOAT'];"),
  "DS setup must scope variables to matching Figma picker fields so designers see less noise"
);

assert.ok(
  code.includes("await _applyVariableScopesToCollection(primColl.id, { hideFromPickers: true });") &&
    code.includes("await _applyVariableScopesToCollection(semColl.id);") &&
    code.includes("await _applyVariableScopesToCollection(typoColl.id);") &&
    code.includes("await _applyVariableScopesToCollection(spacingColl.id);") &&
    code.includes("await _applyVariableScopesToCollection(elevColl.id);"),
  "DS setup must repair variable scopes even when existing collections are skipped"
);

assert.ok(
  code.includes("_setVariableScopesForName(semVar, semEntry.name, 'COLOR');") &&
    code.includes("_setVariableScopes(existing, []);"),
  "Primitive update flow must hide primitive variables from pickers while preserving semantic variable scopes"
);

assert.ok(
  code.includes("figma.currentPage.selection = _showcaseNodes;") &&
    code.includes("_qaPass = await _runQaBindingAudit({ fix: true });") &&
    code.includes("figma.currentPage.selection = _prevSelection;"),
  "Showcase should reuse QA's high-confidence fix path scoped to generated showcase nodes"
);

assert.ok(
  code.includes("if (node.fills && Array.isArray(node.fills)) {"),
  "fill audit must still inspect style-bound fills because color variables are primary"
);

assert.ok(
  !code.includes("Array.isArray(node.fills) && !node.fillStyleId"),
  "fillStyleId must not exempt color fills from variable-first QA"
);

assert.ok(
  tool.includes("color, spacing, radius, and border bind to variables first"),
  "qa_binding_audit description must document the variable-first color/scalar policy"
);

assert.ok(
  !tool.includes("text styles first, then variables"),
  "qa_binding_audit description must not claim styles are globally first"
);

'use strict';

const { createHash } = require('crypto');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

// A decision covers the evaluated token, mode, colors, contexts, and threshold.
// Unrelated config edits do not restart a resolved conversation.
function contrastFindingId(finding) {
  return createHash('sha256').update(JSON.stringify(stable(finding))).digest('hex');
}

function contrastReadiness(ds, validation, continueWithWarnings) {
  const findings = (validation.contrastFindings || []).map(finding => ({ ...finding, id: contrastFindingId(finding) }));
  const previous = ds.figlets && ds.figlets.contrastAcknowledgments;
  const acknowledged = new Set(Array.isArray(previous) ? previous : []);
  if (continueWithWarnings === true) {
    for (const finding of findings) acknowledged.add(finding.id);
    ds.figlets = { ...ds.figlets, contrastAcknowledgments: [...acknowledged].sort() };
  }
  const warnings = findings.map(finding => ({ ...finding, accepted: acknowledged.has(finding.id), severity: 'warning', resolved: false }));
  const blocking = warnings.filter(finding => finding.kind === 'text' && !finding.accepted);
  const referenceErrors = validation.referenceErrors || [];
  return {
    ready: blocking.length === 0 && referenceErrors.length === 0,
    textFailureCount: warnings.filter(finding => finding.kind === 'text').length,
    iconFailureCount: validation.iconFailCount || 0,
    acceptedCount: warnings.filter(finding => finding.accepted).length,
    blockingCount: blocking.length,
    warnings,
    referenceErrors,
    agentInstruction: blocking.length
      ? 'Offer existing semantic alias repairs or continuation with current colors. If the designer already said continue anyway or ignore these contrast findings, pass continue_with_contrast_warnings: true to the existing prepare or apply tool. Do not ask again, change primitives, or repeat an unchanged failed repair.'
      : 'Contrast findings are advisory or already accepted. Do not repeat the repair menu. Continue the approved build with the current colors and report unresolved warnings truthfully.',
  };
}

function contrastRepairOptions(pairSuggestions, iconSuggestions) {
  const options = [];
  for (const key of Object.keys(pairSuggestions || {})) {
    const suggestion = pairSuggestions[key] || {};
    const parts = key.split('|');
    const background = parts[0];
    const text = parts[1];
    for (const mode of ['Light', 'Dark']) {
      const rawSuggestion = suggestion[mode];
      if (!rawSuggestion) continue;
      const suggestionObject = typeof rawSuggestion === 'string'
        ? { suggestedText: rawSuggestion }
        : rawSuggestion;
      const suggestedText = suggestionObject.suggestedText || suggestionObject.text;
      const suggestedBackground = suggestionObject.suggestedBackground || suggestionObject.background || null;
      if (!suggestedText && !suggestedBackground) continue;
      options.push({
        id: `${background}|${text}|${mode}`,
        mode,
        background,
        text,
        suggestedBackground,
        suggestedText,
        wcag: suggestionObject.wcag || null,
        action: suggestedBackground
          ? 'Update the semantic pair background and text aliases for this mode to the evaluated passing combination, then rerun prepare_ds_config.'
          : 'Update the semantic pair text alias for this mode to the suggested passing step, then rerun prepare_ds_config.',
        approvalLabel: suggestedBackground
          ? `${mode}: ${background} -> ${suggestedBackground}; ${text} -> ${suggestedText}`
          : `${mode}: ${text} on ${background} -> ${suggestedText}`,
      });
    }
  }
  return options.concat(iconSuggestions || []);
}


module.exports = { contrastReadiness, contrastFindingId, contrastRepairOptions };

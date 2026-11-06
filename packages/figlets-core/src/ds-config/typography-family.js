'use strict';

// Keep these pure functions compatible with the Figma sandbox. The bridge embeds
// this block verbatim; regression tests enforce parity between both runtimes.
function typographyFamilies(typography) {
  typography = typography || {};
  var supplied = typography.families || {};
  var families = { sans: supplied.sans || supplied.body || 'Inter', mono: supplied.mono || 'JetBrains Mono' };
  Object.keys(supplied).forEach(function (key) {
    if (typeof supplied[key] === 'string' && supplied[key].trim()) families[key] = supplied[key].trim();
  });
  var assignments = typography.roleFamilies || {};
  var scale = typography.scale || {};
  function retain(selector, key) {
    if (typeof selector !== 'string' || !selector.trim() || families[selector]) return;
    var literal = selector.trim();
    if (!Object.keys(families).some(function (name) { return families[name] === literal; })) families[key] = literal;
  }
  Object.keys(assignments).forEach(function (role) { retain(assignments[role], 'role/' + role); });
  Object.keys(scale).forEach(function (role) { retain(scale[role].family, 'role/' + role); });
  return families;
}

function resolveTypographyFamily(typography, role, entry) {
  typography = typography || {};
  entry = entry || (typography.scale || {})[role] || {};
  var families = typographyFamilies(typography);
  var group = String(role || '').split('/')[0];
  var assignments = typography.roleFamilies || {};
  var selector = entry.family || assignments[role] || assignments[group];
  if (!selector && group === 'display' && families.display) selector = 'display';
  if (!selector && group === 'body' && families.body) selector = 'body';
  if (!selector && (group === 'ui' || group === 'label') && families.ui) selector = 'ui';
  selector = selector || 'sans';
  var family = families[selector] || selector;
  var variant = families[selector] ? selector : Object.keys(families).filter(function (key) { return families[key] === family; })[0];
  return { family: family, variant: variant || null };
}

function typographyFontStyles(weight) {
  var styles = {
    100: ['Thin'], 200: ['Extra Light', 'ExtraLight', 'Ultra Light'], 300: ['Light'],
    400: ['Regular', 'Normal', 'Book'], 500: ['Medium'],
    600: ['Semi Bold', 'Semibold', 'SemiBold', 'Demi Bold'], 700: ['Bold'],
    800: ['Extra Bold', 'ExtraBold', 'Ultra Bold'], 900: ['Black', 'Heavy']
  };
  return styles[weight] || [];
}

module.exports = { typographyFamilies, resolveTypographyFamily, typographyFontStyles };

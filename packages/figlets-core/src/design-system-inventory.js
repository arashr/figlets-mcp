"use strict";

function _count(input) {
  return Array.isArray(input) ? input.length : 0;
}

function designSystemInventory(figmaData = {}) {
  const counts = {
    collections: _count(figmaData.collections),
    variables: _count(figmaData.variables),
    textStyles: _count(figmaData.textStyles),
    effectStyles: _count(figmaData.effectStyles),
    paintStyles: _count(figmaData.paintStyles),
  };
  counts.designSystemArtifacts = counts.variables + counts.textStyles + counts.effectStyles + counts.paintStyles;
  counts.foundationCollections = counts.collections;

  const hasFoundationShell = counts.foundationCollections > 0;
  const isEmpty = counts.designSystemArtifacts === 0;
  const state = isEmpty
    ? (hasFoundationShell ? "empty-foundation-shell" : "empty-file")
    : "has-token-artifacts";

  return {
    isEmpty,
    state,
    hasFoundationShell,
    counts,
    designSystemArtifactCount: counts.designSystemArtifacts,
    foundationCollectionCount: counts.foundationCollections,
  };
}

function emptyDesignSystemPrompt(inventory) {
  if (!inventory || !inventory.isEmpty) return null;
  return inventory.hasFoundationShell
    ? "This file has foundation collections but no design-system variables or local styles yet. Do you want to continue setting up the design-system foundation?"
    : "This file looks empty as a design-system file. Do you want to set up a new design-system foundation?";
}

function emptyDesignSystemMessage(inventory) {
  if (!inventory || !inventory.isEmpty) return null;
  return inventory.hasFoundationShell
    ? "Foundation collections exist, but no variables were found in the synced Figma snapshot."
    : "No variables or variable collections found in the synced Figma snapshot.";
}

module.exports = {
  designSystemInventory,
  emptyDesignSystemPrompt,
  emptyDesignSystemMessage,
};

function inspectComponentData(input = {}) {
  const selection = Array.isArray(input.selection) ? input.selection : [];
  
  if (selection.length === 0) {
    return { error: "No nodes are currently selected in Figma." };
  }

  // Process the selection nodes to ensure they are clean and structured
  const processedSelection = selection.map(node => {
    const result = {
      id: node.id,
      type: node.type,
      name: node.name
    };

    if (node.description) result.description = node.description;
    if (node.documentationLinks && node.documentationLinks.length > 0) result.documentationLinks = node.documentationLinks;
    if (node.componentPropertyDefinitions) result.componentPropertyDefinitions = node.componentPropertyDefinitions;
    if (node.componentProperties) result.componentProperties = node.componentProperties;
    
    if (node.layoutMode && node.layoutMode !== "NONE") {
      result.autoLayout = {
        mode: node.layoutMode,
        padding: node.padding || null,
        itemSpacing: node.itemSpacing || 0
      };
    }

    if (node.children && node.children.length > 0) {
      result.children = node.children;
    }

    return result;
  });

  return {
    selectedNodesCount: processedSelection.length,
    selection: processedSelection
  };
}

module.exports = {
  inspectComponentData
};

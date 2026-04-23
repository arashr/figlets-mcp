figma.showUI(__html__, { width: 240, height: 120, themeColors: true });

function serializeNode(node) {
  const result = {
    id: node.id,
    name: node.name,
    type: node.type
  };

  if ('description' in node) result.description = node.description || "";
  if ('documentationLinks' in node) result.documentationLinks = node.documentationLinks || [];
  if ('componentPropertyDefinitions' in node) result.componentPropertyDefinitions = node.componentPropertyDefinitions;
  if ('componentProperties' in node) result.componentProperties = node.componentProperties;
  
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
  if (msg.type === 'extract-all') {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();

    const componentNodes = figma.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });

    const payload = {
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

    figma.ui.postMessage({ type: 'data-extracted', data: payload });
  }

  if (msg.type === 'extract-selection') {
    const selection = figma.currentPage.selection;
    const payload = {
      selection: selection.map(node => serializeNode(node))
    };
    figma.ui.postMessage({ type: 'selection-extracted', data: payload });
  }

  if (msg.type === 'sync-success') {
    figma.notify('Data synced to local machine successfully!');
  }
};

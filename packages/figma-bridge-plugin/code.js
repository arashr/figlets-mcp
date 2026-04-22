figma.showUI(__html__, { width: 240, height: 120, themeColors: true });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'extract-data') {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();

    // Map to the shape expected by core
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
      }))
    };

    figma.ui.postMessage({ type: 'data-extracted', data: payload });
  }

  if (msg.type === 'sync-success') {
    figma.notify('Data synced to local machine successfully!');
  }
};

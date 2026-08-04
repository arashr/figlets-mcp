const {
  annotateComponentDependencies,
  collectComponentDependencies,
} = require("./component-dependencies.js");

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

  const dependencyResults = selection.map(node => collectComponentDependencies(node, input.dependencyOptions));
  const dependenciesByIdentity = new Map();
  const cycles = [];
  let truncated = false;
  for (const dependencyResult of dependencyResults) {
    truncated = truncated || dependencyResult.truncated;
    cycles.push.apply(cycles, dependencyResult.cycles);
    for (const dependency of dependencyResult.dependencies) {
      if (!dependenciesByIdentity.has(dependency.identity)) {
        dependenciesByIdentity.set(dependency.identity, dependency);
        continue;
      }
      const existing = dependenciesByIdentity.get(dependency.identity);
      existing.minDepth = Math.min(existing.minDepth, dependency.minDepth);
      existing.maxDepth = Math.max(existing.maxDepth, dependency.maxDepth);
      existing.relationship = existing.minDepth === 1 ? "Direct dependency" : "Nested dependency";
      for (const location of dependency.locations) {
        if (!existing.locations.includes(location)) existing.locations.push(location);
      }
      for (const viaComponentName of dependency.viaComponentNames) {
        if (!existing.viaComponentNames.includes(viaComponentName)) {
          existing.viaComponentNames.push(viaComponentName);
        }
      }
    }
  }
  const nestedComponents = annotateComponentDependencies(
    Array.from(dependenciesByIdentity.values()).sort((a, b) => (
      b.maxDepth - a.maxDepth || a.componentName.localeCompare(b.componentName)
    )),
    input.componentSpecs
  );

  const output = {
    selectedNodesCount: processedSelection.length,
    selection: processedSelection
  };
  if (nestedComponents.length > 0 || cycles.length > 0 || truncated) {
    const documentedCount = nestedComponents.filter(item => item.documented).length;
    const missingCount = nestedComponents.length - documentedCount;
    output.nestedComponents = nestedComponents;
    output.nestedComponentSummary = {
      count: nestedComponents.length,
      documentedCount,
      missingCount,
      cycles,
      truncated,
      requiresDesignerChoice: true,
      message: nestedComponents.length > 0
        ? `This component uses ${nestedComponents.length} nested component${nestedComponents.length === 1 ? "" : "s"}. ${documentedCount} already ${documentedCount === 1 ? "has" : "have"} a Figlets spec; ${missingCount} ${missingCount === 1 ? "has" : "have"} no standalone Figlets spec.`
        : "Nested component traversal stopped because a cycle or safety limit was detected.",
    };
  }
  return output;
}

module.exports = {
  inspectComponentData
};

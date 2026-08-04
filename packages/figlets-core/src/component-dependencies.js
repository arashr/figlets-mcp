function _componentIdentity(source, fallbackId) {
  if (source && source.key) return `key:${source.key}`;
  if (source && source.id) return `id:${source.id}`;
  return fallbackId ? `node:${fallbackId}` : "";
}

function _canonicalComponent(source) {
  return source && source.componentSet ? source.componentSet : (source || {});
}

function _rootComponentIdentities(root) {
  const identities = new Set();
  function add(node) {
    if (!node || (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET")) return;
    const identity = _componentIdentity({ key: node.componentKey || node.key, id: node.id });
    if (identity) identities.add(identity);
    if (node.componentSet) {
      const componentSetIdentity = _componentIdentity(node.componentSet);
      if (componentSetIdentity) identities.add(componentSetIdentity);
    }
  }
  add(root);
  if (root && root.type === "COMPONENT_SET" && Array.isArray(root.children)) {
    for (const child of root.children) add(child);
  }
  return identities;
}

function collectComponentDependencies(root, options = {}) {
  if (!root || typeof root !== "object") {
    return { dependencies: [], cycles: [], truncated: false, visitedNodeCount: 0 };
  }

  const maxDependencies = Number.isInteger(options.maxDependencies) && options.maxDependencies > 0
    ? options.maxDependencies
    : 50;
  const maxNodes = Number.isInteger(options.maxNodes) && options.maxNodes > 0
    ? options.maxNodes
    : 2500;
  const dependencies = new Map();
  const cycles = [];
  const cycleKeys = new Set();
  const visitedNodes = new Set();
  const rootIdentities = _rootComponentIdentities(root);
  let visitedNodeCount = 0;
  let truncated = false;

  function rememberCycle(identity, name, path) {
    const key = `${identity}|${path}`;
    if (cycleKeys.has(key)) return;
    cycleKeys.add(key);
    cycles.push({ identity, name, path });
  }

  function walk(node, pathParts, dependencyDepth, activeIdentities, dependencyTrail) {
    if (!node || typeof node !== "object" || truncated) return;
    if (visitedNodes.has(node)) {
      rememberCycle(`node:${node.id || "unknown"}`, node.name || "Nested component", pathParts.join(" / "));
      return;
    }
    visitedNodes.add(node);
    visitedNodeCount += 1;
    if (visitedNodeCount > maxNodes) {
      truncated = true;
      return;
    }

    const nodeName = String(node.name || node.type || "Node");
    const nextPath = pathParts.concat(nodeName);
    let nextDepth = dependencyDepth;
    let nextActive = activeIdentities;
    let nextTrail = dependencyTrail;

    if (node.type === "INSTANCE") {
      const source = node.mainComponent || node.sourceComponent || {};
      const canonicalSource = _canonicalComponent(source);
      const identity = _componentIdentity(canonicalSource, node.id);
      const componentName = String(canonicalSource.name || source.name || node.name || "Nested component");
      const location = nextPath.join(" / ");
      nextDepth += 1;

      if (identity && (rootIdentities.has(identity) || activeIdentities.has(identity))) {
        rememberCycle(identity, componentName, location);
        return;
      }

      if (!dependencies.has(identity)) {
        if (dependencies.size >= maxDependencies) {
          truncated = true;
          return;
        }
        dependencies.set(identity, {
          identity,
          componentId: canonicalSource.id || null,
          componentKey: canonicalSource.key || null,
          componentName,
          remote: Boolean(canonicalSource.remote || source.remote),
          minDepth: nextDepth,
          maxDepth: nextDepth,
          viaComponentNames: dependencyTrail.length > 0
            ? [dependencyTrail[dependencyTrail.length - 1]]
            : [],
          locations: [location],
        });
      } else {
        const existing = dependencies.get(identity);
        existing.minDepth = Math.min(existing.minDepth, nextDepth);
        existing.maxDepth = Math.max(existing.maxDepth, nextDepth);
        if (!existing.locations.includes(location)) existing.locations.push(location);
        const viaComponentName = dependencyTrail[dependencyTrail.length - 1];
        if (viaComponentName && !existing.viaComponentNames.includes(viaComponentName)) {
          existing.viaComponentNames.push(viaComponentName);
        }
      }

      nextActive = new Set(activeIdentities);
      if (identity) nextActive.add(identity);
      nextTrail = dependencyTrail.concat(componentName);
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child, nextPath, nextDepth, nextActive, nextTrail);
    }
  }

  walk(root, [], 0, new Set(), []);

  const ordered = Array.from(dependencies.values())
    .map(dependency => Object.assign({}, dependency, {
      relationship: dependency.minDepth === 1 ? "Direct dependency" : "Nested dependency",
    }))
    .sort((a, b) => (
      b.maxDepth - a.maxDepth
      || a.componentName.localeCompare(b.componentName)
      || a.identity.localeCompare(b.identity)
    ));

  return { dependencies: ordered, cycles, truncated, visitedNodeCount };
}

function annotateComponentDependencies(dependencies, componentSpecs) {
  const specsByName = new Map();
  for (const spec of Array.isArray(componentSpecs) ? componentSpecs : []) {
    if (!spec || typeof spec.name !== "string" || !spec.name.trim()) continue;
    specsByName.set(spec.name.trim(), spec);
  }
  return (Array.isArray(dependencies) ? dependencies : []).map(dependency => {
    const spec = specsByName.get(dependency.componentName);
    return Object.assign({}, dependency, {
      documented: Boolean(spec),
      specPath: spec && spec.path ? spec.path : null,
      documentationLabel: spec ? "Existing Figlets spec" : "No standalone Figlets spec",
    });
  });
}

module.exports = {
  annotateComponentDependencies,
  collectComponentDependencies,
};

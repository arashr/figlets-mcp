'use strict';

/**
 * generate-component-doc.js
 * MCP tool handler for generate_component_doc.
 *
 * Sends the component name + optional usage rules and variant descriptions to
 * the bridge plugin via /request-doc-build. The plugin renders a spec sheet
 * inside Figma, writes a [SPEC] block to the component description, and
 * returns the markdown body for component-specs/[Name].md after writing the
 * local markdown handoff file.
 */

const fs = require('fs');
const path = require('path');
const { inspectComponentData } = require('../figlets-core.js');
const { discoverComponentSpecs } = require('../utils/component-specs.js');
const {
  bridgeActiveSessionText,
  formatPluginNotListening,
  formatReceiverConnectionError,
  requestBridgePost,
} = require('../bridges/bridge-request.js');

const generateComponentDocTool = {
  name: 'generate_component_doc',
  description:
    'Generate a complete component spec sheet inside Figma (Documentation section), write the local markdown handoff file at component-specs/[Name].md under project_path when provided, otherwise under the MCP server working directory, and return the markdown body plus written path. The spec sheet includes component variants, every bound multi-mode variable collection with visual previews for each mode, properties, sizing, anatomy, token bindings, Do/Don\'t usage panels, and accessibility maintenance notes. When the selected component contains nested component instances, the markdown includes a bounded dependency table that references existing Figlets specs without recursively generating documentation. Also writes a [SPEC] machine-readable block to the component\'s Figma description for MCP handover. Requires the Figlets Bridge plugin open in Figma Desktop, with the target component on the current page.',
  inputSchema: {
    type: 'object',
    properties: {
      component_name: {
        type: 'string',
        description: 'Optional name of the COMPONENT or COMPONENT_SET to document. Omit to document the selected component or selected variant\'s parent component set.'
      },
      component_id: {
        type: 'string',
        description: 'Optional component ID returned by inspect_component. Documents that component in the current Figma file without requiring the user to select it.'
      },
      description: {
        type: 'string',
        description: 'Human-readable description shown under the component title on the spec sheet. 1-2 sentences: what the component is and when to use it. The agent should generate this after inspecting the component, not pass a placeholder.'
      },
      usage_do: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of Do rules (2-3 short sentences) grounded in this specific component.'
      },
      usage_dont: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of Don\'t rules (2-3 short sentences) grounded in misuse risks specific to this component.'
      },
      accessibility_notes: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of 2-4 accessibility maintenance notes for implementation handoff. These should preserve accessible behavior when rebuilding the component, such as alt text for images, captions/transcripts for video, keyboard/focus behavior, semantic roles/labels, touch target requirements, and contrast/token preservation. Use component-specific notes when inspection reveals images, slots, controls, text, or interactive states; otherwise provide generic accessibility maintenance notes. Do not frame these as visual improvement suggestions.'
      },
      variant_descriptions: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional map of exact variant name (e.g. "Type=Primary, Size=Default") to <=10-word purpose. Used in the variant showcase and the markdown handover file.'
      },
      project_path: {
        type: 'string',
        description: 'Optional absolute path to the active code workspace/project root. Used as the base for the component-specs markdown handoff file.'
      }
    },
    required: ['description', 'usage_do', 'usage_dont'],
    additionalProperties: false
  }
};

function handleGenerateComponentDoc(args) {
  const fallbackComponentName = args && args.component_name ? String(args.component_name) : '';

  return _resolveSelectedComponent({
    componentId: args && args.component_id,
    projectPath: args && args.project_path
  }).then((selectionInfo) => {
    if (selectionInfo && selectionInfo.bridgeError) {
      return {
        content: [{ type: 'text', text: _formatPluginConnectionError(selectionInfo.bridgeError) }],
        isError: true
      };
    }

    const selected = selectionInfo && selectionInfo.component ? selectionInfo.component : null;
    const selectionContext = selectionInfo && selectionInfo.context ? selectionInfo.context : {};
    const componentId = selected && selected.id ? selected.id : '';
    const componentName = fallbackComponentName || (selected && selected.name ? selected.name : '');

    if (selected && fallbackComponentName && selected.name !== fallbackComponentName && selected.type !== 'COMPONENT') {
      return {
        content: [{
          type: 'text',
          text: `Error: Figma selection does not match component_name. Selected ${selected.type} "${selected.name}" on ${selectionContext.fileName || 'current file'} / ${selectionContext.pageName || 'current page'}, but component_name was "${fallbackComponentName}". Select the intended component or omit component_name to document the live selection.`
        }],
        isError: true
      };
    }

    if (!componentName) {
      const where = `${selectionContext.fileName || 'current file'} / ${selectionContext.pageName || 'current page'}`;
      return {
        content: [{ type: 'text', text: `Error: Select a COMPONENT or COMPONENT_SET in Figma on ${where}. Ask the user to select the intended component or component set, then confirm before continuing.` }],
        isError: true
      };
    }

    const description = typeof args.description === 'string' ? args.description.trim() : '';
    const usageDo = Array.isArray(args.usage_do) ? args.usage_do.map((s) => String(s).trim()).filter(Boolean) : [];
    const usageDont = Array.isArray(args.usage_dont) ? args.usage_dont.map((s) => String(s).trim()).filter(Boolean) : [];
    const accessibilityNotes = Array.isArray(args.accessibility_notes) ? args.accessibility_notes.map((s) => String(s).trim()).filter(Boolean) : [];

    if (!description) {
      return {
        content: [{ type: 'text', text: 'Error: description is required. The agent must provide a component-specific summary before generating the doc.' }],
        isError: true
      };
    }
    if (usageDo.length < 2) {
      return {
        content: [{ type: 'text', text: 'Error: usage_do must contain at least 2 component-specific rules.' }],
        isError: true
      };
    }
    if (usageDont.length < 2) {
      return {
        content: [{ type: 'text', text: 'Error: usage_dont must contain at least 2 component-specific misuse rules.' }],
        isError: true
      };
    }

    const payload = {
      componentId: componentId,
      componentName: componentName,
      description: description,
      usageDo: usageDo,
      usageDont: usageDont,
      accessibilityNotes: accessibilityNotes,
      variantDescriptions: (args.variant_descriptions && typeof args.variant_descriptions === 'object')
        ? args.variant_descriptions
        : {}
    };
    return requestBridgePost('/request-doc-build', payload, { timeoutMs: 125000 }).then((response) => {
      if (response.statusCode === 200) {
        const parsed = response.data || {};
        const result = parsed.result || parsed;
        if (result.error) {
          return {
            content: [{ type: 'text', text: `Plugin error: ${result.error}` }],
            isError: true
          };
        }
        const nestedComponents = selectionInfo && Array.isArray(selectionInfo.nestedComponents)
          ? selectionInfo.nestedComponents
          : [];
        const markdown = _appendNestedComponentsMarkdown(result.markdown, nestedComponents);
        let writtenMarkdown = null;
        try {
          writtenMarkdown = _writeMarkdownHandoff(result.path, markdown, {
            projectPath: args.project_path
          });
        } catch (writeErr) {
          return {
            content: [{
              type: 'text',
              text: `Error: Spec sheet rendered in Figma, but Figlets could not write the markdown handoff file: ${writeErr.message}`
            }],
            isError: true
          };
        }
        const responsePayload = {
          componentName: result.componentName || componentName,
          path: result.path,
          markdown: markdown,
          componentMeta: result.componentMeta || {},
          bindingsCount: result.bindingsCount || 0,
          bindingWarnings: Array.isArray(result.bindingWarnings) ? result.bindingWarnings : [],
          bindingDiagnostics: result.bindingDiagnostics || {},
          accessibilityNotes: Array.isArray(result.accessibilityNotes) ? result.accessibilityNotes : [],
          anatomyCount: result.anatomyCount || 0,
          writtenPath: writtenMarkdown.absolutePath,
          pathWritten: true,
          selectionContext: result.selectionContext || selectionContext,
          specSheet: result.specSheet || {},
          message: `Spec sheet rendered for ${result.componentName || componentName} on ${(result.selectionContext && result.selectionContext.fileName) || selectionContext.fileName || 'current file'} / ${(result.selectionContext && result.selectionContext.pageName) || selectionContext.pageName || 'current page'}. Markdown handoff written to '${writtenMarkdown.relativePath}'.`
        };
        if (selectionInfo && selectionInfo.nestedComponentSummary) {
          responsePayload.nestedComponents = nestedComponents;
          responsePayload.nestedComponentSummary = selectionInfo.nestedComponentSummary;
          responsePayload.componentMeta = Object.assign({}, responsePayload.componentMeta, {
            nestedComponentCount: nestedComponents.length
          });
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(responsePayload, null, 2)
          }]
        };
      }
      if (response.statusCode === 503) {
        return {
          content: [{ type: 'text', text: `Error: ${formatPluginNotListening('component documentation', response.data || {})}` }],
          isError: true
        };
      }
      if (response.statusCode === 504) {
        return {
          content: [{ type: 'text', text: 'Error: Doc build timed out. The component may be very large or the plugin may have crashed.' }],
          isError: true
        };
      }
      if (response.connectionError) {
        return {
          content: [{ type: 'text', text: `Error: ${formatReceiverConnectionError(response.connectionError)}` }],
          isError: true
        };
      }
      return {
        content: [{ type: 'text', text: `Error: Unexpected status ${response.statusCode}: ${response.raw}` }],
        isError: true
      };
    }).catch((err) => {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true
      };
    });
  });
}

function _resolveSelectedComponent(options) {
  return _requestSelectedComponent(options);
}

function _requestSelectedComponent(options) {
  return requestBridgePost('/request-selection', {
    componentId: options && options.componentId ? String(options.componentId) : ''
  }, {
    timeoutMs: 16000,
    bridgeRetryAttempts: 3
  }).then((response) => {
    if (response.connectionError) return null;
    if (response.statusCode !== 200) {
      const parsed = response.data || {};
      parsed.statusCode = response.statusCode;
      if (response.statusCode === 504 && !parsed.error) {
        parsed.error = 'Selection sync timed out before the component doc could be generated.';
      }
      return { bridgeError: parsed };
    }

    const parsed = response.data || {};
    let selection = [];
    if (parsed && parsed.path && fs.existsSync(parsed.path)) {
      try {
        const selectionData = JSON.parse(fs.readFileSync(parsed.path, 'utf-8'));
        selection = Array.isArray(selectionData.selection) ? selectionData.selection : [];
        parsed.meta = selectionData.meta || parsed.meta || {};
      } catch (e) {
        selection = [];
      }
    }

    const context = {
      fileName: parsed && parsed.meta && parsed.meta.fileName ? String(parsed.meta.fileName) : '',
      pageName: parsed && parsed.meta && parsed.meta.pageName ? String(parsed.meta.pageName) : '',
      pageId: parsed && parsed.meta && parsed.meta.pageId ? String(parsed.meta.pageId) : '',
      usedFallback: !!(parsed && parsed.meta && parsed.meta.usedFallback),
      chosenSource: parsed && parsed.meta && parsed.meta.chosenSource ? String(parsed.meta.chosenSource) : '',
      liveSelectionCount: parsed && parsed.meta && typeof parsed.meta.liveSelectionCount === 'number' ? parsed.meta.liveSelectionCount : 0
    };

    if (!selection.length) {
      return { component: null, context: context };
    }

    let inspection = inspectComponentData({ selection: selection });
    if (Array.isArray(inspection.nestedComponents) && inspection.nestedComponents.length > 0) {
      inspection = inspectComponentData({
        selection: selection,
        componentSpecs: discoverComponentSpecs(options && options.projectPath).specs
      });
    }

    const node = selection[0];
    if (node && (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')) {
      return {
        component: { id: node.id, name: node.name, type: node.type },
        context: context,
        nestedComponents: inspection.nestedComponents || [],
        nestedComponentSummary: inspection.nestedComponentSummary || null
      };
    }

    return { component: null, context: context };
  }).catch(() => null);
}

function _formatPluginConnectionError(parsed) {
  const recentlySeenText = parsed && parsed.pluginRecentlySeen
    ? ' The plugin was seen recently but did not return to listening before the retry window ended.'
    : '';
  const capabilitiesText = parsed && Array.isArray(parsed.pluginCapabilities) && parsed.pluginCapabilities.length
    ? ` Advertised capabilities: ${parsed.pluginCapabilities.join(', ')}.`
    : '';
  const receiverErrorText = parsed && parsed.error
    ? ` Receiver said: ${parsed.error}`
    : '';
  return `Error: Figma plugin is not connected. Open the Figlets Bridge plugin in Figma Desktop, then retry.${bridgeActiveSessionText(parsed)}${recentlySeenText}${capabilitiesText}${receiverErrorText}`;
}

function _resolveMarkdownRoot(projectPath) {
  return projectPath ? path.resolve(projectPath) : process.cwd();
}

function _markdownCell(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, '<br>');
}

function _appendNestedComponentsMarkdown(markdown, nestedComponents) {
  const dependencies = Array.isArray(nestedComponents) ? nestedComponents : [];
  if (dependencies.length === 0) return String(markdown || '');
  const source = String(markdown || '');
  if (/^## Nested Components\s*$/m.test(source)) return source;

  const lines = [
    '## Nested Components',
    '',
    'These component dependencies are referenced rather than expanded so their existing Figlets documentation can be reused without recursive generation.',
    '',
    '| Nested component | Documentation | Relationship |',
    '| --- | --- | --- |'
  ];
  for (const dependency of dependencies) {
    const documentation = dependency.documented && dependency.specPath
      ? '`' + dependency.specPath + '`'
      : (dependency.documentationLabel || 'No standalone Figlets spec');
    const viaNames = Array.isArray(dependency.viaComponentNames) ? dependency.viaComponentNames : [];
    const relationship = dependency.relationship === 'Direct dependency'
      ? (viaNames.length > 0
        ? 'Direct dependency; also nested via ' + viaNames.join(', ')
        : 'Direct dependency')
      : (viaNames.length > 0 ? 'Nested via ' + viaNames.join(', ') : 'Nested dependency');
    lines.push('| ' + [
      _markdownCell(dependency.componentName),
      _markdownCell(documentation),
      _markdownCell(relationship)
    ].join(' | ') + ' |');
  }
  lines.push('', '---', '');
  const section = lines.join('\n');
  const usageMarker = '## Usage Rules';
  const usageIndex = source.indexOf(usageMarker);
  if (usageIndex >= 0) return source.slice(0, usageIndex) + section + source.slice(usageIndex);
  return source.replace(/\s*$/, '\n\n---\n\n') + section.replace(/\n---\n\s*$/, '\n');
}

function _writeMarkdownHandoff(relativePath, markdown, options) {
  const rel = typeof relativePath === 'string' && relativePath.trim()
    ? relativePath.trim()
    : 'component-specs/component.md';
  if (path.isAbsolute(rel)) {
    throw new Error('Refusing to write an absolute component spec path.');
  }
  const normalized = path.normalize(rel);
  if (
    normalized === '..' ||
    normalized.indexOf('..' + path.sep) === 0 ||
    normalized.split(path.sep).indexOf('..') !== -1
  ) {
    throw new Error('Refusing to write a component spec path outside the project directory.');
  }
  const root = _resolveMarkdownRoot(options && options.projectPath);
  const absolutePath = path.resolve(root, normalized);
  const relativeFromRoot = path.relative(root, absolutePath);
  if (relativeFromRoot.indexOf('..') === 0 || path.isAbsolute(relativeFromRoot)) {
    throw new Error('Refusing to write a component spec path outside the project directory.');
  }
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, String(markdown || ''), 'utf8');
  return {
    relativePath: normalized,
    absolutePath: absolutePath
  };
}

module.exports = {
  generateComponentDocTool,
  handleGenerateComponentDoc,
  _appendNestedComponentsMarkdown,
  _writeMarkdownHandoff
};

'use strict';

/**
 * generate-component-doc.js
 * MCP tool handler for generate_component_doc.
 *
 * Sends the component name + optional usage rules and variant descriptions to
 * the bridge plugin via /request-doc-build. The plugin renders a spec sheet
 * inside Figma, writes a [SPEC] block to the component description, and
 * returns the markdown body for component-specs/[Name].md so the agent can
 * write it via the Write tool.
 */

const http = require('http');

const generateComponentDocTool = {
  name: 'generate_component_doc',
  description:
    'Generate a complete component spec sheet inside Figma (Documentation section) AND return the markdown body for component-specs/[Name].md. The spec sheet includes preview, variant showcase, properties table, sizing, anatomy diagram with badges, and Do/Don\'t usage panels. Also writes a [SPEC] machine-readable block to the component\'s Figma description for MCP handover. Requires the Figlets Bridge plugin open in Figma Desktop, with the target component on the current page.',
  inputSchema: {
    type: 'object',
    properties: {
      component_name: {
        type: 'string',
        description: 'Name of the COMPONENT or COMPONENT_SET to document. Must exist on the current Figma page.'
      },
      description: {
        type: 'string',
        description: 'Human-readable description shown under the component title on the spec sheet. 1-2 sentences: what the component is and when to use it. The agent should generate this after inspecting the component, not pass a placeholder.'
      },
      usage_do: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of Do rules (2-3 short sentences). Falls back to generic defaults when omitted.'
      },
      usage_dont: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of Don\'t rules (2-3 short sentences). Falls back to generic defaults when omitted.'
      },
      variant_descriptions: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional map of exact variant name (e.g. "Type=Primary, Size=Default") to <=10-word purpose. Used in the variant showcase and the markdown handover file.'
      }
    },
    required: ['component_name'],
    additionalProperties: false
  }
};

function handleGenerateComponentDoc(args) {
  const componentName = args && args.component_name ? String(args.component_name) : '';
  if (!componentName) {
    return Promise.resolve({
      content: [{ type: 'text', text: 'Error: component_name is required.' }],
      isError: true
    });
  }

  const payload = {
    componentName: componentName,
    description: typeof args.description === 'string' ? args.description : '',
    usageDo: Array.isArray(args.usage_do) ? args.usage_do : [],
    usageDont: Array.isArray(args.usage_dont) ? args.usage_dont : [],
    variantDescriptions: (args.variant_descriptions && typeof args.variant_descriptions === 'object')
      ? args.variant_descriptions
      : {}
  };

  const receiverUrl = process.env.FIGLETS_RECEIVER_URL || 'http://localhost:1337';
  const body = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = http.request(`${receiverUrl}/request-doc-build`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode === 200) {
          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { parsed = {}; }
          const result = parsed.result || parsed;
          if (result.error) {
            resolve({
              content: [{ type: 'text', text: `Plugin error: ${result.error}` }],
              isError: true
            });
            return;
          }
          resolve({
            content: [{
              type: 'text',
              text: JSON.stringify({
                componentName: result.componentName || componentName,
                path: result.path,
                markdown: result.markdown,
                componentMeta: result.componentMeta || {},
                bindingsCount: result.bindingsCount || 0,
                anatomyCount: result.anatomyCount || 0,
                specSheet: result.specSheet || {},
                message: `Spec sheet rendered. Write the 'markdown' field to '${result.path}' via the Write tool.`
              }, null, 2)
            }]
          });
        } else if (res.statusCode === 503) {
          resolve({
            content: [{ type: 'text', text: 'Error: Figma plugin is not connected. Open the Figlets Bridge plugin in Figma Desktop, then retry.' }],
            isError: true
          });
        } else if (res.statusCode === 504) {
          resolve({
            content: [{ type: 'text', text: 'Error: Doc build timed out. The component may be very large or the plugin may have crashed.' }],
            isError: true
          });
        } else {
          resolve({
            content: [{ type: 'text', text: `Error: Unexpected status ${res.statusCode}: ${data}` }],
            isError: true
          });
        }
      });
    });

    req.setTimeout(125000, () => {
      req.destroy();
      resolve({
        content: [{ type: 'text', text: 'Error: Request to bridge receiver timed out.' }],
        isError: true
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        resolve({
          content: [{ type: 'text', text: 'Error: Bridge receiver is not running. The MCP server should start it automatically — try restarting the MCP server.' }],
          isError: true
        });
      } else {
        resolve({
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true
        });
      }
    });

    req.write(body);
    req.end();
  });
}

module.exports = { generateComponentDocTool, handleGenerateComponentDoc };

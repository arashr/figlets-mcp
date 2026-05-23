'use strict';

const fs = require('fs');
const path = require('path');
const { getConfigPathGuardError } = require('../utils/paths.js');

const designMdIntakeTool = {
  name: 'create_ds_config_from_design_md',
  description: 'Create a starter design-system.config.js from an existing DESIGN.md file. Accepts Google-style YAML front matter or Markdown-only docs with optional linked JSON config. Use as an optional setup intake shortcut when a designer already has DESIGN.md; explicit designer answers can still override the generated config before prepare_ds_config.',
  inputSchema: {
    type: 'object',
    properties: {
      design_md_path: {
        type: 'string',
        description: 'Absolute path to DESIGN.md.'
      },
      config_path: {
        type: 'string',
        description: 'Absolute path where design-system.config.js should be written.'
      },
      linked_config_path: {
        type: 'string',
        description: 'Optional absolute path to a linked JSON config referenced by DESIGN.md (for example theme or gallery config).'
      }
    },
    required: ['design_md_path', 'config_path'],
    additionalProperties: false
  }
};

function _loadDesignMdIntake() {
  try {
    return require("../figlets-core.js").dsConfig.designMdIntake;
  } catch (_) {
    return require("../figlets-core.js").dsConfig.designMdIntake;
  }
}

function handleCreateDsConfigFromDesignMd(args) {
  args = args || {};
  const designPath = path.resolve(args.design_md_path || '');
  const configPath = path.resolve(args.config_path || '');
  const guardError = getConfigPathGuardError(configPath);
  if (guardError) return guardError;

  if (!fs.existsSync(designPath)) {
    return { error: 'DESIGN.md not found: ' + designPath };
  }

  const intake = _loadDesignMdIntake();
  let result;
  try {
    result = intake.readDesignMdAsDsConfig(designPath, {
      linkedConfigPath: args.linked_config_path || null,
      autoLinkedConfig: args.linked_config_path ? false : true
    });
  } catch (err) {
    return {
      error: err.message,
      hint: 'Provide a readable DESIGN.md file. YAML front matter is optional; Markdown-only docs are supported as partial intake.'
    };
  }

  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, 'const DS = ' + JSON.stringify(result.ds, null, 2) + ';\n', 'utf8');

  const intakeMode = result.parsedFromFrontMatter
    ? 'front-matter'
    : (result.mapped && result.mapped.linkedConfigUsed ? 'markdown+linked-config' : 'markdown-only');

  return {
    configPath: configPath,
    sourcePath: designPath,
    intakeMode: intakeMode,
    parsed: result.parsed,
    parsedFromFrontMatter: result.parsedFromFrontMatter,
    parsedFromMarkdown: result.parsedFromMarkdown,
    linkedConfigCandidates: result.linkedConfigCandidates || [],
    mapped: result.mapped,
    needsDesignerInput: result.needsDesignerInput || [],
    warnings: result.warnings || [],
    message: result.parsedFromFrontMatter
      ? 'Starter design-system.config.js created from DESIGN.md front matter. Review any missing answers, then run prepare_ds_config.'
      : 'Starter design-system.config.js created from Markdown-only DESIGN.md intake. Ask only the remaining setup questions listed in needsDesignerInput, then run prepare_ds_config.'
  };
}

module.exports = {
  designMdIntakeTool,
  handleCreateDsConfigFromDesignMd
};

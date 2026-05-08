'use strict';

const fs = require('fs');
const path = require('path');
const { getConfigPathGuardError } = require('../utils/paths.js');

const designMdIntakeTool = {
  name: 'create_ds_config_from_design_md',
  description: 'Create a starter design-system.config.js from an existing Google DESIGN.md file. Use this as an optional setup intake shortcut when a designer already has DESIGN.md; explicit designer answers can still override the generated config before prepare_ds_config.',
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
      }
    },
    required: ['design_md_path', 'config_path'],
    additionalProperties: false
  }
};

function _loadDesignMdIntake() {
  try {
    return require('@figlets/core').dsConfig.designMdIntake;
  } catch (_) {
    return require('../../../figlets-core/src/ds-config/index.js').designMdIntake;
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
    result = intake.readDesignMdAsDsConfig(designPath);
  } catch (err) {
    return {
      error: err.message,
      hint: 'Use a DESIGN.md file with YAML front matter delimited by --- fences.'
    };
  }

  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, 'const DS = ' + JSON.stringify(result.ds, null, 2) + ';\n', 'utf8');

  return {
    configPath: configPath,
    sourcePath: designPath,
    parsed: result.parsed,
    mapped: result.mapped,
    warnings: result.warnings,
    message: 'Starter design-system.config.js created from DESIGN.md. Review any missing answers, then run prepare_ds_config.'
  };
}

module.exports = {
  designMdIntakeTool,
  handleCreateDsConfigFromDesignMd
};

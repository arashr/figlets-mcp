'use strict';

const path = require('path');

function _core() {
  return require('../figlets-core.js').dsConfig;
}

function _blockingFindings(findings) {
  const toleratedRules = new Set(['orphaned-tokens']);
  return findings.filter(finding =>
    finding.severity === 'error'
      || (finding.severity === 'warning' && !toleratedRules.has(finding.rule))
  );
}

async function prepareDesignMdArtifact({ ds, outputPath, renderOptions }) {
  const core = _core();
  const artifacts = core.designMdIntake.buildDesignMdArtifacts(ds, outputPath, renderOptions || {});
  const { lint } = await import('@google/design.md/linter');
  const googleReport = lint(artifacts.markdown);
  const figletsFindings = core.designSystemPolicy.validateDesignSystemPolicy(ds);
  const findings = (googleReport.findings || []).concat(figletsFindings);
  const blockingFindings = _blockingFindings(findings);

  return {
    artifacts,
    ds,
    renderOptions: renderOptions || {},
    lint: {
      standard: '@google/design.md@0.4.0',
      summary: {
        errors: findings.filter(finding => finding.severity === 'error').length,
        warnings: findings.filter(finding => finding.severity === 'warning').length,
        infos: findings.filter(finding => finding.severity === 'info').length,
      },
      googleSummary: googleReport.summary,
      findings,
      blockingFindings,
      passed: blockingFindings.length === 0,
    },
  };
}

function writePreparedDesignMdArtifact(prepared, options) {
  const includeSidecar = !options || options.includeSidecar !== false;
  const outputPath = path.resolve(options && options.outputPath || prepared.artifacts.path);
  const core = _core();
  const artifacts = outputPath === prepared.artifacts.path
    ? prepared.artifacts
    : core.designMdIntake.buildDesignMdArtifacts(prepared.ds, outputPath, prepared.renderOptions);
  core.designMdIntake.writeDesignMdArtifacts(artifacts, { writeSidecar: includeSidecar });
  return {
    path: artifacts.path,
    sidecarPath: includeSidecar ? artifacts.sidecar.path : null,
  };
}

async function prepareAndWriteDesignMdArtifact(args) {
  const prepared = await prepareDesignMdArtifact(args);
  if (!prepared.lint.passed) return Object.assign({ written: false }, prepared);
  const written = writePreparedDesignMdArtifact(prepared, { includeSidecar: args.includeSidecar !== false });
  return Object.assign({ written: true }, prepared, written);
}

module.exports = {
  prepareDesignMdArtifact,
  writePreparedDesignMdArtifact,
  prepareAndWriteDesignMdArtifact,
};

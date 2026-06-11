"use strict";

const {
  LOCAL_DIR,
  getActiveFileKey,
  getActiveFileConfigPath,
} = require("../utils/paths.js");
const { ensureActiveDsConfig } = require("../utils/ensure-ds-config.js");

const MUTATING_TOOLS = new Set([
  "apply_ds_setup",
  "apply_ds_foundation_repairs",
  "apply_ds_setup_repairs",
  "apply_ds_semantic_naming_consolidation",
  "apply_ds_variable_creations",
  "apply_ds_figma_operations",
  "build_ds_showcase",
  "generate_component_doc",
  "qa_binding_audit:fix",
  "update_ds_primitives",
  "update_ds_tokens",
]);

const TOKEN_GAP_APPROVAL_CONTRACT = {
  goalPhraseIsNotApproval: true,
  requiredBeforeWrite:
    "Explicit designer approval after dry-run previews (for example: yes, proceed, or apply).",
  separateWriteBoundaries: [
    "foundation collection or mode creation",
    "primitive token updates",
    "semantic token updates",
  ],
  foundationBoundaryRule:
    "Foundation collection/mode creation must be presented as its own option and approval. If approved, apply only apply_ds_foundation_repairs, then sync and reinspect, then stop before any primitive or semantic token write.",
  routingExamplesThatAreNotApproval: [
    "complete missing config-backed tokens",
    "complete tokens",
    "missing tokens",
    "finish the token system",
  ],
  stopBeforeTools: [
    "apply_ds_foundation_repairs",
    "update_ds_primitives",
    "update_ds_tokens",
  ],
};

const DESIGNER_FLOW_HARD_RULES = {
  reviewMustUseFigletsWorkflow: true,
  bulkDesignSystemUpdatesAreInScope: true,
  appliesTo: [
    "design-system review",
    "design-system check",
    "design-system audit",
    "setup-gap investigation",
    "contrast investigation",
  ],
  requiredSequence: [
    "figlets_start",
    "figlets_route_intent",
    "figlets_workflow_guide",
    "workflow tools named by figlets_workflow_guide",
  ],
  forbiddenUnlessDesignerExplicitlyAsksOutOfBounds: [
    "custom scripts over Figma snapshots",
    "custom scripts over MCP transcripts",
    "custom scripts over Claude/Codex tool-results",
    "reading .local/<fileKey>/figma-data.json to perform designer-facing review",
    "raw Figma APIs or generic Figma tools for Figlets review",
  ],
  supportedBulkUpdateSurfaces: [
    "inspect_ds_setup_gaps.repairPlan.applyInput → apply_ds_setup_repairs for approved setup repairs, alias updates, and missing role creations; preserve each aliases object exactly",
    "inspect_ds_setup_gaps.repairPlan.optionalApplyInput → apply_ds_setup_repairs for separately approved optional convention-level role creation; preserve each aliases object exactly",
    "inspect_ds_setup_gaps.semanticColorGrammar / semanticNamingConflicts + designer's grammar/context decision → plan_ds_semantic_naming_consolidation, then approved repairPlan.applyInput → apply_ds_semantic_naming_consolidation for rename-only compatibility consolidation",
    "inspect_ds_setup_gaps.repairPlan.missingCapabilityNotes for named findings that need designer decisions or future Figlets planner/apply surfaces",
    "inspect_ds_token_gaps.repairPlan.foundationRepairPlan.applyInput → apply_ds_foundation_repairs for approved missing collection shells before token completion",
    "inspect_ds_token_gaps.repairPlan.previewInput / repairPlan.applyInput → update_ds_tokens for config-backed non-color token dry-run preview and narrow approved apply",
    "designer-specified exact variable list → plan_ds_variable_creations, then approved repairPlan.applyInput → apply_ds_variable_creations for creating explicit variables that are not covered by config-backed token completion",
    "designer-specified exact Figma design-system operations → plan_ds_figma_operations, then approved repairPlan.applyInput → apply_ds_figma_operations for variables, collections, modes, local styles, exact node bindings, metadata, and token lifecycle helpers; do not use this generic surface to invent semantic naming migrations from health-check conflicts",
    "update_ds_primitives with categories color, spacing, color-semantics, primitive-typography, and primitive-shadow for config-backed primitive values, primitive typography/shadow tokens, and Color collection semantic alias updates",
    "inspect_ds_token_gaps.repairPlan.primitiveRepairPlan → update_ds_primitives for approved primitive-typography or primitive-shadow create/update in the Primitives collection",
    "qa_binding_audit repairPlan with applyInput { fix: true } for fixableNow binding fixes only after reading byFixability",
  ],
  bulkRepairRouting: [
    "Inspect first. If inspect_ds_setup_gaps.repairPlan.applyInput is non-empty, ask approval and pass that exact object to repairPlan.tool / apply_ds_setup_repairs without inventing payloads.",
    "Never replace setup repair aliases with counts, summaries, booleans, or prose-derived values. aliases must remain the per-mode object from repairPlan.applyInput.",
    "If only a subset of setup repairs is approved, filter entries from repairPlan.applyInput while preserving each approved entry's aliases object unchanged.",
    "If schema validation rejects a setup repair payload, stop, rerun inspect_ds_setup_gaps, and copy or filter the fresh structured repairPlan.applyInput instead of retrying invented arguments.",
    "If repairPlan.optionalApplyInput is non-empty, present it as optional bulk creation that needs separate approval.",
    "If inspect_ds_setup_gaps reports semanticNamingConflicts or semanticNamingAdvisories, report the inferred semanticColorGrammar first. Do not ask for a binary surface-based/role-based choice by default. Ask for a grammar/context decision only when the designer wants naming cleanup, then call plan_ds_semantic_naming_consolidation; show every proposed rename line and every advisory; only after approval pass repairPlan.applyInput unchanged to apply_ds_semantic_naming_consolidation.",
    "For health-check, run inspect_ds_token_gaps as a read-only suggestion step before summarizing the design-system audit. Surface token-gap findings by category, including missing foundation collection/mode suggestions, without forcing the designer into a separate token-gap workflow.",
    "When health-check finds both semantic setup repairs and token-gap suggestions, the next-step prompt must offer both boundaries. Do not make semantic color repair or naming consolidation the only clean next step if inspect_ds_token_gaps found foundation modes, primitive gaps, or semantic token repairs.",
    "End health-check repair summaries with a numbered repair choice menu: one numbered option per available repair category, then a numbered all option, then a numbered specific/other option where the designer can name exact fixes. Category choices must use designer goal language such as fix, review, plan, add, or create; do not use implementation terms like dry-run in the menu label. If a selected category needs a dry-run preview before writing, say the designer will review the proposed changes and be asked for confirmation before anything changes. Category choices must preserve separate write boundaries; all must state exactly which ready safe categories it includes and which optional, designer-decision, or separate-boundary items it excludes.",
    "If a designer asks to review token repairs from health-check, use inspect_ds_token_gaps.repairPlan.reviewOptions as a submenu and run only the selected preview option. Do not run repairPlan.previewInput plus primitiveRepairPlan.previewInput as one combined token preview. Token review options must stay separated: foundation modes, primitive typography, exact semantic spacing aliases, radius/border tokens, typography variables/styles, and full semantic spacing token completion when present.",
    "For config-backed missing typography, spacing, radius, border-width, or elevation tokens, use inspect_ds_token_gaps and dry-run previews. Present foundation collection/mode creation, primitive updates, and semantic token updates as separate options with separate approvals. If foundationRepairPlan applies and is approved, call only apply_ds_foundation_repairs, then sync and reinspect, then stop before primitive or semantic token writes. Never ask for one approval that covers foundation repair and token apply.",
    "If the designer asks to add an exact set of variables that is not covered by config-backed token completion, call plan_ds_variable_creations with the exact names, collections, types, and mode values/aliases. Show the dry-run proposedChanges and blocked entries, then after approval pass repairPlan.applyInput unchanged to apply_ds_variable_creations. If collection, type, mode, value, or alias details are missing, ask for those details instead of inventing them.",
    "If the designer asks to make, update, rename, or delete exact variables, variable values, collections, collection modes, local text/effect styles, exact node bindings, variable metadata, collection metadata, or token lifecycle operations outside a narrower Figlets repair flow, call plan_ds_figma_operations. Show all proposedChanges and warnings, especially destructive delete/replace/move operations, and after approval pass repairPlan.applyInput unchanged to apply_ds_figma_operations. If exact names, values, collections, modes, aliases, style names/properties, node IDs, binding properties, or lifecycle targets are missing, ask for those details instead of claiming Figlets cannot do it.",
    "For exact semantic spacing alias repairs, copy inspect_ds_token_gaps.repairPlan.applyInput.spacing_semantic_repairs unchanged into update_ds_tokens. Preserve each repair's updates array with modeName/modeId and toAliasName/toAliasId. Do not replace the exact entries with token names, counts, summary rows, or a broad spacing-semantics category. If update_ds_tokens rejects the exact payload, stop, rerun inspect_ds_token_gaps, and copy/filter the fresh spacing_semantic_repairs entries; do not redirect a Mobile-only approval into foundation mode creation.",
    "After any write inside health-check, rerun the full read-only health-check verification sequence before reporting clean or remaining findings: sync_figma_data, detect_design_system, audit_tokens, inspect_ds_setup_gaps, and inspect_ds_token_gaps. Do not summarize remaining setup, contrast, naming, or token-gap findings from the apply result or from a narrow token-only reinspection. Reconcile remaining items against the fresh results: if detect_design_system or inspect_ds_token_gaps no longer reports missing foundation modes, do not repeat a stale missing Tablet/Desktop modes item; if audit_tokens and inspect_ds_token_gaps report spacing aliases clear, say that boundary is cleared. Refer to the applied repair by its named boundary or token list, not by a drifting menu number such as 'option 5'.",
    "For raw unbound values on designed layers, use qa_binding_audit read-only first; use repairPlan.counts.fixableNow and byFixability; call qa_binding_audit({ fix: true }) only for fixableNow after approval.",
    "Do not create tokens from qa_binding_audit findings unless a Figlets token-completion planner provides the payload.",
    "If no specialized Figlets repair payload exists, first check whether the request is an exact designer-specified variable, collection, mode, style, binding, metadata, or lifecycle edit that plan_ds_figma_operations can represent. Do not convert product-specific health-check findings into invented generic operations. Only product-specific planning/decision gaps should be reported as Figlets product/tool gaps.",
  ],
  setupRepairPayloadHandoff: {
    source: "inspect_ds_setup_gaps.repairPlan.applyInput",
    target: "repairPlan.tool / apply_ds_setup_repairs",
    preserveAliases: true,
    subsetRule: "Filter approved entries only; do not rewrite aliases.",
    invalidPayloadRecovery: "Stop, rerun inspect_ds_setup_gaps, then copy or filter the fresh repairPlan.applyInput.",
    forbiddenAliasSubstitutes: ["counts", "summaries", "booleans", "prose-derived values"],
  },
  spacingSemanticRepairPayloadHandoff: {
    source: "inspect_ds_token_gaps.repairPlan.applyInput.spacing_semantic_repairs",
    target: "update_ds_tokens.spacing_semantic_repairs",
    preserveUpdates: true,
    subsetRule: "Filter approved repair entries or approved mode updates only; do not rewrite updates.",
    invalidPayloadRecovery: "Stop, rerun inspect_ds_token_gaps, then copy or filter the fresh spacing_semantic_repairs entries.",
    forbiddenSubstitutes: ["token names only", "counts", "summary rows", "broad spacing-semantics category"],
    mobileOnlyRule: "A Mobile-only semantic spacing alias approval must not be redirected into Tablet/Desktop foundation mode creation.",
  },
  designerPresentationRule:
    "When inspect_ds_setup_gaps returns repairPlan.designerPresentation, use that as the designer-facing summary shape. Before approval, show every ready-to-apply entry from designerPresentation.proposedChanges or the What will change section (token, action, mode aliases, reason) — not only a count. Keep optional and needs-designer-decision tiers separate. For inspect_ds_token_gaps in health-check, summarize token gaps by category and call out foundation mode suggestions such as missing Tablet/Desktop modes; show exact token/mode repair rows only when asking approval for that token-gap boundary. The final next-step prompt should include available token-gap boundaries alongside semantic setup and naming choices, formatted as a numbered repair choice menu with goal-language category options, an all-ready-safe-repairs option that names included/excluded categories, and a specific/other option. Menu labels should say what the designer is trying to accomplish, not tool mechanics like dry-run. Do not present raw verification tables, JSON key audits, or pass/fail checklists unless the designer explicitly asks for implementation details.",
  missingCapabilityResponse: "If the Figlets workflow output does not expose the needed specialized planner or apply payload, route exact designer-specified high-level Figma edits through plan_ds_figma_operations when possible. Do not translate health-check findings into invented generic operations. For remaining product-specific planning or designer-decision gaps, say this is proposed Figlets planner scope instead of inventing a script or saying the gaps cannot be fixed.",
  neverLeaveDesignerModeForImplementation: {
    stopImmediatelyWhenYouWould: [
      "edit figlets-mcp, figma-bridge-plugin, or package source files",
      "patch the MCP server or bridge as a workaround for a missing Figlets tool",
      "run npm test, git commits, or repo inspection to fix a designer spacing/token request",
      "switch to Developer Mode without the designer explicitly asking for repo work",
    ],
    requiredResponse:
      "Stop and tell the designer the exact high-level operation needs the Figlets operations planner or the product-specific planner is not exposed yet. Stay in Designer Mode. Do not edit the repository unless the designer explicitly pivots to a developer task.",
    designerShouldNotNeedToSay: [
      "do not edit figlet",
      "do not edit the repo",
      "stay in designer mode",
    ],
  },
};

const NEW_DS_SETUP_INTAKE_CONTRACT = {
  treatPromptAs: "initial direction, not a complete design-system spec",
  requireQuestionsBefore: ["prepare_ds_config", "apply_ds_setup"],
  firstResponseRule:
    "For broad setup prompts, lead with targeted intake questions. Do not open with a synthesized design-system proposal, palette, or token plan.",
  doNotInvent: [
    "brand color hex values",
    "color family names or counts",
    "background/foreground pairing choices",
    "typography scale or preset",
    "spacing, grid, radius, or breakpoint defaults",
    "contrast standard choice",
    "light/dark mode behavior",
  ],
  doNotDraftBeforeIntake: [
    "concrete color pairs or palettes",
    "hex-like values or swatch lists",
    "typography stacks or type scale choices",
    "grid, breakpoint, spacing, or radius defaults",
    "final-looking token or variable names",
    "a full setup proposal presented for approval",
  ],
  requiredTopics: [
    "project name",
    "platform",
    "grid base (4px/8px)",
    "breakpoints (3-tier/4-tier)",
    "semantic color naming grammar (paired context / element-first / intent and emphasis / component-scoped / custom)",
    "contrast standard (APCA default / WCAG 2.2)",
    "color scale and brand colors (name + hex)",
    "color families and background/foreground pairing intent",
    "typeface and typography preset",
    "light/dark behavior",
  ],
  suggestionRule:
    "You may ask multiple-choice questions or offer lightweight answer options, but label them as choices to pick from. Do not draft a full proposal before intake unless the designer explicitly asks for suggestions or has already answered the relevant intake topics.",
  proposalRule:
    "Do not draft a full proposal before intake. Ask questions before suggesting concrete token values unless the designer explicitly asks for suggestions.",
};

const WORKFLOWS = [
  {
    id: "start",
    title: "Start / Help",
    summary: "Introduce Figlets, explain the safety contract, and route the designer to a workflow.",
    intents: ["what can you do", "help me", "new to figlets", "start", "menu"],
    prerequisites: ["Figma Desktop is open for live workflows", "Figlets Bridge plugin is open for live workflows"],
    steps: [
      {
        id: "introduce",
        kind: "read",
        designerMessage: "I can help set up, check, repair, document, and export your Figma design system.",
      },
      {
        id: "explain-safety",
        kind: "read",
        designerMessage: "I'll inspect first, explain in plain language, and only change Figma after you approve the exact fix.",
      },
      {
        id: "ask-intent",
        kind: "confirmation",
        designerMessage: "What are you trying to do today?",
      },
    ],
    next: ["health-check", "new-ds-setup", "build-showcase", "component-docs", "export-design-md"],
    errors: [],
  },
  {
    id: "health-check",
    title: "Full Design System Health Check",
    summary: "Sync the current Figma file, detect design-system capabilities, audit token health, and surface semantic setup plus token-gap suggestions.",
    intents: [
      "check my design system",
      "health check",
      "what is in this file",
      "is my ds healthy",
      "review my design system",
      "review design system",
      "design system review",
      "audit tokens",
      "fix semantic colors",
      "fix contrast",
      "find missing color roles",
      "setup gaps",
      "repair color setup",
      "missing foreground",
    ],
    prerequisites: ["Figma Desktop is open", "Figlets Bridge plugin is open"],
    steps: [
      {
        id: "sync",
        kind: "read",
        tool: "sync_figma_data",
        designerMessage: "I'll pull a fresh read-only snapshot from Figma.",
      },
      {
        id: "detect",
        kind: "read",
        tool: "detect_design_system",
        designerMessage: "I'll check what design-system pieces this file exposes.",
      },
      {
        id: "audit",
        kind: "read",
        tool: "audit_tokens",
        designerMessage: "I'll look for token health issues and summarize the highest-impact ones.",
      },
      {
        id: "semantic-setup-qa",
        kind: "read",
        tool: "inspect_ds_setup_gaps",
        designerMessage: "I'll check semantic setup gaps, icon contrast, and missing neighboring roles before calling the system healthy.",
      },
      {
        id: "token-gap-suggestions",
        kind: "read",
        tool: "inspect_ds_token_gaps",
        designerMessage: "I'll also inspect config-backed token gaps, including missing foundation collections or modes, and summarize them by category without changing Figma.",
      },
      {
        id: "approve-repairs",
        kind: "confirmation",
        designerMessage: "If the QA found setup gaps or token-gap suggestions, I'll keep semantic setup repairs separate from token-gap foundation, primitive, and semantic-token options. Setup repairs list each exact proposed change from repairPlan.designerPresentation; token gaps are summarized by category until you ask to preview or approve that boundary. When I ask what to do next, I will include every available boundary instead of naming only semantic color or naming choices, ending with a numbered all option that says exactly what it includes/excludes and a numbered specific/other option for exact fixes.",
      },
      {
        id: "apply-approved-repairs",
        kind: "write",
        tool: "apply_ds_setup_repairs",
        requiresApproval: true,
        designerMessage: "I'll pass the exact approved repairPlan.applyInput object to apply_ds_setup_repairs, filtering entries only if you approved a subset and preserving each aliases object unchanged.",
      },
      {
        id: "plan-naming-consolidation",
        kind: "read",
        tool: "plan_ds_semantic_naming_consolidation",
        designerMessage: "If semantic naming issues remain and you ask to clean them up, I'll use the inferred grammar and your context decision to produce a dry-run consolidation plan with exact variables. I will not ask you to pick a global surface-based/role-based ideology.",
      },
      {
        id: "apply-approved-naming-consolidation",
        kind: "write",
        tool: "apply_ds_semantic_naming_consolidation",
        requiresApproval: true,
        designerMessage: "If you approve the dry-run rename list, I'll pass plan_ds_semantic_naming_consolidation.repairPlan.applyInput unchanged and preserve variable IDs. I will not delete variables.",
      },
      {
        id: "preview-token-repairs",
        kind: "read",
        tool: "update_ds_tokens",
        options: { dry_run: true },
        designerMessage: "If you want to continue with token-gap repairs from the health check, I'll first show inspect_ds_token_gaps.repairPlan.reviewOptions and ask which boundary you want to preview. I will run only the selected preview option, not one combined token preview.",
      },
      {
        id: "preview-token-primitives",
        kind: "read",
        tool: "update_ds_primitives",
        options: { dry_run: true },
        designerMessage: "If primitiveRepairPlan is present, I'll dry-run primitive typography or shadow updates before asking for primitive-write approval.",
      },
      {
        id: "apply-approved-foundation-repairs",
        kind: "write",
        tool: "apply_ds_foundation_repairs",
        requiresApproval: true,
        designerMessage: "If you approve token-gap foundation repair, I'll apply only inspect_ds_token_gaps.repairPlan.foundationRepairPlan.applyInput, then sync and reinspect, then stop before primitive or semantic token writes.",
      },
      {
        id: "apply-approved-token-primitives",
        kind: "write",
        tool: "update_ds_primitives",
        requiresApproval: true,
        designerMessage: "If you separately approve primitive token repair, I'll apply only inspect_ds_token_gaps.repairPlan.primitiveRepairPlan.applyInput through update_ds_primitives.",
      },
      {
        id: "apply-approved-token-repairs",
        kind: "write",
        tool: "update_ds_tokens",
        requiresApproval: true,
        designerMessage: "If you separately approve semantic token repair, I'll apply only inspect_ds_token_gaps.repairPlan.applyInput through update_ds_tokens. Exact spacing_semantic_repairs cover only listed token/mode rows and must not create missing breakpoint modes.",
      },
      {
        id: "verify-health-check",
        kind: "read",
        tools: ["sync_figma_data", "detect_design_system", "audit_tokens", "inspect_ds_setup_gaps", "inspect_ds_token_gaps"],
        designerMessage: "After approved repairs, I'll rerun the same read-only health-check sequence as the initial check: sync_figma_data, detect_design_system, audit_tokens, inspect_ds_setup_gaps, then inspect_ds_token_gaps. I'll report semantic naming conflicts separately from token hygiene, token-gap suggestions, contrast failures, apply-ready repairs, and optional advisories, and I will not call the file clean unless the full follow-up health check is clean. Remaining items must come from the fresh verification results only; I will drop stale pre-apply items that are no longer reported, such as missing Tablet/Desktop modes after detect_design_system shows those modes exist.",
      },
    ],
    next: ["token-gap-completion", "build-showcase", "component-docs", "export-design-md", "qa-binding-audit"],
    errors: ["If the bridge is unavailable, ask the designer to open the Figlets Bridge plugin in Figma Desktop."],
  },
  {
    id: "token-gap-completion",
    title: "Config-Backed Token Completion",
    summary: "Plan and apply missing config-backed typography, spacing, radius, border-width, and elevation tokens using inspect_ds_token_gaps and approved update_ds_tokens payloads.",
    intents: [
      "missing tokens",
      "complete tokens",
      "token completion",
      "typography gaps",
      "spacing tokens",
      "radius tokens",
      "elevation tokens",
      "border width tokens",
      "add missing variables",
      "finish the token system",
    ],
    prerequisites: ["design-system.config.js exists for the active Figma file", "Figlets Bridge plugin is open"],
    approvalContract: TOKEN_GAP_APPROVAL_CONTRACT,
    steps: [
      {
        id: "sync",
        kind: "read",
        tool: "sync_figma_data",
        designerMessage: "I'll sync the current Figma file before planning token completion.",
      },
      {
        id: "inspect-gaps",
        kind: "read",
        tool: "inspect_ds_token_gaps",
        designerMessage: "I'll read config-backed token gaps and return preview/apply payloads without changing Figma.",
      },
      {
        id: "preview-apply",
        kind: "read",
        tool: "update_ds_tokens",
        options: { dry_run: true },
        designerMessage: "I'll show repairPlan.reviewOptions and dry-run only the selected semantic token boundary so you can review what would change.",
      },
      {
        id: "preview-primitives",
        kind: "read",
        tool: "update_ds_primitives",
        options: { dry_run: true },
        designerMessage: "If primitiveRepairPlan is present, I'll dry-run primitive typography/shadow updates before asking for approval.",
      },
      {
        id: "approve-token-plan",
        kind: "confirmation",
        designerMessage: "I'll summarize foundation collection/mode creation, primitive updates, and semantic token updates as separate options with separate approvals. A goal phrase like 'complete missing tokens' is not permission to write, and one approval must not cover both foundation repair and token apply.",
      },
      {
        id: "apply-foundation",
        kind: "write",
        tool: "apply_ds_foundation_repairs",
        requiresApproval: true,
        designerMessage: "If you approve foundation collection or mode creation, I'll apply only repairPlan.foundationRepairPlan.applyInput, then sync and reinspect, then stop before any primitive or semantic token write.",
      },
      {
        id: "apply-primitives",
        kind: "write",
        tool: "update_ds_primitives",
        requiresApproval: true,
        designerMessage: "After you approve, I'll apply only repairPlan.primitiveRepairPlan.applyInput through update_ds_primitives.",
      },
      {
        id: "apply-tokens",
        kind: "write",
        tool: "update_ds_tokens",
        requiresApproval: true,
        designerMessage: "After a separate token-update approval, I'll apply only the approved repairPlan.applyInput categories through update_ds_tokens. If spacing_semantic_repairs is present, that approval covers only the listed token/mode repairs and must not create missing breakpoint modes.",
      },
      {
        id: "verify",
        kind: "read",
        tool: "inspect_ds_token_gaps",
        designerMessage: "I'll re-check token gaps after the approved changes.",
      },
    ],
    next: ["health-check", "build-showcase", "qa-binding-audit"],
    errors: ["If broad typography or elevation apply is requested, explain the approved narrow categories from repairPlan.applyInput instead of inventing a broad apply."],
  },
  {
    id: "setup-gap-qa",
    title: "Setup Gap QA + Approved Repair",
    summary: "Legacy alias for the repair portion of Full Design System Health Check. Prefer health-check for designer-facing QA.",
    designerVisible: false,
    intents: ["legacy setup gap qa", "legacy setup repair flow"],
    prerequisites: ["Figma Desktop is open", "Figlets Bridge plugin is open"],
    steps: [
      {
        id: "sync",
        kind: "read",
        tool: "sync_figma_data",
        designerMessage: "I'll pull a fresh read-only snapshot from Figma.",
      },
      {
        id: "refresh-preview",
        kind: "read",
        tool: "refresh_ds_config_from_figma",
        options: { dry_run: true },
        designerMessage: "I'll preview whether the local config differs from Figma without writing anything.",
      },
      {
        id: "inspect",
        kind: "read",
        tool: "inspect_ds_setup_gaps",
        designerMessage: "I'll summarize setup gaps in plain language.",
      },
      {
        id: "approve-repairs",
        kind: "confirmation",
        designerMessage: "Which repairPlan.applyInput entries do you want me to apply?",
      },
      {
        id: "apply-repairs",
        kind: "write",
        tool: "apply_ds_setup_repairs",
        requiresApproval: true,
        designerMessage: "I'll apply only the approved structured repairPlan.applyInput entries and preserve aliases unchanged.",
      },
      {
        id: "plan-naming-consolidation",
        kind: "read",
        tool: "plan_ds_semantic_naming_consolidation",
        designerMessage: "If semantic naming review items remain and you ask to clean them up, I'll use the inferred grammar and your context decision to dry-run the exact safe rename plan.",
      },
      {
        id: "apply-approved-naming-consolidation",
        kind: "write",
        tool: "apply_ds_semantic_naming_consolidation",
        requiresApproval: true,
        designerMessage: "I'll apply only the approved renameVariables payload from the dry-run plan and never delete variables.",
      },
      {
        id: "verify",
        kind: "read",
        tool: "inspect_ds_setup_gaps",
        designerMessage: "I'll re-check the semantic setup after the approved changes and report semantic naming conflicts separately from any remaining contrast failures, apply-ready repairs, optional advisories, or token-completion follow-ups. I will not call the file clean unless the follow-up QA is actually clean.",
      },
    ],
    next: ["health-check", "build-showcase", "export-design-md"],
    errors: [
      "If a suggested repair is ambiguous, ask the designer instead of applying it from confidence alone.",
      "If apply_ds_setup_repairs schema validation rejects a setup repair payload, stop, rerun inspect_ds_setup_gaps, and copy or filter the fresh repairPlan.applyInput instead of retrying invented arguments.",
    ],
  },
  {
    id: "new-ds-setup",
    title: "New Design System Setup",
    summary: "Collect designer choices, prepare a config, preview generated tokens, then build collections only after approval.",
    intents: [
      "set up a design system",
      "set up a new design system",
      "create variables",
      "bootstrap tokens",
      "build variables",
      "new design system",
      "setup a new design system",
    ],
    prerequisites: ["Designer intake answers are collected before config preparation", "Figma Desktop is open before the build step", "Figlets Bridge plugin is open before the build step"],
    intakeContract: NEW_DS_SETUP_INTAKE_CONTRACT,
    steps: [
      {
        id: "optional-design-md-intake",
        kind: "read",
        tool: "create_ds_config_from_design_md",
        optional: true,
        designerMessage: "If you have a DESIGN.md file, just drop it in and I will ask the remaining questions. If you don't, no worries.",
      },
      {
        id: "collect-answers",
        kind: "confirmation",
        requiredBeforeTool: "prepare_ds_config",
        designerMessage: "I'll ask targeted setup questions first. I won't draft color palettes, typography stacks, grid defaults, or token names before you answer.",
        intakeTopics: NEW_DS_SETUP_INTAKE_CONTRACT.requiredTopics,
      },
      {
        id: "prepare",
        kind: "read",
        tool: "prepare_ds_config",
        requiresIntake: true,
        designerMessage: "I'll compute and preview the token plan before touching Figma.",
      },
      {
        id: "approve-build",
        kind: "confirmation",
        designerMessage: "Does the preview look right, and are you ready to build it in Figma?",
      },
      {
        id: "apply",
        kind: "write",
        tool: "apply_ds_setup",
        requiresApproval: true,
        designerMessage: "I'll create the approved variable collections in Figma.",
      },
    ],
    next: ["build-showcase", "health-check", "export-design-md"],
    errors: [
      "If the designer prompt is evocative but incomplete, treat it as direction and run intake before prepare_ds_config.",
      "Do not invent missing brand colors, typography, spacing, contrast, or light/dark choices and ask for build confirmation.",
      "Do not draft a full setup proposal, palette, or token plan before intake. Ask questions first; only offer lightweight multiple-choice options unless the designer asks for suggestions.",
      "If prepare_ds_config reports contrast failures, fix or confirm the config before running apply_ds_setup.",
    ],
  },
  {
    id: "build-showcase",
    title: "Build Token Showcase",
    summary: "Render the design-system showcase in Figma using deterministic bridge logic.",
    intents: ["build showcase", "show my tokens", "token page", "visual overview", "create a showcase"],
    prerequisites: ["Figma Desktop is open", "Figlets Bridge plugin is open"],
    steps: [
      {
        id: "sync",
        kind: "read",
        tool: "sync_figma_data",
        designerMessage: "I'll check what this file exposes before building the showcase.",
      },
      {
        id: "approve-showcase",
        kind: "confirmation",
        designerMessage: "This will write showcase frames to the token page. Ready?",
      },
      {
        id: "build",
        kind: "write",
        tool: "build_ds_showcase",
        requiresApproval: true,
        designerMessage: "I'll build the visual token showcase in Figma.",
      },
    ],
    next: ["health-check", "export-design-md"],
    errors: ["If numeric chrome bindings are missing, only use fallback options after the designer explicitly opts in."],
  },
  {
    id: "component-docs",
    title: "Component Documentation",
    summary: "Inspect a selected component, craft human usage guidance, and generate a Figma spec sheet plus markdown handoff.",
    intents: ["document component", "spec sheet", "component docs", "document this button", "generate docs"],
    prerequisites: ["Target component is selected in Figma", "Figlets Bridge plugin is open"],
    steps: [
      {
        id: "select-component",
        kind: "confirmation",
        designerMessage: "Select the component in Figma, then tell me when you're ready.",
      },
      {
        id: "inspect",
        kind: "read",
        tool: "inspect_component",
        designerMessage: "I'll inspect the selected component before writing guidance.",
      },
      {
        id: "draft-copy",
        kind: "read",
        designerMessage: "I'll draft component-specific description, usage rules, and variant descriptions.",
      },
      {
        id: "approve-doc",
        kind: "confirmation",
        designerMessage: "Ready for me to render the spec sheet and markdown handoff?",
      },
      {
        id: "generate",
        kind: "write",
        tool: "generate_component_doc",
        requiresApproval: true,
        designerMessage: "I'll render the spec sheet in Figma and return the markdown handoff.",
      },
    ],
    next: ["qa-binding-audit", "export-design-md", "component-docs"],
    errors: ["If the component has generic layer names or missing properties, ask whether the designer wants to fix those first."],
  },
  {
    id: "qa-binding-audit",
    title: "QA Binding Audit",
    summary: "Inspect selected layers for raw values and apply safe binding fixes only after approval.",
    intents: ["binding audit", "raw values", "fix bindings", "check this frame", "unbound values"],
    prerequisites: ["Target frame/component is selected in Figma", "Figlets Bridge plugin is open"],
    steps: [
      {
        id: "select-scope",
        kind: "confirmation",
        designerMessage: "Select the frame or component to audit, or confirm that the current page is the intended scope.",
      },
      {
        id: "audit",
        kind: "read",
        tool: "qa_binding_audit",
        options: { fix: false },
        designerMessage: "I'll report raw or unbound values with fixability (fixableNow, needsExistingToken, needsDesignerDecision) and repairPlan counts.",
      },
      {
        id: "approve-fixes",
        kind: "confirmation",
        designerMessage: "I'll explain which violations are fixableNow, which need new tokens first, and which need your design decision before any binding apply.",
      },
      {
        id: "fix",
        kind: "write",
        tool: "qa_binding_audit:fix",
        options: { fix: true },
        requiresApproval: true,
        designerMessage: "I'll call qa_binding_audit({ fix: true }) to apply only fixableNow bindings from repairPlan.",
      },
    ],
    next: ["component-docs", "health-check", "token-gap-completion"],
    errors: [
      "If byFixability.needsExistingToken is non-zero, route to inspect_ds_token_gaps instead of forcing fix:true.",
      "If there is no suggestion, say the design system lacks a matching variable or style rather than inventing one.",
    ],
  },
  {
    id: "export-design-md",
    title: "Export DESIGN.md",
    summary: "Refresh from Figma and write a portable DESIGN.md handoff artifact.",
    intents: ["export design.md", "handoff file", "give this to a coding agent", "developer handoff", "make design md"],
    prerequisites: ["Figma Desktop is open for fresh export", "Figlets Bridge plugin is open for fresh export"],
    steps: [
      {
        id: "preview",
        kind: "read",
        tool: "export_design_md",
        options: { dry_run: true },
        optional: true,
        designerMessage: "I can preview what would refresh before writing the file.",
      },
      {
        id: "export",
        kind: "write-local",
        tool: "export_design_md",
        designerMessage: "I'll write DESIGN.md to the path returned by the tool.",
      },
    ],
    next: ["component-docs", "health-check"],
    errors: ["If no config exists, point the designer to setup instead of bootstrapping silently."],
  },
];

const WORKFLOW_BY_ID = new Map(WORKFLOWS.map(workflow => [workflow.id, workflow]));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value == null ? "" : value).toLowerCase();
}

const ROUTE_STOPWORDS = new Set(["what", "this", "that", "with", "using", "help", "figlets", "design", "system"]);

function _workflowStartResponse(workflow) {
  if (!workflow || workflow.id === "start") return null;
  if (workflow.id === "new-ds-setup") {
    return [
      "# Figlets",
      "",
      "I'll use the Figlets new design system setup workflow.",
      "",
      "Your prompt gives me direction, not a complete design-system spec yet.",
      "",
      "I'll start by asking targeted setup questions for missing choices, such as:",
      "- how many color families and background/foreground pairings you want",
      "- brand colors (name + hex) once you're ready to provide them",
      "- light/dark behavior",
      "- typography, spacing, grid, breakpoints, and contrast standard",
      "",
      "I won't draft a full palette, typography stack, grid defaults, or token names before you answer.",
      "I may offer lightweight multiple-choice options, but not a proposal to approve.",
      "",
      "After intake I'll preview tokens with prepare_ds_config, show the preview, and only then ask before building in Figma.",
    ].join("\n");
  }
  if (workflow.id === "health-check") {
    return [
      "# Figlets",
      "",
      "I'll review your design system using the Figlets health check.",
      "",
      "I'll start read-only:",
      "1. Sync the current Figma file",
      "2. Detect design-system structure",
      "3. Audit token health",
      "4. Check semantic setup gaps, icon contrast, and missing roles",
      "5. Inspect config-backed token-gap suggestions, including missing collection modes",
      "",
      "I'll summarize semantic setup findings separately from token-gap suggestions. If a write is needed, I'll ask before changing Figma and keep foundation, primitive, and semantic-token approvals separate.",
      "",
      "Please make sure the Figlets Bridge plugin is open in Figma, then I'll begin.",
    ].join("\n");
  }
  if (workflow.id === "token-gap-completion") {
    return [
      "# Figlets",
      "",
      "I'll complete missing config-backed tokens using the Figlets token-gap workflow.",
      "",
      "I'll start read-only:",
      "1. Sync the current Figma file",
      "2. Inspect config-backed token gaps",
      "3. Dry-run semantic token updates",
      "4. Dry-run primitive updates when needed",
      "",
      "I will not change Figma until you explicitly approve after the dry-run plan (for example: yes, proceed, or apply).",
      "Phrases like 'complete missing tokens' route to this workflow; they are not approval to write.",
      "",
      "Please make sure the Figlets Bridge plugin is open in Figma, then I'll begin.",
    ].join("\n");
  }
  const readSteps = (workflow.steps || []).filter(step => step.kind === "read" && step.tool);
  const writeSteps = (workflow.steps || []).filter(step => step.kind === "write" || step.kind === "write-local");
  const lines = [
    "# Figlets",
    "",
    `I'll use the Figlets ${workflow.title.toLowerCase()} workflow.`,
    "",
  ];
  if (readSteps.length) {
    lines.push("I'll start read-only:");
    readSteps.slice(0, 4).forEach((step, index) => {
      lines.push(`${index + 1}. ${step.designerMessage || step.tool}`);
    });
    lines.push("");
  }
  lines.push(writeSteps.length
    ? "If a write is needed, I'll ask before changing Figma."
    : "I'll summarize the result in plain language.");
  return lines.join("\n");
}

function _selectionPrompt(candidates, capabilityMenu) {
  const choices = (candidates && candidates.length ? candidates : capabilityMenu)
    .slice(0, 5)
    .map((item, index) => ({
      id: item.workflowId || item.id,
      label: item.label || item.title,
      description: item.description || item.summary || "",
      index: index + 1,
    }));
  const lines = [
    "# Figlets",
    "",
    "I can help, but this could mean a few different workflows.",
    "",
    "Choose one:",
    "",
  ];
  for (const choice of choices) {
    lines.push(`${choice.index}. **${choice.label}**`);
    if (choice.description) lines.push(`   ${choice.description}`);
    lines.push("");
  }
  lines.push("Reply with the number or name.");
  return {
    type: "single-choice",
    message: lines.join("\n"),
    choices,
  };
}

function routeIntent(intent) {
  const text = normalizeText(intent);
  const candidates = WORKFLOWS
    .filter(workflow => workflow.id !== "start")
    .map(workflow => {
      let score = 0;
      const matchedIntents = [];
      for (const phrase of workflow.intents || []) {
        const normalized = normalizeText(phrase);
        if (!normalized) continue;
        if (text.indexOf(normalized) !== -1) {
          score += normalized.length >= 12 ? 3 : 2;
          matchedIntents.push(phrase);
          continue;
        }
        const words = normalized.split(/\s+/).filter(word => word && !ROUTE_STOPWORDS.has(word));
        if (words.some(word => word.length >= 4 && text.indexOf(word) !== -1)) {
          score += 1;
          matchedIntents.push(phrase);
        }
      }
      return { workflowId: workflow.id, title: workflow.title, score, matchedIntents };
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const best = candidates[0] || {
    workflowId: "start",
    title: "Start / Help",
    score: 0,
    matchedIntents: [],
  };
  const bestWorkflow = getWorkflowGuide(best.workflowId);
  const ambiguous = candidates.length > 1 && candidates[0].score === candidates[1].score;
  const fallbackChoices = [
    {
      label: "Check my design system",
      workflowId: "health-check",
      description: "Review tokens, semantic setup, contrast, and missing roles.",
    },
    {
      label: "Build a token showcase",
      workflowId: "build-showcase",
      description: "Render the visual overview in Figma.",
    },
    {
      label: "Export DESIGN.md",
      workflowId: "export-design-md",
      description: "Create a portable handoff for coding agents.",
    },
  ];
  const selectionPrompt = best.workflowId === "start"
    ? _selectionPrompt([], fallbackChoices)
    : ambiguous
      ? _selectionPrompt(candidates.map(candidate => {
        const workflow = getWorkflowGuide(candidate.workflowId);
        return { id: workflow.id, title: workflow.title, summary: workflow.summary };
      }), fallbackChoices)
      : null;

  return _routeIntentResult(best, candidates, selectionPrompt, bestWorkflow, intent);
}

function _routeIntentResult(best, candidates, selectionPrompt, bestWorkflow, intent) {
  const result = {
    intent: String(intent == null ? "" : intent),
    workflow: bestWorkflow,
    candidates,
    selectionPrompt,
    designerResponse: selectionPrompt ? selectionPrompt.message : _workflowStartResponse(bestWorkflow),
    hardRules: clone(DESIGNER_FLOW_HARD_RULES),
    message: best.workflowId === "start"
      ? "I am not sure which Figlets workflow fits yet. Use selectionPrompt if the host supports choices; otherwise ask with its message."
      : best.workflowId === "new-ds-setup"
        ? `Recommended workflow: ${best.title}. Treat the designer prompt as initial direction, ask intake questions first, do not draft a full proposal or concrete token values before intake, run setup intake before prepare_ds_config, and ask before any Figma write.`
        : `Recommended workflow: ${best.title}. Use Figlets workflow tools/scripts only, start read-only, summarize plainly, and ask before any Figma write.`,
  };
  if (best.workflowId === "new-ds-setup") {
    result.intakeContract = clone(NEW_DS_SETUP_INTAKE_CONTRACT);
  }
  return result;
}

function getWorkflowGuide(workflowId) {
  const workflow = WORKFLOW_BY_ID.get(workflowId || "start") || WORKFLOW_BY_ID.get("start");
  return clone(workflow);
}

function getStartGuide() {
  const activeFileKey = getActiveFileKey();
  const configStatus = activeFileKey
    ? ensureActiveDsConfig({ reason: "figlets-start", refreshGenerated: true })
    : { configPath: null, configExists: false, created: false };
  const configPath = configStatus.configPath || (activeFileKey ? getActiveFileConfigPath() : null);
  const capabilities = WORKFLOWS
    .filter(workflow => workflow.id !== "start" && workflow.designerVisible !== false)
    .map(workflow => ({ id: workflow.id, title: workflow.title, summary: workflow.summary }));
  const capabilityMenu = [
    {
      label: "Check my design system",
      workflowId: "health-check",
      description: "See tokens, styles, semantic setup gaps, contrast issues, and health status.",
    },
    {
      label: "Set up a new design system",
      workflowId: "new-ds-setup",
      description: "Create a token plan from your brand/type choices and build it after approval.",
    },
    {
      label: "Build a token showcase",
      workflowId: "build-showcase",
      description: "Render a visual overview of colors, type, spacing, elevation, and related tokens.",
    },
    {
      label: "Document a component",
      workflowId: "component-docs",
      description: "Inspect a selected component and generate a Figma spec sheet plus markdown handoff.",
    },
    {
      label: "Export DESIGN.md",
      workflowId: "export-design-md",
      description: "Create a portable handoff file for coding agents and downstream tools.",
    },
  ];
  const forbiddenDesignerMenuItems = [
    "Plugin / MCP server code",
    "Edit repo files",
    "Edit the figlets plugin",
    "Edit MCP server code",
    "Create, delete, move, resize, or rename arbitrary Figma nodes",
    "Generic Figma authoring tools",
    "Raw Figma console tools",
  ];
  const designerResponse = [
    "# Figlets",
    "",
    "A focused toolkit for checking, repairing, showcasing, documenting, and exporting Figma design systems.",
    "",
    "| What you can ask for | What I'll do |",
    "|---|---|",
  ].concat(capabilityMenu.map(item => `| ${item.label} | ${item.description} |`)).concat([
    "",
    "I'll inspect first, explain results in plain language, and ask before changing Figma.",
  ]).join("\n");

  return {
    message: "Use designerResponse only for generic help/start requests. If the designer already stated a concrete goal, call figlets_route_intent and figlets_workflow_guide, then use the routed designerResponse instead of showing the menu.",
    responseContract: {
      openingFormat: "capability-menu",
      useVerbatimWhenPossible: "designerResponse for generic help only; routed designerResponse for specific goals",
      doNotAddCapabilitiesOutside: "capabilityMenu",
      doNotOfferMenuItems: "forbiddenDesignerMenuItems",
      designSystemReviewRule: "Use Figlets workflow tools/scripts only. Do not write custom scripts or inspect local snapshots/tool-results unless the designer explicitly asks to go out of bounds.",
      bulkUpdateRule: "Bulk design-system updates are in Figlets scope when they are represented as structured, designer-approved tool payloads. Use repairPlan.applyInput with the named tool; present repairPlan.optionalApplyInput separately. Token gaps use inspect_ds_token_gaps → update_ds_tokens; binding gaps use qa_binding_audit fixableNow only. Exact designer-specified variable, collection, mode, local style, binding, metadata, and token lifecycle edits use plan_ds_figma_operations → apply_ds_figma_operations, with warnings shown before approval. Do not use the generic operations surface to invent semantic naming migrations from health-check conflicts. Only product-specific planning or designer-decision gaps should be reported as future Figlets planner scope.",
      mode: "designer-facing",
      nextAction: "For a concrete initial goal, route it before replying. For ambiguous routing, use selectionPrompt. For generic help, show designerResponse.",
    },
    designerIntro: designerResponse,
    designerResponse,
    capabilityMenu,
    forbiddenDesignerMenuItems,
    safety: [
      "Inspection comes before mutation.",
      "Figma writes require explicit designer approval.",
      "Supported bulk design-system repairs should use structured Figlets payloads, such as repairPlan.applyInput, not agent-authored scripts.",
      "Follow hardRules.bulkRepairRouting when choosing between setup repairs, token completion, primitive updates, and binding QA.",
      "The agent should summarize tool results in plain language instead of dumping JSON.",
      "Design-system reviews, checks, audits, setup-gap investigations, and contrast investigations must use the Figlets workflow and the Figlets MCP tools/scripts named by figlets_workflow_guide.",
      "Do not write custom scripts, inspect local snapshots or tool-results, read MCP transcript files, or use raw Figma APIs for designer-facing Figlets review unless the designer explicitly asks to go out of bounds.",
      "If the request is an exact high-level Figma edit, use the Figlets operations planner. If a product-specific planner is still missing, stop and report that planner scope. Never edit repo, plugin, or MCP server code, and never switch to Developer Mode, unless the designer explicitly asks for implementation work.",
    ],
    hardRules: clone(DESIGNER_FLOW_HARD_RULES),
    scope: {
      figletsDoes: [
        "Design-system setup, QA, repair, showcase, documentation, and DESIGN.md export workflows.",
        "Deterministic checks through Figlets MCP tools and the Figlets Bridge plugin.",
        "Designer-approved Figma writes only through Figlets tools that are part of a workflow guide.",
        "Structured bulk design-system updates when Figlets can plan or receive an explicit approved payload.",
      ],
      figletsDoesNotMean: [
        "Do not advertise generic Figma create, delete, move, resize, or arbitrary edit powers as Figlets capabilities.",
        "Do not offer editing repo files, plugin code, MCP server code, or supporting tooling in the designer-facing menu.",
        "Do not tell the designer you are working through figma-console when the requested product is Figlets.",
        "Do not mix unrelated MCP servers into the Figlets introduction unless the designer asks about them.",
        "Do not list implementation guardrails like OKLab anchoring or raw VariableID handling in the first response.",
      ],
    },
    environment: {
      command: "figlets-mcp",
      localDir: LOCAL_DIR,
      activeFileKnown: Boolean(activeFileKey),
      activeFileKey,
      configPath,
      configExists: Boolean(configStatus.configExists),
      configCreated: Boolean(configStatus.created),
      configRefreshed: Boolean(configStatus.refreshed),
      configMessage: configStatus.message || null,
    },
    capabilities,
    nextQuestion: "What are you trying to do today?",
  };
}

function listWorkflows() {
  return clone(WORKFLOWS.filter(workflow => workflow.designerVisible !== false));
}

module.exports = {
  DESIGNER_FLOW_HARD_RULES,
  MUTATING_TOOLS,
  NEW_DS_SETUP_INTAKE_CONTRACT,
  WORKFLOWS,
  getStartGuide,
  getWorkflowGuide,
  listWorkflows,
  routeIntent,
};

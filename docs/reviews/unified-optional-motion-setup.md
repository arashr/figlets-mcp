# Motion belongs to normal setup

November 7, 2026. User approved integrating selected motion into the existing setup process and reusing shared code.

## Designer flow

Motion remains optional. The include/skip question is part of the main intake, before declaring intake complete or saving the completed config. An already supplied profile or known choice is reused. The same create_ds_config_from_intake call stores motion with the other choices; no separate profile-preview/save/reprepare sequence is appended. Selected motion appears alongside the other foundations in the complete setup preview. One Figma setup approval builds everything selected.

> **Build dummy_ds_4 in Figma?**
>
> Includes primitives, colors, typography, spacing, elevation, and motion.

Skipping motion uses the existing five-foundation path with no motion sync, planning, or writes. Existing profiles are retained rather than replaced with defaults. Reviewing settings alone does not authorize Figma writes.

## Shared implementation

- `apply_ds_setup` orchestrates the approved build. The existing base Bridge execution remains unchanged.
- Extracted the existing config-backed motion planner into a shared pure function. Both standalone edits and normal setup use the same capability, collection, mode, type, and identity checks.
- Reused the existing generic structural apply path and atomic variable batch writer. No public tool or Bridge mutation branch was added.
- Reused the sync request transport. Internal sync does not refresh or rewrite the approved config.
- Added core profile readback verification using the existing easing normalizer and native float precision. Complete setup requires the configured values in Default and Reduced Motion.
- Config changes, file changes, failed modes, rollback, unknown outcomes, and failed readback stop the build with an accurate partial result. No retry loop and no false completion after creating an empty collection.

Standalone motion edits retain their scoped planner/apply workflow. They are not a required continuation of normal setup.

## Verification

144/144 test files pass. Build, lint, plugin package smoke, and whitespace checks pass.

Intake tests prove that missing include/skip returns a question without saving the config, skip adds no motion, explicit/custom profiles are preserved, invalid profiles cannot overwrite the config, and known choices are not asked again. The workflow contract explicitly places the question before config creation and preparation. Partial DESIGN.md imports report a still-missing motion decision.

Integration tests execute the existing Bridge operation handler in an isolated Figma test harness through a simulated receiver. A fresh stdio MCP process first calls intake without motion and verifies no config write, then supplies the motion answer through the normal intake tool, prepares the full preview, and builds all six selected foundations with one setup call. Tests cover omission, creation, repeat setup without duplication, in-place updates preserving IDs, unrelated-token preservation, unsupported capabilities, wrong types, mode failure, atomic rollback, incorrect readback, file changes, and config changes.

Shared test fixtures replace duplicated Bridge and MCP client harness code. Existing atomic and contrast tests continue to pass.

No live Figma writes were performed for this implementation. The existing Bridge build remains 1.3.0+dev.20261106.8. The running agent connection still returned the older motion guide during verification and needs a server refresh before manual use. No new commit, release, or push was performed.

The earlier implementation integrated execution but left motion after preparation. That was incomplete. The intake correction above supersedes that placement. The running connection was checked again and still has the old ordering; refresh it before testing this correction.

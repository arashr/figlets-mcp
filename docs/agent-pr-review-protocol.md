# Agent PR review protocol

Use this protocol when agents implement, review, or merge Figlets PRs.

## Communication channels

| Channel | Purpose |
| --- | --- |
| Linear | Task log: start, checkpoints, blockers, review verdicts, completion, and handoff |
| GitHub PR | Code review truth: scope, diff discussion, checks, manual verification, and merge decision |
| Chat thread | Coordination while work is active |

Linear comments explain what happened on the task. PR comments explain whether the code is ready to merge.

## PR description

Every PR should use `.github/pull_request_template.md` and fill these sections:

- Linear
- Scope
- Not In Scope
- Test Plan
- Manual Verification
- Agent Review
- Merge Notes

Use `not required` rather than deleting a section. For v1.0 blockers and high-risk workflow changes, manual verification and agent review are required.

## Agent review comment

Review agents should post this on the GitHub PR. Also add a shorter Linear task comment with the same verdict and link to the PR.

```md
Agent Review

Verdict: approve / approve with nits / request changes

Scope reviewed:
- 

Must-fix before merge:
- 

Non-blocking improvements:
- 

Test coverage gaps:
- 

Verification:
- `command`: pass/fail/not run + reason

Manual verification:
- Prompt/flow:
- Result:

Host-neutrality / release risk:
- 

Linear updates:
- Commented on BNN-:
```

If the review finds no issues, say that directly under `Must-fix before merge`.

## Merge captain checklist

The merge captain or EM agent gives the merge green light only after:

- PR links the Linear issue.
- PR scope and not-in-scope are filled.
- Test plan is complete or failures are explained.
- Manual verification is complete when the PR changes designer workflow, setup, release packaging, host plugins, or v1.0 blockers.
- At least one agent review comment exists for v1.0 blockers, high-risk workflow changes, release changes, or PRs with broad blast radius.
- `request changes` findings are resolved or explicitly deferred by the human owner.
- Linear has a task comment with the review or merge verdict.

Do not give merge green light while must-fix findings remain open.

## Subagent handoff prompt

```md
Review PR <url>.

Scope: code-review stance. Prioritize bugs, behavioral regressions, missing tests, release risk, and host-neutrality.

Deliver:
- Verdict: approve / approve with nits / request changes
- Must-fix before merge with file/line references
- Non-blocking improvements
- Test coverage gaps
- Verification run or not run
- Manual verification prompts/flows
- Linear comment summary

Do not make code changes. Do not revert unrelated work.
```

## Escalation

Use Linear for durable task history and GitHub for merge truth. If they disagree, the merge captain resolves the discrepancy in a PR comment and links the Linear comment.


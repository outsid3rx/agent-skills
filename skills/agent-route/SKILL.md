---
name: agent-route
description: Recommend a subagent model and reasoning effort from the current runtime's available configurations using a user-selected decision API. Use when planning authorized delegation and comparing executor cost, quality, or speed.
license: MIT
metadata:
  version: "0.1.0"
---

# Agent Route

Choose an adequate executor for each proposed work variant. The bundled CLI calls
a decision model and validates its recommendation; the calling agent makes the
final decision and launches any subagent through its own runtime.

## Establish the available choices

Read the current runtime's model catalog and supported reasoning efforts. Include
only configurations that can actually be selected under the active instructions.
Use documented capabilities, observed performance, and known relative costs;
do not infer capability or price from model names. Mark unknown cost information
as unknown rather than inventing it. If executor configuration cannot be selected,
report that limitation and continue within the runtime's supported workflow.

This skill does not authorize delegation, model overrides, paid API calls, or
additional work. Preserve existing user choices and runtime permissions. Evaluate
proposed variants independently; recommending a variant does not require running it.

## Prepare the routing request

Create a short task summary and one or more work variants with complexity,
uncertainty, expected result, verification, and material constraints. Keep the
request abstract: omit secrets, private file paths, raw logs, and code excerpts.
The task summary, variants, and model descriptions are sent to the configured API.

Use `balanced` unless the user chose `quality`, `speed`, or `cost`. For `balanced`,
prefer the least expensive configuration expected to complete the work reliably;
a stronger model or higher effort is appropriate when its expected quality benefit
justifies the additional cost. This is a qualitative recommendation, not a billing
estimate or budget enforcement mechanism.

Read [references/usage.md](references/usage.md) when configuring the API, constructing
input, or interpreting output. Start from [examples/task.json](examples/task.json),
replacing the fictional catalog with the actual available configurations.

## Configure and run

Reuse the user's existing decision API settings. If missing, ask for the API format,
endpoint, and decision model; do not pick a provider or model on their behalf.
TypeSafe/Jev is an optional example. The decision model and the executor catalog
are separate: an executor's `provider` does not change the decision API.

Resolve the installed skill directory as `SKILL_DIR`; use absolute paths when
invoking its CLI from a task workspace. Node.js 20.3+ and npm are required.
Install the pinned dependency in that directory when needed:

```sh
npm --prefix "$SKILL_DIR" ci --ignore-scripts --no-audit --no-fund
```

Keep task/config files in the task workspace. Store credentials in an environment
variable or macOS Keychain, never in the skill or request JSON. Preview the payload
without reading credentials or calling the API:

```sh
node "$SKILL_DIR/scripts/agent-route.mjs" --input task.json --config config.local.json --dry-run
```

Once the configuration and API use are authorized, run:

```sh
node "$SKILL_DIR/scripts/agent-route.mjs" --input task.json --config config.local.json
```

## Apply the result

- Exit `0`: read each `selected` recommendation, check its model/effort/provider
  against current availability and constraints, and use the runtime's native
  delegation tool if the work and configuration are authorized.
- Exit `3`: output still contains valid JSON. For each `needs_review` variant,
  clarify missing evidence or use an already agreed fallback. Do not automatically
  apply `candidate`; handle independently selected variants only if they remain useful.
- Exit `2`: input, credentials, installation, or API failed. Correct the reported
  issue or use an already agreed fallback; do not fabricate a recommendation.

Confidence is not proof of task success. Chat Completions confidence is the model's
self-assessment; provider-reported values are not necessarily calibrated either.
Report the chosen configuration and relevant uncertainty, then verify the executor's
actual result using the task's acceptance criteria. Do not silently escalate cost
or repeatedly call the router after an unresolved review/failure.

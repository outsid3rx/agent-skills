# Agent Route

An [Agent Skill](https://agentskills.io/specification) that recommends a subagent
model and reasoning effort from the configurations available in your runtime.
A user-selected decision API evaluates proposed work variants for cost, quality,
or speed. Your calling agent checks the recommendation and executes authorized work.

```text
Runtime catalog + task variants
              ↓
    User-selected decision API
              ↓
 Validated model/effort or needs_review
              ↓
    Calling agent's delegation tool
```

## Install

This skill is part of the [outsid3rx/agent-skills](https://github.com/outsid3rx/agent-skills)
collection:

```sh
npx skills add outsid3rx/agent-skills --skill agent-route
```

To inspect a local checkout before installation, run from the repository root:

```sh
npx skills add . --list
```

Requires Node.js 20.3+ and npm. Use a maintained Node release. Install the pinned
SDK dependency from the skill directory (the skills CLI does not do this for you):

```sh
cd /path/to/installed/agent-route
npm ci --ignore-scripts --no-audit --no-fund
```

Environment credentials work across platforms; Keychain credentials require
macOS. The host must expose selectable subagent configurations for recommendations
to be actionable. This package provides neither a launcher nor automatic hooks.

## Use with an agent

Example requests:

> Use agent-route to recommend a model and reasoning effort for the investigation
> and implementation parts of this task. Use my configured decision API and the
> current runtime catalog. Show any variants requiring review.

> Compare adequate executor configurations for this delegated review, prioritizing
> quality. Keep the task summary abstract and use my existing routing settings.

The skill's entry point is [SKILL.md](SKILL.md). Full CLI/config/input/output details
are in [references/usage.md](references/usage.md).

## Preview without an API key

From this directory:

```sh
node scripts/agent-route.mjs --input examples/task.json --config examples/config.json --dry-run
npm test
```

The preview performs no network request and reads no credential. Example models
and costs are fictional. For a real request, replace them with your runtime's
catalog, create a local task file, and configure your chosen decision API:

```sh
cp examples/config.json config.local.json
# Edit apiFormat, baseURL and model; set DECISION_API_KEY through your secret manager.
node scripts/agent-route.mjs --input task.json --config config.local.json
```

Supported formats are OpenAI-compatible Chat Completions, TypeSafe Choice, and a
custom JSON HTTP endpoint. TypeSafe/Jev is an optional example, never a default.

## Behavior and limits

- Recommends only supplied model/effort pairs; a runtime catalog must be provided.
- Supports `balanced` (default), `quality`, `speed`, and `cost` priorities.
- Returns `needs_review` for insufficient information or confidence below the
  configured threshold. Exit codes are `0` selected/preview, `3` review, `2` error.
- Uses qualitative cost descriptions; it does not calculate bills or enforce budgets.
- Confidence is not calibrated success probability. Verify the executor's actual work.

The chosen API receives task summaries, variant details, and model descriptions.
Keep secrets, raw code/logs, and private paths out of the request. API credentials
are read from an environment variable or macOS Keychain. Retries are bounded and
can incur additional cost. Routing does not expand the calling agent's permissions.

## Publish on skills.sh

Publish the collection with this skill under `skills/agent-route/`; preserve its
scripts, references, examples, and package files together. Run the following
commands against the published collection to check discovery and install this
skill. The repository-root README explains how to maintain the collection.

```sh
npx skills add outsid3rx/agent-skills --list
npx skills add outsid3rx/agent-skills --skill agent-route
```

There is no need to publish this helper as an npm package; `private: true` protects
against accidental npm publication.

## Development

`npm test` runs mocked API/SDK tests. It verifies request/response validation,
timeouts, retries, credential handling, and CLI behavior; it does not validate
live provider availability or recommendation quality. The SDK is pinned in
`package-lock.json`. Only the TypeSafe adapter imports it; the other adapters and
dry runs use Node's built-in APIs.

## License

[MIT](LICENSE). Third-party packages retain their own licenses.

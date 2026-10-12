# CLI and API reference

## Setup and execution

Requires Node.js 20.3+ (`AbortSignal.any`) and npm. Use a maintained Node release.
From the installed skill directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/agent-route.mjs --help
node scripts/agent-route.mjs --input examples/task.json --config examples/config.json --dry-run
```

Installation through the skills CLI copies the skill files; run the dependency
installation separately. The CLI imports the TypeSafe SDK only for `typesafe`;
`chat-completions`, `json-http`, and dry runs use Node's built-in APIs.
The full test suite requires the SDK.

`--input -` or omitting `--input` reads JSON from stdin. All flags are listed by
`--help`; flags override config values. `--dry-run` prints the request body to
stdout without reading a credential or sending a request. It includes the task
summary and catalog descriptions, so treat saved previews as task data.
There is no automatic hook, agent launcher, or model catalog discovery.

## Configuration

### Automatic discovery

Configuration is loaded in this order (first selected file wins):

1. `--config FILE`.
2. `AGENT_ROUTE_CONFIG` environment variable (a file path).
3. `agent-route.config.local.json` in the current working directory.
4. `$XDG_CONFIG_HOME/agent-route/config.json`, or `~/.config/agent-route/config.json`
   when `XDG_CONFIG_HOME` is unset.

Explicit relative paths are resolved from the working directory. Missing automatic
candidates are skipped. A selected unreadable/malformed file is an error; the CLI
does not silently fall back. If no config is found, the existing flags-only workflow
still works. Flags override fields from the selected file. `config.local.json` is
not an automatic project filename; use `--config config.local.json` for that name.

### Fill a reusable profile

`apiFormat`, `baseURL`, and `model` configure the **decision API**. The optional
`executorCatalog` configures the **models the decision API may choose**:

```json
{
  "apiFormat": "chat-completions",
  "baseURL": "https://provider.example/v1",
  "model": "your-decision-model",
  "credential": { "type": "env", "name": "DECISION_API_KEY" },
  "executorCatalog": "./models.json"
}
```

To set up a reusable profile:

1. Create a config directory, usually `~/.config/agent-route/`.
2. Copy [examples/config.json](../examples/config.json) there as `config.json`, or
   use [examples/typesafe.config.json](../examples/typesafe.config.json) when you
   selected TypeSafe. Fill in the API format, root/endpoint, and decision-model ID
   using your provider's documentation.
3. Copy [examples/executor-catalog.json](../examples/executor-catalog.json) there as
   `models.json`. Set `executorCatalog` to `./models.json`. Relative catalog paths
   resolve from the config directory, regardless of where the CLI is launched;
   absolute paths are supported too. The file is a JSON **array**, without an
   enclosing `models` object.
4. Replace every fictional executor ID, provider, supported effort, and capability
   description with your runtime's actual values. Describe known relative cost
   in `description`; mark unknown costs as unknown. The example has two models
   with three efforts each, but any valid catalog size is supported within the
   selected adapter's limit. Use `low` if that is your runtime's name for `light`.
5. Choose an environment-variable or Keychain credential reference. Store the
   token in that secret source, never in the JSON files. Keep both profile files
   outside the installed skill so reinstalling/updating the skill preserves them.
6. Preview a task with the command below. After checking the selected API and
   catalog, run without `--dry-run` when API use is authorized.

```sh
node /path/to/skill/scripts/agent-route.mjs --input task.json --dry-run
```

For a custom config location, set `AGENT_ROUTE_CONFIG` to its path or pass
`--config FILE`. The supported fields are:

| Field | Fill with |
| --- | --- |
| `apiFormat` | One adapter from the table below |
| `baseURL` | Your decision provider's API root or custom complete endpoint |
| `model` | The decision-model ID accepted by that provider, not an executor ID |
| `credential` | An environment-variable or macOS Keychain reference |
| `executorCatalog` | Optional path to your executor model array |
| Limits and retries | Optional settings from the defaults table below |

### Fixed executor choices and availability

When `executorCatalog` is configured, it is authoritative. Tasks can omit `models`
and use the saved profile. If a task supplies `models`, the CLI treats it as the
current runtime catalog: every configured provider/model/effort must be present.
Extra input models/efforts are ignored for routing; missing configured choices
are an error. Configured descriptions and ordering are preserved. Malformed,
missing, or empty profile files fail before credential lookup and network use.
The CLI never silently falls back to the task's broader catalog.

With no `executorCatalog`, `input.models` remains required and behaves as before.
For the JavaScript library API, call `loadExecutorCatalog(config, configPath)` from
`scripts/config.mjs` and pass its result as the third argument to
`prepareRequest(input, config, executorCatalog)`; omitting a configured catalog
is an error.

The CLI cannot discover host availability or identify the latest model versions.
Provide current `input.models` when availability must be checked. Refresh exact
version IDs in the approved profile when the user changes the allowed versions.
Keep the effort strings exactly as accepted by the host; there is no automatic
`light` → `low` alias conversion.

### Decision API adapters

| `apiFormat` | Endpoint and response |
| --- | --- |
| `chat-completions` | API root; POST `/chat/completions`; JSON string in `choices[0].message.content` |
| `typesafe` | API root; SDK POST `/v1/systemone`; Choice answers |
| `json-http` | Complete endpoint; POST `{model, state, questions}`; response `{answers}` |

All adapters use Bearer authentication. HTTPS is required; HTTP is allowed only
for `localhost`, `127.0.0.1`, and `[::1]`. URL credentials, query strings, and
fragments are rejected. For Chat Completions, include the provider's version path
in the API root when required. For TypeSafe, do not include `/v1/systemone`.
For protocols outside these contracts, adapt `scripts/adapters.mjs` explicitly.

`jsonMode: false` omits Chat Completions `response_format`; JSON output is still
required. [examples/config.json](../examples/config.json) has fictional endpoint/model
values. [examples/typesafe.config.json](../examples/typesafe.config.json) demonstrates
TypeSafe/Jev only; confirm its endpoint and model availability before a live call.

The default credential is the environment variable `DECISION_API_KEY`. Set its
value through the user's existing secret-management workflow; never print it or
place it in request/config files. macOS can instead use:

```json
{
  "type": "keychain",
  "service": "agent-route.decision-api",
  "account": "decision-api"
}
```

Set this as the `credential` object. Create a generic password with the matching
service/account in Keychain Access; its password is the API key. The CLI reads it
with `/usr/bin/security`. Use environment credentials on other operating systems.
Project profiles named `agent-route.config.local.json`, `config.local.json`, or
`*.local.json` are excluded from this repository's Git rules. A file named
`config.json` or `models.json` inside a project is not automatically ignored;
keep reusable profiles in the user config directory or add suitable Git rules.

| Setting | Default | Accepted values |
| --- | --- | --- |
| `minConfidence` | `0.6` | Number, 0–1 |
| `timeoutMs` | `10000` | Positive integer up to 2147483647; per attempt |
| `totalTimeoutMs` | `45000` | Positive integer up to 2147483647; whole API operation |
| `maxRetries` | `1` | Integer, 0–3; additional attempts |

Temporary transport errors and HTTP 408/429/5xx may be retried within the total
deadline. Retries may incur additional cost. Set `maxRetries: 0` for one attempt.
The timeout excludes credential lookup; Keychain lookup has a separate 10-second
limit. A confidence threshold is a review policy, not calibrated accuracy.

## Input contract

Use [examples/task.json](../examples/task.json) as a task-only example paired with
the configured [executor catalog](../examples/executor-catalog.json). Catalog IDs
and relative cost descriptions are fictional and must be replaced for real routing.

| Field | Contract |
| --- | --- |
| `task` | Nonempty, abstract task summary |
| `variants` | Nonempty array of objects with unique nonempty `id` and nonempty `description` |
| Variant details | Optional nonempty strings: `expected_result`, `verification`, `constraints` |
| `models` | Required without `executorCatalog`; otherwise optional availability catalog. Nonempty array of objects with nonempty `id`, `description`, and `efforts` |
| `efforts` | Nonempty array of unique nonempty strings supported by that model in the runtime |
| Model details | Optional `provider`; optional `effort_descriptions` mapping supported effort → nonempty description |
| `priority` | `balanced` (default), `quality`, `speed`, or `cost` |

Provider/model pairs must be unique. Describe capability and known cost in
`description`; there is no numeric pricing field or token-budget calculation.
All model/effort pairs are enumerated as `pair_0`, `pair_1`, etc. TypeSafe accepts
at most 254 pairs plus `insufficient_information`. Variants become `variant_0`,
`variant_1`, etc. and are evaluated together in one request, independently.

## Decision API answer contract

Every adapter must produce `answers.variant_N` containing `type: "choice"`, a
supplied criterion key in `choice`, a numeric `confidence` from 0 to 1, and
`probabilities` for every pair plus `insufficient_information`.
For example, with exactly two configurations and one variant:

```json
{
  "answers": {
    "variant_0": {
      "type": "choice",
      "choice": "pair_0",
      "confidence": 0.85,
      "probabilities": {
        "pair_0": 0.9,
        "pair_1": 0.05,
        "insufficient_information": 0.05
      }
    }
  }
}
```

Each probability must be 0–1. The sum must be within 0.01 of 1, and `choice`
must have the largest probability (ties allowed, comparison tolerance 1e-6).
Missing/unknown criteria, inconsistent choices, and malformed answers are rejected.

## CLI output and integration

stdout contains JSON; stderr contains diagnostics. Output includes:

- `decision_model` and `confidence_source` (`model_reported` for Chat Completions,
  `provider_reported` for the other adapters).
- `configurations`: criterion key → `{model, effort, provider?}`.
- `recommendations`: one entry per input variant with `variant_id`, `status`,
  `model`, `effort`, optional `provider`, `confidence`, `reason`, `candidate`,
  and `probabilities`.

`selected` requires a supplied configuration and confidence at or above the
threshold. `needs_review` sets model/effort to `null`; `candidate` is a supplied
pair for low confidence or `null` for insufficient information. `reason` is
`choice_above_threshold`, `low_confidence`, or `insufficient_information`, not
a generated explanation of the choice.

| Exit | Meaning | Caller action |
| --- | --- | --- |
| `0` | All variants selected, or dry run | Distinguish preview from recommendation; validate against runtime permissions |
| `3` | At least one variant needs review; JSON preserved | Inspect entries; clarify or use an agreed fallback for unresolved variants |
| `2` | Invalid input/config, credential, installation, or API failure | Read stderr; do not consume stdout as a recommendation |

Treat code `3` as a meaningful result when invoking through a tool that normally
rejects nonzero exits. Do not lose its stdout. The CLI does not execute tasks or
launch agents. Translate selected fields to the native delegation API only when
that configuration is supported and permitted. Never forward `candidate` as an
automatic fallback. Recheck availability if the runtime catalog changes.

## Verification

Run `npm test` for input/output validation, retries, timeout behavior, credential
handling, config discovery, catalog restrictions, and CLI exit codes. HTTP and SDK transports use mocked responses;
tests do not call decision providers or prove routing quality. Run a separately
authorized live request to assess provider compatibility and real task outcomes.

TypeSafe documentation: [Choice](https://docs.typesafe.ai/primitives/choice),
[Confidence](https://docs.typesafe.ai/confidence). These links describe the optional
adapter; the bundled source and pinned SDK define this package's behavior.

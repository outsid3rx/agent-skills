# Agent Skills

[![skills.sh](https://skills.sh/b/outsid3rx/agent-skills)](https://skills.sh/outsid3rx/agent-skills)

A collection of reusable [Agent Skills](https://agentskills.io/specification).
Each skill lives in its own directory under `skills/`, with instructions and any
scripts, references, or examples it needs.

## Available skills

| Skill | Purpose | Requirements |
| --- | --- | --- |
| [agent-route](skills/agent-route/SKILL.md) | Recommend a subagent model and reasoning effort using a user-selected decision API | Node.js 20.3+, npm, and a runtime with selectable subagent configurations |

See the [Agent Route guide](skills/agent-route/README.md) for setup and behavior.
It supports a reusable local profile with automatic config discovery and a fixed
executor catalog; the example profile demonstrates six model/effort choices.

## Install

Install from [outsid3rx/agent-skills](https://github.com/outsid3rx/agent-skills):

```sh
# Discover the available skills
npx skills add outsid3rx/agent-skills --list

# Install one skill
npx skills add outsid3rx/agent-skills --skill agent-route

# Install all skills in this collection
npx skills add outsid3rx/agent-skills --skill '*'
```

For a local checkout, run from the repository root:

```sh
npx skills add . --list
npx skills add . --skill agent-route
```

The skills CLI installs skill files. Install runtime dependencies separately when
a skill requires them, following that skill's README.

## Repository layout

```text
agent-skills/
├── README.md
├── LICENSE
└── skills/
    └── agent-route/
        ├── SKILL.md
        ├── README.md
        ├── LICENSE
        ├── agents/openai.yaml
        ├── scripts/
        ├── references/
        ├── examples/
        ├── tests/
        ├── package.json
        └── package-lock.json
```

## Add another skill

1. Create `skills/<skill-name>/SKILL.md` with YAML frontmatter containing `name`
   and `description`. Use a lowercase hyphenated name matching the directory.
2. Keep the entry point focused on when to use the skill and how to do its work.
   Add `scripts/`, `references/`, or `assets/` only when the skill needs them.
   Keep paths relative to the skill directory so installation remains portable.
3. Make each skill self-contained: keep its runtime dependencies, configuration
   examples, and license in that skill's directory. Do not rely on sibling skills
   or repository-root files that an installer may omit. No root npm workspace is
   required; different skills may use different runtimes.
4. Add a row to the table above. Validate the new skill and run its relevant
   checks, then use `npx skills add . --list` to verify discovery.

Keep local credentials, dependency folders, and task data out of Git. There is no
root `SKILL.md`: the repository is a collection, and each entry is independently
installable.

## Check Agent Route

From the repository root:

```sh
npm --prefix skills/agent-route ci --ignore-scripts --no-audit --no-fund
npm --prefix skills/agent-route test
node skills/agent-route/scripts/agent-route.mjs --input skills/agent-route/examples/task.json --config skills/agent-route/examples/config.json --dry-run
```

Tests use mocked API transports. The preview reads no credential and makes no
API request. Live provider compatibility and recommendation quality require
separate, authorized checks.

## Publish on skills.sh

Publish the complete repository on GitHub, preserving `skills/<skill-name>/`.
Confirm discovery with `npx skills add outsid3rx/agent-skills --list`, then install a skill
with `npx skills add outsid3rx/agent-skills --skill agent-route`.

The [skills.sh FAQ](https://skills.sh/docs/faq) explains that directory listings
and rankings are based on installation telemetry. A local repository or discovery
check alone does not publish the collection. Individual skills do not need to be
published as npm packages.

## License

[MIT](LICENSE). Each skill includes its license so it remains available after
installation. Third-party dependencies retain their own licenses.

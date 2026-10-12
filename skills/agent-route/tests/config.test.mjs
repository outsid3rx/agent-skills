import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadExecutorCatalog } from '../scripts/config.mjs';
import { prepareRequest, validateConfig } from '../scripts/router.mjs';

const cli = fileURLToPath(new URL('../scripts/agent-route.mjs', import.meta.url));
const settings = {
  apiFormat: 'typesafe', baseURL: 'https://decision.example/api', model: 'decision-model',
  credential: { type: 'env', name: 'UNSET_CONFIG_TEST_KEY' },
};
const catalog = [
  { id: 'general-model', provider: 'runtime', description: 'General coding tasks', efforts: ['low', 'medium', 'high'] },
  { id: 'fast-model', provider: 'runtime', description: 'Bounded tasks; lower relative cost', efforts: ['low', 'medium', 'high'] },
];
const task = { task: 'Review API integration', variants: [{ id: 'review', description: 'Reproduce integration defects' }] };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agent-route-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'project');
  const xdg = join(root, 'user-config');
  await mkdir(cwd);
  await mkdir(join(xdg, 'agent-route'), { recursive: true });
  const env = { ...process.env, XDG_CONFIG_HOME: xdg };
  delete env.AGENT_ROUTE_CONFIG;
  delete env.UNSET_CONFIG_TEST_KEY;
  return { root, cwd, xdg, env, home: join(root, 'home') };
}
async function json(path, data) { await writeFile(path, `${JSON.stringify(data)}\n`); }
function run(f, args = [], input = task) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: f.cwd, env: f.env, encoding: 'utf8', input: JSON.stringify(input) });
}

test('config discovery prefers explicit path, then environment, project, and user config', async t => {
  const f = await fixture(t);
  const user = join(f.xdg, 'agent-route/config.json');
  const project = join(f.cwd, 'agent-route.config.local.json');
  const environment = join(f.root, 'env.json');
  const explicit = join(f.cwd, 'explicit.json');
  await json(user, { model: 'user' });
  assert.equal((await loadConfig(undefined, f)).rawConfig.model, 'user');
  await json(project, { model: 'project' });
  assert.equal((await loadConfig(undefined, f)).rawConfig.model, 'project');
  await json(environment, { model: 'environment' });
  f.env.AGENT_ROUTE_CONFIG = environment;
  assert.equal((await loadConfig(undefined, f)).rawConfig.model, 'environment');
  await json(explicit, { model: 'explicit' });
  assert.equal((await loadConfig('explicit.json', f)).configPath, explicit);
  assert.equal((await loadConfig('explicit.json', f)).rawConfig.model, 'explicit');
});

test('default user config uses .config under the home directory when XDG is unset', async t => {
  const f = await fixture(t);
  delete f.env.XDG_CONFIG_HOME;
  const user = join(f.home, '.config/agent-route/config.json');
  await mkdir(join(f.home, '.config/agent-route'), { recursive: true });
  await json(user, { model: 'home-config' });
  assert.equal((await loadConfig(undefined, f)).configPath, user);
});

test('no config preserves the flags-only workflow', async t => {
  const f = await fixture(t);
  assert.deepEqual(await loadConfig(undefined, f), { rawConfig: {}, configPath: null });
  const result = run(f, ['--dry-run', '--api-format', settings.apiFormat, '--base-url', settings.baseURL, '--decision-model', settings.model], { ...task, models: catalog });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).model, settings.model);
});

test('selected missing or malformed configs fail instead of falling back', async t => {
  const f = await fixture(t);
  await json(join(f.xdg, 'agent-route/config.json'), settings);
  await assert.rejects(loadConfig('missing.json', f), /Could not read config file/);
  f.env.AGENT_ROUTE_CONFIG = join(f.root, 'missing.json');
  await assert.rejects(loadConfig(undefined, f), /Could not read config file/);
  delete f.env.AGENT_ROUTE_CONFIG;
  await writeFile(join(f.cwd, 'agent-route.config.local.json'), '{not-json');
  await assert.rejects(loadConfig(undefined, f), /valid JSON/);
  await assert.rejects(loadConfig('', f), /nonempty/);
});

test('executor catalog paths resolve relative to the config, independent of cwd', async t => {
  const f = await fixture(t);
  const configPath = join(f.xdg, 'agent-route/config.json');
  await json(join(f.xdg, 'agent-route/models.json'), catalog);
  const config = validateConfig({ ...settings, executorCatalog: 'models.json' });
  assert.deepEqual(await loadExecutorCatalog(config, configPath, f.cwd), catalog);
  const absolute = { ...config, executorCatalog: join(f.xdg, 'agent-route/models.json') };
  assert.deepEqual(await loadExecutorCatalog(absolute, null, f.cwd), catalog);
});

test('configured choices stay at six with broader input models, or no input models', () => {
  const config = validateConfig({ ...settings, executorCatalog: 'models.json' });
  const broad = [...catalog.map(m => ({ ...m, efforts: [...m.efforts, 'extra-effort'] })),
    { id: 'other-model', description: 'An additional runtime model', efforts: ['high'] }];
  for (const input of [task, { ...task, models: broad }]) {
    const prepared = prepareRequest(input, config, catalog);
    assert.equal(prepared.pairs.length, 6);
    assert.deepEqual(prepared.pairs.map(p => [p.model, p.effort]), catalog.flatMap(m => m.efforts.map(e => [m.id, e])));
    assert.equal(Object.keys(prepared.request.questions.variant_0.criteria).length, 7);
  }
});

test('profiles support an arbitrary valid size rather than hardcoding six choices', () => {
  const config = validateConfig({ ...settings, executorCatalog: 'models.json' });
  const single = [{ ...catalog[0], efforts: ['medium'] }];
  assert.equal(prepareRequest(task, config, single).pairs.length, 1);
});

test('CLI live path sends only configured pairs and interprets the returned recommendation', async t => {
  const f = await fixture(t);
  await json(join(f.xdg, 'agent-route/config.json'), {
    ...settings, apiFormat: 'json-http', baseURL: 'https://decision.example/choose', executorCatalog: 'models.json',
  });
  await json(join(f.xdg, 'agent-route/models.json'), catalog);
  f.env.UNSET_CONFIG_TEST_KEY = 'test-secret';
  const preload = `globalThis.fetch = async (url, init) => {
    if (url !== 'https://decision.example/choose') throw new Error('Unexpected URL');
    const body = JSON.parse(init.body);
    const criteria = body.questions.variant_0.criteria;
    if (Object.keys(criteria).length !== 7) throw new Error('Wrong catalog size');
    const probabilities = Object.fromEntries(Object.keys(criteria).map(k => [k, k === 'pair_4' ? 1 : 0]));
    return new Response(JSON.stringify({answers:{variant_0:{type:'choice',choice:'pair_4',confidence:0.9,probabilities}}}));
  };`;
  const called = spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(preload)}`, cli,
  ], { cwd: f.cwd, env: f.env, encoding: 'utf8', input: JSON.stringify(task) });
  assert.equal(called.status, 0, called.stderr);
  const output = JSON.parse(called.stdout);
  assert.equal(Object.keys(output.configurations).length, 6);
  assert.equal(output.recommendations[0].model, 'fast-model');
  assert.equal(output.recommendations[0].effort, 'medium');
  assert.doesNotMatch(called.stdout, /test-secret/);
});

test('missing configured model, effort, or provider fails instead of reducing or expanding choices', () => {
  const config = validateConfig({ ...settings, executorCatalog: 'models.json' });
  for (const available of [
    catalog.slice(0, 1),
    catalog.map(m => ({ ...m, efforts: ['low', 'medium'] })),
    catalog.map(m => ({ ...m, provider: 'different-runtime' })),
  ]) assert.throws(() => prepareRequest({ ...task, models: available }, config, catalog), /unavailable in input.models/);
});

test('malformed configured catalog cannot bypass validation or fall back to input models', () => {
  const config = validateConfig({ ...settings, executorCatalog: 'models.json' });
  assert.throws(() => validateConfig({ ...settings, executorCatalog: '' }), /executorCatalog/);
  assert.throws(() => prepareRequest({ ...task, models: catalog }, config), /Load the configured/);
  for (const invalid of [[], { models: catalog }, [catalog[0], catalog[0]], [{ ...catalog[0], efforts: ['low', 'low'] }]]) {
    assert.throws(() => prepareRequest({ ...task, models: catalog }, config, invalid));
  }
});

test('CLI automatically loads user config and six configured pairs without input models', async t => {
  const f = await fixture(t);
  await json(join(f.xdg, 'agent-route/config.json'), { ...settings, executorCatalog: 'models.json' });
  await json(join(f.xdg, 'agent-route/models.json'), catalog);
  const result = run(f, ['--dry-run', '--decision-model', 'override-model']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.model, 'override-model');
  assert.equal(Object.keys(payload.questions.variant_0.criteria).length, 7);
});

test('CLI reads AGENT_ROUTE_CONFIG and config-relative catalog from a different cwd', async t => {
  const f = await fixture(t);
  const configPath = join(f.xdg, 'agent-route/custom.json');
  await json(configPath, { ...settings, executorCatalog: 'models.json' });
  await json(join(f.xdg, 'agent-route/models.json'), catalog);
  f.env.AGENT_ROUTE_CONFIG = configPath;
  const result = run(f, ['--dry-run'], { ...task, models: catalog });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(Object.keys(JSON.parse(result.stdout).questions.variant_0.criteria).length, 7);
});

test('CLI fails closed before credentials or API on bad catalog or unavailable choices', async t => {
  const f = await fixture(t);
  const configPath = join(f.cwd, 'config.json');
  await json(configPath, { ...settings, executorCatalog: 'models.json' });
  let result = run(f, ['--config', configPath]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Could not read executor catalog/);
  await writeFile(join(f.cwd, 'models.json'), '{bad-json');
  result = run(f, ['--config', configPath]);
  assert.match(result.stderr, /executor catalog must contain valid JSON/);
  await json(join(f.cwd, 'models.json'), catalog);
  result = run(f, ['--config', configPath], { ...task, models: catalog.slice(0, 1) });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /unavailable in input.models/);
  assert.doesNotMatch(result.stderr, /API key is missing/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { readCredential, prepareRequest, parseResponse, route, validateConfig, buildApiRequest } from '../scripts/router.mjs';

const input = {
  task: 'Diagnose a failing test', priority: 'balanced',
  variants: [{ id: 'find-cause', description: 'Inspect logs' }, { id: '__proto__', description: 'Compare implementations' }],
  models: [{ id: 'executor', provider: 'runtime', description: 'Good at bounded debugging', efforts: ['low', 'high'] }],
};
const settings = { apiFormat: 'typesafe', baseURL: 'https://decision.example/api', model: 'example-router' };
const config = validateConfig({ ...settings, maxRetries: 0 });
const prepared = prepareRequest(input, config);
const cliCwd = mkdtempSync(join(tmpdir(), 'agent-route-legacy-'));
after(() => rmSync(cliCwd, { recursive: true, force: true }));
const cliEnv = { ...process.env, XDG_CONFIG_HOME: join(cliCwd, 'isolated-config') };
delete cliEnv.AGENT_ROUTE_CONFIG;
function response({ choice = 'pair_0', confidence = 0.85, probabilities = { pair_0: 0.9, pair_1: 0.05, insufficient_information: 0.05 } } = {}) {
  return { model: 'example-router', answers: Object.fromEntries(input.variants.map((_, i) => [
    `variant_${i}`, { type: 'choice', choice, confidence, probabilities },
  ])) };
}

test('catalog produces only supplied pairs and independent questions with safe keys', () => {
  assert.equal(prepared.pairs.length, 2);
  assert.deepEqual(Object.keys(prepared.request.questions), ['variant_0', 'variant_1']);
  assert.deepEqual(Object.keys(prepared.request.questions.variant_0.criteria), ['pair_0', 'pair_1', 'insufficient_information']);
  assert.equal(prepared.request.questions.variant_0.criteria.pair_1.effort, 'high');
  assert.equal(prepared.request.state.variants[1].id, '__proto__');
});

test('invalid catalogs are rejected before any API call', () => {
  assert.throws(() => prepareRequest({ ...input, models: [] }, config), /nonempty/);
  assert.throws(() => prepareRequest({ ...input, variants: [input.variants[0], input.variants[0]] }, config), /unique/);
  assert.throws(() => prepareRequest({ ...input, models: [{ ...input.models[0], efforts: ['high', 'high'] }] }, config), /unique/);
  assert.throws(() => prepareRequest({ ...input, models: [{ ...input.models[0], efforts: Array.from({ length: 255 }, (_, i) => `e${i}`) }] }, config), /254/);
});

test('unavailable pairs, malformed distributions and inconsistent choices are rejected', () => {
  assert.throws(() => parseResponse(response({ choice: 'invented' }), prepared, config), /Invalid choice/);
  assert.throws(() => parseResponse(response({ confidence: NaN }), prepared, config), /confidence/);
  assert.throws(() => parseResponse(response({ probabilities: { pair_0: 0.9 } }), prepared, config), /distribution/);
  assert.throws(() => parseResponse(response({ probabilities: { pair_0: 0.9, pair_1: 0.9, insufficient_information: 0 } }), prepared, config), /sum/);
  assert.throws(() => parseResponse(response({ choice: 'pair_1' }), prepared, config), /most probable/);
});

test('selected config includes the executor provider; low confidence requires review', () => {
  const selected = parseResponse(response(), prepared, config).recommendations;
  assert.deepEqual(selected.map(r => [r.variant_id, r.model, r.effort, r.provider]), [
    ['find-cause', 'executor', 'low', 'runtime'], ['__proto__', 'executor', 'low', 'runtime'],
  ]);
  const uncertain = parseResponse(response({ confidence: 0.4 }), prepared, config).recommendations[0];
  assert.equal(uncertain.status, 'needs_review');
  assert.equal(uncertain.model, null);
  assert.equal(uncertain.candidate.model, 'executor');
  const unknown = parseResponse(response({ choice: 'insufficient_information', confidence: 1, probabilities: { pair_0: 0, pair_1: 0, insufficient_information: 1 } }), prepared, config).recommendations[0];
  assert.equal(unknown.reason, 'insufficient_information');
  assert.equal(unknown.candidate, null);
});

test('SDK sends the configured API root, model and credential', async () => {
  const custom = validateConfig({ ...settings, baseURL: 'https://decision.example/api/', model: 'provider/router', maxRetries: 0 });
  const request = prepareRequest(input, custom);
  let called = 0;
  const result = await route(request, custom, 'test-secret', { fetch: async (url, init) => {
    called++;
    assert.equal(url, 'https://decision.example/api/v1/systemone');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-secret');
    assert.deepEqual(JSON.parse(init.body), request.request);
    assert.ok(init.signal);
    return new Response(JSON.stringify(response()), { headers: { 'Content-Type': 'application/json' } });
  } });
  assert.equal(called, 1);
  assert.equal(result.decision_model, 'provider/router');
});

test('SDK retries temporary failures but not authentication errors; error bodies stay private', async () => {
  let calls = 0;
  await route(prepared, { ...config, maxRetries: 1 }, 'secret', { fetch: async () => {
    calls++;
    if (calls === 1) return new Response('temporary', { status: 503 });
    return new Response(JSON.stringify(response()));
  } });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(route(prepared, config, 'secret', { fetch: async () => {
    calls++;
    return new Response('secret plus private task', { status: 401 });
  } }), error => error.message.includes('HTTP 401') && !error.message.includes('secret'));
  assert.equal(calls, 1);
});

test('total timeout cancels SDK transport', async () => {
  const start = Date.now();
  // Keep an event loop handle alive while AbortSignal.timeout is unref'ed.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(route(prepared, { ...config, totalTimeoutMs: 30 }, 'secret', {
      fetch: async (_, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      }),
    }), /request failed/);
    assert.ok(Date.now() - start < 1000);
  } finally { clearInterval(keepAlive); }
});

test('Keychain reads use separate arguments and environment credentials are explicit', async () => {
  assert.equal(await readCredential({ type: 'env', name: 'TEST_KEY' }, { env: { TEST_KEY: ' secret ' } }), 'secret');
  await assert.rejects(readCredential({ type: 'env', name: 'TEST_KEY' }, { env: {} }), /missing/);
  const credential = { type: 'keychain', service: 'service with spaces', account: 'account' };
  assert.equal(await readCredential(credential, { platform: 'darwin', exec: async (file, args) => {
    assert.equal(file, '/usr/bin/security');
    assert.deepEqual(args, ['find-generic-password', '-s', credential.service, '-a', credential.account, '-w']);
    return { stdout: 'secret\n' };
  } }), 'secret');
  await assert.rejects(readCredential(credential, { platform: 'linux' }), /macOS/);
});

test('config validates endpoint, thresholds and budgets', () => {
  assert.throws(() => validateConfig(), /config.model/);
  assert.throws(() => validateConfig({ model: 'router' }), /apiFormat/);
  assert.throws(() => validateConfig({ model: 'router', apiFormat: 'chat-completions' }), /baseURL/);
  assert.throws(() => validateConfig({ ...settings, baseURL: 'http://external.example' }), /HTTPS/);
  assert.throws(() => validateConfig({ ...settings, baseURL: 'https://user:secret@example.com' }), /credentials/);
  assert.throws(() => validateConfig({ ...settings, baseURL: 'https://example.com/v1/systemone' }), /API root/);
  assert.throws(() => validateConfig({ ...settings, minConfidence: 1.1 }), /minConfidence/);
  assert.throws(() => validateConfig({ ...settings, timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => validateConfig({ ...settings, maxRetries: 4 }), /maxRetries/);
});

test('Chat Completions adapter uses a user-selected model and validates generated JSON', async () => {
  const custom = validateConfig({ ...settings, apiFormat: 'chat-completions', baseURL: 'https://provider.example/v1', model: 'other-decision-model', maxRetries: 0 });
  const request = prepareRequest(input, custom);
  const result = await route(request, custom, 'test-key', { fetch: async (url, init) => {
    assert.equal(url, 'https://provider.example/v1/chat/completions');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'other-decision-model');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(JSON.parse(body.messages[1].content).questions, request.request.questions);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response()) } }] }));
  } });
  assert.equal(result.recommendations[0].status, 'selected');
  assert.equal(result.confidence_source, 'model_reported');
  assert.ok(!Object.hasOwn(buildApiRequest(request, { ...custom, jsonMode: false }), 'response_format'));
  await assert.rejects(route(request, custom, 'test-key', { fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not JSON' } }] })) }), /request failed/);
});

test('custom JSON adapter calls the exact endpoint and shares validation and retries', async () => {
  const custom = validateConfig({ ...settings, apiFormat: 'json-http', baseURL: 'https://provider.example/decide', maxRetries: 1 });
  const request = prepareRequest(input, custom);
  let calls = 0;
  const result = await route(request, custom, 'test-key', { fetch: async (url, init) => {
    calls++;
    assert.equal(url, custom.baseURL);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-key');
    assert.deepEqual(JSON.parse(init.body), request.request);
    if (calls === 1) return new Response('busy', { status: 429 });
    return new Response(JSON.stringify(response()));
  } });
  assert.equal(calls, 2);
  assert.equal(result.recommendations[0].model, 'executor');
  await assert.rejects(route(request, { ...custom, maxRetries: 0 }, 'test-key', { fetch: async () => new Response(JSON.stringify(response({ choice: 'unknown' }))) }), /Invalid choice/);
});

test('CLI dry-run reads stdin without a key; invalid input stays off stdout', () => {
  const cli = fileURLToPath(new URL('../scripts/agent-route.mjs', import.meta.url));
  const dry = spawnSync(process.execPath, [cli, '--dry-run', '--api-format', 'typesafe', '--base-url', settings.baseURL, '--decision-model', settings.model, '--key-env', 'UNSET_ROUTE_TEST_KEY'], { input: JSON.stringify(input), encoding: 'utf8', cwd: cliCwd, env: cliEnv });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stderr, '');
  assert.equal(JSON.parse(dry.stdout).model, settings.model);
  const bad = spawnSync(process.execPath, [cli, '--dry-run', '--api-format', 'typesafe', '--base-url', settings.baseURL, '--decision-model', settings.model], { input: '{not-json', encoding: 'utf8', cwd: cliCwd, env: cliEnv });
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /valid JSON/);
});

test('CLI runs through the real SDK and returns exit 0 or 3 with JSON', () => {
  const cli = fileURLToPath(new URL('../scripts/agent-route.mjs', import.meta.url));
  const preload = `globalThis.fetch = async (url, init) => {
    if (url !== 'https://decision.example/api/v1/systemone') throw new Error('Wrong URL');
    const request = JSON.parse(init.body);
    const review = process.env.ROUTE_TEST_REVIEW === '1';
    const answers = Object.fromEntries(Object.keys(request.questions).map(id => [id, {
      type: 'choice', choice: 'pair_0', confidence: review ? 0.4 : 0.85,
      probabilities: {pair_0: 0.9, pair_1: 0.05, insufficient_information: 0.05}
    }]));
    return new Response(JSON.stringify({answers}));
  };`;
  for (const review of ['0', '1']) {
    const result = spawnSync(process.execPath, [
      '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
      cli, '--api-format', 'typesafe', '--base-url', settings.baseURL, '--decision-model', settings.model, '--key-env', 'ROUTE_TEST_KEY',
    ], { input: JSON.stringify(input), encoding: 'utf8', cwd: cliCwd, env: { ...cliEnv, ROUTE_TEST_KEY: 'test-secret', ROUTE_TEST_REVIEW: review } });
    assert.equal(result.status, review === '1' ? 3 : 0, result.stderr);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout);
    assert.equal(output.recommendations.length, 2);
    assert.equal(output.recommendations[0].status, review === '1' ? 'needs_review' : 'selected');
    assert.ok(!result.stdout.includes('test-secret'));
  }
});

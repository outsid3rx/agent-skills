#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { prepareRequest, readCredential, route, validateConfig, buildApiRequest, RouteError } from './router.mjs';
import { loadConfig, loadExecutorCatalog } from './config.mjs';

const help = `agent-route --input task.json [--config config.json] [--dry-run]
Or: cat task.json | agent-route [options]

Options:
  --config FILE           Explicit configuration (overrides automatic discovery)
  --api-format FORMAT     typesafe / chat-completions / json-http (required)
  --base-url URL           API root, or full endpoint for json-http (required)
  --decision-model ID      User-selected decision model (required)
  --key-env NAME           Read API key from this environment variable
  --keychain-service NAME Read API key from macOS Keychain (requires --keychain-account)
  --keychain-account NAME  Account of the Keychain generic password
  --min-confidence NUMBER Confidence threshold, 0..1 (default 0.6)
  --dry-run               Print request JSON without reading key or calling API
  --help                  Show help

Exit codes: 0 all selected / dry run; 2 invalid input or API failure; 3 needs review.

Config search: --config, AGENT_ROUTE_CONFIG, ./agent-route.config.local.json,
then $XDG_CONFIG_HOME/agent-route/config.json (default ~/.config/agent-route/config.json).
executorCatalog in config restricts choices to a JSON model catalog; input.models
may verify availability but cannot broaden the configured choices.
`;

async function jsonFile(path, label) {
  let source;
  try {
    if (path === 0) {
      process.stdin.setEncoding('utf8');
      source = '';
      for await (const chunk of process.stdin) source += chunk;
    } else source = await readFile(path, 'utf8');
  } catch { throw new RouteError(`Could not read ${label}`); }
  try { return JSON.parse(source); } catch { throw new RouteError(`${label} must contain valid JSON`); }
}

try {
  let values;
  try {
    ({ values } = parseArgs({ options: {
      input: { type: 'string' }, config: { type: 'string' },
      'api-format': { type: 'string' }, 'base-url': { type: 'string' }, 'decision-model': { type: 'string' },
      'key-env': { type: 'string' }, 'keychain-service': { type: 'string' }, 'keychain-account': { type: 'string' },
      'min-confidence': { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' },
    } }));
  } catch { throw new RouteError('Invalid CLI arguments; run --help'); }
  if (values.help) process.stdout.write(help);
  else {
    const { rawConfig, configPath } = await loadConfig(values.config);
    if (rawConfig === null || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) throw new RouteError('config must be an object');
    if (values['api-format'] !== undefined) rawConfig.apiFormat = values['api-format'];
    if (values['base-url'] !== undefined) rawConfig.baseURL = values['base-url'];
    if (values['decision-model'] !== undefined) rawConfig.model = values['decision-model'];
    if (values['min-confidence'] !== undefined) {
      if (!values['min-confidence'].trim()) throw new RouteError('min-confidence must be a number');
      rawConfig.minConfidence = Number(values['min-confidence']);
    }
    if (values['key-env'] !== undefined && (values['keychain-service'] !== undefined || values['keychain-account'] !== undefined)) throw new RouteError('Choose either --key-env or Keychain flags');
    if (values['key-env'] !== undefined) rawConfig.credential = { type: 'env', name: values['key-env'] };
    if (values['keychain-service'] !== undefined || values['keychain-account'] !== undefined) rawConfig.credential = {
      type: 'keychain', service: values['keychain-service'], account: values['keychain-account'],
    };
    const config = validateConfig(rawConfig);
    const executorCatalog = await loadExecutorCatalog(config, configPath);
    if ((!values.input || values.input === '-') && process.stdin.isTTY) throw new RouteError('Provide --input FILE or JSON on stdin');
    const input = await jsonFile(values.input && values.input !== '-' ? values.input : 0, 'input');
    const prepared = prepareRequest(input, config, executorCatalog);
    if (values['dry-run']) process.stdout.write(`${JSON.stringify(buildApiRequest(prepared, config), null, 2)}\n`);
    else {
      const key = await readCredential(config.credential);
      const result = await route(prepared, config, key);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.recommendations.some(r => r.status === 'needs_review')) process.exitCode = 3;
    }
  }
} catch (error) {
  process.stderr.write(`agent-route: ${error instanceof RouteError ? error.message : 'Unexpected failure; check input and installation'}\n`);
  process.exitCode = 2;
}

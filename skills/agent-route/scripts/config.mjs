import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { RouteError } from './router.mjs';

async function readJson(path, label, optional = false) {
  let source;
  try { source = await readFile(path, 'utf8'); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw new RouteError(`Could not read ${label}`);
  }
  try { return JSON.parse(source); }
  catch { throw new RouteError(`${label} must contain valid JSON`); }
}

export async function loadConfig(explicitPath, {
  env = process.env, cwd = process.cwd(), home = homedir(),
} = {}) {
  const selected = explicitPath ?? env.AGENT_ROUTE_CONFIG;
  if (selected !== undefined) {
    if (typeof selected !== 'string' || !selected.trim()) throw new RouteError('Config path must be a nonempty string');
    const configPath = resolve(cwd, selected);
    return { rawConfig: await readJson(configPath, 'config file'), configPath };
  }
  const candidates = [
    join(cwd, 'agent-route.config.local.json'),
    resolve(env.XDG_CONFIG_HOME || join(home, '.config'), 'agent-route', 'config.json'),
  ];
  for (const configPath of candidates) {
    const rawConfig = await readJson(configPath, 'config file', true);
    if (rawConfig !== undefined) return { rawConfig, configPath };
  }
  return { rawConfig: {}, configPath: null };
}

export async function loadExecutorCatalog(config, configPath, cwd = process.cwd()) {
  if (config.executorCatalog === undefined) return undefined;
  const path = resolve(configPath ? dirname(configPath) : cwd, config.executorCatalog);
  return await readJson(path, 'executor catalog');
}

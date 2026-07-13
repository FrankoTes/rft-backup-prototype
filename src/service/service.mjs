import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runBackup } from '../pipeline/runner.mjs';
import { testDestinationConnection } from '../transport/index.mjs';

const DATA_DIR = process.env.RFT_DATA_DIR ?? '.rft-data';
const DB = path.join(DATA_DIR, 'state.json');
const initial = { configurations: [], activity: [], versions: [], connectionTests: {} };

export async function loadState() {
  try { return { ...structuredClone(initial), ...JSON.parse(await readFile(DB, 'utf8')) }; }
  catch { return structuredClone(initial); }
}
export async function saveState(state) { await mkdir(DATA_DIR, { recursive: true }); await writeFile(DB, JSON.stringify(state, null, 2)); }

export function redactConfiguration(configuration) {
  if (!configuration) return configuration;
  const { password, ...destination } = configuration.destination ?? {};
  return { ...configuration, destination };
}
const redactState = (state) => ({ ...state, configurations: state.configurations.map(redactConfiguration) });

function normalizeConfiguration(input, existing) {
  const destinationInput = input.destination ?? {};
  const password = destinationInput.password || existing?.destination?.password || '';
  return {
    id: input.id ?? existing?.id ?? randomUUID(),
    name: input.name?.trim() || 'Configuration sans nom',
    enabled: input.enabled ?? true,
    folders: (input.folders ?? []).filter((folder) => folder.path).map((folder) => ({ path: folder.path, included: folder.included ?? true })),
    schedule: input.schedule ?? existing?.schedule ?? { frequency: 'manual' },
    destination: {
      type: destinationInput.type ?? existing?.destination?.type ?? 'sftp',
      host: destinationInput.host ?? existing?.destination?.host ?? '',
      port: Number(destinationInput.port ?? existing?.destination?.port ?? 22),
      username: destinationInput.username ?? existing?.destination?.username ?? '',
      password,
      remotePath: destinationInput.remotePath ?? existing?.destination?.remotePath ?? '',
      timeoutMs: Number(destinationInput.timeoutMs ?? existing?.destination?.timeoutMs ?? 15000),
    },
    retention: { type: 'keep_last', count: Number(input.retention?.count ?? existing?.retention?.count ?? 3) },
  };
}

export async function listConfigurations() { return (await loadState()).configurations.map(redactConfiguration); }
export async function getPublicState() { return redactState(await loadState()); }
export async function saveConfiguration(configuration) {
  const state = await loadState();
  const i = state.configurations.findIndex((c) => c.id === configuration.id);
  const normalized = normalizeConfiguration(configuration, i >= 0 ? state.configurations[i] : undefined);
  i >= 0 ? state.configurations[i] = normalized : state.configurations.push(normalized);
  await saveState(state);
  return redactConfiguration(normalized);
}
export async function deleteConfiguration(id) {
  const state = await loadState();
  state.configurations = state.configurations.filter((c) => c.id !== id);
  await saveState(state);
  return { ok: true };
}
export async function testConfigurationConnection(input) {
  const state = await loadState();
  const existing = input.id ? state.configurations.find((c) => c.id === input.id) : undefined;
  const config = normalizeConfiguration(input, existing);
  const result = await testDestinationConnection(config.destination);
  state.connectionTests[config.id] = { ok: true, checkedAt: new Date().toISOString(), transport: result.transport ?? config.destination.type };
  await saveState(state);
  return state.connectionTests[config.id];
}
export async function executeBackup(configurationId) {
  const state = await loadState();
  const config = state.configurations.find((c) => c.id === configurationId);
  if (!config) throw new Error('Configuration not found');
  const running = { id: randomUUID(), configurationId, configurationName: config.name, start: new Date().toISOString(), result: 'running', explanation: 'Sauvegarde en cours.' };
  state.activity.unshift(running); await saveState(state);
  const result = await runBackup(config, DATA_DIR);
  const activity = { ...result.activity, configurationName: config.name, technicalDetails: result.logs?.technical ?? [] };
  const fresh = await loadState();
  fresh.activity = fresh.activity.map((a) => a.id === running.id ? activity : a);
  if (result.version) fresh.versions.unshift({ ...result.version, configurationName: config.name });
  await saveState(fresh);
  return { activity, version: result.version };
}
export async function dashboard() {
  const state = await loadState();
  const lastBackup = state.activity.find((a) => a.result !== 'running');
  const enabled = state.configurations.find((c) => c.enabled);
  const latestBytesByConfiguration = new Map();
  for (const version of [...state.versions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))) {
    if (!latestBytesByConfiguration.has(version.configurationId)) latestBytesByConfiguration.set(version.configurationId, version.totalBytes ?? 0);
  }
  const protectedDataBytes = [...latestBytesByConfiguration.values()].reduce((sum, bytes) => sum + bytes, 0);
  return {
    health: !lastBackup || lastBackup.result === 'success' ? 'healthy' : lastBackup.error?.severity === 'critical' ? 'critical' : 'warning',
    lastBackup,
    nextBackup: enabled?.schedule?.nextRun ?? null,
    protectedDataBytes,
    sftpStatus: enabled ? (state.connectionTests[enabled.id]?.ok ? 'connected' : 'untested') : 'not_configured',
  };
}
export async function activity() { return (await loadState()).activity; }
export async function versions() { return (await loadState()).versions; }

if (import.meta.url === `file://${process.argv[1]}`) console.log('RFT Backup service prototype is ready. Configure Windows Service wrapper to run: npm run service');

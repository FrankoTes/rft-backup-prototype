import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runBackup } from '../pipeline/runner.mjs';
const DATA_DIR = process.env.RFT_DATA_DIR ?? '.rft-data'; const DB = path.join(DATA_DIR, 'state.json'); const initial = { configurations: [], activity: [], versions: [] };
export async function loadState() { try { return JSON.parse(await readFile(DB, 'utf8')); } catch { return structuredClone(initial); } }
export async function saveState(state) { await mkdir(DATA_DIR, { recursive: true }); await writeFile(DB, JSON.stringify(state, null, 2)); }
export async function saveConfiguration(configuration) { const state = await loadState(); const i = state.configurations.findIndex(c => c.id === configuration.id); i >= 0 ? state.configurations[i] = configuration : state.configurations.push(configuration); await saveState(state); return configuration; }
export async function executeBackup(configurationId) { const state = await loadState(); const config = state.configurations.find(c => c.id === configurationId); if (!config) throw new Error('Configuration not found'); const result = await runBackup(config, DATA_DIR); state.activity.unshift(result.activity); if (result.version) state.versions.unshift(result.version); await saveState(state); return result; }
export async function dashboard() { const state = await loadState(); const lastBackup = state.activity[0]; return { health: !lastBackup || lastBackup.result === 'success' ? 'healthy' : lastBackup.error?.severity === 'critical' ? 'critical' : 'warning', lastBackup, nextBackup: state.configurations.find(c => c.enabled)?.schedule.nextRun, protectedDataBytes: state.versions[0]?.totalBytes ?? 0, sftpStatus: 'untested' }; }
if (import.meta.url === `file://${process.argv[1]}`) console.log('RFT Backup service prototype is ready. Configure Windows Service wrapper to run: npm run service');

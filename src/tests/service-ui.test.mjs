import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function withService(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'rft-service-'));
  process.env.RFT_DATA_DIR = path.join(root, 'data');
  const mod = await import(`../service/service.mjs?${t.name}-${Date.now()}`);
  return { root, mod };
}

function config(source, remote, extra = {}) {
  return {
    name: 'Documents critiques',
    enabled: true,
    folders: [{ path: source, included: true }],
    destination: { type: 'local', host: 'localhost', port: 22, username: 'demo', password: 'secret-password', remotePath: remote, timeoutMs: 500 },
    retention: { type: 'keep_last', count: 2 },
    ...extra,
  };
}

test('creates, updates, deletes and never exposes SFTP passwords', async (t) => {
  const { root, mod } = await withService(t);
  const source = path.join(root, 'source'); const remote = path.join(root, 'remote');
  await mkdir(source); await writeFile(path.join(source, 'a.txt'), 'a');

  const created = await mod.saveConfiguration(config(source, remote));
  assert.ok(created.id);
  assert.equal(created.destination.password, undefined);
  assert.equal(JSON.stringify(await mod.getPublicState()).includes('secret-password'), false);

  const updated = await mod.saveConfiguration({ ...created, name: 'Documents modifiés', destination: { ...created.destination, type: 'local', remotePath: remote }, retention: { type: 'keep_last', count: 1 } });
  assert.equal(updated.name, 'Documents modifiés');
  assert.equal(updated.destination.password, undefined);

  await mod.deleteConfiguration(created.id);
  assert.equal((await mod.listConfigurations()).length, 0);
});

test('tests connection, runs the real backup, updates activity, versions and dashboard', async (t) => {
  const { root, mod } = await withService(t);
  const source = path.join(root, 'source'); const remote = path.join(root, 'remote');
  await mkdir(source); await writeFile(path.join(source, 'note.txt'), 'real engine');
  const created = await mod.saveConfiguration(config(source, remote));

  assert.deepEqual(await mod.testConfigurationConnection({ ...created, destination: { ...created.destination, type: 'local', remotePath: remote } }), { ok: true, checkedAt: (await mod.loadState()).connectionTests[created.id].checkedAt, transport: 'local' });
  const result = await mod.executeBackup(created.id);
  assert.equal(result.activity.result, 'success');
  assert.equal((await mod.activity())[0].configurationName, created.name);
  assert.equal((await mod.versions()).length, 1);
  const dash = await mod.dashboard();
  assert.equal(dash.health, 'healthy');
  assert.ok(dash.protectedDataBytes > 0);
});

test('UI controller returns API errors that the browser can display', async (t) => {
  const { root } = await withService(t);
  process.env.RFT_DATA_DIR = path.join(root, 'data-ui');
  const { createRftUiServer } = await import(`../ui/server.mjs?${t.name}-${Date.now()}`);
  const server = createRftUiServer().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/configurations/missing/backup`, { method: 'POST' });
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.match(payload.error, /Configuration not found/);
});

test('technical state file may contain a secret until secure storage PR, but public API does not', async (t) => {
  const { root, mod } = await withService(t);
  const source = path.join(root, 'source'); const remote = path.join(root, 'remote');
  await mkdir(source);
  await mod.saveConfiguration(config(source, remote));
  const raw = await readFile(path.join(process.env.RFT_DATA_DIR, 'state.json'), 'utf8');
  assert.match(raw, /secret-password/);
  assert.equal(JSON.stringify(await mod.getPublicState()).includes('secret-password'), false);
});


test('normal UI startup binds only to 127.0.0.1', async (t) => {
  const { root } = await withService(t);
  process.env.RFT_DATA_DIR = path.join(root, 'data-bind');
  const { startRftUiServer, UI_HOST } = await import(`../ui/server.mjs?bind-${Date.now()}`);
  const server = startRftUiServer({ listenPort: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  assert.equal(UI_HOST, '127.0.0.1');
  assert.equal(server.address().address, '127.0.0.1');
});

test('static UI serving is rooted in src/ui and rejects invalid paths', async (t) => {
  const { root } = await withService(t);
  process.env.RFT_DATA_DIR = path.join(root, 'data-static');
  const { createRftUiServer } = await import(`../ui/server.mjs?static-${Date.now()}`);
  const server = createRftUiServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const rootResponse = await fetch(`${base}/`);
  assert.equal(rootResponse.status, 200);
  assert.match(await rootResponse.text(), /RFT Backup/);

  const cssResponse = await fetch(`${base}/style.css`);
  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers.get('content-type'), /text\/css/);

  const missingResponse = await fetch(`${base}/missing.css`);
  assert.equal(missingResponse.status, 404);

  const traversalResponse = await fetch(`${base}/..%2Fservice%2Fservice.mjs`);
  assert.ok([403, 404].includes(traversalResponse.status));
  assert.doesNotMatch(await traversalResponse.text(), /runBackup/);

  const stateResponse = await fetch(`${base}/..%2F..%2F.rft-data%2Fstate.json`);
  assert.ok([403, 404].includes(stateResponse.status));
  assert.doesNotMatch(await stateResponse.text(), /configurations/);
});

test('dashboard protected data uses only the latest version for each configuration', async (t) => {
  const { mod } = await withService(t);
  await mod.saveState({
    configurations: [{ id: 'cfg-a', name: 'A', enabled: true, folders: [], destination: { type: 'local', remotePath: '/tmp/a' }, retention: { type: 'keep_last', count: 2 } }],
    activity: [],
    connectionTests: {},
    versions: [
      { id: 'old', configurationId: 'cfg-a', createdAt: '2026-01-01T00:00:00.000Z', totalBytes: 100 },
      { id: 'new', configurationId: 'cfg-a', createdAt: '2026-01-02T00:00:00.000Z', totalBytes: 150 },
      { id: 'other', configurationId: 'cfg-b', createdAt: '2026-01-01T00:00:00.000Z', totalBytes: 25 },
    ],
  });

  assert.equal((await mod.dashboard()).protectedDataBytes, 175);
});

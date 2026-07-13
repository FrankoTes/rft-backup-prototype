import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../core/errors.mjs';
import { runBackup } from '../pipeline/runner.mjs';

test('executes, validates, logs and applies keep_last retention', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rft-'));
  const source = path.join(root, 'source'); const remote = path.join(root, 'remote');
  await mkdir(source); await writeFile(path.join(source, 'note.txt'), 'peace of mind');
  const config = { id: 'cfg', name: 'Test', enabled: true, folders: [{ path: source, included: true }], schedule: { frequency: 'manual' }, destination: { host: 'localhost', port: 22, username: 'test', remotePath: remote }, retention: { type: 'keep_last', count: 1 } };
  const first = await runBackup(config, path.join(root, 'data'));
  const second = await runBackup(config, path.join(root, 'data'));
  assert.equal(first.activity.result, 'success'); assert.ok(second.version.manifestHash);
  assert.equal((await readdir(remote)).filter(f => f.endsWith('.rftpkg')).length, 1);
});

test('classifies technical errors into user-ready explanations', () => {
  assert.match(classifyError(new Error('ECONNREFUSED')).suggestedSolution, /connexion/);
});

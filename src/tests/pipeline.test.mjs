import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../core/errors.mjs';
import { runBackup } from '../pipeline/runner.mjs';
import { extractRftPackage, readRftPackage } from '../pipeline/package.mjs';

async function fileHash(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function configFor(sourceFolders, remote) {
  return {
    id: 'cfg',
    name: 'Test',
    enabled: true,
    folders: sourceFolders.map((folder) => ({ path: folder, included: true })),
    schedule: { frequency: 'manual' },
    destination: { type: 'local', host: 'localhost', port: 22, username: 'test', remotePath: remote },
    retention: { type: 'keep_last', count: 3 },
  };
}

test('executes, validates, logs and applies keep_last retention', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rft-'));
  const source = path.join(root, 'source');
  const remote = path.join(root, 'remote');
  await mkdir(source);
  await writeFile(path.join(source, 'note.txt'), 'peace of mind');
  const config = { ...configFor([source], remote), retention: { type: 'keep_last', count: 1 } };

  const first = await runBackup(config, path.join(root, 'data'));
  const second = await runBackup(config, path.join(root, 'data'));

  assert.equal(first.activity.result, 'success');
  assert.ok(second.version.manifestHash);
  assert.equal((await readdir(remote)).filter((file) => file.endsWith('.rftpkg')).length, 1);
});

test('creates autonomous packages for multiple folders and nested directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rft-autonomous-'));
  const sourceA = path.join(root, 'Documents');
  const sourceB = path.join(root, 'Pictures');
  const nestedA = path.join(sourceA, 'Projects', 'RFT');
  const nestedB = path.join(sourceB, '2026', 'July');
  const remote = path.join(root, 'remote');
  const data = path.join(root, 'data');

  await mkdir(nestedA, { recursive: true });
  await mkdir(nestedB, { recursive: true });
  await writeFile(path.join(sourceA, 'readme.txt'), 'root document');
  await writeFile(path.join(nestedA, 'design.md'), '# Backup design\nPreserve everything.');
  await writeFile(path.join(nestedB, 'photo.raw'), Buffer.from([0, 1, 2, 3, 255]));

  const originals = new Map();
  for (const filePath of [
    path.join(sourceA, 'readme.txt'),
    path.join(nestedA, 'design.md'),
    path.join(nestedB, 'photo.raw'),
  ]) {
    const fileStat = await stat(filePath);
    const relativeToRoot = filePath.startsWith(sourceA)
      ? path.join('Documents', path.relative(sourceA, filePath))
      : path.join('Pictures', path.relative(sourceB, filePath));
    originals.set(relativeToRoot, {
      content: await readFile(filePath),
      hash: await fileHash(filePath),
      size: fileStat.size,
    });
  }

  const result = await runBackup(configFor([sourceA, sourceB], remote), data);
  assert.equal(result.activity.result, 'success');

  await rm(sourceA, { recursive: true, force: true });
  await rm(sourceB, { recursive: true, force: true });

  const restoreDir = path.join(root, 'restore');
  const extraction = await extractRftPackage(result.remotePackagePath, restoreDir);

  assert.equal(extraction.restored.length, originals.size);
  for (const [archivePath, original] of originals) {
    const restoredPath = path.join(restoreDir, archivePath);
    assert.deepEqual(await readFile(restoredPath), original.content);
    assert.equal(await fileHash(restoredPath), original.hash);

    const packageEntry = extraction.manifest.files.find((file) => file.archivePath === archivePath);
    assert.equal(packageEntry.size, original.size);
    assert.equal(packageEntry.hash, original.hash);
    assert.equal(packageEntry.encoding, 'base64');
    assert.ok(packageEntry.modifiedAt);
  }
});

test('keeps packages valid across repeated backups', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rft-repeat-'));
  const source = path.join(root, 'source');
  const nested = path.join(source, 'nested');
  const remote = path.join(root, 'remote');
  const data = path.join(root, 'data');
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, 'file.txt'), 'version 1');

  const config = configFor([source], remote);
  const first = await runBackup(config, data);
  await writeFile(path.join(nested, 'file.txt'), 'version 2');
  const second = await runBackup(config, data);

  for (const packagePath of [first.remotePackagePath, second.remotePackagePath]) {
    const manifest = await readRftPackage(packagePath);
    assert.equal(manifest.format, 'rft-backup-package');
    assert.equal(manifest.version, 2);
    assert.equal(manifest.storage.compression, 'none');
    assert.equal(manifest.files.length, 1);
    assert.equal(
      createHash('sha256').update(Buffer.from(manifest.files[0].data, 'base64')).digest('hex'),
      manifest.files[0].hash,
    );
  }
});

test('classifies technical errors into user-ready explanations', () => {
  assert.match(classifyError(new Error('ECONNREFUSED')).suggestedSolution, /connexion/);
});

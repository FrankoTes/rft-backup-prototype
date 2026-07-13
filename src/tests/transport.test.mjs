import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../core/errors.mjs';
import { TransferStage } from '../pipeline/stages.mjs';
import { LocalTransport } from '../transport/local.mjs';
import { SftpTransport } from '../transport/sftp.mjs';
import { classifyTransportFailure, TransportError, TransportErrorCodes } from '../transport/errors.mjs';
import { createTransport, testDestinationConnection } from '../transport/index.mjs';

async function tempPackage() {
  const root = await mkdtemp(path.join(tmpdir(), 'rft-transport-'));
  const local = path.join(root, 'local.rftpkg');
  const remote = path.join(root, 'remote');
  await writeFile(local, 'package bytes');
  return { root, local, remote };
}

test('local transport uploads and validates package size', async () => {
  const { local, remote } = await tempPackage();
  const transport = new LocalTransport({ remotePath: remote });
  const result = await transport.uploadPackage(local);

  assert.equal(result.hashValidated, true);
  assert.equal(await readFile(result.remotePath, 'utf8'), 'package bytes');
  assert.equal(result.size, 13);
});

test('transport abstraction keeps the pipeline independent from implementation details', async () => {
  const { local } = await tempPackage();
  const calls = [];
  const stage = new TransferStage((destination) => ({
    async uploadPackage(packagePath) {
      calls.push({ destination, packagePath });
      return { remotePath: '/remote/local.rftpkg', size: 13, hashValidated: false };
    },
  }));

  const ctx = await stage.run({ packagePath: local, configuration: { destination: { type: 'fake' } }, logs: { user: [], technical: [] } });

  assert.equal(calls.length, 1);
  assert.equal(ctx.remotePackagePath, '/remote/local.rftpkg');
  assert.equal(ctx.remoteHashValidated, false);
});

test('connection test delegates to configured transport', async () => {
  const { remote } = await tempPackage();
  const result = await testDestinationConnection({ type: 'local', remotePath: remote });
  assert.deepEqual(result, { ok: true, transport: 'local' });
});

test('invalid SFTP parameters are rejected before connecting', async () => {
  const transport = new SftpTransport({ host: '', port: 70000, username: 'u', password: 'secret', remotePath: '/backup' });
  await assert.rejects(() => transport.testConnection(), (error) => {
    assert.equal(error.code, TransportErrorCodes.INVALID_CONFIGURATION);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test('SFTP errors are classified for user-facing diagnostics', () => {
  assert.equal(classifyTransportFailure(new Error('ETIMEDOUT')).code, TransportErrorCodes.TIMEOUT);
  assert.equal(classifyTransportFailure(new Error('All configured authentication methods failed')).code, TransportErrorCodes.AUTHENTICATION_REFUSED);
  assert.equal(classifyTransportFailure(new Error('Permission denied')).code, TransportErrorCodes.PERMISSION_DENIED);
  assert.equal(classifyTransportFailure(new Error('No such file mkdir')).code, TransportErrorCodes.REMOTE_DIRECTORY_UNAVAILABLE);
  assert.equal(classifyTransportFailure(new Error('No space left on device')).code, TransportErrorCodes.INSUFFICIENT_SPACE);
  assert.equal(classifyTransportFailure(new Error('ECONNREFUSED')).code, TransportErrorCodes.SERVER_UNREACHABLE);
  assert.equal(classifyTransportFailure(new Error('socket closed')).code, TransportErrorCodes.TRANSFER_INTERRUPTED);
});

test('passwords are redacted from transport and classified logs', () => {
  const secret = 'super-secret-password';
  const error = classifyTransportFailure(new Error(`Authentication failed password=${secret}`), secret);
  const classified = classifyError(error);

  assert.doesNotMatch(error.message, new RegExp(secret));
  assert.doesNotMatch(classified.technicalMessage, new RegExp(secret));
});

test('failed transfer does not mark a remote package as uploaded', async () => {
  const { local } = await tempPackage();
  const stage = new TransferStage(() => ({
    async uploadPackage() {
      throw new TransportError(TransportErrorCodes.TRANSFER_INTERRUPTED, 'Transfert SFTP interrompu.');
    },
  }));

  await assert.rejects(
    () => stage.run({ packagePath: local, configuration: { destination: { type: 'fake' } }, logs: { user: [], technical: [] } }),
    { code: TransportErrorCodes.TRANSFER_INTERRUPTED },
  );
});

test('unknown transport type is rejected', () => {
  assert.throws(() => createTransport({ type: 'ftp' }), /Transport inconnu/);
});

function sftpDestination() {
  return {
    host: 'sftp.example.test',
    port: 2222,
    username: 'rft-user',
    password: 'top-secret-password',
    remotePath: '/remote/backups',
    timeoutMs: 3456,
  };
}

function fakeSftpClient({ remoteSize = 13, failAt } = {}) {
  const calls = [];
  const client = {
    calls,
    async connect(options) {
      calls.push(['connect', options]);
      if (failAt === 'connect') throw new Error(`Authentication failed for top-secret-password`);
    },
    async mkdir(remotePath, recursive) {
      calls.push(['mkdir', remotePath, recursive]);
      if (failAt === 'mkdir') throw new Error('Permission denied');
    },
    async fastPut(localPath, remotePath) {
      calls.push(['fastPut', localPath, remotePath]);
      if (failAt === 'fastPut') throw new Error('socket closed during transfer');
    },
    async stat(remotePath) {
      calls.push(['stat', remotePath]);
      if (failAt === 'stat') throw new Error('No such file');
      return { size: remoteSize };
    },
    async end() {
      calls.push(['end']);
    },
  };
  return client;
}

test('SftpTransport performs the complete upload sequence with injected client', async () => {
  const { local } = await tempPackage();
  const client = fakeSftpClient({ remoteSize: 13 });
  const transport = new SftpTransport(sftpDestination(), { clientFactory: () => client });

  const result = await transport.uploadPackage(local);

  assert.deepEqual(client.calls[0], ['connect', {
    host: 'sftp.example.test',
    port: 2222,
    username: 'rft-user',
    password: 'top-secret-password',
    readyTimeout: 3456,
  }]);
  assert.deepEqual(client.calls[1], ['mkdir', '/remote/backups', true]);
  assert.deepEqual(client.calls[2], ['fastPut', local, '/remote/backups/local.rftpkg']);
  assert.deepEqual(client.calls[3], ['stat', '/remote/backups/local.rftpkg']);
  assert.deepEqual(client.calls.at(-1), ['end']);
  assert.equal(result.remotePath, '/remote/backups/local.rftpkg');
  assert.equal(result.size, 13);
  assert.equal(result.hashValidated, false);
});

test('SftpTransport testConnection connects, creates the remote directory and closes', async () => {
  const client = fakeSftpClient();
  const transport = new SftpTransport(sftpDestination(), { clientFactory: () => client });

  const result = await transport.testConnection();

  assert.deepEqual(result, { ok: true, transport: 'sftp' });
  assert.deepEqual(client.calls.map(([name]) => name), ['connect', 'mkdir', 'end']);
  assert.deepEqual(client.calls[1], ['mkdir', '/remote/backups', true]);
});

test('SftpTransport returns validation_failed when remote size differs and still closes', async () => {
  const { local } = await tempPackage();
  const client = fakeSftpClient({ remoteSize: 12 });
  const transport = new SftpTransport(sftpDestination(), { clientFactory: () => client });

  await assert.rejects(() => transport.uploadPackage(local), (error) => {
    assert.equal(error.code, TransportErrorCodes.VALIDATION_FAILED);
    assert.doesNotMatch(error.message, /top-secret-password/);
    return true;
  });
  assert.deepEqual(client.calls.at(-1), ['end']);
});

test('SftpTransport closes and redacts password after client errors', async () => {
  const { local } = await tempPackage();
  const client = fakeSftpClient({ failAt: 'connect' });
  const transport = new SftpTransport(sftpDestination(), { clientFactory: () => client });

  await assert.rejects(() => transport.uploadPackage(local), (error) => {
    assert.equal(error.code, TransportErrorCodes.AUTHENTICATION_REFUSED);
    assert.doesNotMatch(error.message, /top-secret-password/);
    return true;
  });
  assert.deepEqual(client.calls.at(-1), ['end']);
});

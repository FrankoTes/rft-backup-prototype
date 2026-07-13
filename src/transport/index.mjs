import { LocalTransport } from './local.mjs';
import { SftpTransport } from './sftp.mjs';

export function createTransport(destination = {}) {
  const type = destination.type ?? 'sftp';
  if (type === 'local') return new LocalTransport(destination);
  if (type === 'sftp') return new SftpTransport(destination);
  throw new Error(`Transport inconnu: ${type}`);
}

export async function testDestinationConnection(destination) {
  return createTransport(destination).testConnection();
}

export { LocalTransport } from './local.mjs';
export { SftpTransport } from './sftp.mjs';
export { TransportError, TransportErrorCodes, classifyTransportFailure, redactSecret } from './errors.mjs';

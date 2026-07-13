import { stat } from 'node:fs/promises';
import path from 'node:path';
import { classifyTransportFailure, TransportError, TransportErrorCodes } from './errors.mjs';

function requireString(value, name, secret) {
  if (typeof value !== 'string' || value.trim() === '') throw new TransportError(TransportErrorCodes.INVALID_CONFIGURATION, `Paramètre SFTP invalide: ${name}.`, { secret });
}

export class SftpTransport {
  constructor(destination, options = {}) {
    this.destination = { port: 22, timeoutMs: 15000, ...destination };
    this.clientFactory = options.clientFactory;
  }

  async testConnection() {
    return this.#withClient(async (client) => {
      await client.mkdir(this.destination.remotePath, true);
      return { ok: true, transport: 'sftp' };
    });
  }

  async uploadPackage(localPackagePath) {
    return this.#withClient(async (client) => {
      await client.mkdir(this.destination.remotePath, true);
      const remotePath = path.posix.join(this.destination.remotePath, path.basename(localPackagePath));
      const localInfo = await stat(localPackagePath);
      await client.fastPut(localPackagePath, remotePath);
      const remoteInfo = await client.stat(remotePath);
      if (Number(remoteInfo.size) !== localInfo.size) throw new TransportError(TransportErrorCodes.VALIDATION_FAILED, 'Le fichier distant existe mais sa taille ne correspond pas au package local.', { secret: this.destination.password });
      return { remotePath, size: Number(remoteInfo.size), hashValidated: false, hashValidation: 'Le protocole SFTP standard ne fournit pas de hash distant portable sans relire le fichier.' };
    });
  }

  async #withClient(work) {
    this.#validate();
    const client = await this.#createClient();
    try {
      await client.connect({ host: this.destination.host, port: this.destination.port, username: this.destination.username, password: this.destination.password, readyTimeout: this.destination.timeoutMs });
      return await work(client);
    } catch (error) {
      throw classifyTransportFailure(error, this.destination.password);
    } finally {
      try { await client.end(); } catch {}
    }
  }

  async #createClient() {
    if (this.clientFactory) return this.clientFactory();

    let SftpClient;
    try {
      ({ default: SftpClient } = await import('ssh2-sftp-client'));
    } catch (error) {
      throw new TransportError(TransportErrorCodes.INVALID_CONFIGURATION, 'Dépendance SFTP manquante: installez ssh2-sftp-client pour utiliser le transport SFTP.', { cause: error, secret: this.destination.password });
    }

    return new SftpClient();
  }

  #validate() {
    requireString(this.destination.host, 'host', this.destination.password);
    requireString(this.destination.username, 'username', this.destination.password);
    requireString(this.destination.password, 'password', this.destination.password);
    requireString(this.destination.remotePath, 'remotePath', this.destination.password);
    if (!Number.isInteger(this.destination.port) || this.destination.port <= 0 || this.destination.port > 65535) throw new TransportError(TransportErrorCodes.INVALID_CONFIGURATION, 'Paramètre SFTP invalide: port.', { secret: this.destination.password });
    if (!Number.isInteger(this.destination.timeoutMs) || this.destination.timeoutMs <= 0) throw new TransportError(TransportErrorCodes.INVALID_CONFIGURATION, 'Paramètre SFTP invalide: timeoutMs.', { secret: this.destination.password });
  }
}

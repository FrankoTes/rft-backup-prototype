import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { TransportError, TransportErrorCodes } from './errors.mjs';

export class LocalTransport {
  constructor(destination) {
    this.destination = destination;
  }

  async testConnection() {
    this.#validate();
    await mkdir(this.destination.remotePath, { recursive: true });
    return { ok: true, transport: 'local' };
  }

  async uploadPackage(localPackagePath) {
    this.#validate();
    await mkdir(this.destination.remotePath, { recursive: true });
    const remotePath = path.join(this.destination.remotePath, path.basename(localPackagePath));
    await copyFile(localPackagePath, remotePath);
    const [localInfo, remoteInfo] = await Promise.all([stat(localPackagePath), stat(remotePath)]);
    if (localInfo.size !== remoteInfo.size) throw new TransportError(TransportErrorCodes.VALIDATION_FAILED, 'La taille du fichier local et distant ne correspond pas après transfert.');
    return { remotePath, size: remoteInfo.size, hashValidated: true };
  }

  #validate() {
    if (!this.destination?.remotePath) throw new TransportError(TransportErrorCodes.INVALID_CONFIGURATION, 'Chemin de destination local manquant.');
  }
}

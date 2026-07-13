import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRftPackage } from './package.mjs';
import { createTransport } from '../transport/index.mjs';

async function walk(folder) {
  const out = [];

  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const entryPath = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      out.push(...await walk(entryPath));
    } else if (entry.isFile()) {
      out.push(entryPath);
    }
  }

  return out;
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

function archiveRootNames(folders) {
  const used = new Map();

  return folders.map((folder) => {
    const baseName = path.basename(path.resolve(folder.path)) || 'root';
    const count = used.get(baseName) ?? 0;
    used.set(baseName, count + 1);
    return count === 0 ? baseName : `${baseName}-${count + 1}`;
  });
}

export class SelectionStage {
  name = 'Selection';

  async run(ctx) {
    ctx.logs.user.push('Sélection des dossiers à protéger.');
    ctx.selectedFiles = [];

    const folders = ctx.configuration.folders.filter((folder) => folder.included);
    const rootNames = archiveRootNames(folders);

    for (const [index, folder] of folders.entries()) {
      for (const file of await walk(folder.path)) {
        const fileStat = await stat(file);
        const relativePath = path.relative(folder.path, file);

        ctx.selectedFiles.push({
          sourcePath: file,
          sourceRoot: rootNames[index],
          relativePath,
          archivePath: path.join(rootNames[index], relativePath),
          size: fileStat.size,
          modifiedAt: fileStat.mtime.toISOString(),
          hash: await sha256(file),
        });
      }
    }

    return ctx;
  }
}

export class PreparationStage {
  name = 'Preparation';

  async run(ctx) {
    await mkdir(ctx.workingDirectory, { recursive: true });
    ctx.logs.user.push(`${ctx.selectedFiles.length} fichier(s) prêts pour la sauvegarde.`);
    return ctx;
  }
}

export class RftPackageStage {
  name = 'Optimization';

  async run(ctx) {
    ctx.packagePath = path.join(ctx.workingDirectory, `${ctx.configuration.id}-${Date.now()}.rftpkg`);
    const { manifest, packageHash } = await createRftPackage({
      configurationId: ctx.configuration.id,
      files: ctx.selectedFiles,
      packagePath: ctx.packagePath,
    });

    ctx.packageHash = packageHash;
    ctx.packageManifest = manifest;
    ctx.logs.technical.push(`Package ${ctx.packagePath} hash=${ctx.packageHash} files=${manifest.files.length}`);
    return ctx;
  }
}

export class TransferStage {
  name = 'Transfer';

  constructor(transportFactory = createTransport) {
    this.transportFactory = transportFactory;
  }

  async run(ctx) {
    if (!ctx.packagePath) throw new Error('Package missing');

    const transport = this.transportFactory(ctx.configuration.destination);
    const transfer = await transport.uploadPackage(ctx.packagePath);
    ctx.remotePackagePath = transfer.remotePath;
    ctx.remotePackageSize = transfer.size;
    ctx.remoteHashValidated = transfer.hashValidated;
    if (transfer.hashValidation) ctx.logs.technical.push(transfer.hashValidation);
    ctx.logs.user.push('Sauvegarde envoyée vers la destination configurée.');
    return ctx;
  }
}

export class LocalSftpTransferStage extends TransferStage {}

export class ValidationStage {
  name = 'Validation';

  async run(ctx) {
    if (ctx.remoteHashValidated === false) {
      ctx.logs.user.push('Présence et taille du package distant validées après transfert.');
      return ctx;
    }

    const remoteHash = await sha256(ctx.remotePackagePath);

    if (remoteHash !== ctx.packageHash) {
      throw new Error('Integrity hash mismatch after transfer');
    }

    ctx.logs.user.push('Intégrité validée après transfert.');
    return ctx;
  }
}

export class VersionManagementStage {
  name = 'Version Management';

  async run(ctx) {
    if (ctx.configuration.destination.type !== 'local') {
      ctx.logs.user.push(`Rétention distante non appliquée par ce prototype pour le transport ${ctx.configuration.destination.type ?? 'sftp'}.`);
      return ctx;
    }

    const versions = (await readdir(ctx.configuration.destination.remotePath))
      .filter((file) => file.endsWith('.rftpkg'))
      .sort()
      .reverse();

    for (const oldVersion of versions.slice(ctx.configuration.retention.count)) {
      await rm(path.join(ctx.configuration.destination.remotePath, oldVersion));
    }

    ctx.logs.user.push(`Rétention appliquée: conserver les ${ctx.configuration.retention.count} dernières versions.`);
    return ctx;
  }
}

export class CatalogStage {
  name = 'Catalog';

  async run(ctx) {
    ctx.version = {
      id: randomUUID(),
      configurationId: ctx.configuration.id,
      createdAt: new Date().toISOString(),
      fileCount: ctx.selectedFiles.length,
      totalBytes: ctx.selectedFiles.reduce((total, file) => total + file.size, 0),
      manifestHash: ctx.packageHash,
      remotePath: ctx.remotePackagePath,
    };

    return ctx;
  }
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';

export const RFT_PACKAGE_FORMAT = 'rft-backup-package';
export const RFT_PACKAGE_VERSION = 2;

export async function createRftPackage({ configurationId, files, packagePath }) {
  const entries = [];

  for (const file of files) {
    const content = await readFile(file.sourcePath);
    const contentHash = createHash('sha256').update(content).digest('hex');

    entries.push({
      sourceRoot: file.sourceRoot,
      archivePath: file.archivePath,
      originalRelativePath: file.relativePath,
      size: file.size,
      modifiedAt: file.modifiedAt,
      hash: contentHash,
      encoding: 'base64',
      data: content.toString('base64'),
    });
  }

  const manifest = {
    format: RFT_PACKAGE_FORMAT,
    version: RFT_PACKAGE_VERSION,
    configurationId,
    createdAt: new Date().toISOString(),
    storage: {
      contentEncoding: 'base64',
      compression: 'none',
      encryption: 'none',
      deduplication: 'none',
    },
    files: entries,
  };

  const body = JSON.stringify(manifest, null, 2);
  await writeFile(packagePath, body);

  return {
    manifest,
    packageHash: createHash('sha256').update(body).digest('hex'),
  };
}

export async function readRftPackage(packagePath) {
  const body = await readFile(packagePath, 'utf8');
  const manifest = JSON.parse(body);

  if (manifest.format !== RFT_PACKAGE_FORMAT) {
    throw new Error(`Unsupported RFT package format: ${manifest.format}`);
  }

  if (manifest.version !== RFT_PACKAGE_VERSION) {
    throw new Error(`Unsupported RFT package version: ${manifest.version}`);
  }

  return manifest;
}

export async function extractRftPackage(packagePath, destinationDirectory) {
  const manifest = await readRftPackage(packagePath);
  const restored = [];

  for (const file of manifest.files) {
    const content = Buffer.from(file.data, file.encoding);
    const hash = createHash('sha256').update(content).digest('hex');

    if (hash !== file.hash) {
      throw new Error(`Integrity hash mismatch while extracting ${file.archivePath}`);
    }

    const outputPath = path.join(destinationDirectory, file.archivePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
    const modifiedAt = new Date(file.modifiedAt);
    await utimes(outputPath, modifiedAt, modifiedAt);

    restored.push({
      outputPath,
      archivePath: file.archivePath,
      size: content.byteLength,
      hash,
      modifiedAt: file.modifiedAt,
    });
  }

  return { manifest, restored };
}

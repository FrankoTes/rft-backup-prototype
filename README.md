# RFT Backup Prototype MVP

This repository contains the first prototype of **RFT Backup**, designed around the SDS principle that backups should eliminate anxiety about data loss.

## Architecture decisions

- **JavaScript modules first**: the prototype separates domain models, error classification, service orchestration, pipeline stages and UI so each part can evolve independently.
- **Windows Service ready**: `src/service/service.mjs` is a long-running service entry point. In production it can be wrapped by a Windows Service host while the GUI remains independent.
- **Local SFTP adapter for MVP tests**: the transfer stage writes to the configured destination path to keep tests deterministic. The `Transfer` stage boundary is intentionally isolated so a real SFTP implementation can replace it without changing the pipeline.
- **RFT package v2**: the proprietary format is represented by self-contained `.rftpkg` JSON packages with hashes, metadata and Base64 file data. This keeps the MVP inspectable while preserving a block/dedup/compression/encryption-ready boundary.
- **Calm Windows 11-inspired UI**: the dependency-free web UI demonstrates left navigation, dashboard confidence indicators, configuration editing, activity, explorer and settings.


## Autonomous package format v2

The `.rftpkg` package now contains the real file bytes, not only metadata. The MVP deliberately stores file content as Base64 inside a JSON manifest so the format remains easy to inspect, validate and extract while avoiding compression, encryption and deduplication.

Each package preserves:

- the selected folder root name and full relative tree through `archivePath`;
- file names and nested directories;
- file size;
- modification timestamp;
- SHA-256 hash of the stored bytes;
- explicit storage flags showing `compression`, `encryption` and `deduplication` are `none`;
- Base64 encoded data that is sufficient to reconstruct files after the original sources are deleted.

`src/pipeline/package.mjs` exposes `createRftPackage`, `readRftPackage` and `extractRftPackage`. The extraction helper is intentionally not a restore engine or GUI workflow; it exists to prove that packages are self-contained and to keep the future restore architecture simple.

## Commands

- `npm run dev` starts the desktop-style prototype UI in a browser.
- `npm run service` starts the service prototype.
- `npm test` runs pipeline tests.
- `npm run build` checks runtime modules.

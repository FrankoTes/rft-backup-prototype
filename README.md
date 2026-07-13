# RFT Backup Prototype MVP

This repository contains the first prototype of **RFT Backup**, designed around the SDS principle that backups should eliminate anxiety about data loss.

## Architecture decisions

- **JavaScript modules first**: the prototype separates domain models, error classification, service orchestration, pipeline stages and UI so each part can evolve independently.
- **Windows Service ready**: `src/service/service.mjs` is a long-running service entry point. In production it can be wrapped by a Windows Service host while the GUI remains independent.
- **Local SFTP adapter for MVP tests**: the transfer stage writes to the configured destination path to keep tests deterministic. The `Transfer` stage boundary is intentionally isolated so a real SFTP implementation can replace it without changing the pipeline.
- **RFT package v1**: the proprietary format is represented by `.rftpkg` JSON manifests with hashes and file metadata. This keeps the MVP inspectable while preserving a block/dedup/compression/encryption-ready boundary.
- **Calm Windows 11-inspired UI**: the dependency-free web UI demonstrates left navigation, dashboard confidence indicators, configuration editing, activity, explorer and settings.

## Commands

- `npm run dev` starts the desktop-style prototype UI in a browser.
- `npm run service` starts the service prototype.
- `npm test` runs pipeline tests.
- `npm run build` checks runtime modules.

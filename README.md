# RFT Backup Prototype MVP

This repository contains the first prototype of **RFT Backup**, designed around the SDS principle that backups should eliminate anxiety about data loss.

## Architecture decisions

- **JavaScript modules first**: the prototype separates domain models, error classification, service orchestration, pipeline stages and UI so each part can evolve independently.
- **Windows Service ready**: `src/service/service.mjs` is a long-running service entry point. In production it can be wrapped by a Windows Service host while the GUI remains independent.
- **Transport architecture**: the backup pipeline depends on a `TransferStage` abstraction and not on a concrete destination. Production configurations use the SFTP transport, while the local transport remains available for deterministic automated tests.
- **RFT package v2**: the proprietary format is represented by self-contained `.rftpkg` JSON packages with hashes, metadata and Base64 file data. This keeps the MVP inspectable while preserving a block/dedup/compression/encryption-ready boundary.
- **Calm Windows 11-inspired UI**: the dependency-free web UI demonstrates left navigation, dashboard confidence indicators, configuration editing, activity, explorer and settings.


## Transport architecture and SFTP configuration

`src/transport/index.mjs` exposes `createTransport(destination)` and `testDestinationConnection(destination)`. The pipeline calls the transport abstraction from `TransferStage`; it does not know whether the package is copied locally for tests or uploaded to SFTP in production.

Supported destination types:

- `type: "sftp"` (default): uploads the `.rftpkg` package to a real SFTP server.
- `type: "local"`: copies the package to a local folder and is intended for automated tests only.

Example SFTP destination:

```json
{
  "type": "sftp",
  "host": "backup.example.com",
  "port": 22,
  "username": "rft-backup",
  "password": "provide-at-runtime",
  "remotePath": "/srv/backups/rft",
  "timeoutMs": 15000
}
```

The current prototype supports password authentication only. The password is passed to the SFTP client at runtime and is redacted from transport errors and logs. Test fixtures must use the local transport and must not store real secrets.

The SFTP transport creates the remote directory when necessary, uploads the `.rftpkg` file, closes the connection in a `finally` block, and verifies that the remote file exists with the same byte size as the local package. Portable remote SHA-256 validation is not implemented because standard SFTP servers do not expose a common hash operation without downloading the file again or running a server-specific command.

SFTP failures are translated into explicit categories: unreachable server, timeout, authentication refused, insufficient permissions, inaccessible remote directory, interrupted transfer, insufficient remote space when reported by the server, invalid configuration, and post-transfer validation failure.

To test a destination without running a full backup, call `testDestinationConnection(destination)` from `src/transport/index.mjs` with the same destination object used by the backup configuration.

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


## Local UI controller API

The demo UI now talks to a small local HTTP controller in `src/ui/server.mjs` instead of invoking pipeline stages directly from the browser. The development server explicitly binds to `127.0.0.1` and serves only files resolved inside `src/ui`. The controller delegates to `src/service/service.mjs`, which remains the source of truth for configurations, activity, saved versions and dashboard state. The service then invokes the existing backup pipeline and transport abstraction.

Available prototype endpoints include:

- `GET /api/state`, `GET /api/dashboard`, `GET /api/configurations`, `GET /api/activity` and `GET /api/versions` for read models used by the UI;
- `POST /api/configurations`, `PUT /api/configurations/:id`, `DELETE /api/configurations/:id` for configuration management;
- `POST /api/test-connection` for destination connectivity checks;
- `POST /api/configurations/:id/backup` for immediate manual backup execution.

API responses deliberately redact `destination.password`. Existing configurations therefore render the password input empty; leaving it empty during an edit keeps the existing password in the service state. This prototype still stores the secret in the local JSON state file so the end-to-end flow can run; secure secret storage is explicitly deferred to a dedicated future PR. Logs and public API responses must not include the password.

## Commands

- `npm run dev` starts the desktop-style prototype UI in a browser.
- `npm run service` starts the service prototype.
- `npm test` runs pipeline and transport unit tests. These tests use the local transport and do not require a public SFTP server.
- Future SFTP integration tests can instantiate `SftpTransport` with credentials for a controlled server, separate from the default unit test suite.
- `npm run build` checks runtime modules.

## Known prototype limits

- Remote retention is fully implemented for the local test transport. SFTP upload validation is implemented, but SFTP-side retention listing/deletion is intentionally deferred.
- Remote hash validation is documented but not performed unless a future controlled SFTP server exposes a portable hash capability.
- Compression, encryption and graphical restore remain outside the scope of this prototype iteration.

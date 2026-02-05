# Production Readiness Notes

This document covers operational guidance for running Smithers in production.

## Requirements
- Bun `>= 1.3` (Smithers uses Bun SQLite and Bun runtime APIs).
- SQLite for workflow and internal state.
- Optional: JJ (Jujutsu) for snapshot pointers.

## Deployment Modes
- **CLI**: `smithers run workflow.tsx --input '{}'`
- **Server**: `startServer({ port, rootDir, db, authToken, allowNetwork, maxBodyBytes })`

## Server Configuration
- `port`: Listening port (default `7331`).
- `rootDir`: Constrains workflow path resolution and tool sandboxing.
- `db`: Enables `/v1/runs` list endpoint and central run registry. When provided, events are mirrored into this DB for API queries.
- `authToken`: Required for API access when set (also via `SMITHERS_API_KEY`).
- `allowNetwork`: When `false`, the `bash` tool blocks network commands.
- `maxBodyBytes`: Max request size (default `1_048_576`).

## Environment Variables
- `SMITHERS_API_KEY`: Bearer token for server auth.
- `SMITHERS_DEBUG=1`: Enables extra server/engine logging.

## Resource Limits
Set via CLI or programmatic options:
- `maxConcurrency`: Max parallel tasks.
- `maxOutputBytes`: Max tool output bytes (default `200_000`).
- `toolTimeoutMs`: Tool timeout (default `60_000`).

## Observability
- Events are stored in `_smithers_events` and streamed over SSE.
- Default event log file for CLI runs: `.smithers/executions/<runId>/logs/stream.ndjson`.
- Consider log shipping (e.g., Filebeat) if you need centralized observability.

## Backups
SQLite files are the source of truth for runs and outputs.
- Use filesystem-level snapshots or periodic copies.
- For active runs, coordinate backups to avoid partial writes.

## Security
- Always set `authToken` in server mode.
- Keep `rootDir` narrow to the minimum required.
- Leave `allowNetwork` off unless you explicitly need network access for tools.
- Run the server behind a reverse proxy if you need rate limiting, TLS termination, or IP allowlisting.

## Upgrade Guidance
- Internal tables are created automatically by `ensureSmithersTables`.
- If schema changes are introduced, plan for a migration step (no migration runner is included yet).

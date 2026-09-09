# JEMP — Jobless Empire Discord Bot

One Discord bot, one PostgreSQL database, and one canonical JEMP identity and Timeline.

> **Jobless doesn't mean useless. No job. Still building.**

JEMP is deliberately a single modular bot—not a fleet of disconnected bots. Discord is the workflow interface; PostgreSQL is the source of record; Timeline events are only accepted from official systems and are immutable after creation.

## Included domains

- smart arrival, approved-email verification, membership states, JEMP# identities, and offboarding
- admin application whitelist and audit trail
- encrypted member profile / résumé metadata
- canonical receiver-only proof-of-work Timeline, export data, and expiring public shares
- B# Brainstorming lifecycle, applications, contributors, decisions, tasks, and milestones
- P# project lifecycle, roles, work updates, reports, incidents, and milestones
- HC# client/hiring opportunities and participation
- PAY# payroll ledger, transparent distribution proposals, approvals, and disputes
- channel-, role-, and workflow-aware controls. Admin operations are guarded both by role and by the configured operational channel.

## Quick start

1. Copy `.env.example` to `.env` and fill the secrets and Discord application values.
2. Create PostgreSQL and set `DATABASE_URL`.
3. Run `npm install`, `npm run db:generate`, then `npm run db:deploy` (the initial production migration is committed).
4. Register commands once with `npm run commands:deploy`.
5. Start with `npm run dev` (or build and use `npm start`).

The bot requires Discord's **Guild Members** intent. It needs only the scoped permissions it actually uses: manage roles, create/manage threads, send messages, and read message history. Do not grant Administrator.

## Production notes

- Put the API behind TLS/reverse proxy if integrations are not local. Restrict it to trusted JEMP services.
- Rotate `TIMELINE_SERVICE_SECRET` and `DATA_ENCRYPTION_KEY` using a managed secret store; do not commit them.
- Back up PostgreSQL and run `npm run db:deploy` during releases.
- For a local all-in-one stack, set strong secrets in `.env` and use `docker compose up --build`. Change the sample Postgres password before any non-local deployment.
- `TIMELINE_SERVICE_SECRET` is accepted in `x-jemp-signature` as an HMAC SHA-256 of the raw body, or in the legacy `x-timeline-service-secret` header during transition. Prefer HMAC.
- API event writes require an idempotency key, preventing duplicate Timeline entries when an upstream system retries.

See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for server setup, permissions, and the upstream event contract.

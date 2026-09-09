# JEMP operating contract

## Discord layout

Configure IDs in environment variables; the bot never hard-codes server layout.

| Area | Config | Intended audience |
|---|---|---|
| `#verify-me` | `VERIFY_ME_CHANNEL_ID` | Unverified members; verification card only |
| `#profile-manager` | `PROFILE_MANAGER_CHANNEL_ID` | Active members; private responses |
| `#applications` | `APPLICATIONS_CHANNEL_ID` | Admins only |
| `#onboarding-logs` | `ONBOARDING_LOG_CHANNEL_ID` | Public welcome notices only |
| `#bot-logs` | `BOT_LOG_CHANNEL_ID` | Admins only |
| B# / P# / HC# / PAY# hubs | respective channel ID | Active members / scoped staff |

Run `/jemp setup` in an admin channel to post or refresh the persistent verification card. A new Discord member is given `@Unverified`; they verify from the card using their approved application email. No verification slash command is exposed.

Discord only supports slash-command visibility via native permissions rather than database roles. Give the JEMP staff role **Manage Server** if it should see the admin command groups; the bot separately checks `ADMIN_ROLE_ID` and the configured private channel before performing any admin operation.

## Trusted Timeline event API

`POST /internal/v1/timeline/events`

Headers:

```http
content-type: application/json
x-jemp-source: project-service
x-jemp-idempotency-key: project-update-<stable-upstream-id>
x-jemp-signature: <hex HMAC-SHA256 of exact raw JSON body>
```

The HMAC key is `TIMELINE_SERVICE_SECRET`. During migration, a trusted existing sender may send `x-timeline-service-secret` instead. Remove that fallback after every sender uses HMAC.

```json
{
  "memberJempId": "JEMP#0042",
  "type": "WORK_UPDATE",
  "title": "Implemented responsive dashboard",
  "summary": "Shipped the first member-facing dashboard view.",
  "occurredAt": "2026-09-09T10:15:00.000Z",
  "visibility": "MEMBER_ONLY",
  "entity": { "kind": "PROJECT", "externalId": "P#003", "name": "JEMP dashboard" },
  "metadata": { "upstreamEventId": "abc123" }
}
```

The API validates identity and source, deduplicates by `(source, idempotency key)`, creates no new member identities, and returns the stored canonical event. It accepts events; it never scans Discord messages and never decides that an arbitrary message is proof of work.

## Data and security rules

- Database state is authoritative. Discord roles and messages are projections.
- `JEMP#`, `B#`, `P#`, `HC#`, and `PAY#` IDs are allocated transactionally and never reused.
- Audit rows are append-only under the application account. Restrict direct database write access.
- Store only encrypted profile/resume metadata; upload binary files to a private object store in a deployment integration, never to the database.
- Public Timeline links expire (24 hours by default), are revocable, and only expose events explicitly marked public.
- Do not expose detailed rejection, suspension, or email-matching outcomes to a member.

import Fastify from 'fastify';
import { EntityKind, TimelineEventType, TimelineVisibility, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Logger } from 'pino';
import { isDatabaseConfigured, isDiscordConfigured, type Env } from '../config/env.js';
import { constantTimeEquals, signBody } from '../lib/crypto.js';
import { DomainError } from '../lib/errors.js';
import { jempId } from '../lib/ids.js';
import { deploySlashCommands } from '../discord/deploy.js';
import { audit } from '../services/audit.js';
import { getTimeline, recordTimelineEvent, resolvePublicTimelineShare } from '../services/timeline.js';
import { AuditAction } from '@prisma/client';

const eventBody = z.object({
  memberJempId: z.string().regex(/^JEMP#\d+$/i),
  type: z.nativeEnum(TimelineEventType),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().max(4_000).optional(),
  occurredAt: z.string().datetime().optional(),
  visibility: z.nativeEnum(TimelineVisibility).optional(),
  entity: z.object({
    kind: z.nativeEnum(EntityKind),
    externalId: z.string().trim().min(1).max(120),
    name: z.string().trim().max(180).optional()
  }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

function html(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]!));
}

function publicTimelineHtml(memberId: string, events: Array<{ occurredAt: Date; title: string; summary: string | null; entityName: string | null }>, expiresAt: Date) {
  const entries = events.length
    ? events.map((event) => `<article><time>${html(event.occurredAt.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }))}</time><h2>${html(event.title)}</h2>${event.summary ? `<p>${html(event.summary)}</p>` : ''}${event.entityName ? `<small>${html(event.entityName)}</small>` : ''}</article>`).join('')
    : '<p>No public proof-of-work entries are available for this Timeline.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${html(memberId)} — Jobless Empire Timeline</title><style>body{margin:0;background:#0c0c0d;color:#f4f1ed;font:16px/1.55 Inter,system-ui,sans-serif}.page{max-width:780px;margin:auto;padding:56px 24px}header{border-left:4px solid #a32020;padding-left:20px;margin-bottom:36px}h1{font-size:30px;margin:0}h2{font-size:18px;margin:7px 0}article{border:1px solid #302a2a;border-radius:8px;background:#141314;padding:18px 20px;margin:14px 0}time,small,.muted{color:#bdb3ac;font-size:13px}p{white-space:pre-wrap;margin-bottom:0}footer{margin-top:32px;color:#a89c94;font-size:12px}</style></head><body><main class="page"><header><div class="muted">JOBLESS EMPIRE · PUBLIC PROOF OF WORK</div><h1>${html(memberId)}</h1><p>Jobless doesn't mean useless. No job. Still building.</p></header>${entries}<footer>This revocable share link expires ${html(expiresAt.toISOString())}. It includes only Timeline records marked public by its owner.</footer></main></body></html>`;
}

function rootDashboardHtml(env: Env) {
  const isDiscordActive = isDiscordConfigured(env);
  const isDbActive = isDatabaseConfigured(env);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>JEMP Discord Bot — Jobless Empire</title>
  <meta name="description" content="Jobless Empire Discord ecosystem bot and internal timeline API service">
  <style>
    body { margin: 0; background: #0c0c0d; color: #f4f1ed; font: 16px/1.55 Inter, system-ui, -apple-system, sans-serif; }
    .page { max-width: 820px; margin: auto; padding: 48px 24px; }
    header { border-left: 4px solid #a32020; padding-left: 20px; margin-bottom: 32px; }
    h1 { font-size: 28px; margin: 0 0 6px 0; letter-spacing: -0.01em; }
    h2 { font-size: 18px; margin: 0 0 12px 0; color: #f4f1ed; }
    .tagline { color: #bdb3ac; font-size: 15px; margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; margin: 24px 0 32px 0; }
    .card { border: 1px solid #302a2a; border-radius: 8px; background: #141314; padding: 18px 20px; }
    .card-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #a89c94; margin-bottom: 8px; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .dot-green { background: #22c55e; box-shadow: 0 0 8px rgba(34, 197, 94, 0.4); }
    .dot-yellow { background: #eab308; box-shadow: 0 0 8px rgba(234, 179, 8, 0.4); }
    .section { border: 1px solid #282424; border-radius: 8px; background: #121112; padding: 20px 22px; margin-bottom: 20px; }
    .endpoint { display: flex; align-items: baseline; gap: 10px; margin: 10px 0; font-family: ui-monospace, monospace; font-size: 14px; flex-wrap: wrap; }
    .method { background: #242020; color: #e59393; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .method-get { color: #86efac; }
    .method-post { color: #93c5fd; }
    .desc { color: #a89c94; font-size: 13px; font-family: Inter, system-ui, sans-serif; }
    a { color: #f87171; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #1c1b1c; border: 1px solid #2e2a2a; border-radius: 4px; padding: 2px 6px; font-size: 13px; color: #fca5a5; font-family: ui-monospace, monospace; }
    footer { margin-top: 36px; border-top: 1px solid #282424; padding-top: 18px; color: #7f746d; font-size: 13px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  </style>
</head>
<body>
  <main class="page">
    <header>
      <div style="color: #a89c94; font-size: 13px; letter-spacing: 0.05em; font-weight: 600;">JOBLESS EMPIRE · ECOSYSTEM BOT</div>
      <h1>JEMP Service Console</h1>
      <p class="tagline">Jobless doesn't mean useless. No job. Still building.</p>
    </header>

    <div class="grid">
      <div class="card">
        <div class="card-title">HTTP API Service</div>
        <div class="status-badge"><span class="dot dot-green"></span> Listening on Port ${env.INTERNAL_API_PORT}</div>
      </div>
      <div class="card">
        <div class="card-title">Database Storage</div>
        <div class="status-badge">
          <span class="dot ${isDbActive ? 'dot-green' : 'dot-yellow'}"></span>
          ${isDbActive ? 'PostgreSQL Connected' : 'In-Memory Fallback Active'}
        </div>
      </div>
      <div class="card">
        <div class="card-title">Discord Bot Client</div>
        <div class="status-badge">
          <span class="dot ${isDiscordActive ? 'dot-green' : 'dot-yellow'}"></span>
          ${isDiscordActive ? 'Token Configured' : 'Awaiting DISCORD_TOKEN'}
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Service Endpoints</h2>
      <div class="endpoint">
        <span class="method method-get">GET</span>
        <a href="/health">/health</a>
        <span class="desc">— System health probe and readiness check</span>
      </div>
      <div class="endpoint">
        <span class="method method-post">POST</span>
        <span>/internal/v1/timeline/events</span>
        <span class="desc">— Ingest signed canonical Timeline events</span>
      </div>
      <div class="endpoint">
        <span class="method method-get">GET</span>
        <span>/public/timeline/:token</span>
        <span class="desc">— Public proof-of-work Timeline page</span>
      </div>
      <div class="endpoint">
        <span class="method method-get">GET</span>
        <span>/internal/v1/members/:jempId/timeline</span>
        <span class="desc">— Internal member timeline audit events</span>
      </div>
      <div class="endpoint">
        <span class="method method-post">POST</span>
        <span>/internal/v1/commands/deploy</span>
        <span class="desc">— Deploy latest slash commands to Discord</span>
      </div>
    </div>

    <div class="section">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 12px;">
        <h2 style="margin: 0;">Discord Slash Commands</h2>
        <button id="sync-commands-btn" onclick="syncCommands()" style="background: #a32020; color: #f4f1ed; border: none; border-radius: 6px; padding: 8px 16px; font-weight: 600; cursor: pointer; font-size: 14px; font-family: Inter, system-ui, sans-serif; transition: opacity 0.15s;">
          ⚡ Sync Slash Commands to Discord
        </button>
      </div>
      <div id="sync-result" style="display: none; padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 14px;"></div>
      <p style="margin: 0 0 10px 0; color: #bdb3ac; font-size: 14px;">
        Registered command groups: <code>/jemp</code>, <code>/onboard</code>, <code>/profile</code>, <code>/timeline</code>, <code>/brainstorm</code>, <code>/project</code>, <code>/opportunity</code>, <code>/payroll</code>.
      </p>
      <p style="margin: 0; color: #8c827a; font-size: 13px;">
        💡 Tip: If you just updated commands or don't see them, click <strong>Sync Slash Commands to Discord</strong>, then press <code>Ctrl + R</code> (or <code>Cmd + R</code>) in your Discord desktop client to force-refresh Discord's command autocomplete cache. Admin commands (<code>/jemp</code>, <code>/onboard</code>, <code>/opportunity</code>, <code>/payroll</code>) require Manage Server permissions.
      </p>
    </div>

    <div class="section">
      <h2>Environment &amp; Integration</h2>
      <p style="margin: 0 0 12px 0; color: #bdb3ac; font-size: 14px;">
        To connect the Discord Bot to your server, configure your Discord Application credentials in the environment:
      </p>
      <ul style="margin: 0; padding-left: 20px; color: #d6cfc7; font-size: 14px; line-height: 1.8;">
        <li><code>DISCORD_TOKEN</code> — Bot token from Discord Developer Portal</li>
        <li><code>DISCORD_APPLICATION_ID</code> — Discord Application Client ID</li>
        <li><code>DISCORD_GUILD_ID</code> — Target Discord server / guild ID</li>
        <li><code>DATABASE_URL</code> — PostgreSQL connection string</li>
      </ul>
    </div>

    <footer>
      <span>JEMP ecosystem v0.1.0</span>
      <span>Canonical JEMP identity &amp; timeline</span>
    </footer>
  </main>
  <script>
    async function syncCommands() {
      const btn = document.getElementById('sync-commands-btn');
      const resEl = document.getElementById('sync-result');
      btn.disabled = true;
      btn.textContent = 'Syncing commands...';
      try {
        const res = await fetch('/internal/v1/commands/deploy', { method: 'POST' });
        const data = await res.json();
        resEl.style.display = 'block';
        if (res.ok && data.status === 'ok') {
          resEl.style.background = 'rgba(34, 197, 94, 0.15)';
          resEl.style.color = '#86efac';
          resEl.style.border = '1px solid #166534';
          resEl.textContent = '✅ ' + data.message + ' (' + data.scope + (data.guildId ? ': ' + data.guildId : '') + ')! If not visible in Discord yet, press Ctrl+R in Discord to refresh cache.';
        } else {
          resEl.style.background = 'rgba(239, 68, 68, 0.15)';
          resEl.style.color = '#fca5a5';
          resEl.style.border = '1px solid #991b1b';
          resEl.textContent = '❌ ' + (data.message || 'Error syncing commands');
        }
      } catch (err) {
        resEl.style.display = 'block';
        resEl.style.background = 'rgba(239, 68, 68, 0.15)';
        resEl.style.color = '#fca5a5';
        resEl.style.border = '1px solid #991b1b';
        resEl.textContent = '❌ Failed: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = '⚡ Sync Slash Commands to Discord';
      }
    }
  </script>
</body>
</html>`;
}

export function createInternalApi({ db, env, logger }: { db: PrismaClient; env: Env; logger: Logger }) {
  const app = Fastify({ loggerInstance: logger, trustProxy: env.TRUST_PROXY, bodyLimit: 256 * 1024 });
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => done(null, body));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) return reply.status(error.code === 'SHARE_UNAVAILABLE' ? 404 : 400).send({ error: error.code, message: error.expose ? error.message : 'Request rejected.' });
    request.log.error({ err: error }, 'internal api error');
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'The request could not be processed.' });
  });

  app.get('/', async (request, reply) => {
    const accept = request.headers.accept || '';
    if (accept.includes('application/json') && !accept.includes('text/html')) {
      return {
        service: 'jemp-discord-bot',
        status: 'online',
        port: env.INTERNAL_API_PORT,
        endpoints: {
          health: '/health',
          timelineEvents: '/internal/v1/timeline/events',
          publicTimeline: '/public/timeline/:token',
          memberTimeline: '/internal/v1/members/:jempId/timeline'
        }
      };
    }
    return reply.type('text/html; charset=utf-8').send(rootDashboardHtml(env));
  });

  app.get('/health', async () => ({ status: 'ok', service: 'jemp-timeline-receiver' }));

  app.post('/internal/v1/commands/deploy', async (_request, reply) => {
    try {
      const result = await deploySlashCommands(env, logger);
      return {
        status: 'ok',
        message: `Registered ${result.count} JEMP slash command groups`,
        scope: result.scope,
        guildId: result.guildId
      };
    } catch (error: any) {
      reply.status(500);
      return {
        status: 'error',
        message: error?.message || 'Failed to deploy slash commands to Discord'
      };
    }
  });

  function requireInternalSecret(value: string | string[] | undefined) {
    if (typeof value !== 'string' || !constantTimeEquals(value, env.TIMELINE_SERVICE_SECRET)) throw new DomainError('Internal service authentication failed.', 'UNAUTHORIZED');
  }

  app.post('/internal/v1/timeline/events', async (request, reply) => {
    const raw = typeof request.body === 'string' ? request.body : '';
    if (!raw) throw new DomainError('A JSON request body is required.', 'INVALID_BODY');
    const source = request.headers['x-jemp-source'];
    const idempotencyKey = request.headers['x-jemp-idempotency-key'];
    const signature = request.headers['x-jemp-signature'];
    const legacySecret = request.headers['x-timeline-service-secret'];
    if (typeof source !== 'string' || !/^[a-z][a-z0-9_-]{1,63}$/.test(source)) throw new DomainError('A valid x-jemp-source header is required.', 'INVALID_SOURCE');
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 180) throw new DomainError('A valid x-jemp-idempotency-key header is required.', 'INVALID_IDEMPOTENCY_KEY');
    const validHmac = typeof signature === 'string' && constantTimeEquals(signature, signBody(raw, env.TIMELINE_SERVICE_SECRET));
    const validLegacy = typeof legacySecret === 'string' && constantTimeEquals(legacySecret, env.TIMELINE_SERVICE_SECRET);
    if (!validHmac && !validLegacy) throw new DomainError('Timeline authentication failed.', 'UNAUTHORIZED');
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw new DomainError('Request body must contain valid JSON.', 'INVALID_BODY'); }
    const parsed = eventBody.safeParse(json);
    if (!parsed.success) throw new DomainError('Timeline event payload is invalid.', 'INVALID_EVENT');
    const memberNumber = Number(parsed.data.memberJempId.slice(5));
    const member = await db.member.findUnique({ where: { jempNumber: memberNumber } });
    if (!member) throw new DomainError('Timeline member identity is unknown.', 'MEMBER_NOT_FOUND');
    const result = await recordTimelineEvent(db, {
      memberId: member.id,
      type: parsed.data.type,
      title: parsed.data.title,
      summary: parsed.data.summary,
      source,
      idempotencyKey,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date(),
      visibility: parsed.data.visibility,
      entity: parsed.data.entity,
      metadata: parsed.data.metadata as never
    });
    if (result.wasCreated) await audit(db, { action: AuditAction.TIMELINE_RECORDED, entityKind: parsed.data.entity?.kind, entityExternalId: parsed.data.entity?.externalId, summary: `Timeline event recorded by trusted ${source} service.`, metadata: { source, eventId: result.event.id, legacyAuthentication: validLegacy } });
    return reply.status(result.wasCreated ? 201 : 200).send({ id: result.event.id, canonical: true, duplicate: !result.wasCreated, memberJempId: jempId(member.jempNumber), occurredAt: result.event.occurredAt.toISOString() });
  });

  app.get('/public/timeline/:token', async (request, reply) => {
    const token = z.string().min(20).parse((request.params as { token?: string }).token);
    const share = await resolvePublicTimelineShare(db, token);
    return reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
      .header('x-robots-tag', 'noindex, nofollow')
      .type('text/html; charset=utf-8')
      .send(publicTimelineHtml(share.memberJempId, share.events, share.expiresAt));
  });

  app.get('/internal/v1/members/:jempId/timeline', async (request) => {
    requireInternalSecret(request.headers['x-timeline-service-secret']);
    const rawId = z.string().regex(/^JEMP#\d+$/i).parse((request.params as { jempId?: string }).jempId);
    const number = Number(rawId.slice(5));
    const member = await db.member.findUnique({ where: { jempNumber: number } });
    if (!member) throw new DomainError('Timeline member identity is unknown.', 'MEMBER_NOT_FOUND');
    const timeline = await getTimeline(db, member.id);
    return { memberJempId: jempId(member.jempNumber), events: timeline.events.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString(), createdAt: event.createdAt.toISOString() })) };
  });
  return app;
}

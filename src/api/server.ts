import Fastify from 'fastify';
import { EntityKind, TimelineEventType, TimelineVisibility, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import { constantTimeEquals, signBody } from '../lib/crypto.js';
import { DomainError } from '../lib/errors.js';
import { jempId } from '../lib/ids.js';
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

export function createInternalApi({ db, env, logger }: { db: PrismaClient; env: Env; logger: Logger }) {
  const app = Fastify({ loggerInstance: logger, trustProxy: env.TRUST_PROXY, bodyLimit: 256 * 1024 });
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => done(null, body));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) return reply.status(error.code === 'SHARE_UNAVAILABLE' ? 404 : 400).send({ error: error.code, message: error.expose ? error.message : 'Request rejected.' });
    request.log.error({ err: error }, 'internal api error');
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'The request could not be processed.' });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'jemp-timeline-receiver' }));

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

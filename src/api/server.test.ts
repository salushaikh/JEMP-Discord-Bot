import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { createLogger, createPrisma } from '../db/client.js';
import { createInternalApi } from './server.js';

describe('JEMP Internal API & Dashboard', () => {
  const env = loadEnv();
  const logger = createLogger(env);
  const db = createPrisma(logger);
  const app = createInternalApi({ db, env, logger });

  it('responds with ok on /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.body);
    expect(json.status).toBe('ok');
    expect(json.service).toBe('jemp-timeline-receiver');
  });

  it('serves the Jobless Empire console dashboard on GET /', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('JEMP Service Console');
    expect(response.body).toContain("Jobless doesn't mean useless. No job. Still building.");
  });

  it('returns JSON status on GET / when JSON is preferred', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { accept: 'application/json' }
    });
    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.body);
    expect(json.service).toBe('jemp-discord-bot');
    expect(json.status).toBe('online');
    expect(json.endpoints.health).toBe('/health');
  });
});

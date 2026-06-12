import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

describe('GET /api/health', () => {
  it('is reachable without authentication and reports status + version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string; version: string;
      backend: { status: string; version: string; uptimeSeconds: number };
      frontend: { status: string; version: string };
    };
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.backend.status).toBe('ok');
    expect(typeof body.backend.uptimeSeconds).toBe('number');
    expect(body.version).toBe(body.backend.version);
    expect(['served', 'missing']).toContain(body.frontend.status);
  });

  it('reflects GIT_SHA when set', async () => {
    process.env.GIT_SHA = 'abc1234';
    const fresh = await buildApp({ logger: false, rateLimit: false, helmet: false });
    const res = await fresh.inject({ method: 'GET', url: '/api/health' });
    expect((res.json() as { version: string }).version).toBe('abc1234');
    delete process.env.GIT_SHA;
  });
});

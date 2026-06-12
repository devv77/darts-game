import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { DATA_DIR } from '../src/db.js';
import { bearer, createHumanWithSession, resetDb, getAi } from './helpers.js';
import type { Player } from '../src/types.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

// 1×1 transparent PNG
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478' +
  '9c6200010000050001' + '0d0a2db4' + '0000000049454e44ae426082',
  'hex',
);

function multipartPng(token: string, png = PNG, contentType = 'image/png', filename = 'a.png') {
  const boundary = '----darttest';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { headers: { ...bearer(token), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body };
}

describe('admin flag toggle', () => {
  beforeEach(() => resetDb());

  it('non-admin cannot grant admin (403)', async () => {
    const a = createHumanWithSession('Alice');
    const b = createHumanWithSession('Bob');
    const res = await app.inject({ method: 'POST', url: `/api/players/${b.player.id}/admin`, headers: bearer(a.token), payload: { isAdmin: true } });
    expect(res.statusCode).toBe(403);
  });

  it('admin grants then revokes the DB admin flag', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const boss = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss' });
    const target = createHumanWithSession('Target');

    const grant = await app.inject({ method: 'POST', url: `/api/players/${target.player.id}/admin`, headers: bearer(boss.token), payload: { isAdmin: true } });
    expect(grant.statusCode).toBe(200);
    expect((grant.json() as Player).is_admin).toBe(1);

    // The promoted user is now admin per /api/auth/me.
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(target.token) });
    expect((me.json() as { isAdmin: boolean }).isAdmin).toBe(true);

    const revoke = await app.inject({ method: 'POST', url: `/api/players/${target.player.id}/admin`, headers: bearer(boss.token), payload: { isAdmin: false } });
    expect((revoke.json() as Player).is_admin).toBe(0);
    process.env.ADMIN_EMAILS = '';
  });

  it('a DB-flagged admin can then promote others (flag alone grants admin)', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const boss = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss2' });
    const mod = createHumanWithSession('Mod');
    await app.inject({ method: 'POST', url: `/api/players/${mod.player.id}/admin`, headers: bearer(boss.token), payload: { isAdmin: true } });
    process.env.ADMIN_EMAILS = ''; // remove env admin; mod stays admin via flag

    const victim = createHumanWithSession('Victim');
    const res = await app.inject({ method: 'POST', url: `/api/players/${victim.player.id}/admin`, headers: bearer(mod.token), payload: { isAdmin: true } });
    expect(res.statusCode).toBe(200);
  });

  it('cannot make an AI player admin (400); 404 for unknown', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const boss = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss3' });
    const ai = getAi(5);
    expect((await app.inject({ method: 'POST', url: `/api/players/${ai.id}/admin`, headers: bearer(boss.token), payload: { isAdmin: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/players/99999/admin', headers: bearer(boss.token), payload: { isAdmin: true } })).statusCode).toBe(404);
    process.env.ADMIN_EMAILS = '';
  });
});

describe('avatar upload', () => {
  const created: number[] = [];
  beforeEach(() => resetDb());
  afterAll(() => {
    for (const id of created) for (const e of ['jpg', 'png', 'webp']) fs.rmSync(path.join(DATA_DIR, 'avatars', `${id}.${e}`), { force: true });
  });

  it('owner uploads a PNG → avatar_url set; GET serves it', async () => {
    const a = createHumanWithSession('Alice');
    created.push(a.player.id);
    const up = await app.inject({ method: 'POST', url: `/api/players/${a.player.id}/avatar`, ...multipartPng(a.token) });
    expect(up.statusCode).toBe(200);
    const body = up.json() as Player;
    expect(body.avatar_url).toMatch(new RegExp(`^/api/players/${a.player.id}/avatar\\?v=`));

    const get = await app.inject({ method: 'GET', url: `/api/players/${a.player.id}/avatar` });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
  });

  it('rejects a non-image type (400)', async () => {
    const a = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'POST', url: `/api/players/${a.player.id}/avatar`, ...multipartPng(a.token, Buffer.from('hello'), 'text/plain', 'x.txt') });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an image larger than 5 MB (413) and leaves avatar_url unset', async () => {
    const a = createHumanWithSession('Alice');
    const big = Buffer.alloc(6 * 1024 * 1024, 0x2a); // 6 MB, declared image/png
    const res = await app.inject({ method: 'POST', url: `/api/players/${a.player.id}/avatar`, ...multipartPng(a.token, big, 'image/png', 'big.png') });
    expect(res.statusCode).toBe(413);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(a.token) });
    expect((me.json() as { player: { avatar_url: string | null } }).player.avatar_url).toBeNull();
  });

  it('a non-owner non-admin cannot upload for someone else (403)', async () => {
    const a = createHumanWithSession('Alice');
    const b = createHumanWithSession('Bob');
    const res = await app.inject({ method: 'POST', url: `/api/players/${b.player.id}/avatar`, ...multipartPng(a.token) });
    expect(res.statusCode).toBe(403);
  });

  it('admin can upload for another player', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const boss = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss4' });
    const target = createHumanWithSession('Target');
    created.push(target.player.id);
    const res = await app.inject({ method: 'POST', url: `/api/players/${target.player.id}/avatar`, ...multipartPng(boss.token) });
    expect(res.statusCode).toBe(200);
    process.env.ADMIN_EMAILS = '';
  });

  it('GET avatar 404 when none uploaded', async () => {
    const a = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'GET', url: `/api/players/${a.player.id}/avatar` });
    expect(res.statusCode).toBe(404);
  });
});

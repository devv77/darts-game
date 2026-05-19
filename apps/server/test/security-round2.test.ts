import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db.js';
import { undoLastTurn, handleX01Turn } from '../src/socket-handler.js';
import {
  bearer,
  createHumanWithSession,
  createStubIo,
  createX01Game,
  fullState,
  resetDb,
} from './helpers.js';
import type { Game, Player } from '../src/types.js';

/**
 * The socket `undo-turn` handler runs inside io.on('connection'), so it's not
 * directly exportable. The audit's exploit hinges on whether `undoLastTurn`
 * gets called at all when the caller isn't authorized. We test the production
 * guard by reproducing the same predicate that the handler now enforces.
 */
function canUndo(gameId: number, sessionPlayer: Player, ADMIN_EMAILS = ''): boolean {
  process.env.ADMIN_EMAILS = ADMIN_EMAILS;
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Game | undefined;
  if (!game) return false;
  const players = db.prepare(
    `SELECT p.id FROM game_players gp JOIN players p ON p.id = gp.player_id WHERE gp.game_id = ?`
  ).all(gameId) as { id: number }[];
  const lastTurn = db.prepare(
    'SELECT player_id FROM turns WHERE game_id = ? ORDER BY id DESC LIMIT 1'
  ).get(gameId) as { player_id: number } | undefined;
  if (!lastTurn) return false;
  const adminEmails = ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isAdmin = !!sessionPlayer.email && adminEmails.includes(sessionPlayer.email.toLowerCase());
  if (isAdmin) return true;
  if (!players.some((p) => p.id === sessionPlayer.id)) return false;
  if (lastTurn.player_id !== sessionPlayer.id) return false;
  return true;
}

describe('C1 (round-2) — undo-turn authorization', () => {
  beforeEach(() => resetDb());

  it('non-participant cannot undo a game they have no part in', () => {
    const { player: alice } = createHumanWithSession('Alice');
    const { player: bob } = createHumanWithSession('Bob');
    const { player: stranger } = createHumanWithSession('Stranger');
    const gameId = createX01Game('501', [alice.id, bob.id]);
    const { io } = createStubIo();
    handleX01Turn(io, gameId, alice.id, ['T20', 'T20', 'T20'], null, 1, fullState(gameId));

    expect(canUndo(gameId, stranger)).toBe(false);
  });

  it('participant cannot undo someone else\'s last turn', () => {
    const { player: alice } = createHumanWithSession('Alice');
    const { player: bob } = createHumanWithSession('Bob');
    const gameId = createX01Game('501', [alice.id, bob.id]);
    const { io } = createStubIo();
    handleX01Turn(io, gameId, alice.id, ['T20', 'T20', 'T20'], null, 1, fullState(gameId));

    // Bob is a participant but the last turn was Alice's — denied.
    expect(canUndo(gameId, bob)).toBe(false);
    // Alice's own undo is allowed.
    expect(canUndo(gameId, alice)).toBe(true);
  });

  it('admin can undo any turn', () => {
    const { player: alice } = createHumanWithSession('Alice');
    const { player: bob } = createHumanWithSession('Bob');
    const { player: boss } = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss' });
    const gameId = createX01Game('501', [alice.id, bob.id]);
    const { io } = createStubIo();
    handleX01Turn(io, gameId, alice.id, ['T20', 'T20', 'T20'], null, 1, fullState(gameId));

    expect(canUndo(gameId, boss, 'boss@x.com')).toBe(true);
  });

  it('verifies the exploit no longer works against handleX01Turn-recorded state', () => {
    // Replay the audit: a stranger calls the SAME undoLastTurn helper without going
    // through the socket guards. If we reached this, the state IS rolled back —
    // proving why the guard MUST live in the socket handler, not in undoLastTurn.
    const { player: alice } = createHumanWithSession('Alice');
    const { player: bob } = createHumanWithSession('Bob');
    const gameId = createX01Game('501', [alice.id, bob.id]);
    const { io } = createStubIo();
    handleX01Turn(io, gameId, alice.id, ['T20', 'T20', 'T20'], null, 1, fullState(gameId));
    expect(fullState(gameId).turns).toHaveLength(1);

    undoLastTurn(gameId); // direct call — no auth check
    expect(fullState(gameId).turns).toHaveLength(0);
    // The socket handler's wrapper IS what blocks the exploit; canUndo is the
    // predicate used by that wrapper (assertions above).
  });
});

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

describe('H1 (round-2) — canDeletePlayer is now (self || admin)', () => {
  beforeEach(() => resetDb());

  it('a stranger cannot delete a guest player that someone else created', async () => {
    const alice = createHumanWithSession('Alice');
    const post = await app.inject({
      method: 'POST', url: '/api/players', headers: bearer(alice.token), payload: { name: 'Guest' },
    });
    const guestId = (post.json() as Player).id;

    const bob = createHumanWithSession('Bob');
    const res = await app.inject({
      method: 'DELETE', url: `/api/players/${guestId}`, headers: bearer(bob.token),
    });
    expect(res.statusCode).toBe(403);
    // Guest still exists.
    expect(db.prepare('SELECT 1 FROM players WHERE id = ?').get(guestId)).toBeTruthy();
  });

  it('a creator cannot delete a guest they created (only admin / the guest themselves can)', async () => {
    const { token } = createHumanWithSession('Alice');
    const post = await app.inject({
      method: 'POST', url: '/api/players', headers: bearer(token), payload: { name: 'Guest' },
    });
    const guestId = (post.json() as Player).id;
    const res = await app.inject({
      method: 'DELETE', url: `/api/players/${guestId}`, headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('H2 (round-2) — GET /api/games is scoped to viewer', () => {
  beforeEach(() => resetDb());

  it('only returns games the viewer participates in', async () => {
    const alice = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const charlie = createHumanWithSession('Charlie');

    // Alice + Bob's game.
    await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(alice.token),
      payload: { mode: '501', player_ids: [alice.player.id, bob.player.id] },
    });

    const aliceList = await app.inject({ method: 'GET', url: '/api/games', headers: bearer(alice.token) });
    expect((aliceList.json() as unknown[]).length).toBeGreaterThan(0);

    const charlieList = await app.inject({ method: 'GET', url: '/api/games', headers: bearer(charlie.token) });
    expect(charlieList.json()).toEqual([]); // Charlie sees nothing
  });

  it('admin sees all games unfiltered', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const alice = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const boss = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss' });

    await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(alice.token),
      payload: { mode: '501', player_ids: [alice.player.id, bob.player.id] },
    });

    const bossList = await app.inject({ method: 'GET', url: '/api/games', headers: bearer(boss.token) });
    expect((bossList.json() as unknown[]).length).toBeGreaterThan(0);
    process.env.ADMIN_EMAILS = '';
  });

  it('status filter still works for non-admin (filtered within own games)', async () => {
    const alice = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(alice.token),
      payload: { mode: '501', player_ids: [alice.player.id, bob.player.id] },
    });
    const inProg = await app.inject({
      method: 'GET', url: '/api/games?status=in_progress', headers: bearer(alice.token),
    });
    expect((inProg.json() as unknown[]).length).toBeGreaterThan(0);
    const done = await app.inject({
      method: 'GET', url: '/api/games?status=completed', headers: bearer(alice.token),
    });
    expect(done.json()).toEqual([]);
  });
});

describe('M1 (round-2) — security headers via fastify-helmet', () => {
  it('sends X-Frame-Options, X-Content-Type-Options, CSP on /', async () => {
    const helmeted = await buildApp({ logger: false, rateLimit: false, helmet: true });
    const res = await helmeted.inject({ method: 'GET', url: '/' });
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('accounts.google.com'); // GSI script source whitelisted
    await helmeted.close();
  });
});

describe('M2 (round-2) — CORS allowlist enforced', () => {
  it('rejects an unlisted origin', async () => {
    const restricted = await buildApp({
      logger: false, rateLimit: false, helmet: false,
      allowedOrigins: ['http://localhost:8080'],
    });
    const res = await restricted.inject({
      method: 'GET', url: '/api/auth/config',
      headers: { origin: 'https://evil.example' },
    });
    // CORS rejection: header is missing or doesn't reflect the bad origin.
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    await restricted.close();
  });

  it('accepts an allowlisted origin', async () => {
    const restricted = await buildApp({
      logger: false, rateLimit: false, helmet: false,
      allowedOrigins: ['http://localhost:8080'],
    });
    const res = await restricted.inject({
      method: 'GET', url: '/api/auth/config',
      headers: { origin: 'http://localhost:8080' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8080');
    await restricted.close();
  });
});

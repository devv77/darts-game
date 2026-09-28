import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { buildApp } from '../src/app.js';
import { isOutdatedClient, payloadId, setupSocket } from '../src/socket-handler.js';
import { db } from '../src/db.js';
import { createHumanWithSession, createX01Game, resetDb } from './helpers.js';

// DR-H2: every handler used to destructure its payload, so `emit('join-game', null)`
// threw inside Socket.IO's dispatch → uncaughtException → the process exited.
describe('socket handlers survive malformed payloads', () => {
  let app: FastifyInstance;
  let io: Server;
  let url: string;
  const clients: Socket[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false, rateLimit: false, helmet: false });
    await app.ready();
    io = new Server(app.server);
    setupSocket(io);
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    clients.forEach((c) => c.close());
    io.close();
    await app.close();
  });
  beforeEach(() => resetDb());

  function client(token: string, version?: string): Promise<Socket> {
    const c = connect(url, { auth: { token, version }, transports: ['websocket'], forceNew: true });
    clients.push(c);
    return new Promise((resolve, reject) => {
      c.on('connect', () => resolve(c));
      c.on('connect_error', reject);
    });
  }

  it('ignores null / primitive / wrong-typed payloads on every event and keeps serving', async () => {
    const { player, token } = createHumanWithSession('Mallory');
    const other = createHumanWithSession('Other').player;
    const gameId = createX01Game('501', [player.id, other.id]);
    const c = await client(token);

    const junk: unknown[] = [null, undefined, 42, 'x', [], { gameId: '1' }, { tournamentId: {} }];
    for (const ev of ['join-game', 'submit-turn', 'undo-turn', 'join-tournament', 'leave-tournament']) {
      for (const p of junk) c.emit(ev, p);
    }

    // Still alive and still processing: a valid join gets the game state back.
    const state = await new Promise<{ id: number }>((resolve) => {
      c.once('game-state', resolve);
      c.emit('join-game', { gameId });
    });
    expect(state.id).toBe(gameId);
  });
});

// DR-H3: a stale PWA bundle (pre-fix client) kept throwing after a deploy and
// recorded a wrong result. A version-mismatched client may watch but not write.
describe('outdated client bundles', () => {
  let app: FastifyInstance;
  let io: Server;
  let url: string;
  const clients: Socket[] = [];
  const prev = process.env.GIT_SHA;

  beforeAll(async () => {
    process.env.GIT_SHA = 'newsha1';
    app = await buildApp({ logger: false, rateLimit: false, helmet: false });
    await app.ready();
    io = new Server(app.server);
    setupSocket(io);
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = prev;
    clients.forEach((c) => c.close());
    io.close();
    await app.close();
  });
  beforeEach(() => resetDb());

  function client(token: string, version?: string): Promise<Socket> {
    const c = connect(url, { auth: { token, version }, transports: ['websocket'], forceNew: true });
    clients.push(c);
    return new Promise((resolve, reject) => {
      c.on('connect', () => resolve(c));
      c.on('connect_error', reject);
    });
  }
  const turnCount = (gameId: number) =>
    (db.prepare('SELECT COUNT(*) AS n FROM turns WHERE game_id = ?').get(gameId) as { n: number }).n;
  const joinAndSubmit = async (c: Socket, gameId: number, playerId: number) => {
    await new Promise((resolve) => { c.once('game-state', resolve); c.emit('join-game', { gameId }); });
    c.emit('submit-turn', { gameId, playerId, darts: ['T20', 'T20', 'T20'] });
    await new Promise((r) => setTimeout(r, 150));
  };

  it('a stale bundle is told to reload and its turn is not recorded', async () => {
    const { player, token } = createHumanWithSession('Stale');
    const gameId = createX01Game('501', [player.id, createHumanWithSession('B').player.id]);
    const c = connect(url, { auth: { token, version: 'oldsha0' }, transports: ['websocket'], forceNew: true });
    clients.push(c);
    const told = new Promise((resolve) => c.once('client-outdated', resolve));
    await new Promise((resolve) => c.on('connect', resolve));
    expect(await told).toEqual({ serverVersion: 'newsha1' });
    await joinAndSubmit(c, gameId, player.id);
    expect(turnCount(gameId)).toBe(0);
  });

  it('a current bundle (and a pre-check unversioned one) can still throw', async () => {
    const { player, token } = createHumanWithSession('Fresh');
    const other = createHumanWithSession('B');
    const gameId = createX01Game('501', [player.id, other.player.id]);
    await joinAndSubmit(await client(token, 'newsha1'), gameId, player.id);
    expect(turnCount(gameId)).toBe(1);
    await joinAndSubmit(await client(other.token), gameId, other.player.id);
    expect(turnCount(gameId)).toBe(2);
  });
});

describe('isOutdatedClient', () => {
  it('only flags an explicit version that differs from a real server version', () => {
    const prev = process.env.GIT_SHA;
    process.env.GIT_SHA = 'abc1234';
    expect(isOutdatedClient('abc1234')).toBe(false);
    expect(isOutdatedClient('0000000')).toBe(true);
    expect(isOutdatedClient(undefined)).toBe(false);
    expect(isOutdatedClient('dev')).toBe(false);
    process.env.GIT_SHA = 'dev';
    expect(isOutdatedClient('0000000')).toBe(false);
    if (prev === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = prev;
  });
});

describe('payloadId', () => {
  it('only returns integer ids from object payloads', () => {
    expect(payloadId({ gameId: 7 }, 'gameId')).toBe(7);
    expect(payloadId({ gameId: '7' }, 'gameId')).toBeNull();
    expect(payloadId({ gameId: 1.5 }, 'gameId')).toBeNull();
    expect(payloadId(null, 'gameId')).toBeNull();
    expect(payloadId(undefined, 'gameId')).toBeNull();
    expect(payloadId(7, 'gameId')).toBeNull();
  });
});

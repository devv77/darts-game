import { OAuth2Client } from 'google-auth-library';
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from './db.js';
import type { Player, Session } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    player?: Player;
  }
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Prefer a dedicated test/dev client id when present (e.g. one whose Google
// "Authorized JS origins" include localhost), so non-prod environments don't
// need the real production client. Production sets only GOOGLE_CLIENT_ID.
export const googleClientId = process.env.TEST_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || null;
export const oauthClient = googleClientId ? new OAuth2Client(googleClientId) : null;

// Self-hosted fallback: when Google is NOT configured, the app has no other
// door, so we allow passwordless local sign-in. This is OFF whenever
// GOOGLE_CLIENT_ID is set (i.e. production), so it never weakens the hosted
// instance.
export const localAuthEnabled = !oauthClient;

// Local-login accounts carry this sentinel email; in local mode it grants
// admin so the self-hosted operator can manage their own box. Inert in
// production (localAuthEnabled is false there) and never assigned to
// Google/guest players, so it doesn't widen admin anywhere else.
export const LOCAL_ADMIN_EMAIL = 'admin@local';

export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdmin(player: Pick<Player, 'email'> | null | undefined): boolean {
  if (!player?.email) return false;
  if (localAuthEnabled && player.email.toLowerCase() === LOCAL_ADMIN_EMAIL) return true;
  return adminEmails().has(player.email.toLowerCase());
}

const AVATAR_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
];

function pickAvatarColor(googleId: string): string {
  let hash = 0;
  for (const ch of googleId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function uniqueName(baseName: string): string {
  const base = baseName.trim() || 'Player';
  const taken = db.prepare('SELECT 1 FROM players WHERE name = ?').get(base);
  if (!taken) return base;
  for (let i = 2; i < 999; i++) {
    const candidate = `${base} (${i})`;
    if (!db.prepare('SELECT 1 FROM players WHERE name = ?').get(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export interface VerifiedGoogleUser {
  googleId: string;
  email: string;
  name: string;
  picture: string | null;
}

export async function verifyGoogleCredential(credential: string): Promise<VerifiedGoogleUser> {
  if (!oauthClient || !googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID not configured on server');
  }
  const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: googleClientId });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Invalid Google token');
  }
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture || null,
  };
}

export function upsertGooglePlayer(user: VerifiedGoogleUser): Player {
  const existing = db.prepare('SELECT * FROM players WHERE google_id = ?').get(user.googleId) as Player | undefined;
  if (existing) {
    db.prepare(
      'UPDATE players SET email = ?, avatar_url = ? WHERE id = ?'
    ).run(user.email, user.picture, existing.id);
    return db.prepare('SELECT * FROM players WHERE id = ?').get(existing.id) as Player;
  }
  const name = uniqueName(user.name);
  const result = db.prepare(
    `INSERT INTO players (name, avatar_color, is_ai, ai_level, google_id, email, avatar_url)
     VALUES (?, ?, 0, NULL, ?, ?, ?)`
  ).run(name, pickAvatarColor(user.googleId), user.googleId, user.email, user.picture);
  return db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid) as Player;
}

// Local sign-in: reuse a non-AI player with the given name if one exists
// (so you can log back into the same guest), otherwise create a fresh one.
export function upsertLocalPlayer(rawName: string): Player {
  const name = (rawName || '').trim() || 'Player';
  const existing = db.prepare(
    'SELECT * FROM players WHERE name = ? AND is_ai = 0'
  ).get(name) as Player | undefined;
  if (existing) return existing;
  const result = db.prepare(
    `INSERT INTO players (name, avatar_color, is_ai, ai_level, google_id, email, avatar_url)
     VALUES (?, ?, 0, NULL, NULL, ?, NULL)`
  ).run(uniqueName(name), pickAvatarColor(name), LOCAL_ADMIN_EMAIL);
  return db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid) as Player;
}

export function createSession(playerId: number): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO sessions (token, player_id, expires_at) VALUES (?, ?, ?)'
  ).run(token, playerId, expiresAt);
  return { token, expiresAt };
}

export function lookupSession(token: string | null | undefined): Player | null {
  if (!token) return null;
  const row = db.prepare(
    "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')"
  ).get(token) as Session | undefined;
  if (!row) return null;
  return db.prepare('SELECT * FROM players WHERE id = ?').get(row.player_id) as Player | null;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function pruneExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : null;
}

export function playerFromRequest(req: FastifyRequest): Player | null {
  const token = extractBearer(req.headers.authorization);
  return lookupSession(token);
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const player = playerFromRequest(req);
  if (!player) {
    reply.code(401).send({ error: 'Authentication required' });
    return;
  }
  req.player = player;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireSession(req, reply);
  if (reply.sent) return;
  if (!isAdmin(req.player)) {
    reply.code(403).send({ error: 'Admin access required' });
  }
}

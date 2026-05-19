import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db.js';
import {
  createSession,
  deleteSession,
  extractBearer,
  isAdmin,
  lookupSession,
  pruneExpiredSessions,
  upsertGooglePlayer,
} from '../src/auth.js';
import { resetDb } from './helpers.js';

describe('auth — session lifecycle', () => {
  beforeEach(() => resetDb());

  it('upsertGooglePlayer creates a player row keyed by google_id', () => {
    const p = upsertGooglePlayer({
      googleId: 'gid_abc',
      email: 'someone@example.com',
      name: 'Someone',
      picture: 'https://example.com/me.png',
    });
    expect(p.google_id).toBe('gid_abc');
    expect(p.email).toBe('someone@example.com');
    expect(p.avatar_url).toBe('https://example.com/me.png');
    expect(p.is_ai).toBe(0);
  });

  it('upsertGooglePlayer on a second sign-in updates email/avatar but not id or name', () => {
    const first = upsertGooglePlayer({
      googleId: 'gid_abc',
      email: 'old@example.com',
      name: 'Someone',
      picture: null,
    });
    const second = upsertGooglePlayer({
      googleId: 'gid_abc',
      email: 'new@example.com',
      name: 'New Display Name',
      picture: 'https://example.com/new.png',
    });
    expect(second.id).toBe(first.id);
    expect(second.email).toBe('new@example.com');
    expect(second.avatar_url).toBe('https://example.com/new.png');
    // Name set on first creation is preserved (renames stick).
    expect(second.name).toBe(first.name);
  });

  it('upsertGooglePlayer handles a name collision by suffixing (n)', () => {
    const p1 = upsertGooglePlayer({ googleId: 'g1', email: 'a@x.com', name: 'Pat', picture: null });
    const p2 = upsertGooglePlayer({ googleId: 'g2', email: 'b@x.com', name: 'Pat', picture: null });
    expect(p1.name).toBe('Pat');
    expect(p2.name).toBe('Pat (2)');
  });

  it('createSession + lookupSession round-trips a 64-char hex token', () => {
    const p = upsertGooglePlayer({ googleId: 'g1', email: 'a@x.com', name: 'Pat', picture: null });
    const { token, expiresAt } = createSession(p.id);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const found = lookupSession(token);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(p.id);
  });

  it('lookupSession returns null for an unknown token', () => {
    expect(lookupSession('not-a-real-token')).toBeNull();
    expect(lookupSession(null)).toBeNull();
    expect(lookupSession(undefined)).toBeNull();
    expect(lookupSession('')).toBeNull();
  });

  it('lookupSession returns null for an expired session', () => {
    const p = upsertGooglePlayer({ googleId: 'g1', email: 'a@x.com', name: 'Pat', picture: null });
    const { token } = createSession(p.id);
    // Force-expire the session in the DB.
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE token = ?").run(token);
    expect(lookupSession(token)).toBeNull();
  });

  it('deleteSession removes the row and subsequent lookup returns null', () => {
    const p = upsertGooglePlayer({ googleId: 'g1', email: 'a@x.com', name: 'Pat', picture: null });
    const { token } = createSession(p.id);
    expect(lookupSession(token)).not.toBeNull();
    deleteSession(token);
    expect(lookupSession(token)).toBeNull();
  });

  it('pruneExpiredSessions only drops expired rows', () => {
    const p = upsertGooglePlayer({ googleId: 'g1', email: 'a@x.com', name: 'Pat', picture: null });
    const { token: good } = createSession(p.id);
    const { token: bad } = createSession(p.id);
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE token = ?").run(bad);

    pruneExpiredSessions();
    expect(lookupSession(good)).not.toBeNull();
    expect(lookupSession(bad)).toBeNull();
  });
});

describe('auth — admin gate', () => {
  beforeEach(() => {
    resetDb();
    process.env.ADMIN_EMAILS = 'admin@x.com, another@x.com';
  });

  it('isAdmin matches case-insensitively, ignores whitespace', () => {
    expect(isAdmin({ email: 'admin@x.com' })).toBe(true);
    expect(isAdmin({ email: 'ADMIN@X.COM' })).toBe(true);
    expect(isAdmin({ email: 'another@x.com' })).toBe(true);
    expect(isAdmin({ email: 'stranger@x.com' })).toBe(false);
    expect(isAdmin({ email: null })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it('isAdmin returns false when ADMIN_EMAILS is unset', () => {
    process.env.ADMIN_EMAILS = '';
    expect(isAdmin({ email: 'admin@x.com' })).toBe(false);
  });
});

describe('auth — bearer header parsing', () => {
  it('extracts case-insensitively, tolerates extra whitespace', () => {
    expect(extractBearer('Bearer abc123')).toBe('abc123');
    expect(extractBearer('bearer abc123')).toBe('abc123');
    expect(extractBearer('BEARER   abc123  ')).toBe('abc123');
  });

  it('returns null for malformed headers', () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer('')).toBeNull();
    expect(extractBearer('Token abc123')).toBeNull();
    expect(extractBearer('Bearer')).toBeNull();
  });
});

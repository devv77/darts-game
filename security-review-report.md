# Darts Counter — Security Review (2026-05-19)

- **Target:** `http://localhost:8080` (Docker container `darts-game-darts-1`, Fastify 5 + Socket.IO + React/Vite + better-sqlite3, app bound to port 3000 inside the container)
- **Note on scheme:** asked for `https://localhost:8080`, but the app speaks plain HTTP — see L1 below
- **Scope:** static review of `apps/server` + `apps/web`, plus authenticated live testing of REST + Socket.IO with two synthetic test users (cleaned up after)
- **Authorization:** confirmed by owner (own app)
- **Test artifacts:** two synthetic users (ids 512, 513) and game id 37 were created during testing and **fully removed** at the end. DB residual confirmed empty.

This run was scoped as a follow-up to [SECURITY_FINDINGS.md](SECURITY_FINDINGS.md) (same day). Most of the previous findings have been remediated; this report focuses on (a) regressions/new issues, (b) verification of the prior fixes, and (c) defense-in-depth gaps.

---

## Severity legend

| | |
|---|---|
| 🔴 Critical | Lets any authenticated user damage other users' data or fabricate wins. |
| 🟠 High | Cross-user data exposure or weakened defense-in-depth. |
| 🟡 Medium / Low | Headers, info leak, hardening. |

---

## 🔴 Critical

### C1 (NEW). Socket.IO `undo-turn` has no authorization — any user can erase any game's turns

**Where:** [apps/server/src/socket-handler.ts:94-99](apps/server/src/socket-handler.ts:94)

```ts
socket.on('undo-turn', ({ gameId }: { gameId: number }) => {
  undoLastTurn(gameId);
  const newState = getFullGameState(gameId);
  io.to(`game:${gameId}`).emit('game-state', stripPiiFromGameState(newState));
});
```

No participant check, no `Number.isInteger` check, no "is this user allowed to undo this game" check. Contrast with the `submit-turn` handler immediately above it ([socket-handler.ts:66-92](apps/server/src/socket-handler.ts:66)) which does all the right checks.

**Proof of exploit (reproduced live):**

1. Alice (player 512, game 37) emits `submit-turn { gameId:37, playerId:512, darts:["T20","T20","T20"] }` — server records a 180.
2. Bob (player 513, NOT a participant in game 37) connects with a valid session and emits `undo-turn { gameId:37 }`.
3. Server deletes Alice's last turn. Alice's next `game-state` shows `turns=0` (the 180 is gone).

`undoLastTurn` ([socket-handler.ts:344-369](apps/server/src/socket-handler.ts:344)) also reverts `status: 'completed' → 'in_progress'`, so this works on **finished** games too — Bob can take Alice's win away after the fact and undo as many turns as he likes by replaying the call.

**Impact:** any authenticated user can wipe turns from any in-progress or completed game. This nullifies the C1/C2/C3 fixes from the previous report because state can be silently rolled back from the outside.

**Fix:** mirror the `submit-turn` guard. Suggested:

```ts
socket.on('undo-turn', ({ gameId }: { gameId: number }) => {
  const sessionPlayer = (socket.data as { player: Player }).player;
  if (!sessionPlayer) return;
  if (!Number.isInteger(gameId)) return;
  const state = getFullGameState(gameId);
  if (!state) return;
  if (!isAdmin(sessionPlayer) && !state.players.some((p) => p.id === sessionPlayer.id)) return;
  // Optional but recommended: only allow undo of *your own* last turn.
  const lastTurn = db.prepare('SELECT player_id FROM turns WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(gameId) as { player_id: number } | undefined;
  if (!lastTurn) return;
  if (!isAdmin(sessionPlayer) && lastTurn.player_id !== sessionPlayer.id) return;
  undoLastTurn(gameId);
  const newState = getFullGameState(gameId);
  io.to(`game:${gameId}`).emit('game-state', stripPiiFromGameState(newState));
});
```

---

## 🟠 High

### H1 (NEW). `canDeletePlayer` allows deleting any non-Google, non-AI human player

**Where:** [apps/server/src/routes/players.ts:14-18](apps/server/src/routes/players.ts:14)

```ts
function canDeletePlayer(req: FastifyRequest, target: Player): boolean {
  if (isAdmin(req.player)) return true;
  if (req.player?.id === target.id) return true;
  return !target.is_ai && !target.google_id;   // <-- any user can delete any "local-only" human
}
```

**Today's impact: latent.** Because the live app only accepts Google Sign-In, *most* human players will have a `google_id` and the predicate returns `false`. But:

- The DB schema and migration still support local (non-Google) players. The Phase-1 migration in [apps/server/src/db.ts:95-109](apps/server/src/db.ts:95) wipes pre-Google locals, but nothing in the schema prevents future ones.
- During testing I created two `google_id IS NULL` synthetic users (Alice 512, Bob 513) — Bob's `DELETE /api/players/512` (cross-user) returned `409 Player has active games` (because Alice was in game 37) rather than `403 Cannot delete this player`. The 409 means the authorization branch *passed* and only the foreign-key-existence check stopped the deletion. With no active games, Bob's call would have succeeded.

**Impact if local-player creation is ever re-enabled** (or if any DB seed creates non-Google humans): any authenticated user can `DELETE /api/players/:id` against any local human and wipe them.

**Fix:** the "local human can be deleted by anyone" branch dates back to the Phase-1 pass-and-play model and should now be removed:

```ts
function canDeletePlayer(req: FastifyRequest, target: Player): boolean {
  if (isAdmin(req.player)) return true;
  if (req.player?.id === target.id) return true;
  return false;
}
```

Phase-out the local-player code path entirely if it isn't needed.

---

### H2 (RESIDUAL FROM PREVIOUS REPORT). `GET /api/games` lists every game in the DB to every authed user

**Where:** [apps/server/src/routes/games.ts:22-32](apps/server/src/routes/games.ts:22)

```ts
app.get('/api/games', async (req) => {
  const { status } = req.query;
  let query = 'SELECT * FROM games';
  // ... no scoping to req.player.id
  return db.prepare(query).all(...params) as Game[];
});
```

**Proof (live):** Alice's `GET /api/games` returned the historical games 35 and 36 (player 479's games — Alice is not a participant in either).

**Impact:** game metadata (winner_id, settings, timestamps, status) for every game is enumerable by every authed user. Player names/PII aren't in this payload (good), but combined with `GET /api/stats/players/:id` (any id) you can rebuild a fairly complete picture of who played, when, and against whom. The `GET /api/games/:id` IDOR fix correctly blocks the *full* state — this listing endpoint just wasn't updated.

**Fix:**

```ts
app.get('/api/games', async (req) => {
  const viewer = req.player!;
  const baseQuery = `
    SELECT g.* FROM games g
    JOIN game_players gp ON gp.game_id = g.id
    WHERE gp.player_id = ?`;
  // ... add status filter, ORDER BY created_at DESC
});
```

Admins should keep the unfiltered view.

---

### H3. Authorization tokens still in `localStorage` (defense-in-depth)

**Where:** [apps/web/src/lib/auth.ts:3-22](apps/web/src/lib/auth.ts:3)

Same finding as previous report H4. Nothing changed. No active XSS sink in the current frontend — React's default escaping covers it — but the token is exposed to any future XSS or any browser extension. The opportunity is missed every release.

**Fix:** issue the session as `Set-Cookie: token=...; HttpOnly; Secure; SameSite=Lax; Path=/`; add a CSRF token (double-submit or per-request) for mutating REST endpoints; have the Socket.IO middleware read the cookie via `socket.handshake.headers.cookie`.

This is also a soft prerequisite for tightening L2 (CORS) below — once cookies are credentialed, you'll *need* a closed origin list anyway.

---

## 🟡 Medium / Low

### M1 (NEW). No HTTP security headers

**Observation (live):** `GET /` returns zero security headers. Verified absent:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` / `Cross-Origin-Resource-Policy`

**Impact:** clickjacking-protectable, MIME-sniffing-protectable, and (once HTTPS is in front) HSTS-protectable surface left open. Most importantly, **no CSP** means any XSS that lands has unrestricted egress.

**Fix:** add [`@fastify/helmet`](https://github.com/fastify/fastify-helmet). Suggested baseline that lets Google Sign-In and Google Fonts continue to work:

```ts
import helmet from '@fastify/helmet';
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
      connectSrc: ["'self'", 'https://accounts.google.com'],
      frameSrc: ['https://accounts.google.com'],
      frameAncestors: ["'none'"],
    },
  },
  // HSTS only takes effect over HTTPS, but it's safe to send.
});
```

Then test that Google Sign-In's popup/iframe still renders.

---

### M2 (NEW). CORS reflects any origin

**Where:** [apps/server/src/app.ts:21](apps/server/src/app.ts:21) — `await app.register(fastifyCors, { origin: true });`

**Proof (live):** `GET /api/auth/config` with `Origin: https://evil.example` returns `Access-Control-Allow-Origin: https://evil.example`. `Access-Control-Allow-Credentials` is not sent, so cookies/Bearer can't be auto-replayed cross-origin today — but the policy is wide-open and only the *current* (token-in-`Authorization`-header) model is protecting you.

**Impact today: low.** The Bearer token lives in `localStorage` (same-origin-only), so an attacker page can't read it. If H3 is fixed (cookie-based session), this misconfiguration immediately becomes a CSRF vector unless tightened.

**Fix:** enumerate allowed origins.

```ts
const allowed = (process.env.ALLOWED_ORIGINS || 'http://localhost:8080').split(',');
await app.register(fastifyCors, {
  origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
  credentials: true, // when you move to cookies
});
```

---

### L1. App speaks HTTP only (no TLS)

You asked for `https://localhost:8080`. The app listens with plain HTTP (`app.log.info` literally says "Darts Counter listening on **http://**"). For a homelab self-host this is acceptable behind a reverse proxy (Caddy/Authentik/nginx that terminates TLS) — confirm the production deployment actually has that proxy in front of port 8080. Inside the LAN without a proxy, the Bearer token traverses the wire in plaintext.

**Fix:** document the reverse-proxy expectation in README, and add an `app.log.warn` if `NODE_ENV=production` and no `X-Forwarded-Proto: https` is observed on the first request.

---

### L2. `/api/auth/config` is publicly readable (by design) but reveals which Google client is in use

[apps/server/src/routes/auth.ts:14-19](apps/server/src/routes/auth.ts:14) returns `googleClientId` unauthenticated. This is fine and necessary (the SPA needs it), but be aware: an attacker fingerprinting your homelab can confirm this is the darts-game app and tie it to the specific Google OAuth client. Not actionable on its own.

---

### L3. `.env` contains real secrets and is gitignored — confirm it isn't backed up anywhere world-readable

[.env](.env) holds `AUTHENTIK_API_TOKEN`, `TEST_GOOGLE_CLIENT_SECRET`, `PROD_GOOGLE_CLIENT_SECRET`. It is correctly in [.gitignore](.gitignore:6) and `git ls-files .env` confirms it was never committed. **But:** the file sits inside the repo working tree on a WSL filesystem, and the `GOOGLE_CLIENT_SECRET` values aren't actually read by this server (the code only reads `GOOGLE_CLIENT_ID` — see [apps/server/src/auth.ts:15](apps/server/src/auth.ts:15)). The two secret values are dead weight that increase blast radius for no functional reason.

**Fix:** if those secrets are for some other tool, move them out of this project's `.env`. Rotate the `AUTHENTIK_API_TOKEN` if anyone has ever had read access to the WSL filesystem (it was visible in `.env` when I read it for this audit).

---

## ✅ Verified-as-fixed (vs. previous report)

I retested the items from the previous [SECURITY_FINDINGS.md](SECURITY_FINDINGS.md) and confirm:

| Old finding | Status | Where |
|---|---|---|
| **C1** — client-supplied `scoreTotal` trusted | **Fixed** — server recomputes from `darts[]`; quick-entry clamps 0..180 | [socket-handler.ts:117-125](apps/server/src/socket-handler.ts:117) |
| **C2** — client-supplied `playerId` trusted | **Fixed** — turn-order enforced (`state.players[current_player_index].id !== playerId` → reject) | [socket-handler.ts:79-83](apps/server/src/socket-handler.ts:79) |
| **C3** — double-out not enforced | **Fixed** — `isBust` now considers `lastDart` multiplier; empty-darts checkouts rejected as bust | [socket-handler.ts:128-133](apps/server/src/socket-handler.ts:128) |
| **C4** — `DELETE /api/games/:id` IDOR | **Fixed** — participant/admin check | [games.ts:99-111](apps/server/src/routes/games.ts:99) |
| **H1** — `GET /api/games/:id` IDOR | **Fixed** — participant/admin check + PII scrub | [games.ts:88-97](apps/server/src/routes/games.ts:88) |
| **H2** — `GET /api/stats/players/:id` leaks PII | **Partial** — endpoint still cross-readable, but PII (email, google_id) is stripped via `sanitizePlayer` ✅ | [stats.ts:122-123](apps/server/src/routes/stats.ts:122), [sanitize.ts:9-17](apps/server/src/sanitize.ts:9) |
| **H3** — `GET /api/players` leaks emails | **Fixed** — `sanitizePlayer` strips `email`/`google_id` for non-self/non-admin viewers | [players.ts:22-24](apps/server/src/routes/players.ts:22) |
| **H5** — no rate limiting | **Fixed** — `@fastify/rate-limit` at 200/min keyed by token-or-IP. Verified: requests #201+ return `429 Too Many Requests` | [app.ts:26-37](apps/server/src/app.ts:26) |
| **M1** — unbounded name length | **Fixed** — `MAX_NAME_LENGTH = 50` enforced on POST and PUT | [players.ts:7,37-39,74](apps/server/src/routes/players.ts:7) |
| **M2** — Fastify content-type leaks endpoints pre-auth | **Effectively fixed** — DELETE without body returns `401` (auth runs first) in my probes |
| Mass-assignment of `is_ai`/`role`/`google_id` on self | **Holds** — PUT only updates `name` and `avatar_color` regardless of body | [players.ts:79-83](apps/server/src/routes/players.ts:79) |
| Cross-user player edit (`PUT /api/players/:other`) | **Holds** — `canEdit` → 403 | [players.ts:9-12,70-72](apps/server/src/routes/players.ts:9) |
| Admin route gating | **Holds** — `/api/admin/reset` → 403 for Bob | [admin.ts:6-9](apps/server/src/routes/admin.ts:6) |

---

## Recommended fix order

1. **C1 (NEW)** — drop authorization checks into the `undo-turn` socket handler. ~10 lines. Highest impact, smallest change.
2. **H1 (NEW)** — tighten `canDeletePlayer` to (self || admin). One line removal.
3. **H2 (RESIDUAL)** — scope `GET /api/games` to participant. Small SQL change.
4. **M1 (NEW)** — drop in `@fastify/helmet` with a CSP that allows Google Sign-In + Google Fonts.
5. **M2 (NEW)** — narrow CORS to an env-driven allowlist (do this before any cookie migration).
6. **H3 (DEFENSE-IN-DEPTH)** — migrate session token from `localStorage` to `HttpOnly; Secure; SameSite=Lax` cookie + CSRF token.
7. **L1** — document/enforce TLS-in-front-of-8080 if not already done.
8. **L3** — prune unused secrets from `.env`; rotate the Authentik API token.

---

## Appendix — Test ledger

Synthetic users (cleaned up post-test):

| id | name | role |
|---|---|---|
| 512 | `sectest_alice_<ts>` | Alice (victim, participant in test game 37) |
| 513 | `sectest_bob_<ts>` | Bob (attacker, NOT a participant) |

Sessions for 512 and 513 inserted directly into the `sessions` table with 1h TTL. Test game id 37 created via `POST /api/games {mode:"501", player_ids:[512, 5]}`. All three rows (game, both players, both sessions) deleted at the end of testing; residual check returned `[]` for both.

Live test outputs captured during this run (status codes, body excerpts) are in the conversation transcript that produced this report.

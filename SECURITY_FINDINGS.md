# Darts Counter — Security & Logic Test Report

- **Target:** `http://localhost:8080/`
- **Stack:** React SPA (Vite) + Fastify + Socket.IO + SQLite (likely)
- **Date:** 2026-05-19
- **Tester role:** non-admin authenticated user (player id 479, `lencses.david77@gmail.com`)
- **Scope:** static review of JS bundle, REST API fuzzing, Socket.IO event fuzzing, SPA logic / UX bug hunt
- **Out of scope (declined):** credential brute force against Google SSO

---

## Severity legend

| | |
|---|---|
| 🔴 Critical | Allows fake wins, data destruction, or PII exfiltration with no special privilege. Fix immediately. |
| 🟠 High | Cross-user data exposure or weakened defense-in-depth. Fix in current cycle. |
| 🟡 Medium / Low | Quality, defense-in-depth, or info disclosure. Fix when convenient. |

---

## 🔴 Critical

### C1. Server trusts client-supplied `scoreTotal` — fake any score, fake any win

**Where:** `submit-turn` Socket.IO event handler.
**Payload shape sent by client:** `{ gameId, playerId, darts, scoreTotal }`.

**Proof of exploit:** Sent `{ gameId: 35, playerId: 479, darts: [], scoreTotal: 441 }` to a 501 game where I had 441 remaining. Server response:

- `status: "in_progress"` → `"completed"`
- `winner_id: null` → `479`
- `scores: { 479: 0 }`
- broadcast `["game-over", { winnerId: 479 }]`

**Variants confirmed in game 36:**

| Payload | Result |
|---|---|
| `scoreTotal: -100` | Score went UP from 501 → 601 |
| `scoreTotal: 200` | Accepted (max physically possible is 180) |
| `scoreTotal: '60'` (string) | Coerced to number, accepted |

**Impact:** Stats integrity is gone. Anyone can fabricate 9-darters, perfect 180s, world-record averages, inflate `highest_turn` / `best_leg_darts` / `count_180`. Leaderboards are meaningless.

**Fix:** Server must compute `scoreTotal` from `darts[]` itself. Reject if `darts.length > 3`, dart `score ∉ {0, 1..20, 25}`, multiplier `∉ {1, 2, 3}` (with 25 only at multipliers 1 or 2). For score-per-turn mode where `darts: []` is intentional, enforce `0 ≤ scoreTotal ≤ 180`.

---

### C2. Server trusts client-supplied `playerId` — submit turns for any player in the game

**Where:** `submit-turn` event handler.

**Proof:** Signed in as player 479, sent `{ gameId: 36, playerId: 5, scoreTotal: 60 }`. AI player 5's score dropped 501 → 441.

**Impact:** In multi-human games you can submit turns on your opponent's behalf — busting them, tanking their stats, fake-winning. AI opponent score can be sabotaged.

**Fix:** Ignore client `playerId`. Derive from `socket.data.userId`. Reject if it isn't currently that player's turn.

---

### C3. 501 double-out rules not enforced server-side

**Proof:** Sent exactly the remaining score (341 → 0) with `darts: []`. Game ended with me as winner. Real 501 rules require the last dart to land on a double or the bullseye — server has no way to verify because `darts` was empty.

**Partial defense that DID work:** Bust IS detected when `scoreTotal` exceeds remaining (`is_bust: 1` recorded, score not deducted). So the "below zero" case is guarded; the "land on a non-double" case is not.

**Impact:** Wins are not "legal" wins. Combined with C1, you cannot trust any recorded match.

**Fix:** In double-out modes, require the final dart's multiplier to be 2 (or bull-with-mult-2). For empty-`darts` payloads, reject any score that would bring remaining to 0 or 1.

---

### C4. IDOR — `DELETE /api/games/:id` allows any authed user to delete any game

**Proof:** As player 479, sent `DELETE /api/games/34` (a game between player 418 and AI Novice — I was not a participant). Response: `204 No Content`. Player 418's stats wiped: `games_played: 1, games_won: 1, x01_average: 50.1, best_leg_darts: 30, checkout_count: 1` → all zeros.

**Impact:** Vandalism — any user can erase any other user's games and stats.

**Fix:** Check the authed user is a participant in the game before allowing delete (or restrict delete to admin).

---

## 🟠 High

### H1. IDOR — `GET /api/games/:id` returns any game including other users' emails

**Proof:** `GET /api/games/34` returned full game state including both players' profiles (`email`, `google_id`, `avatar_url`) for a game I'm not in.

**Impact:** Combined with sequential integer IDs, an attacker creating one account can scrape every game and harvest every user's email.

**Fix:** Restrict to participants. Strip PII from responses if game viewing must remain public.

---

### H2. IDOR — `GET /api/stats/players/:id` exposes any user's email + google_id

**Proof:** `GET /api/stats/players/418` returned `email`, `google_id`, `avatar_url` of another user.

**Fix:** Strip PII from the response (or restrict to self).

---

### H3. `GET /api/players` lists all users with emails

**Proof:** Returns 12 records (10 AI + 2 Google) including both Google accounts with full `email` + `google_id` fields.

**Impact:** Any signed-in user can enumerate every other user's email.

**Fix:** Filter to AI players + local-players-on-this-device + self; never return emails or google_ids of other Google users.

---

### H4. Auth token stored in `localStorage`, not in `HttpOnly` cookie

**Observation:** 64-character opaque token sent via `Authorization: Bearer` header. Token sits in `localStorage`.

**Impact:** No XSS sink found today (React's default escaping protects player names — payload `<img src=x onerror=...>` is stored but renders as escaped text). However, **defense-in-depth is missing**: any future XSS (e.g., a feature added with `dangerouslySetInnerHTML`) becomes immediate full account takeover. Also exposed to any installed browser extension.

**Fix:** Move to `HttpOnly; Secure; SameSite=Lax` cookie + CSRF token (or double-submit pattern) for mutating routes.

---

### H5. No rate limiting on API

**Proof:** 50 concurrent `GET /api/players` requests completed in 143ms, all 200.

**Impact:** Combined with H1–H3 and sequential IDs, an attacker can scrape the whole database in seconds.

**Fix:** Add `@fastify/rate-limit` with per-IP and per-user limits.

---

## 🟡 Medium / Low

### M1. Unbounded player name length

`POST /api/players` accepted a 10,000-char name and stored it. No max length enforced.

**Fix:** Cap at e.g. 50 chars in the Fastify route schema (`maxLength: 50`).

---

### M2. Fastify content-type behavior leaks endpoint existence pre-auth

Sending `DELETE /api/players/418` with empty body and `Content-Type: application/json` returns `400 FST_ERR_CTP_EMPTY_JSON_BODY` *before* the auth middleware runs. An unauth attacker can map which endpoints exist by the difference between `401` (no Content-Type) and `400` (Fastify parsing).

**Impact:** Minor info disclosure.

**Fix:** Mount the auth hook at `preParsing` priority, or use `addContentTypeParser` to accept empty bodies on DELETE.

---

### M3. `/game` route renders blank with no `?id=` query

Pure UX bug. The route should redirect to `/` (or to the most recent in-progress game) when no `?id=` is present.

---

### M4. Game-creation endpoint silently filters players instead of erroring

`POST /api/games` with `{ player_ids: [479, 999999] }` (bogus id) returns `400 "At least 2 player(s) required"` rather than `400 "Player 999999 not found"`. Same for `[479, 479]` (duplicates) and `[418, 5]` (attempting to create a game on another user's behalf — which is also correctly rejected, but with a confusing message).

**Impact:** Confusing error message; not a security issue.

**Fix:** Return a more specific error.

---

## ✅ What DID hold up — credit where due

These are real defenses the app got right:

- **`/api/admin/reset`** requires `isAdmin: true`. Returns `403 Admin access required` for non-admin (the initial `400` I saw was a Fastify parsing artifact, not a bypass).
- **All unauth requests** return consistent `401` with no info leak in error bodies (`{"error":"Authentication required"}`).
- **Cross-user writes** on `PUT /api/players/418` and `DELETE /api/players/418` return `403 "Cannot modify/delete this player"`.
- **Mass-assignment on own profile** with `{is_ai: 1, ai_level: 7, google_id: 'changed', email: 'new@example.com', isAdmin: true, role: 'admin'}` is silently dropped — server doesn't trust client-supplied identity / role fields.
- **AI-player creation** gated to admin (`POST /api/players { is_ai: 1 }` → `403`).
- **Player names rendered via React JSX** are HTML-escaped. XSS payload `<img src=x onerror=...>` stored but never executes; appears as plain text.
- **No `X-Powered-By` / verbose `Server:` headers** leaked.
- **Bust detection** works for "score exceeds remaining" case (C3 is only about the missing double-out check).
- **Server does not echo** other users' tokens, sessions, or stack traces in error responses.

---

## Recommended fix priorities

1. **Fix C1 + C2 + C3 together** — they all live in the `submit-turn` handler and are the most damaging. Single PR: (a) ignore client `playerId`, (b) re-compute `scoreTotal` from `darts[]`, (c) enforce double-out, (d) reject scores >180 or <0.
2. **Add ownership check to every `/api/games/:id` handler** (`GET`, `PUT`, `DELETE`) — fixes C4 + H1 in one go.
3. **Strip PII from `/api/players` and `/api/stats/players/:id`** — fixes H2 + H3.
4. **Add `@fastify/rate-limit`** — slows down any remaining IDOR exploitation.
5. **Move session to HttpOnly cookie + CSRF token** — defense in depth (H4).
6. **Cap input lengths** in route schemas (M1).

---

## Appendix — Endpoints discovered

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/auth/me` | 401 → required | Returns `{player, isAdmin}` |
| GET | `/api/auth/config` | none | Returns Google client ID (public by design) |
| POST | `/api/auth/google` | none | Sign-in exchange |
| POST | `/api/auth/logout` | required | |
| GET | `/api/players` | required | **Returns ALL players incl. other users' emails (H3)** |
| POST | `/api/players` | required | Admin-gated for `is_ai: 1`. Name length unbounded (M1) |
| GET | `/api/players/:id` | required | |
| PUT | `/api/players/:id` | required | Cross-user blocked (✅) |
| DELETE | `/api/players/:id` | required | Cross-user blocked (✅) |
| GET | `/api/games` | required | Lists games |
| POST | `/api/games` | required | `{mode, settings, player_ids: [...]}` |
| GET | `/api/games/:id` | required | **IDOR — any game readable (H1)** |
| PUT | `/api/games/:id` | required | |
| DELETE | `/api/games/:id` | required | **IDOR — any game deletable (C4)** |
| GET | `/api/stats/players/:id` | required | **IDOR — any user's stats + PII (H2)** |
| DELETE | `/api/admin/reset` | admin only | ✅ correctly gated |

## Appendix — Socket.IO events

| Direction | Event | Payload |
|---|---|---|
| client → server | `join-game` | `{ gameId }` |
| client → server | `submit-turn` | `{ gameId, playerId, darts, scoreTotal }` ← **C1, C2, C3** |
| client → server | `undo-turn` | `{ gameId }` |
| server → client | `game-state` | full game object incl. participants' PII |
| server → client | `game-over` | `{ winnerId }` |
| server → client | `ai-thinking` | `{ playerId }` |

Socket.IO is mounted at `/socket.io/`. Engine.IO handshake does not require auth; the `40{token:...}` connect frame attaches the bearer token.

---

## Appendix — Test environment state after testing

- **Deleted by C4 exploit:** Game id 34 (player 418's only game) — user accepted the loss.
- **Created during testing:** Games 35 and 36, both "completed" with fake wins on player 479. Stats for player 479 will be inflated until `/api/admin/reset` is run.
- **Test players cleaned up:** ids 480 and 481 deleted. Real Google players (418, 479) intact.

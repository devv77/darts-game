# Darts Counter

Self-hosted web app for tracking 501 / 301 / Cricket games on a phone or tablet next to the dartboard. Real-time scoreboard, 10-level AI opponents, dynamic checkout suggestions, sets & legs match formats, post-match review with momentum graph, and voice + animation feedback.

![status](https://img.shields.io/badge/status-v2-blue) ![stack](https://img.shields.io/badge/stack-Fastify%20%2B%20React%20%2B%20TS-1d4ed8)

## Stack

- **Backend** — Fastify 5, Socket.IO 4, better-sqlite3, TypeScript (ESM)
- **Frontend** — React 18, Vite 5, react-router-dom, socket.io-client, TypeScript
- **UI** — GSAP, canvas-confetti, Chart.js (+ chartjs-plugin-annotation), Web Audio API, Web Speech API
- **Database** — SQLite (single file, WAL mode) at `data/darts.db`
- **Deployment** — Multi-stage Docker, served by Fastify on `:3000` (mapped to `:8080` in compose)

## Layout

npm-workspaces monorepo:

```
apps/
  server/        # Fastify + TS — REST + Socket.IO + game engine + AI + DB
  web/           # React + Vite + TS — lobby, game, stats, post-match review
data/            # SQLite DB (mounted as Docker volume)
.forgejo/        # Forgejo Actions CI (build + push image)
Dockerfile       # Multi-stage build
docker-compose.yml
```

## Commands

Run from the repo root.

| Task | Command |
|------|---------|
| Install workspace deps | `npm install` |
| Dev (server + web together) | `npm run dev` → http://localhost:5173 |
| Dev (server only) | `npm run dev:server` |
| Dev (web only) | `npm run dev:web` |
| Build everything | `npm run build` |
| Run compiled server | `npm start` → http://localhost:3000 |
| Type-check all workspaces | `npm run typecheck` |
| Docker build + run | `docker compose up -d --build` → http://localhost:8080 |

In dev, Vite proxies `/api` and `/socket.io` to the Fastify server on `:3000`. In prod, Fastify serves the built React app from `apps/web/dist` with an SPA fallback.

## Features

### Game modes
- **501 / 301** — standard double-out X01 with bust detection, sets & legs, starting-player rotation per leg
- **Cricket** — 15-20 + Bull, mark grid (`/`, `X`, `O`), point scoring against unclosed opponents, allClosed + points >= all opponents win condition

### AI opponents
10 difficulty levels (Beginner → World Class) with dart-physics simulation — per-level accuracy, treble/double hit rates, miss rate, and scatter. Pre-seeded on first DB run.

### Checkout intelligence
- Full 169-entry double-out table (170 → 2)
- Skill-tier presets (beginner / club / good / advanced) based on lifetime 3-dart average
- Bogey-number warnings (169, 168, 166, 165, 163, 162, 159)
- Safer checkout alternatives for high bust-rate players
- Mid-turn checkout recalculation in dart-by-dart mode

### Match formats
- Single leg
- Best of *n* legs (3, 5, 7, 9, 11)
- Sets (best-of-*n* sets, best-of-*m* legs per set)

### Online play (Phase 8a)
- Toggle **Play online** in match setup to host a remote game on your own device
- Host gets a 5-character invite code; others enter it under **Join an online game** on the home screen
- The match starts once every seat (2–4 players) is filled — the lobby shows a "waiting for players" panel with the code
- Server-authoritative turn ownership: each device can only throw on its own turn, and only after the game is full (single-device pass-and-play is unaffected)
- AI opponents aren't supported in online games yet

### Tournaments (Phase 9 — Knockout)
- Create a single-elimination **Knockout** from 2–32 players (humans + AI), any game mode + match format
- Bracket auto-pads to a power of two with byes given to the top seeds; the winner path is wired so results propagate automatically
- Each tie is a **real game** played through the audited engine, so lifetime stats accrue normally; on completion the bracket settles **server-side** (the client never reports who won) and advances
- **Bracket** and **Fixtures** views live-update over a tournament socket room; a **champion** screen with confetti caps it off
- League and Groups→Knockout formats are designed (`TOURNAMENT_MODE.md`) but not yet wired

### Post-match review
Three tabs over a winner banner:
1. **Summary** — per-player averages, first-9, highest, 180s/140+/100+, busts, legs won, checkout dart
2. **Legs** — per-leg breakdown with leg winner, averages, darts, checkout
3. **Momentum** — Chart.js line graph of remaining score over turns with annotations for 180s, tons, busts, and checkouts

### Polish
- Active player tint (`--player-color` follows whoever's throwing)
- GSAP overlays for 180s, ton+, game shots, busts
- Synthesized sound effects (Web Audio API)
- Voice caller (Web Speech API, toggleable)
- Screen wake lock during play
- Mobile-first viewport lock (`100dvh`, no scroll)

## Network access from WSL2

If running the dev server in WSL2 and you want to reach it from a phone on the LAN:

```powershell
# PowerShell as Admin
netsh interface portproxy add v4tov4 listenport=8080 listenaddress=0.0.0.0 connectport=8080 connectaddress=<WSL_IP>
netsh advfirewall firewall add rule name="Darts 8080" dir=in action=allow protocol=TCP localport=8080
```

Then hit `http://<windows-host-LAN-IP>:8080` from your phone.

## CI/CD

`.forgejo/workflows/build-push.yml` builds and pushes the image to `forgejo.csodakucko.net/lendev/darts-game:<short-sha>` and `:latest` on every push to `main`. The homelab runner is pre-authenticated.

## TLS / network posture

The container speaks plain HTTP on `:3000` (mapped to `:8080` on the host) by design — TLS termination is handled by Caddy in front, not by the app. This is the standard sidecar pattern: the app stays simple, never holds cert material, and `docker compose up` works on any host without ACME plumbing.

- **External** — VPS Caddy at `46.38.242.26` terminates HTTPS for `darts.csodakucko.net` with a Let's Encrypt HTTP-01 cert, reverse-proxies over the IPsec tunnel to `192.168.10.208:8080`. JSON access logs at `/var/log/caddy/access.log`. Security headers (HSTS, X-Content-Type-Options, Referrer-Policy, `-Server`) are injected by VPS Caddy.
- **Internal (LAN)** — Internal Caddy LXC on `192.168.10.201` terminates HTTPS for `darts.csodakucko.net` with a Cloudflare DNS-01 wildcard cert and reverse-proxies to the same backend. AdGuard rewrites the FQDN to the internal Caddy for any client using the homelab DNS, so LAN traffic never leaves the network.

If you run this image somewhere without a fronting Caddy / nginx / Traefik, **add one** — don't expose `:8080` to the public internet directly.

## Database schema

5 tables: `players`, `games`, `game_players`, `turns`, `cricket_state`. Migrations are additive and run on every startup. See [PLAN.md](PLAN.md#data-model) for the full schema.

## License

Private project.

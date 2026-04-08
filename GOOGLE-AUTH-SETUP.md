# Google Account Authentication Setup

Guide for adding Google Sign-In to the Darts Counter app so players can log in with their Google account instead of manually creating profiles.

---

## Overview

**Goal:** Players tap "Sign in with Google" on the lobby page. Their name and avatar are pulled from their Google profile. Stats are tied to their Google account so they persist across devices.

**Approach:** OAuth 2.0 with Google Identity Services (GIS) on the frontend, verified on the backend with Google's token API.

---

## 1. Google Cloud Console Setup

### Create a project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g. "Darts Counter")
3. Enable the **Google Identity** API (APIs & Services > Library > search "Google Identity")

### Create OAuth 2.0 credentials
1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Authorized JavaScript origins:
   - `http://localhost:8080` (development)
   - `https://your-domain.com` (production)
5. Authorized redirect URIs:
   - `http://localhost:8080/auth/google/callback`
   - `https://your-domain.com/auth/google/callback`
6. Copy the **Client ID** and **Client Secret**

### Configure consent screen
1. Go to **OAuth consent screen**
2. User type: **External**
3. App name: "Darts Counter"
4. Scopes: `email`, `profile`, `openid`
5. Add test users during development

---

## 2. Environment Variables

Add to `.env` (and Docker environment):

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
SESSION_SECRET=random-32-char-string-here
```

Update `docker-compose.yml`:
```yaml
services:
  darts:
    build: .
    ports:
      - "8080:3000"
    volumes:
      - darts-data:/app/data
    env_file:
      - .env
    restart: unless-stopped
```

---

## 3. Database Schema Changes

### players table updates
```sql
ALTER TABLE players ADD COLUMN google_id TEXT UNIQUE;
ALTER TABLE players ADD COLUMN email TEXT;
ALTER TABLE players ADD COLUMN avatar_url TEXT;
```

- `google_id` — Google's unique user ID (sub claim from JWT)
- `email` — from Google profile
- `avatar_url` — Google profile picture URL (replaces avatar_color for Google users)

### sessions table (new)
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  token TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
```

---

## 4. Backend Implementation

### Install dependencies
```bash
npm install google-auth-library express-session
```

### New route: `server/routes/auth.js`

```javascript
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// POST /auth/google — verify Google ID token, create/find player
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  
  // Verify the Google ID token
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  
  // payload contains: sub (Google ID), email, name, picture
  const googleId = payload.sub;
  const name = payload.name;
  const email = payload.email;
  const avatarUrl = payload.picture;
  
  // Find or create player
  let player = db.prepare('SELECT * FROM players WHERE google_id = ?').get(googleId);
  if (!player) {
    db.prepare(
      'INSERT INTO players (name, google_id, email, avatar_url) VALUES (?, ?, ?, ?)'
    ).run(name, googleId, email, avatarUrl);
    player = db.prepare('SELECT * FROM players WHERE google_id = ?').get(googleId);
  }
  
  // Create session token
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  db.prepare(
    'INSERT INTO sessions (id, player_id, token, expires_at) VALUES (?, ?, ?, ?)'
  ).run(crypto.randomUUID(), player.id, token, expiresAt.toISOString());
  
  res.json({ player, token });
});

// GET /auth/me — get current player from session token
router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  const session = db.prepare(
    "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')"
  ).get(token);
  if (!session) return res.status(401).json({ error: 'Session expired' });
  
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(session.player_id);
  res.json(player);
});
```

### Register the route in `server/index.js`
```javascript
app.use('/auth', require('./routes/auth'));
```

---

## 5. Frontend Implementation

### Add Google Sign-In button to lobby (index.html)

```html
<!-- In <head> -->
<script src="https://accounts.google.com/gsi/client" async defer></script>

<!-- In the Players section, before the add-player form -->
<div id="g_id_onload"
     data-client_id="YOUR_CLIENT_ID"
     data-callback="handleGoogleSignIn"
     data-auto_prompt="false">
</div>
<div class="g_id_signin"
     data-type="standard"
     data-shape="rectangular"
     data-theme="filled_black"
     data-text="signin_with"
     data-size="large"
     data-logo_alignment="left">
</div>
```

### Handle the callback in lobby.js

```javascript
async function handleGoogleSignIn(response) {
  const res = await API.post('/auth/google', {
    credential: response.credential
  });
  // Store token in localStorage
  localStorage.setItem('auth_token', res.token);
  localStorage.setItem('current_player_id', res.player.id);
  await loadPlayers();
}
```

### Auto-select the signed-in player

When loading the lobby, check if the user has a stored session:
```javascript
async function checkAuth() {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  try {
    const player = await API.get('/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return player;
  } catch {
    localStorage.removeItem('auth_token');
    return null;
  }
}
```

---

## 6. Player Avatar Changes

Google users get a profile picture URL instead of a color dot:

```javascript
// In renderPlayerList / renderScoreboard:
const avatar = p.avatar_url
  ? `<img class="avatar" src="${p.avatar_url}" alt="">`
  : `<span class="avatar" style="background:${p.avatar_color}"></span>`;
```

```css
.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}
```

---

## 7. Migration Strategy

- Existing local players (no google_id) continue to work as-is
- Google sign-in is optional — the manual "Add Player" form stays
- A signed-in Google user can "claim" an existing local player by linking accounts (match by name or manual link)
- AI players are unaffected

---

## 8. Security Considerations

- **Never trust the client-side token alone** — always verify with Google's API server-side
- **Store session tokens securely** — use HttpOnly cookies if possible, or Bearer tokens in localStorage
- **HTTPS required in production** — Google OAuth won't work over plain HTTP (except localhost)
- **CSRF protection** — Google's GIS library handles this via the credential response
- **Token expiry** — sessions expire after 30 days, re-auth required

---

## 9. Docker / Production Notes

- Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to your Docker environment
- For production, use HTTPS (e.g. behind Caddy/nginx reverse proxy with Let's Encrypt)
- Update Google Cloud Console with production domain in authorized origins
- The `.env` file should be in `.gitignore` (never commit secrets)

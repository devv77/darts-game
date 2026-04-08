# Remote Play via WebRTC

Play against a friend in another location with a live video feed of their dartboard and a synced scoreboard.

---

## Concept

Both players open the same game in their browser. They see:
- The shared scoreboard (already works via Socket.IO)
- A small picture-in-picture video feed of the other player's dartboard in the corner
- Their own camera feed (thumbnail) so they can position it

The score input works exactly as it does locally — whoever's turn it is enters their score.

---

## Architecture

```
Player A (Browser)                    Player B (Browser)
  ├── Camera → WebRTC ──────────────→ Video element
  ├── Video element ←────────────────── Camera → WebRTC
  └── Socket.IO ←───── Server ──────→ Socket.IO
         (game state)    │    (game state)
                         │
                   Signaling only
              (ICE candidates, SDP offers)
```

- **Socket.IO** (already built) handles game state sync AND WebRTC signaling
- **WebRTC** establishes a direct peer-to-peer video stream (no video through the server)
- **Cloudflare Tunnel** exposes the local server to the internet without port forwarding

---

## Implementation Plan

### 1. Signaling via Socket.IO

Add new socket events for WebRTC handshake. No new server dependencies needed — Socket.IO is the signaling server.

**New socket events:**

```javascript
// Server (socket-handler.js) — relay signaling messages between peers
socket.on('webrtc-offer', ({ gameId, offer }) => {
  socket.to(`game:${gameId}`).emit('webrtc-offer', { offer, from: socket.id });
});

socket.on('webrtc-answer', ({ gameId, answer }) => {
  socket.to(`game:${gameId}`).emit('webrtc-answer', { answer, from: socket.id });
});

socket.on('webrtc-ice-candidate', ({ gameId, candidate }) => {
  socket.to(`game:${gameId}`).emit('webrtc-ice-candidate', { candidate, from: socket.id });
});
```

That's it for the server — just relay messages to the other player(s) in the game room.

### 2. Client-Side WebRTC

New file: `public/js/video-call.js`

```javascript
let localStream = null;
let peerConnection = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

async function startVideo(socket, gameId) {
  // Get camera access
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: 640, height: 480 },
    audio: false  // No audio needed for darts
  });
  
  document.getElementById('local-video').srcObject = localStream;
  
  // Create peer connection
  peerConnection = new RTCPeerConnection(rtcConfig);
  
  // Add local tracks
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
  
  // Handle incoming tracks (remote video)
  peerConnection.ontrack = (event) => {
    document.getElementById('remote-video').srcObject = event.streams[0];
  };
  
  // Send ICE candidates via Socket.IO
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', { gameId, candidate: event.candidate });
    }
  };
  
  // Create and send offer (first player to join initiates)
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('webrtc-offer', { gameId, offer });
}

// Handle incoming offer (second player)
socket.on('webrtc-offer', async ({ offer }) => {
  if (!peerConnection) await startVideo(socket, gameId);
  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('webrtc-answer', { gameId, answer });
});

// Handle incoming answer
socket.on('webrtc-answer', async ({ answer }) => {
  await peerConnection.setRemoteDescription(answer);
});

// Handle incoming ICE candidates
socket.on('webrtc-ice-candidate', async ({ candidate }) => {
  await peerConnection.addIceCandidate(candidate);
});
```

### 3. UI Changes (game.html)

Add video elements to the game page:

```html
<!-- Video overlay — picture-in-picture style -->
<div id="video-container" class="video-container" hidden>
  <video id="remote-video" class="remote-video" autoplay playsinline></video>
  <video id="local-video" class="local-video" autoplay playsinline muted></video>
  <button id="toggle-video" class="toggle-video-btn">📹</button>
</div>
```

```css
.video-container {
  position: fixed;
  bottom: 0.5rem;
  right: 0.5rem;
  z-index: 50;
}

.remote-video {
  width: 160px;
  height: 120px;
  border-radius: 8px;
  border: 2px solid var(--player-color);
  object-fit: cover;
}

.local-video {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 48px;
  height: 36px;
  border-radius: 4px;
  border: 1px solid var(--border);
  object-fit: cover;
}

.toggle-video-btn {
  position: absolute;
  top: -12px;
  left: -12px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  font-size: 0.8rem;
  cursor: pointer;
}
```

### 4. Game Creation — Remote Mode Toggle

Add a "Remote Play" toggle in the lobby when creating a game:

```html
<label class="remote-toggle">
  <input type="checkbox" id="remote-play"> Enable video for remote play
</label>
```

When enabled, the game page auto-starts the camera and WebRTC connection. When disabled (local play), no camera prompt — works exactly as today.

Store in game settings: `{ format: "single", remote: true }`

### 5. Exposing to the Internet — Cloudflare Tunnel

Players on different networks need to reach the server. Cloudflare Tunnel is the simplest zero-config option (free, no port forwarding, automatic HTTPS).

#### Install cloudflared
```bash
# Linux
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
```

#### Quick tunnel (no Cloudflare account needed)
```bash
cloudflared tunnel --url http://localhost:8080
```

This prints a public URL like `https://random-name.trycloudflare.com` — share it with your opponent.

#### Permanent tunnel (with Cloudflare account + custom domain)
```bash
cloudflared tunnel login
cloudflared tunnel create darts
cloudflared tunnel route dns darts darts.yourdomain.com
cloudflared tunnel run --url http://localhost:8080 darts
```

Add to `docker-compose.yml` as a sidecar:
```yaml
services:
  darts:
    build: .
    ports:
      - "8080:3000"
    volumes:
      - darts-data:/app/data
    restart: unless-stopped
  
  tunnel:
    image: cloudflare/cloudflared:latest
    command: tunnel --url http://darts:3000
    depends_on:
      - darts
    restart: unless-stopped
```

---

## STUN/TURN Servers

WebRTC needs STUN servers to discover public IPs. Google's free STUN servers work for most cases:

```javascript
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]
```

For players behind strict firewalls/symmetric NAT, you may need a TURN server (relays traffic). Options:
- **Cloudflare TURN** (free tier available via Cloudflare Calls)
- **Coturn** (self-hosted, open source)
- **Twilio TURN** (paid, reliable)

---

## Implementation Phases

### Phase A — Signaling
- Add WebRTC relay events to socket-handler.js (3 events, ~10 lines)
- No new dependencies

### Phase B — Video Module
- Create video-call.js with WebRTC peer connection logic
- Add video elements to game.html
- Add CSS for PiP video overlay
- Camera permission handling + fallback

### Phase C — Lobby Integration
- Remote play toggle in game creation
- Auto-start video when game loads with remote flag
- Connection status indicator (connecting/connected/failed)

### Phase D — Production Deployment
- Cloudflare Tunnel setup (quick or permanent)
- TURN server for firewall traversal
- Bandwidth considerations (640x480 is ~1-2 Mbps)

---

## Security Notes

- Camera access requires HTTPS (or localhost) — Cloudflare Tunnel provides this
- WebRTC streams are encrypted end-to-end by default (DTLS-SRTP)
- No video goes through your server — direct peer-to-peer
- Users must explicitly grant camera permission

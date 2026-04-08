// Animation Overlay System — GSAP + Canvas-Confetti + Sound Effects
// Triggers arcade-style visual + audio effects for significant scores

// ========== SOUND ENGINE (Web Audio API) ==========
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, type, volume, delay) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume || 0.3, ctx.currentTime + (delay || 0));
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (delay || 0) + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + (delay || 0));
  osc.stop(ctx.currentTime + (delay || 0) + duration);
}

function sound180() {
  // Dramatic rising fanfare
  playTone(523, 0.15, 'square', 0.25, 0);    // C5
  playTone(659, 0.15, 'square', 0.25, 0.12);  // E5
  playTone(784, 0.15, 'square', 0.25, 0.24);  // G5
  playTone(1047, 0.4, 'square', 0.3, 0.36);   // C6 — hold
}

function soundTon() {
  // Quick upward chime
  playTone(660, 0.12, 'triangle', 0.2, 0);
  playTone(880, 0.2, 'triangle', 0.25, 0.1);
}

function soundGameShot() {
  // Victory fanfare — major chord arpeggio + sustained
  playTone(523, 0.2, 'square', 0.2, 0);      // C5
  playTone(659, 0.2, 'square', 0.2, 0.15);    // E5
  playTone(784, 0.2, 'square', 0.2, 0.3);     // G5
  playTone(1047, 0.6, 'square', 0.25, 0.45);  // C6
  playTone(1319, 0.6, 'sine', 0.15, 0.5);     // E6 harmony
}

function soundBust() {
  // Low buzz — descending
  playTone(200, 0.15, 'sawtooth', 0.2, 0);
  playTone(120, 0.3, 'sawtooth', 0.25, 0.1);
}

// ========== VOICE ANNOUNCEMENTS (Web Speech API) ==========
let voiceEnabled = true;
let callerVoice = null;

function initVoice() {
  if (!('speechSynthesis' in window)) return;
  // Pick a good English voice once voices are loaded
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    // Prefer a male English voice for that classic darts caller feel
    callerVoice = voices.find(v => v.lang.startsWith('en') && /male/i.test(v.name))
      || voices.find(v => v.lang.startsWith('en-GB'))
      || voices.find(v => v.lang.startsWith('en'))
      || voices[0] || null;
  }
  if (speechSynthesis.getVoices().length) pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function announce(text, rate, pitch) {
  if (!voiceEnabled || !('speechSynthesis' in window)) return;
  // Cancel any queued speech
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (callerVoice) utterance.voice = callerVoice;
  utterance.rate = rate || 0.9;
  utterance.pitch = pitch || 1.0;
  utterance.volume = 1.0;
  speechSynthesis.speak(utterance);
}

function announceScore(score) {
  // Darts caller style number pronunciation
  if (score === 180) return 'One hundred and eighty!';
  if (score === 0 || score === -1) return 'No score!';
  if (score >= 100) {
    const hundreds = Math.floor(score / 100);
    const remainder = score % 100;
    if (remainder === 0) return hundreds === 1 ? 'One hundred!' : `${hundreds} hundred!`;
    return `${hundreds === 1 ? 'One' : hundreds} hundred and ${pronounceNumber(remainder)}!`;
  }
  return pronounceNumber(score);
}

function pronounceNumber(n) {
  // Standard English for common darts scores
  const special = {
    26: 'twenty six', 41: 'forty one', 45: 'forty five',
    60: 'sixty', 85: 'eighty five', 100: 'one hundred'
  };
  if (special[n]) return special[n];
  if (n <= 20) return String(n);
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? tens[t] : `${tens[t]} ${o}`;
}

// Initialize voice on load
initVoice();

/**
 * Trigger a throw animation + voice based on score and checkout status
 * @param {number} turnScore - The score of the turn (or -1 for bust)
 * @param {boolean} isCheckout - Whether this was a game-winning checkout
 */
function triggerThrowAnimation(turnScore, isCheckout) {
  if (typeof gsap === 'undefined') return;

  if (isCheckout) {
    animateGameShot();
    setTimeout(() => announce('Game shot!', 0.85, 1.1), 400);
  } else if (turnScore === -1 || turnScore === 0) {
    animateBust();
    setTimeout(() => announce('No score!', 0.9, 0.8), 200);
  } else if (turnScore === 180) {
    animate180();
    setTimeout(() => announce('One hundred and eighty!', 0.8, 1.2), 300);
  } else if (turnScore >= 100) {
    animateTonPlus(turnScore);
    setTimeout(() => announce(announceScore(turnScore), 0.9, 1.0), 200);
  } else {
    // Regular scores — announce without animation
    announce(announceScore(turnScore), 1.0, 1.0);
  }
}

function createOverlay(text, className) {
  const el = document.createElement('div');
  el.className = 'anim-overlay ' + (className || '');
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

// ========== 180 — Maximum ==========
function animate180() {
  sound180();
  const el = createOverlay('180', 'anim-180');

  const tl = gsap.timeline({
    onComplete: () => el.remove()
  });

  tl.fromTo(el,
    { scale: 0.2, opacity: 0, rotation: -10 },
    { scale: 1.4, opacity: 1, rotation: 0, duration: 0.3, ease: 'back.out(2)' }
  )
  .to(el, {
    x: '+=8', duration: 0.05, repeat: 5, yoyo: true, ease: 'none'
  })
  .to(el, {
    scale: 1.6, opacity: 0, duration: 0.4, ease: 'power2.in', delay: 0.3
  });

  // Quick confetti burst for 180
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 60,
      spread: 70,
      origin: { y: 0.4 },
      colors: ['#e53935', '#fbbf24', '#ffffff'],
      disableForReducedMotion: true
    });
  }
}

// ========== Ton+ (100-179) ==========
function animateTonPlus(score) {
  soundTon();
  const el = createOverlay(score.toString(), 'anim-ton');

  const tl = gsap.timeline({
    onComplete: () => el.remove()
  });

  tl.fromTo(el,
    { x: '-100vw', opacity: 0.8 },
    { x: '0vw', opacity: 1, duration: 0.3, ease: 'power3.out' }
  )
  .to(el, {
    duration: 0.6, ease: 'none' // pause in center
  })
  .to(el, {
    x: '100vw', opacity: 0, duration: 0.25, ease: 'power3.in'
  });
}

// ========== Game Shot (Checkout) ==========
function animateGameShot() {
  soundGameShot();
  const el = createOverlay('GAME SHOT', 'anim-gameshot');

  // Massive confetti blast
  if (typeof confetti === 'function') {
    const end = Date.now() + 1500;
    const colors = ['#fbbf24', '#e53935', '#22c55e', '#3b82f6', '#ffffff'];

    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: colors,
        disableForReducedMotion: true
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: colors,
        disableForReducedMotion: true
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }

  const tl = gsap.timeline({
    onComplete: () => el.remove()
  });

  tl.fromTo(el,
    { scale: 0.3, opacity: 0 },
    { scale: 1.1, opacity: 1, duration: 0.4, ease: 'elastic.out(1, 0.5)' }
  )
  .to(el, {
    scale: 1.0, duration: 0.1
  })
  .to(el, {
    scale: 1.3, opacity: 0, duration: 0.5, ease: 'power2.in', delay: 1.0
  });
}

// ========== Bust ==========
function animateBust() {
  soundBust();
  const el = createOverlay('BUST', 'anim-bust');

  const tl = gsap.timeline({
    onComplete: () => el.remove()
  });

  tl.fromTo(el,
    { scale: 3, opacity: 0.9, rotation: -8 },
    { scale: 1, opacity: 1, rotation: 0, duration: 0.15, ease: 'power4.in' }
  )
  .to(el, {
    opacity: 0, duration: 0.4, delay: 0.5, ease: 'power2.in'
  });
}

// ========== Debug: triple-tap mode badge to show debug panel ==========
(function() {
  let tapCount = 0;
  let tapTimer = null;
  const badge = document.querySelector('.game-mode-badge');
  if (badge) {
    badge.addEventListener('click', () => {
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 600);
      if (tapCount >= 3) {
        const dbg = document.getElementById('debug-animations');
        if (dbg) dbg.hidden = !dbg.hidden;
        tapCount = 0;
      }
    });
  }
})();

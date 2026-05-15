import { gsap } from 'gsap';
import confetti from 'canvas-confetti';

// ============ Sound engine (Web Audio API) ============
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch { return null; }
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function playTone(freq: number, duration: number, type: OscillatorType, volume: number, delay = 0) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ctx.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + delay);
  osc.stop(ctx.currentTime + delay + duration);
}

function sound180() {
  playTone(523, 0.15, 'square', 0.25, 0);
  playTone(659, 0.15, 'square', 0.25, 0.12);
  playTone(784, 0.15, 'square', 0.25, 0.24);
  playTone(1047, 0.4, 'square', 0.3, 0.36);
}

function soundTon() {
  playTone(660, 0.12, 'triangle', 0.2, 0);
  playTone(880, 0.2, 'triangle', 0.25, 0.1);
}

function soundGameShot() {
  playTone(523, 0.2, 'square', 0.2, 0);
  playTone(659, 0.2, 'square', 0.2, 0.15);
  playTone(784, 0.2, 'square', 0.2, 0.3);
  playTone(1047, 0.6, 'square', 0.25, 0.45);
  playTone(1319, 0.6, 'sine', 0.15, 0.5);
}

function soundBust() {
  playTone(200, 0.15, 'sawtooth', 0.2, 0);
  playTone(120, 0.3, 'sawtooth', 0.25, 0.1);
}

// ============ Voice (Web Speech API) ============
let voiceEnabled = true;
let callerVoice: SpeechSynthesisVoice | null = null;

export function isVoiceEnabled(): boolean {
  return voiceEnabled;
}

export function setVoiceEnabled(enabled: boolean) {
  voiceEnabled = enabled;
  if (!enabled && typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel();
  }
}

export function initVoice() {
  if (typeof speechSynthesis === 'undefined') return;
  const pickVoice = () => {
    const voices = speechSynthesis.getVoices();
    callerVoice =
      voices.find((v) => v.lang.startsWith('en') && /male/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith('en-GB')) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      voices[0] ||
      null;
  };
  if (speechSynthesis.getVoices().length) pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

export function announce(text: string, rate = 0.9, pitch = 1.0) {
  if (!voiceEnabled || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (callerVoice) utterance.voice = callerVoice;
  utterance.rate = rate;
  utterance.pitch = pitch;
  utterance.volume = 1.0;
  speechSynthesis.speak(utterance);
}

function pronounceNumber(n: number): string {
  const special: Record<number, string> = {
    26: 'twenty six', 41: 'forty one', 45: 'forty five',
    60: 'sixty', 85: 'eighty five', 100: 'one hundred',
  };
  if (special[n]) return special[n];
  if (n <= 20) return String(n);
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? tens[t]! : `${tens[t]} ${o}`;
}

function announceScore(score: number): string {
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

// ============ Overlay animations ============
function createOverlay(text: string, className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'anim-overlay ' + className;
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

function animate180() {
  sound180();
  const el = createOverlay('180', 'anim-180');

  const tl = gsap.timeline({ onComplete: () => el.remove() });
  tl.fromTo(el,
    { scale: 0.2, opacity: 0, rotation: -10 },
    { scale: 1.4, opacity: 1, rotation: 0, duration: 0.3, ease: 'back.out(2)' }
  )
    .to(el, { x: '+=8', duration: 0.05, repeat: 5, yoyo: true, ease: 'none' })
    .to(el, { scale: 1.6, opacity: 0, duration: 0.4, ease: 'power2.in', delay: 0.3 });

  confetti({
    particleCount: 60,
    spread: 70,
    origin: { y: 0.4 },
    colors: ['#e53935', '#fbbf24', '#ffffff'],
    disableForReducedMotion: true,
  });
}

function animateTonPlus(score: number) {
  soundTon();
  const el = createOverlay(score.toString(), 'anim-ton');
  const tl = gsap.timeline({ onComplete: () => el.remove() });
  tl.fromTo(el,
    { x: '-100vw', opacity: 0.8 },
    { x: '0vw', opacity: 1, duration: 0.3, ease: 'power3.out' }
  )
    .to(el, { duration: 0.6, ease: 'none' })
    .to(el, { x: '100vw', opacity: 0, duration: 0.25, ease: 'power3.in' });
}

function animateGameShot() {
  soundGameShot();
  const el = createOverlay('GAME SHOT', 'anim-gameshot');

  const end = Date.now() + 1500;
  const colors = ['#fbbf24', '#e53935', '#22c55e', '#3b82f6', '#ffffff'];
  (function frame() {
    confetti({
      particleCount: 4, angle: 60, spread: 55,
      origin: { x: 0 }, colors, disableForReducedMotion: true,
    });
    confetti({
      particleCount: 4, angle: 120, spread: 55,
      origin: { x: 1 }, colors, disableForReducedMotion: true,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();

  const tl = gsap.timeline({ onComplete: () => el.remove() });
  tl.fromTo(el,
    { scale: 0.3, opacity: 0 },
    { scale: 1.1, opacity: 1, duration: 0.4, ease: 'elastic.out(1, 0.5)' }
  )
    .to(el, { scale: 1.0, duration: 0.1 })
    .to(el, { scale: 1.3, opacity: 0, duration: 0.5, ease: 'power2.in', delay: 1.0 });
}

function animateBust() {
  soundBust();
  const el = createOverlay('BUST', 'anim-bust');
  const tl = gsap.timeline({ onComplete: () => el.remove() });
  tl.fromTo(el,
    { scale: 3, opacity: 0.9, rotation: -8 },
    { scale: 1, opacity: 1, rotation: 0, duration: 0.15, ease: 'power4.in' }
  )
    .to(el, { opacity: 0, duration: 0.4, delay: 0.5, ease: 'power2.in' });
}

export function triggerThrowAnimation(turnScore: number, isCheckout: boolean) {
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
    announce(announceScore(turnScore), 1.0, 1.0);
  }
}

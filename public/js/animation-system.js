// Animation Overlay System — GSAP + Canvas-Confetti
// Triggers arcade-style visual effects for significant scores

/**
 * Trigger a throw animation based on score and checkout status
 * @param {number} turnScore - The score of the turn (or -1 for bust)
 * @param {boolean} isCheckout - Whether this was a game-winning checkout
 */
function triggerThrowAnimation(turnScore, isCheckout) {
  if (typeof gsap === 'undefined') return;

  if (isCheckout) {
    animateGameShot();
  } else if (turnScore === -1 || turnScore === 0) {
    // Bust indicator (score 0 with bust flag, or -1 from debug)
    animateBust();
  } else if (turnScore === 180) {
    animate180();
  } else if (turnScore >= 100) {
    animateTonPlus(turnScore);
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

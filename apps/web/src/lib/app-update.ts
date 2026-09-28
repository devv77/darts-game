// Stale-bundle recovery. The PWA uses registerType 'prompt', so an open (or
// installed) app keeps running the old bundle until the user taps Refresh —
// the server now refuses writes from such clients and emits `client-outdated`.

let registration: ServiceWorkerRegistration | undefined;
const RELOAD_GUARD_KEY = 'darts:forced-update-at';
const RELOAD_GUARD_MS = 60_000;

export function setSwRegistration(reg: ServiceWorkerRegistration | undefined) {
  registration = reg;
}

export function checkForUpdate() {
  registration?.update().catch(() => {});
}

/** Activate the newest service worker (if any) and reload onto the new bundle. */
export async function forceUpdate() {
  // Guard against a reload loop if the new bundle somehow isn't reachable yet.
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // storage blocked — still try once
  }
  try {
    await registration?.update();
  } catch {
    // offline or no SW — a plain reload is the best we can do
  }
  const waiting = registration?.waiting;
  if (waiting && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // Fallback if controllerchange never fires.
    window.setTimeout(() => window.location.reload(), 3000);
    return;
  }
  window.location.reload();
}

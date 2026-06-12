// Phase 8c — web push client. Subscribes the browser to lock-screen "your turn"
// notifications. Server: apps/server/src/routes/push.ts + push.ts.
import { api } from './api';

interface VapidInfo { publicKey: string | null; enabled: boolean }

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getPushEnabled(): Promise<boolean> {
  try {
    const v = await api.get<VapidInfo>('/api/push/vapid');
    return v.enabled;
  } catch {
    return false;
  }
}

export async function isSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  return !!(await reg.pushManager.getSubscription());
}

/** Request permission and register a subscription. Returns true on success. */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) throw new Error('Notifications are not supported on this device');
  const vapid = await api.get<VapidInfo>('/api/push/vapid');
  if (!vapid.enabled || !vapid.publicKey) throw new Error('Push is not configured on the server');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission denied');

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid.publicKey) as BufferSource,
  });
  await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
  return true;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

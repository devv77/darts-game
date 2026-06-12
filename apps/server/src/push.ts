import webpush from 'web-push';
import { db } from './db.js';

// Phase 8c — web push. VAPID keys come from env; with none set push is disabled
// and every entry point below no-ops, so the app runs fine without it.
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — generate with `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT                        — a mailto: or https: contact URL
const publicKey = process.env.VAPID_PUBLIC_KEY || '';
const privateKey = process.env.VAPID_PRIVATE_KEY || '';
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

export const pushEnabled = !!(publicKey && privateKey);
if (pushEnabled) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export function getVapidPublicKey(): string | null {
  return pushEnabled ? publicKey : null;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function saveSubscription(playerId: number, sub: PushSubscriptionInput): void {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Invalid subscription');
  db.prepare(
    `INSERT INTO push_subscriptions (player_id, endpoint, p256dh_key, auth_key) VALUES (?, ?, ?, ?)
     ON CONFLICT(player_id, endpoint) DO UPDATE SET p256dh_key = excluded.p256dh_key, auth_key = excluded.auth_key`
  ).run(playerId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}

export function removeSubscription(playerId: number, endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE player_id = ? AND endpoint = ?').run(playerId, endpoint);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Send a notification to every endpoint a player has registered. Dead endpoints
 * (404/410) are pruned. Fire-and-forget — failures are swallowed so a turn
 * never blocks on push delivery.
 */
export function sendPushToPlayer(playerId: number, payload: PushPayload): void {
  if (!pushEnabled) return;
  const subs = db.prepare(
    'SELECT endpoint, p256dh_key, auth_key FROM push_subscriptions WHERE player_id = ?'
  ).all(playerId) as { endpoint: string; p256dh_key: string; auth_key: string }[];
  const body = JSON.stringify(payload);
  for (const s of subs) {
    webpush
      .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh_key, auth: s.auth_key } }, body)
      .catch((err: { statusCode?: number }) => {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE player_id = ? AND endpoint = ?').run(playerId, s.endpoint);
        }
      });
  }
}

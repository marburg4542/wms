// Web Push — ส่งแจ้งเตือนที่เด้งแม้ปิดแอป (ผ่าน Service Worker)
import webpush from 'web-push';
import db from './db.js';
import { config } from './config.js';

const enabled = !!(config.vapid.publicKey && config.vapid.privateKey);
if (enabled) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
} else {
  console.warn('⚠️ VAPID keys ยังไม่ถูกตั้งค่า — ปิดฟีเจอร์ push notification');
}

export const isPushEnabled = () => enabled;
export const getPublicKey = () => config.vapid.publicKey;

// บันทึก/อัปเดต subscription ของผู้ใช้ (endpoint ไม่ซ้ำ = 1 อุปกรณ์ 1 แถว)
export const saveSubscription = (username, subscription) => {
  if (!subscription?.endpoint) return;
  db.prepare(`
    INSERT INTO push_subscriptions (username, endpoint, subscription)
    VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET username = excluded.username, subscription = excluded.subscription
  `).run(username, subscription.endpoint, JSON.stringify(subscription));
};

// ส่ง push ให้ทุกอุปกรณ์ของผู้ใช้คนหนึ่ง — ถ้า subscription หมดอายุ (410/404) ลบทิ้ง
// คืนสรุปผล { total, sent, failed, errors } เพื่อใช้วินิจฉัย (เช่น Apple ปฏิเสธ VAPID)
export const sendPushToUser = async (username, payload) => {
  if (!enabled || !username) return { total: 0, sent: 0, failed: 0, errors: ['push disabled'] };

  const rows = db.prepare('SELECT endpoint, subscription FROM push_subscriptions WHERE username = ?').all(username);
  const body = JSON.stringify(payload);
  const errors = [];
  let sent = 0;

  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(JSON.parse(row.subscription), body);
      sent += 1;
    } catch (err) {
      const status = err.statusCode;
      const detail = `${status || '?'} ${String(err.body || err.message || '').slice(0, 200)}`;
      errors.push(detail);
      console.error(`❌ push ไปยัง ${username} ล้มเหลว (${new URL(row.endpoint).host}):`, detail);
      if (status === 410 || status === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
      }
    }
  }));

  return { total: rows.length, sent, failed: errors.length, errors };
};

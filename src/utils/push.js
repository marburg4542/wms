// Push Notification (เด้งแม้ปิดแอป)
// iOS: ต้องติดตั้งเป็น PWA + ขอสิทธิ์จากการ "แตะปุ่มโดยตรง" เท่านั้น (ห้ามขออัตโนมัติหลัง await)
import { fetchApi } from './api';

const supported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

// สมัคร subscription จริง (สิทธิ์ต้องเป็น granted แล้ว)
const doSubscribe = async () => {
  const reg = await navigator.serviceWorker.ready;
  const keyRes = await fetchApi('/api/push/public-key').catch(() => null);
  if (!keyRes?.success || !keyRes.enabled || !keyRes.publicKey) return false;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey)
    });
  }
  await fetchApi('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
  return true;
};

// เรียกตอน login/โหลดแอป — สมัครเฉพาะถ้า "เคยอนุญาตแล้ว" (ไม่เด้งขอสิทธิ์ ไม่รบกวน)
export const subscribeIfGranted = async () => {
  try {
    if (!supported() || Notification.permission !== 'granted') return;
    await doSubscribe();
  } catch (err) {
    console.warn('Push subscribe skipped:', err?.message);
  }
};

// เรียกจากปุ่มโดยตรง (อยู่ใน user gesture — จำเป็นบน iOS) → ขอสิทธิ์ + สมัคร
// คืน { ok, reason }: reason = 'granted' | 'denied' | 'default' | 'unsupported' | 'error'
export const enablePush = async () => {
  if (!supported()) return { ok: false, reason: 'unsupported' };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: permission };
    const ok = await doSubscribe();
    return { ok, reason: ok ? 'granted' : 'error' };
  } catch (err) {
    console.warn('enablePush error:', err?.message);
    return { ok: false, reason: 'error' };
  }
};

// สถานะสิทธิ์ปัจจุบัน สำหรับแสดงในหน้าตั้งค่า
export const pushPermissionState = () =>
  supported() ? Notification.permission : 'unsupported'; // 'granted' | 'denied' | 'default' | 'unsupported'

// ข้อมูลสภาพแวดล้อม เพื่อบอกผู้ใช้ว่าติดเงื่อนไขไหน (โดยเฉพาะ iOS)
export const pushEnvironment = () => {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS แสร้งเป็น Mac
  const isStandalone = window.navigator.standalone === true
    || !!window.matchMedia?.('(display-mode: standalone)').matches;
  return { supported: supported(), isIOS, isStandalone };
};

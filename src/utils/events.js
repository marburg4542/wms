// ============================================================================
// ตัวรับสัญญาณ real-time จาก server (SSE) — ใช้ EventSource "ตัวเดียว" แชร์ทั้งแอป
// (browser จำกัด ~6 connections ต่อ origin ถ้าเปิดหลายแท็บ/หลายหน้าแยกกันจะชนเพดาน)
// การใช้: const unsubscribe = onServerEvent('products', () => refetch());
// ============================================================================
const EVENT_NAMES = ['transactions', 'products', 'users'];

let source = null;
const listeners = {
  transactions: new Set(),
  products: new Set(),
  users: new Set()
};

const connect = () => {
  if (source) return;
  const token = sessionStorage.getItem('token');
  if (!token) return;

  // EventSource ใส่ header ไม่ได้ จึงส่ง token ผ่าน query (server ตรวจ JWT ก่อนเปิด stream)
  source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  for (const name of EVENT_NAMES) {
    source.addEventListener(name, () => {
      listeners[name].forEach((fn) => {
        try { fn(); } catch (err) { console.error('SSE handler error:', err); }
      });
    });
  }
  // ถ้า connection หลุด browser ต่อกลับเองอัตโนมัติ (ตาม retry ที่ server กำหนด)
  // ยกเว้น token หมดอายุ (401) จะปิดถาวร — ระบบยังมี polling เป็น fallback อยู่แล้ว
};

export const onServerEvent = (name, fn) => {
  connect();
  listeners[name]?.add(fn);
  return () => listeners[name]?.delete(fn);
};

// เรียกตอน logout เพื่อปิด connection แล้วให้ต่อใหม่ด้วย token ใหม่หลัง login
export const resetEventStream = () => {
  source?.close();
  source = null;
};

// Service Worker สำหรับ WMS PWA
// เป้าหมาย: โหลดเร็วขึ้นเมื่อเปิดซ้ำ + เปิดหน้าเปล่าได้เมื่อออฟไลน์ + รับ push notification
// ห้ามยุ่งกับ /api/ เด็ดขาด (ข้อมูลสด + SSE ต้องผ่านไปที่ server ตรงๆ เสมอ)
const CACHE = 'wms-cache-v1';

// รับ push จาก server แล้วแสดงแจ้งเตือน (เด้งแม้ปิดแอป)
self.addEventListener('push', (event) => {
  let data = { title: 'WMS', body: '', url: '/homepage' };
  try { data = { ...data, ...event.data.json() }; } catch { /* ignore */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
      vibrate: [80, 40, 80]
    })
  );
});

// กดที่แจ้งเตือน → เปิด/โฟกัสแอปไปที่หน้าที่เกี่ยวข้อง
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.focus(); client.navigate?.(url); return; }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/index.html', '/manifest.webmanifest'])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // ข้าม API/SSE และ cross-origin ทั้งหมด — ปล่อยให้ผ่านไปตามปกติ
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // รูปที่อัปโหลด: cache-first (ชื่อไฟล์ไม่ซ้ำ จึงปลอดภัยที่จะแคชถาวร)
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(request).then((hit) => hit || fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  // หน้าเว็บ (navigation): network-first เผื่อมีอัปเดต ถ้าออฟไลน์ค่อยใช้ index.html ที่แคชไว้
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  // ไฟล์ static (js/css/รูปในแอป): stale-while-revalidate โหลดจากแคชก่อน แล้วอัปเดตเบื้องหลัง
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((hit) => {
        const network = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => hit);
        return hit || network;
      })
    )
  );
});

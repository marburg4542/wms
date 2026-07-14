// ============================================================================
// SSE (Server-Sent Events) — ช่องทางให้ server "ผลัก" สัญญาณไปบอก browser ทันที
// ที่มีข้อมูลเปลี่ยน (ใบเบิก/สินค้า/ผู้ใช้) โดย browser ค่อยไป refetch ข้อมูลเอง
// สัญญาณมีแค่ชื่อ event ไม่มีข้อมูลจริง จึงไม่มีความเสี่ยงข้อมูลรั่วผ่านช่องทางนี้
// ============================================================================
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const clients = new Set();
const router = express.Router();

// EventSource ของ browser ใส่ Authorization header ไม่ได้ จึงรับ token ผ่าน query แทน
router.get('/events', (req, res) => {
  try {
    jwt.verify(String(req.query.token || ''), config.jwtSecret);
  } catch {
    return res.status(401).json({ success: false, message: 'unauthorized' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no' // กัน reverse proxy (nginx) buffer stream ในอนาคต
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n'); // ถ้าหลุด ให้ browser ต่อกลับเองใน 5 วินาที

  clients.add(res);
  // ส่ง ping กันตัวกลาง (proxy/router) ตัด connection ที่เงียบนานเกิน
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// กระจายสัญญาณให้ทุก client ที่ต่ออยู่ — event: 'transactions' | 'products' | 'users'
export const broadcast = (event) => {
  const payload = `event: ${event}\ndata: {}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
};

export default router;

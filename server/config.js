// server/config.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// FRONTEND_URL ใส่ได้หลาย URL คั่นด้วยจุลภาค เช่น LAN + tunnel:
// FRONTEND_URL=http://192.168.1.101:5173,https://xxx.trycloudflare.com
// ใช้เป็น allowlist ของ CORS และเป็นฐาน URL ของลิงก์รีเซ็ตรหัสผ่านในอีเมล
const frontendUrls = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

export const config = {
  port: process.env.PORT || 5000,
  // ไฟล์ฐานข้อมูล SQLite — ระบุใน .env เป็นชื่อไฟล์ (relative กับโฟลเดอร์ server) หรือ path เต็ม
  // เช่น DB_FILE=identifier.test.sqlite สำหรับสลับไปใช้ฐานข้อมูลทดสอบ
  dbFile: process.env.DB_FILE || 'identifier.sqlite',
  jwtSecret: process.env.JWT_SECRET,
  email: {
    // ตั้ง EMAIL_HOST = ใช้ SMTP ขององค์กร | ไม่ตั้ง = ใช้ Gmail ตาม EMAIL_USER/EMAIL_PASS
    host: process.env.EMAIL_HOST || '',
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: String(process.env.EMAIL_SECURE || '').toLowerCase() === 'true',
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || ''
  },
  // Web Push (VAPID) — สำหรับแจ้งเตือนแบบ push ที่เด้งแม้ปิดแอป
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@wms.local'
  },
  frontendUrls,
  frontendUrl: frontendUrls[0],
  bootstrapAdmin: {
    username: process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin',
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@wms.local',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || ''
  }
};

if (!config.jwtSecret) {
  throw new Error('JWT_SECRET is required. Please set it in the server environment.');
}

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

// เช็คค่าที่สำคัญว่าถูกตั้งค่าหรือยัง
if (!config.email.host && (!config.email.user || !config.email.pass)) {
  console.warn('⚠️ Warning: Email configuration is missing in .env — email features will be skipped.');
}

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import authRoutes from './routes/authRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import userRoutes from './routes/userRoutes.js';
import productRoutes from './routes/productRoutes.js';
import analysisRoutes from './routes/analysisRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import rackRoutes from './routes/rackRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import storageMapRoutes from './routes/storageMapRoutes.js';
import uploadRoutes from './upload.js';
import eventsRouter from './events.js';
import pushRoutes from './routes/pushRoutes.js';
import { config } from './config.js';
import { verifyEmailTransport } from './utils/sendEmail.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// เชื่อฉพาะ proxy ที่เป็น loopback (cloudflared รันบน localhost) เพื่ออ่าน IP จริงของผู้ใช้
// ผ่าน X-Forwarded-For ได้ถูกต้อง — จำเป็นสำหรับ rate limiting หลัง Cloudflare Tunnel
// และปลอดภัยกว่า trust proxy=true (กันการปลอม header จากเครื่องใน LAN)
app.set('trust proxy', 'loopback');
app.use(cors({
  origin: config.frontendUrls,
  credentials: true
}));
app.use(express.json());

// เปิดทางให้เข้าถึงรูปในโฟลเดอร์ uploads ได้
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api', authRoutes);
app.use('/api', transactionRoutes);
app.use('/api', userRoutes);
app.use('/api', productRoutes);
app.use('/api', analysisRoutes);
app.use('/api', projectRoutes);
app.use('/api', rackRoutes);
app.use('/api', roomRoutes);
app.use('/api', storageMapRoutes);
app.use('/api', uploadRoutes);
app.use('/api', eventsRouter);
app.use('/api', pushRoutes);

// เสิร์ฟหน้าเว็บที่ build แล้ว (dist/) จาก Express เอง → เหลือ URL เดียวทั้งเว็บและ API
// ทำให้ทั้งการเปิดผ่าน tunnel และการ deploy จริงง่ายขึ้น (ไม่ต้องเปิด 2 port / ไม่ติด CORS)
// ถ้ายังไม่เคย build (ไม่มี dist/) จะข้ามไป ใช้ Vite dev server ตามปกติ
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // SPA fallback: ทุก path ที่ไม่ใช่ /api และ /uploads ให้คืน index.html (ให้ react-router จัดการ route)
  app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
  console.log('🌐 Serving built frontend from dist/');
}

app.listen(config.port, () => {
  console.log(`🚀 Server running on port ${config.port}`);
  // เช็คระบบอีเมลตอนสตาร์ท จะได้รู้ตั้งแต่ตอนนี้ ไม่ต้องรอให้ผู้ใช้กดลืมรหัสผ่านแล้วเงียบหาย
  verifyEmailTransport();
});

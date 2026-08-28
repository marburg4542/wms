// ตั้งค่า pm2 สำหรับรัน WMS บนเซิร์ฟเวอร์
//
// วิธีใช้ (รันจากโฟลเดอร์บนสุดของโปรเจกต์):
//   pm2 start ecosystem.config.js     เริ่มรัน
//   pm2 restart wms                   รีสตาร์ทหลังอัปเดตโค้ด/.env
//   pm2 save                          จำไว้ให้สตาร์ทเองตอนเปิดเครื่อง
//   pm2 logs wms                      ดู log
//
// ไฟล์นี้แทนการพิมพ์ `pm2 start index.js --name wms` เอง เพื่อให้ทุกเครื่องตั้งค่าเหมือนกัน
//
// ทำไมนามสกุลเป็น .cjs: package.json ของโปรเจกต์ตั้ง "type": "module" ไว้
// ถ้าตั้งชื่อเป็น .js ระบบจะมองเป็น ES module แล้ว module.exports จะใช้ไม่ได้ pm2 จะอ่านไฟล์ไม่ออก
// หมายเหตุ: ค่าต่างๆ ของแอป (JWT_SECRET, FRONTEND_URL ฯลฯ) อ่านจาก server/.env ไม่ได้ตั้งที่นี่

module.exports = {
  apps: [
    {
      name: 'wms',
      script: 'index.js',
      cwd: './server',            // ต้องเป็น server/ เพราะ .env และฐานข้อมูลอ้างอิงจากที่นี่

      instances: 1,               // ห้ามเกิน 1 — SQLite เขียนพร้อมกันหลาย process ไม่ได้
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 10,           // ถ้าพังซ้ำเกินนี้ให้หยุด จะได้รู้ว่ามีปัญหาจริง ไม่วนรีสตาร์ทเงียบๆ
      min_uptime: '30s',          // รันไม่ถึง 30 วิ แล้วตาย = นับว่าพัง
      max_memory_restart: '500M', // กันหน่วยความจำรั่วสะสม

      // log แยกไฟล์ พร้อมเวลาแบบไทย จะได้ไล่ปัญหาย้อนหลังได้
      output: './logs/wms-out.log',
      error: './logs/wms-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      watch: false                // ห้ามเปิด — จะรีสตาร์ททุกครั้งที่ไฟล์อัปโหลด/ฐานข้อมูลเปลี่ยน
    }
  ]
};

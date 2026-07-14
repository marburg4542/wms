// ============================================================================
// สำรองข้อมูล WMS: ฐานข้อมูล SQLite + โฟลเดอร์ uploads (รูปสินค้า/avatar)
//
// วิธีใช้ (จากโฟลเดอร์ server):
//   node tools/backup.mjs                     → สำรองลง server/backups/<เวลา>/
//   BACKUP_KEEP=30 node tools/backup.mjs      → เก็บย้อนหลัง 30 ชุด (ค่าเริ่มต้น 14)
//   BACKUP_DIR=D:\wms-backups node tools/...   → เก็บไว้ที่อื่น (แนะนำคนละไดรฟ์/NAS)
//
// ใช้ db.backup() ของ better-sqlite3 → ได้ไฟล์ที่ consistent แม้ระบบกำลังเขียนอยู่ (รวม WAL)
// ตั้งให้รันอัตโนมัติด้วย Windows Task Scheduler (ดูคำสั่ง schtasks ที่ผมให้ไว้)
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 14));
const backupRoot = process.env.BACKUP_DIR || path.join(serverDir, 'backups');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-07-08T14-30-00
const dest = path.join(backupRoot, stamp);
fs.mkdirSync(dest, { recursive: true });

// 1) ฐานข้อมูล — .backup() ได้สำเนาที่สมบูรณ์แม้กำลังมีการเขียน
const dbPath = path.isAbsolute(config.dbFile) ? config.dbFile : path.join(serverDir, config.dbFile);
const db = new Database(dbPath, { readonly: true });
await db.backup(path.join(dest, 'identifier.sqlite'));
db.close();

// 2) โฟลเดอร์ uploads (ถ้ามี)
const uploads = path.join(serverDir, 'uploads');
if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(dest, 'uploads'), { recursive: true });

// 3) หมุนเวียน: เก็บเฉพาะ KEEP ชุดล่าสุด ลบชุดเก่าทิ้ง
const sets = fs.readdirSync(backupRoot)
  .filter((n) => { try { return fs.statSync(path.join(backupRoot, n)).isDirectory(); } catch { return false; } })
  .sort();
for (const old of sets.slice(0, Math.max(0, sets.length - KEEP))) {
  fs.rmSync(path.join(backupRoot, old), { recursive: true, force: true });
}

const sizeMB = (fs.statSync(path.join(dest, 'identifier.sqlite')).size / 1024 / 1024).toFixed(2);
console.log(`✅ สำรองข้อมูลเสร็จ: ${dest} (ฐานข้อมูล ${sizeMB} MB, เก็บย้อนหลัง ${KEEP} ชุด)`);

// ============================================================================
// สำรองข้อมูล WMS: ฐานข้อมูล SQLite + โฟลเดอร์ uploads (รูปสินค้า/avatar)
//
// วิธีใช้ (จากโฟลเดอร์ server):
//   node tools/backup.mjs                            → สำรองลง server/backups/
//   BACKUP_DIR=G:\wms-backups node tools/backup.mjs  → เก็บไว้ที่อื่น (แนะนำคนละไดรฟ์/NAS)
//   BACKUP_KEEP_DAYS=90 node tools/backup.mjs        → เก็บฐานข้อมูลย้อนหลังกี่วัน (เริ่มต้น 365)
//
// โครงที่ได้:
//   <BACKUP_DIR>\database\2026\09\identifier-2026-09-15.sqlite   วันละไฟล์ สะสมไปเรื่อยๆ
//   <BACKUP_DIR>\uploads\                                        รูปทั้งหมด กองเดียว เติมเข้าไป
//
// ใช้ db.backup() ของ better-sqlite3 → ได้ไฟล์ที่ consistent แม้ระบบกำลังเขียนอยู่ (รวม WAL)
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP_DAYS = Math.max(1, Number(process.env.BACKUP_KEEP_DAYS || 365));
const backupRoot = process.env.BACKUP_DIR || path.join(serverDir, 'backups');

const listDirs = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  : []);

const countFiles = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).length
  : 0);

// ----------------------------------------------------------------------------
// 1) ฐานข้อมูล → database\<ปี>\<เดือน>\identifier-<วันที่>.sqlite
//
// วันที่ต้องอ่านตามเวลาเครื่อง ไม่ใช่ toISOString() ซึ่งเป็นเวลาสากล (ไทย +7):
// รอบตีสองของวันที่ 1 จะกลายเป็นวันที่ 31 ของเดือนก่อน แล้วไฟล์ไปตกผิดโฟลเดอร์เดือน
// ----------------------------------------------------------------------------
const now = new Date();
const yyyy = String(now.getFullYear());
const mm = String(now.getMonth() + 1).padStart(2, '0');
const dd = String(now.getDate()).padStart(2, '0');

const dbDir = path.join(backupRoot, 'database', yyyy, mm);
fs.mkdirSync(dbDir, { recursive: true });
const dbDest = path.join(dbDir, `identifier-${yyyy}-${mm}-${dd}.sqlite`);

const dbPath = path.isAbsolute(config.dbFile) ? config.dbFile : path.join(serverDir, config.dbFile);

// เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อยสวมทับ — ถ้าสำรองพังกลางคัน (ดิสก์เต็ม/ไฟดับ)
// สำเนาที่ใช้ได้ของเดิมยังอยู่ครบ แทนที่จะเหลือไฟล์ครึ่งๆ กลางๆ ที่กู้ไม่ได้
const partial = `${dbDest}.part`;
fs.rmSync(partial, { force: true });
const db = new Database(dbPath, { readonly: true });
await db.backup(partial);
db.close();
fs.renameSync(partial, dbDest); // รันซ้ำวันเดียวกัน = ทับของเดิม ตั้งใจให้เป็นแบบนั้น

// ----------------------------------------------------------------------------
// 2) รูปภาพ → uploads\ กองเดียว แบบ "เติมเข้าไป" ไม่ใช่ก๊อปใหม่ทั้งชุด
//
// force:false = ไฟล์ไหนมีอยู่แล้วให้ข้ามไปเงียบๆ รอบแรกจึงขนครบ 231 MB
// แต่รอบต่อๆ ไปคัดลอกเฉพาะรูปที่เพิ่งอัปโหลด (จริงราวสัปดาห์ละ 10 ไฟล์)
//
// ที่ทำแบบนี้ได้เพราะแอปไม่เคยลบรูป และตั้งชื่อไฟล์เป็นเวลา+เลขสุ่มจึงไม่มีทางซ้ำ
// → ของในกองนี้มีแต่เพิ่ม ไม่มีทางหายเพราะถูกทับ
// ----------------------------------------------------------------------------
const uploads = path.join(serverDir, 'uploads');
const uploadsDest = path.join(backupRoot, 'uploads');
const hadFiles = countFiles(uploadsDest);
if (fs.existsSync(uploads)) fs.cpSync(uploads, uploadsDest, { recursive: true, force: false });
const nowFiles = countFiles(uploadsDest);

// ----------------------------------------------------------------------------
// 3) ลบฐานข้อมูลที่เก่าเกินกำหนด — นับจาก "วันที่ในชื่อไฟล์" ไม่ใช่จำนวนโฟลเดอร์
//
// ตัวเก่านับโฟลเดอร์ชั้นบนสุดแล้วเก็บไว้ N อัน พอโฟลเดอร์ซ้อนเป็นปี/เดือน
// มันจะเห็น "2026" เป็นหนึ่งชุด แล้วไม่ลบอะไรเลยตลอดกาลจนดิสก์เต็มโดยไม่มี error
// → ให้ตัวไฟล์เป็นแหล่งความจริงอย่างเดียว โฟลเดอร์เป็นแค่ที่เก็บ
//
// แตะเฉพาะไฟล์ที่ชื่อตรงแบบแผนเท่านั้น อย่างอื่นที่คนเอามาวางไว้ไม่ยุ่งด้วย
// ----------------------------------------------------------------------------
const cutoff = new Date(now);
cutoff.setDate(cutoff.getDate() - KEEP_DAYS);

const dbRoot = path.join(backupRoot, 'database');
let removed = 0;
let kept = 0;
for (const year of listDirs(dbRoot)) {
  const yearDir = path.join(dbRoot, year);
  for (const month of listDirs(yearDir)) {
    const monthDir = path.join(yearDir, month);
    for (const name of fs.readdirSync(monthDir)) {
      const m = /^identifier-(\d{4})-(\d{2})-(\d{2})\.sqlite$/.exec(name);
      if (!m) continue;
      if (new Date(+m[1], +m[2] - 1, +m[3]) < cutoff) {
        fs.rmSync(path.join(monthDir, name), { force: true });
        removed += 1;
      } else {
        kept += 1;
      }
    }
    if (fs.readdirSync(monthDir).length === 0) fs.rmdirSync(monthDir);
  }
  if (fs.readdirSync(yearDir).length === 0) fs.rmdirSync(yearDir);
}

// ----------------------------------------------------------------------------
const sizeMB = (fs.statSync(dbDest).size / 1024 / 1024).toFixed(2);
console.log('✅ สำรองข้อมูลเสร็จ');
console.log(`   ฐานข้อมูล : ${dbDest}  (${sizeMB} MB)`);
console.log(`   รูปภาพ    : ${uploadsDest}  (ทั้งหมด ${nowFiles} ไฟล์, เพิ่มรอบนี้ ${nowFiles - hadFiles})`);
console.log(`   เก็บย้อนหลัง ${KEEP_DAYS} วัน — ตอนนี้มี ${kept} วัน${removed ? `, ลบที่เก่าเกินกำหนด ${removed} ไฟล์` : ''}`);

// ชุดสำรองแบบเก่า (โฟลเดอร์ชื่อเป็นเวลา) ระบบใหม่ไม่แตะและไม่ลบให้ เพราะเป็นข้อมูลจริง
// ที่ยังกู้ได้ แต่ถ้าปล่อยไว้จะกินที่ชุดละ ~230 MB โดยไม่มีใครสังเกต จึงบอกให้เห็นทุกครั้ง
const legacy = listDirs(backupRoot).filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n));
if (legacy.length) {
  console.log('');
  console.log(`⚠️  ยังมีชุดสำรองแบบเก่าค้างอยู่ ${legacy.length} ชุด (ชุดละ ~230 MB)`);
  console.log(`   อยู่ที่ ${backupRoot} — ระบบใหม่ไม่ลบให้ ตรวจแล้วไม่ต้องใช้ ลบทิ้งเองได้เลย`);
}

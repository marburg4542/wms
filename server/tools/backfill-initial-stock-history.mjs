// เติมใบ "รับเข้า" ย้อนหลังให้สต็อกตั้งต้นของสินค้าที่เพิ่มก่อนแก้บั๊ก
//
// ปัญหาเดิม: เพิ่มสินค้าพร้อมสต็อกตั้งต้นแล้ว ยอดคงเหลือถูก แต่ไม่ขึ้นในหน้าประวัติการทำรายการ
// และรายงาน PDF เพราะระบบเขียนแค่ stock_in ไม่ได้สร้างใบรายการคู่กัน (รายละเอียดใน utils/initialStockHistory.js)
//
// ใช้งาน (จากโฟลเดอร์ server):
//   node tools/backfill-initial-stock-history.mjs            → ดูรายการที่จะเติมอย่างเดียว (ไม่แก้)
//   node tools/backfill-initial-stock-history.mjs --apply    → เติมจริง (สำรองด้วย npm run backup ก่อนเสมอ)
//   เพิ่ม --db=<path> เพื่อซ้อมกับไฟล์สำเนาก่อน
//
// รันซ้ำได้ปลอดภัย — รอบถัดไปจะเห็นว่าเติมครบแล้วและไม่สร้างใบซ้ำ
// ไม่แตะ stock_in/stock_out เลย ยอดคงเหลือจึงไม่เปลี่ยน เพิ่มเฉพาะแถวประวัติ
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { backfillInitialStockHistory } from '../utils/initialStockHistory.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const DB_ARG = process.argv.find((a) => a.startsWith('--db='))?.slice(5);
const dbPath = DB_ARG || (path.isAbsolute(config.dbFile) ? config.dbFile : path.join(SERVER, config.dbFile));

console.log('📂 ฐานข้อมูล:', dbPath);
console.log(APPLY ? '✍️  โหมดเติมจริง\n' : '👀 โหมดดูผลอย่างเดียว — ใส่ --apply เพื่อบันทึกจริง\n');

const db = new Database(dbPath, { readonly: !APPLY, fileMustExist: true });
const stockBefore = db.prepare('SELECT COALESCE(SUM(stock_balance), 0) AS total FROM warehouse_balance').get().total;

const { rows, applied } = backfillInitialStockHistory(db, { apply: APPLY });
for (const row of rows) {
  console.log(`  ${row.date}  ${row.sku}  × ${row.quantity}  โดย ${row.actor}  → ${row.transactionId}  ${row.name}`);
}

const byActor = rows.reduce((acc, row) => ({ ...acc, [row.actor]: (acc[row.actor] || 0) + 1 }), {});
console.log(`\nรวม ${rows.length} รายการ`, rows.length ? byActor : '');

if (applied) {
  const stockAfter = db.prepare('SELECT COALESCE(SUM(stock_balance), 0) AS total FROM warehouse_balance').get().total;
  console.log(`✅ บันทึกแล้ว — ยอดคงเหลือรวมก่อน ${stockBefore} / หลัง ${stockAfter} (ต้องเท่ากัน)`);
  if (stockAfter !== stockBefore) process.exitCode = 1;
} else if (rows.length === 0) {
  console.log('✅ ไม่มีรายการที่ต้องเติม');
} else {
  console.log('ยังไม่ได้บันทึก');
}
db.close();

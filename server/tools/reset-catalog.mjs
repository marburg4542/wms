// ล้างสินค้า + ประวัติการเคลื่อนไหว/เบิก ทั้งหมด (เก็บ: หมวดหมู่ โปรเจกต์ ผู้ใช้) — สำหรับเริ่มเพิ่มสินค้าใหม่
// ⚠️ ลบถาวร — ต้องสำรอง identifier.sqlite ก่อนรันเสมอ
import Database from 'better-sqlite3';

const db = new Database('identifier.sqlite');
const cnt = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
const tables = ['wms_transaction_items', 'wms_transactions', 'stock_out', 'stock_in', 'product_settings', 'items'];

console.log('ก่อนล้าง:', Object.fromEntries(tables.map(t => [t, cnt(t)])));

db.pragma('foreign_keys = OFF');
db.transaction(() => {
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
})();
db.pragma('foreign_keys = ON');
db.pragma('wal_checkpoint(TRUNCATE)');

console.log('หลังล้าง:', Object.fromEntries(tables.map(t => [t, cnt(t)])));
console.log('คงไว้ — หมวดหมู่:', cnt('item_groups'), '| โปรเจกต์:', cnt('projects'), '| ผู้ใช้:', cnt('app_users'));
db.close();

// ============================================================================
// สคริปต์สร้างใบเบิก/รับเข้า "จำลอง" กระจายย้อนหลัง 1 ปี สำหรับทดสอบ export report
//
// วิธีใช้ (รันจากโฟลเดอร์ server):
//   node tools/seed-mock.mjs                         → สร้าง 600 ใบลง identifier.sqlite
//   node tools/seed-mock.mjs --count=2000            → กำหนดจำนวนใบเอง
//   node tools/seed-mock.mjs --db=identifier.test.sqlite  → ลงไฟล์ฐานข้อมูลอื่น
//   node tools/seed-mock.mjs --clean                 → ลบใบจำลองทั้งหมดออก (ของจริงไม่โดน)
//
// ข้อมูลจำลองทุกใบมี transactionId ขึ้นต้นด้วย "MOCK-" จึงลบออกได้สะอาดด้วย --clean
// หมายเหตุ: สคริปต์นี้สร้างเฉพาะ "ประวัติใบรายการ" ไม่แตะ stock_in/stock_out
//           ยอดคงเหลือสินค้าจริงจึงไม่เปลี่ยนแม้แต่ชิ้นเดียว
// ============================================================================
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// อ่าน argument แบบ --key=value
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const dbPath = path.resolve(__dirname, '..', args.db || 'identifier.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ---------- โหมดล้างข้อมูลจำลอง ----------
if (args.clean) {
  const result = db.transaction(() => {
    db.prepare(`
      DELETE FROM wms_transaction_items
      WHERE tx_id IN (SELECT id FROM wms_transactions WHERE transactionId LIKE 'MOCK-%')
    `).run();
    return db.prepare(`DELETE FROM wms_transactions WHERE transactionId LIKE 'MOCK-%'`).run();
  })();
  console.log(`🧹 ลบใบจำลองออกแล้ว ${result.changes} ใบ จาก ${dbPath}`);
  process.exit(0);
}

// ---------- โหมดสร้างข้อมูลจำลอง ----------
const count = Number(args.count) || 600;

// หยิบสินค้าที่มีอยู่จริงมาใช้ เพื่อให้รายงานแสดงชื่อ/หมวดหมู่ของจริง
const products = db.prepare('SELECT item_id, item_name FROM items LIMIT 100').all();
if (products.length === 0) {
  console.error('❌ ไม่มีสินค้าในฐานข้อมูล — สร้างสินค้าอย่างน้อย 1 ตัวก่อนแล้วค่อยรันใหม่');
  process.exit(1);
}

const USERS = ['somchai', 'suda', 'anan', 'wipa', 'krit'];
const PROJECTS = ['โปรเจกต์โดรนสำรวจ', 'ซ่อมบำรุงหุ่นยนต์', 'งานภาคสนามเชียงใหม่', 'สต๊อกสำนักงาน', 'ทดสอบไลดาร์'];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

const insertTx = db.prepare(`
  INSERT INTO wms_transactions (transactionId, type, requesterUsername, project, status, requestDate, resolvedDate, adminUsername, adminMessage, pickedUpAt)
  VALUES (@transactionId, @type, @requesterUsername, @project, @status, @requestDate, @resolvedDate, @adminUsername, @adminMessage, @pickedUpAt)
`);
const insertItem = db.prepare(`
  INSERT INTO wms_transaction_items (tx_id, productId, sku, productName, imageUrl, requestedQty, approvedQty, status)
  VALUES (?, ?, ?, ?, '', ?, ?, ?)
`);

const now = Date.now();
const ONE_YEAR = 365 * 24 * 3600 * 1000;

db.transaction(() => {
  for (let n = 0; n < count; n++) {
    // สุ่มเวลาย้อนหลังภายใน 1 ปี
    const t = new Date(now - Math.random() * ONE_YEAR);
    const requestDate = t.toISOString();
    const resolvedDate = new Date(t.getTime() + randInt(10, 300) * 60000).toISOString();

    if (Math.random() < 0.4) {
      // 40% เป็นใบรับเข้า (INBOUND — อนุมัติทันทีเสมอ ตาม flow จริง)
      const p = rand(products);
      const qty = randInt(1, 50);
      const info = insertTx.run({
        transactionId: `MOCK-INB-${t.getTime()}-${n}`,
        type: 'INBOUND',
        requesterUsername: rand(USERS),
        project: 'รับอะไหล่เข้า (ข้อมูลจำลอง)',
        status: 'Approved',
        requestDate,
        resolvedDate: requestDate,
        adminUsername: rand(USERS),
        adminMessage: '',
        pickedUpAt: null
      });
      insertItem.run(info.lastInsertRowid, p.item_id, p.item_id, p.item_name, qty, qty, 'Approved');
    } else {
      // 60% เป็นใบเบิก (OUTBOUND) — อนุมัติเต็ม 70% / บางส่วน 20% / ปฏิเสธ 10%
      const roll = Math.random();
      const status = roll < 0.7 ? 'Approved' : roll < 0.9 ? 'Partial' : 'Rejected';
      const info = insertTx.run({
        transactionId: `MOCK-REQ-${t.getTime()}-${n}`,
        type: 'OUTBOUND',
        requesterUsername: rand(USERS),
        project: rand(PROJECTS),
        status,
        requestDate,
        resolvedDate,
        adminUsername: 'admin',
        adminMessage: status === 'Approved' ? '' : 'หมายเหตุจำลอง: สต็อกไม่พอ จ่ายได้บางส่วน',
        pickedUpAt: status === 'Rejected' ? null : resolvedDate
      });
      const itemCount = randInt(1, 3);
      for (let k = 0; k < itemCount; k++) {
        const p = rand(products);
        const req = randInt(1, 20);
        const app = status === 'Rejected' ? 0 : status === 'Partial' ? Math.max(1, Math.floor(req / 2)) : req;
        const itemStatus = app === 0 ? 'Rejected' : app === req ? 'Approved' : 'Partial';
        insertItem.run(info.lastInsertRowid, p.item_id, p.item_id, p.item_name, req, app, itemStatus);
      }
    }
  }
})();

const total = db.prepare(`SELECT COUNT(*) AS c FROM wms_transactions WHERE transactionId LIKE 'MOCK-%'`).get().c;
console.log(`✅ สร้างใบจำลอง ${count} ใบ กระจายย้อนหลัง 1 ปี ลงใน ${dbPath}`);
console.log(`   ตอนนี้มีใบจำลองในฐานข้อมูลรวม ${total} ใบ`);
console.log(`   ล้างออกเมื่อทดสอบเสร็จ: node tools/seed-mock.mjs --clean${args.db ? ` --db=${args.db}` : ''}`);

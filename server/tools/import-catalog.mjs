// นำเข้าแคตตาล็อกจริง 2,382 รายการจากฐานส่งมอบ (warehouse.db) เข้า schema ปัจจุบัน — รันครั้งเดียว
//
// การใช้งาน:
//   node tools/import-catalog.mjs --source=<warehouse.db> --target=<identifier.sqlite> [--keep-demo]
//
// ค่าเริ่มต้น target = identifier.sqlite ในโฟลเดอร์ server/
// ทุกอย่างทำในทรานแซกชันเดียว — พังกลางคันย้อนกลับทั้งหมด ไม่มีข้อมูลค้างครึ่งๆ
//
// สิ่งที่ทำ:
//   1. upsert 23 กลุ่มสินค้าจากฐานใหม่ (คง '00' Default ของเดิมไว้)
//   2. (default) ล้างข้อมูลทดสอบ: stock_in/stock_out/ใบเบิก/สินค้า demo 5 ตัว  — ใส่ --keep-demo เพื่อคงไว้
//   3. insert สินค้า 2,382 ตัว (item_seq = 3 ตัวท้าย, latest_cost 0 → NULL ตามเจตนา schema)
//   4. สร้าง product_settings ให้ทุกตัว (min_stock=10, image_url='', is_active ตามฐานใหม่)
//   5. โหลดยอดยกมา: SUM(qty_change) ต่อสินค้า → stock_in (บวก) / stock_out (ลบ) → view warehouse_balance คำนวณต่อเอง
//   * บัญชีผู้ใช้ไม่ถูกแตะเลย

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const getArg = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const keepDemo = args.includes('--keep-demo');

const sourcePath = getArg('source', 'C:/Users/Lenovo/Downloads/Newdatabase/warehouse.db');
const targetPath = getArg('target', path.join(__dirname, '..', 'identifier.sqlite'));

console.log('📥 SOURCE:', sourcePath);
console.log('📂 TARGET:', targetPath);
console.log('🧹 ล้างข้อมูล demo:', keepDemo ? 'ไม่ (--keep-demo)' : 'ใช่');
console.log('');

const src = new Database(sourcePath, { readonly: true });
const tgt = new Database(targetPath);
tgt.pragma('foreign_keys = ON');

// --- อ่านจากฐานใหม่ ---
const groups = src.prepare('SELECT group_id, group_name, detail FROM item_groups').all();
const items = src.prepare('SELECT item_id, name, unit, group_id, latest_cost, is_asset, storage_type, vendor, note, is_active FROM items').all();
const openings = src.prepare('SELECT item_id, ROUND(SUM(qty_change), 4) AS bal FROM stock_transactions GROUP BY item_id HAVING SUM(qty_change) != 0').all();
src.close();

// --- safety check: ทุกสินค้าต้องมี group_id ที่รู้จัก ---
const groupIds = new Set(groups.map(g => g.group_id));
const orphans = items.filter(i => !groupIds.has(i.group_id));
if (orphans.length) {
  console.error(`❌ พบสินค้า ${orphans.length} ตัวที่ group_id ไม่อยู่ใน 23 กลุ่ม — หยุดเพื่อกันข้อมูลเพี้ยน`);
  console.error('   ตัวอย่าง:', orphans.slice(0, 5).map(o => `${o.item_id}(${o.group_id})`).join(', '));
  process.exit(1);
}

const now = new Date().toISOString();
let costZeroToNull = 0;

const run = tgt.transaction(() => {
  // 1) upsert กลุ่มสินค้า (คง '00' Default)
  const upsertGroup = tgt.prepare(`
    INSERT INTO item_groups (group_id, group_name, description) VALUES (?, ?, ?)
    ON CONFLICT(group_id) DO UPDATE SET group_name = excluded.group_name, description = excluded.description
  `);
  for (const g of groups) upsertGroup.run(g.group_id, g.group_name, g.detail || null);

  // 2) ล้างข้อมูล demo
  if (!keepDemo) {
    tgt.prepare('DELETE FROM wms_transaction_items').run();
    tgt.prepare('DELETE FROM wms_transactions').run();
    tgt.prepare('DELETE FROM stock_out').run();
    tgt.prepare('DELETE FROM stock_in').run();
    tgt.prepare('DELETE FROM product_settings').run();
    tgt.prepare('DELETE FROM items').run();
  }

  // 3) insert สินค้า
  const insItem = tgt.prepare(`
    INSERT INTO items (item_id, group_id, item_seq, item_name, unit, latest_cost, is_asset, storage_type, vendor, clean_status, source_row, created_at, updated_at)
    VALUES (@item_id, @group_id, @item_seq, @item_name, @unit, @latest_cost, @is_asset, @storage_type, @vendor, 'imported', NULL, @now, @now)
    ON CONFLICT(item_id) DO UPDATE SET
      group_id = excluded.group_id, item_name = excluded.item_name, unit = excluded.unit,
      latest_cost = excluded.latest_cost, is_asset = excluded.is_asset,
      storage_type = excluded.storage_type, vendor = excluded.vendor, updated_at = excluded.updated_at
  `);
  const insSettings = tgt.prepare(`
    INSERT INTO product_settings (item_id, min_stock, image_url, is_active, updated_at)
    VALUES (?, 10, '', ?, @now)
    ON CONFLICT(item_id) DO UPDATE SET is_active = excluded.is_active
  `);
  for (const it of items) {
    let cost = it.latest_cost;
    if (cost === 0) { cost = null; costZeroToNull++; } // 0 = "ไม่รู้ราคา" ตามเจตนา schema (data_dictionary ข้อ 2)
    insItem.run({
      item_id: it.item_id, group_id: it.group_id, item_seq: String(it.item_id).slice(-3).padStart(3, '0'),
      item_name: it.name, unit: it.unit || null, latest_cost: cost,
      is_asset: it.is_asset ? 1 : 0, storage_type: it.storage_type || null, vendor: it.vendor || null, now
    });
    insSettings.run(it.item_id, it.is_active ? 1 : 0, { now });
  }

  // 5) ยอดยกมา → stock_in / stock_out
  const insIn = tgt.prepare(`INSERT INTO stock_in (item_id, quantity, input_date, note, clean_status, created_by) VALUES (?, ?, ?, 'ยอดยกมา (opening)', 'imported', 'system')`);
  const insOut = tgt.prepare(`INSERT INTO stock_out (item_id, quantity, input_date, note, clean_status, created_by) VALUES (?, ?, ?, 'ยอดยกมา (opening, ติดลบ)', 'imported', 'system')`);
  const today = now.slice(0, 10);
  let posN = 0, negN = 0;
  for (const o of openings) {
    if (o.bal > 0) { insIn.run(o.item_id, o.bal, today); posN++; }
    else { insOut.run(o.item_id, Math.abs(o.bal), today); negN++; }
  }
  return { posN, negN };
});

const { posN, negN } = run();

// --- รายงานผล ---
console.log('✅ นำเข้าเสร็จ (ทรานแซกชันเดียว committed)');
console.log('   กลุ่มสินค้า upsert:', groups.length);
console.log('   สินค้า insert:', items.length);
console.log('   latest_cost 0 → NULL:', costZeroToNull);
console.log('   ยอดยกมา → stock_in:', posN, '| stock_out (ติดลบ):', negN);

// --- ตรวจรับทันที (เทียบตัวเลขที่ฐานต้นฉบับการันตี) ---
const q = (sql) => tgt.prepare(sql).get();
const nItems = q('SELECT COUNT(*) n FROM items').n;
const nGroups = q("SELECT COUNT(*) n FROM item_groups WHERE group_id != '00'").n;
const nUsers = q('SELECT COUNT(*) n FROM app_users').n;
const total = q('SELECT ROUND(COALESCE(SUM(qty_in),0) - COALESCE(SUM(qty_out),0), 2) t FROM (SELECT (SELECT COALESCE(SUM(quantity),0) FROM stock_in) qty_in, (SELECT COALESCE(SUM(quantity),0) FROM stock_out) qty_out)').t;
const nNeg = q(`SELECT COUNT(*) n FROM warehouse_balance WHERE stock_balance < 0`).n;
tgt.close();

console.log('\n=== ตรวจรับ (ค่าที่ต้องได้จาก handoff) ===');
const check = (label, got, want) => console.log(`   ${got === want ? '✅' : '❌'} ${label}: ${got}  (ต้องได้ ${want})`);
check('items', nItems, 2382);
check('item_groups (ไม่รวม 00)', nGroups, 23);
check('ยอดรวมทั้งคลัง', total, 3016.85);
check('สินค้ายอดติดลบ', nNeg, 64);
check('ผู้ใช้ (คงเดิม)', nUsers, 6);
console.log('');

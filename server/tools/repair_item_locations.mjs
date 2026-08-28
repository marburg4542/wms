// ซ่อมตำแหน่งจัดเก็บที่ผูกผิดสินค้า หลังปุ่ม "จัดเรียงรหัสสินค้า" เปลี่ยน item_id โดยไม่ลาก item_locations ตามไป
//
// วิธีคิด: แถวใน item_locations จำแค่ "ตัวเลขรหัส" ไม่ได้จำว่าเป็นของสินค้าตัวไหน
// จึงต้องย้อนดูว่า ณ เวลาที่สร้างแถวนั้น รหัสนี้เป็นของสินค้าตัวไหน แล้วหาว่าสินค้าตัวนั้นตอนนี้ใช้รหัสอะไร
// ตัวระบุตัวตนที่ใช้คือ items.created_at เพราะไม่ซ้ำ และการจัดเรียงรหัสไม่แตะคอลัมน์นี้
//
// ใช้งาน:  node tools/repair_item_locations.mjs            → ดูผลอย่างเดียว (ไม่แก้)
//          node tools/repair_item_locations.mjs --apply    → แก้จริง
//          เพิ่ม --db=<path> เพื่อซ้อมกับไฟล์สำเนาก่อน
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync as fsWrite } from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..');
const APPLY = process.argv.includes('--apply');
// --db=<path> ไว้ซ้อมกับสำเนาก่อนลงมือกับฐานข้อมูลจริง (ไม่ใส่ = ใช้ identifier.sqlite ตัวจริง)
const DB_ARG = process.argv.find((a) => a.startsWith('--db='))?.slice(5);

// เวลาที่กดปุ่มจัดเรียงรหัส (อ่านจาก audit_logs) + ไฟล์สำรองที่ถ่ายไว้ "ก่อน" การกดแต่ละครั้ง
const SNAPSHOTS = [
  { until: '2026-08-25 13:59:39', file: 'backups/2026-08-25T13-59-15/identifier.sqlite' },
  { until: '2026-08-27 05:07:41', file: 'backups/2026-08-26T11-26-40/identifier.sqlite' }
];

const live = new Database(DB_ARG || path.join(SERVER, 'identifier.sqlite'), { readonly: !APPLY });
const snaps = SNAPSHOTS.map((s) => ({
  until: s.until,
  skuToIdentity: new Map(new Database(path.join(SERVER, s.file), { readonly: true })
    .prepare('SELECT item_id, created_at FROM items').all().map((r) => [r.item_id, r.created_at]))
}));

// สคริปต์นี้ "รันซ้ำไม่ได้" — เพราะมันตัดสินจากเวลาที่สร้างแถว ซึ่งไม่เปลี่ยนหลังซ่อม
// รันรอบสองจะเข้าใจว่าแถวที่ซ่อมไปแล้วยังผิดอยู่ แล้วเลื่อนรหัสซ้ำอีกรอบ
const done = live.prepare("SELECT created_at, details FROM audit_logs WHERE action = 'storage.repair_locations' ORDER BY id DESC").get();
if (done && !process.argv.includes('--force')) {
  console.error(`\n⛔ ฐานข้อมูลนี้ซ่อมไปแล้วเมื่อ ${done.created_at} (${done.details})`);
  console.error('   รันซ้ำจะทำให้รหัสเลื่อนผิดอีกรอบ — ถ้ายืนยันว่าต้องรันจริงให้ใส่ --force');
  live.close();
  process.exit(1);
}

const identityToSku = new Map(live.prepare('SELECT item_id, created_at FROM items').all()
  .map((r) => [r.created_at, r.item_id]));
const nameOf = new Map(live.prepare('SELECT item_id, item_name FROM items').all()
  .map((r) => [r.item_id, r.item_name]));
const stockOf = new Map(live.prepare('SELECT item_id, stock_balance FROM warehouse_balance').all()
  .map((r) => [r.item_id, Number(r.stock_balance)]));

const rows = live.prepare(`
  SELECT l.id, l.item_id AS sku, l.rack_id AS rackId, l.storage_level AS lvl, l.room_id AS roomId,
         l.quantity, l.created_at,
         COALESCE(r.name, rm.name) AS place
  FROM item_locations l
  LEFT JOIN storage_racks r ON r.id = l.rack_id
  LEFT JOIN rooms rm ON rm.id = l.room_id
  ORDER BY l.id
`).all();

const fixes = [], unchanged = [], review = [];
for (const row of rows) {
  // แถวสร้างหลังการจัดเรียงรอบสุดท้าย = รหัสยังตรงอยู่แล้ว
  const snap = snaps.find((s) => row.created_at < s.until);
  if (!snap) { unchanged.push(row); continue; }

  const identity = snap.skuToIdentity.get(row.sku);
  if (!identity) { review.push({ ...row, why: 'รหัสนี้ยังไม่มีในไฟล์สำรองช่วงนั้น (สินค้าเพิ่งถูกสร้าง)' }); continue; }
  const correctSku = identityToSku.get(identity);
  if (!correctSku) { review.push({ ...row, why: 'สินค้าเจ้าของเดิมถูกลบไปแล้ว' }); continue; }
  if (correctSku === row.sku) { unchanged.push(row); continue; }
  fixes.push({ ...row, correctSku });
}

// ปลายทางชนกัน = สินค้าตัวที่ถูกต้องมีของวางอยู่ที่ชั้น/เลเวลเดียวกันอยู่แล้ว
// (น่าจะเกิดจากผู้ใช้เห็นของหายจากผังแล้ววางซ้ำเข้าไปใหม่) — บวกรวมกันไม่ได้เพราะอาจนับซ้ำ
// จึงไม่แตะแถวพวกนี้ ส่งให้คนตรวจแทน
const slotKey = (sku, r) => `${sku}|${r.rackId ?? 'x'}|${r.lvl ?? 'x'}|${r.roomId ?? 'x'}`;
for (let guard = 0; guard < rows.length; guard += 1) {
  const taken = new Map();
  for (const r of rows) {
    const fix = fixes.find((f) => f.id === r.id);
    taken.set(slotKey(fix ? fix.correctSku : r.sku, r), (taken.get(slotKey(fix ? fix.correctSku : r.sku, r)) || []).concat(r.id));
  }
  const clash = [...taken.values()].find((ids) => ids.length > 1);
  if (!clash) break;
  // ในกลุ่มที่ชนกัน ให้แถวที่ "ไม่ต้องแก้" อยู่ที่เดิม แล้วถอนแถวที่จะย้ายมาทับออกเป็นรายการตรวจ
  const victimId = clash.find((id) => fixes.some((f) => f.id === id));
  if (victimId == null) break;
  const victim = fixes.splice(fixes.findIndex((f) => f.id === victimId), 1)[0];
  review.push({ ...victim, why: `ปลายทาง ${victim.correctSku} มีของวางที่เดียวกันอยู่แล้ว — อาจถูกวางซ้ำ ต้องเช็คของจริง` });
}

// ยอดรวมต่อสินค้าหลังซ่อม — ถ้าเกินยอดคงเหลือ ต้องให้คนตรวจ ไม่ใช่ปล่อยผ่าน
const finalSku = new Map(rows.map((r) => [r.id, r.sku]));
fixes.forEach((f) => finalSku.set(f.id, f.correctSku));
const placedAfter = new Map();
for (const r of rows) {
  const k = finalSku.get(r.id);
  placedAfter.set(k, (placedAfter.get(k) || 0) + Number(r.quantity));
}
const overPlaced = [...placedAfter].filter(([sku, qty]) => qty > (stockOf.get(sku) || 0))
  .map(([sku, qty]) => ({ sku, ชื่อ: (nameOf.get(sku) || '').slice(0, 38), วางไว้: qty, คงเหลือ: stockOf.get(sku) || 0 }));

const short = (s, n = 34) => String(s || '').slice(0, n);
console.log(`\nแถวตำแหน่งทั้งหมด ${rows.length}`);
console.log(`  ✅ ถูกต้องอยู่แล้ว : ${unchanged.length}`);
console.log(`  🔧 ต้องย้ายกลับ    : ${fixes.length}`);
console.log(`  👀 ต้องตรวจด้วยตา  : ${review.length}`);

if (fixes.length) {
  console.log('\n--- รายการที่จะย้ายกลับ ---');
  console.table(fixes.map((f) => ({
    ที่วาง: `${short(f.place, 12)}${f.lvl ? ` L${f.lvl}` : ''}`,
    จำนวน: f.quantity,
    'ตอนนี้ติดกับ': `${f.sku} ${short(nameOf.get(f.sku), 24)}`,
    'ที่ถูกต้อง': `${f.correctSku} ${short(nameOf.get(f.correctSku), 24)}`
  })));
}
if (review.length) {
  console.log('\n--- ต้องตรวจด้วยตา (ไม่แตะ) ---');
  console.table(review.map((r) => ({
    ที่วาง: `${short(r.place, 12)}${r.lvl ? ` L${r.lvl}` : ''}`, จำนวน: r.quantity,
    sku: r.sku, ชื่อ: short(nameOf.get(r.sku), 26), สร้างเมื่อ: r.created_at, เหตุผล: r.why
  })));
}
if (overPlaced.length) {
  console.log(`\n--- หลังซ่อมแล้วยังวางเกินยอดคงเหลือ ${overPlaced.length} รายการ (ต้องปรับจำนวนบนผังเอง) ---`);
  console.table(overPlaced);
}

// --json=<file> เก็บรายการที่ต้องตรวจด้วยตาไว้ทำใบเช็ค
const JSON_OUT = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
if (JSON_OUT) {
  const detail = (r) => ({
    place: r.place, level: r.lvl, quantity: r.quantity, sku: r.sku,
    name: nameOf.get(r.sku), stock: stockOf.get(r.sku) ?? 0,
    correctSku: r.correctSku ?? null, correctName: r.correctSku ? nameOf.get(r.correctSku) : null,
    createdAt: r.created_at, why: r.why
  });
  fsWrite(JSON_OUT, JSON.stringify({ review: review.map(detail), overPlaced, fixes: fixes.length, unchanged: unchanged.length }, null, 2));
  console.log(`\nเขียนรายการตรวจลง ${JSON_OUT}`);
}

if (!APPLY) {
  console.log('\n(ยังไม่ได้แก้อะไร — ใส่ --apply เพื่อลงมือจริง)');
  live.close();
  process.exit(0);
}

// แก้จริง — ต้องลบทุกแถวที่เกี่ยวข้องก่อนแล้วค่อยใส่กลับ
// เพราะรหัสเลื่อนกันเป็นลูกโซ่ (01044→01043, 01043→01042, ...) ถ้าไล่ UPDATE ทีละแถว
// แถวแรกจะไปชนกับแถวที่ยังไม่ได้ย้ายออกทันที (unique index: item_id + ชั้นวาง + เลเวล)
const full = live.prepare('SELECT * FROM item_locations WHERE id = ?');
const originals = fixes.map((f) => ({ fix: f, row: full.get(f.id) }));
const stale = originals.filter(({ fix, row }) => !row || row.item_id !== fix.sku);
if (stale.length) {
  console.error(`\n⛔ ข้อมูลเปลี่ยนไประหว่างที่ตรวจ (${stale.length} แถว) — ยกเลิกทั้งหมด ให้รันใหม่อีกครั้ง`);
  live.close();
  process.exit(1);
}

let applied = 0;
live.transaction(() => {
  const del = live.prepare('DELETE FROM item_locations WHERE id = ?');
  const ins = live.prepare(`INSERT INTO item_locations
    (id, item_id, rack_id, storage_level, room_id, quantity, note, created_by, created_at, updated_at)
    VALUES (@id, @item_id, @rack_id, @storage_level, @room_id, @quantity, @note, @created_by, @created_at, CURRENT_TIMESTAMP)`);
  for (const { row } of originals) del.run(row.id);
  for (const { fix, row } of originals) { ins.run({ ...row, item_id: fix.correctSku }); applied++; }
  live.prepare(`INSERT INTO audit_logs (actor_username, action, entity_type, entity_id, details)
                VALUES ('repair-script', 'storage.repair_locations', 'product', NULL, ?)`)
    .run(JSON.stringify({ applied, review: review.length, overPlaced: overPlaced.length }));
})();

// items.rack_id เป็นค่าที่ derive มาจาก item_locations ต้องคำนวณใหม่ให้ตรงกัน
const { syncPrimaryLocation } = await import('../utils/itemLocations.js');
const touched = new Set([...fixes.map((f) => f.sku), ...fixes.map((f) => f.correctSku)]);
for (const sku of touched) syncPrimaryLocation(live, sku);

console.log(`\n✅ ย้ายกลับแล้ว ${applied} แถว | คำนวณตำแหน่งหลักใหม่ ${touched.size} รายการ`);
console.log('foreign_key_check:', live.pragma('foreign_key_check').length, 'ปัญหา');
live.close();

// ตรวจสุขภาพข้อมูลของฐานข้อมูลที่ใช้งานจริง — อ่านอย่างเดียว ไม่แก้อะไรทั้งสิ้น
//
//   npm run audit              ตรวจฐานข้อมูลที่ใช้งานอยู่
//   npm run audit -- <path>    ตรวจไฟล์สำรอง
//
// ใช้กติกาชุดเดียวกับเทสต์ (test/helpers/invariants.js) ทั้งสองฝั่งจึงตรวจมาตรฐานเดียวกันเสมอ
// คืน exit code 1 เมื่อพบปัญหา — เอาไปต่อกับงานตั้งเวลาให้เตือนอัตโนมัติได้
//
// ฝั่งนี้ยอมให้ข้ามกติกาที่ไฟล์นั้นรันไม่ได้ (ไฟล์เก่ากว่าฟีเจอร์ที่กติกาตรวจ) แล้วรายงานว่าข้ามข้อไหน
// เพราะจังหวะที่ต้องใช้เครื่องมือนี้ที่สุดคือตอนกู้ข้อมูลจากสำเนาเก่า ถ้าพังทั้งคำสั่งจะไม่เหลืออะไรให้ดูเลย
// (ฝั่งเทสต์ยังพังเสียงดังเหมือนเดิม — ดูเหตุผลใน findViolations)
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INVARIANTS, findViolations } from '../test/helpers/invariants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.join(here, '..', 'identifier.sqlite');
const db = new Database(target, { readonly: true });

console.log(`ตรวจฐานข้อมูล: ${target}\n`);

const skipped = [];
const violations = findViolations(db, { onUnsupported: (name) => skipped.push(name) });
for (const { name, rows } of violations) {
  console.log(`⚠️  ${name} — ${rows.length} รายการ`);
  console.table(rows.slice(0, 10));
  if (rows.length > 10) console.log(`   (แสดง 10 จาก ${rows.length})\n`);
}

if (skipped.length > 0) {
  console.log(`ℹ️  ข้าม ${skipped.length} ข้อ — ไฟล์นี้เก่ากว่าฟีเจอร์ที่กติกานั้นตรวจ`);
  for (const name of skipped) console.log(`     · ${name}`);
  console.log('');
}

const integrity = db.pragma('integrity_check')[0].integrity_check;
const fkIssues = db.pragma('foreign_key_check').length;
const checked = INVARIANTS.length - skipped.length;
const skipNote = skipped.length > 0 ? `  (ข้าม ${skipped.length} จาก ${INVARIANTS.length})` : '';

console.log('─'.repeat(52));
console.log(`กติกาข้อมูล      : ผ่าน ${checked - violations.length}/${checked}${skipNote}`);
console.log(`integrity_check  : ${integrity}`);
console.log(`foreign_key_check: ${fkIssues} ปัญหา`);

// ไฟล์รุ่นก่อนมีผังคลังไม่มีตาราง item_locations/storage_racks — นับเท่าที่มี แล้วขีดตัวที่ไม่มี
const count = (sql) => { try { return db.prepare(sql).get().n; } catch { return '—'; } };
const items = count('SELECT COUNT(*) n FROM items');
const locations = count('SELECT COUNT(*) n FROM item_locations');
const racks = count('SELECT COUNT(*) n FROM storage_racks WHERE deleted_at IS NULL');
const stagingZones = count('SELECT COUNT(*) n FROM storage_racks WHERE deleted_at IS NULL AND project_id IS NOT NULL');
const transactions = count('SELECT COUNT(*) n FROM wms_transactions');
console.log(`ข้อมูลในระบบ     : สินค้า ${items} · ตำแหน่ง ${locations} · ชั้นวาง ${racks} (พื้นที่จัดเตรียม ${stagingZones}) · ใบเบิก ${transactions}`);

const healthy = violations.length === 0 && integrity === 'ok' && fkIssues === 0;
const skipTail = skipped.length > 0 ? ` (ข้าม ${skipped.length} ข้อ)` : '';
console.log(healthy ? `\n✅ ข้อมูลสมบูรณ์ ไม่พบปัญหา${skipTail}` : `\n⚠️  พบปัญหา ${violations.length} กติกา — ดูรายละเอียดด้านบน`);
db.close();
process.exit(healthy ? 0 : 1);

// ตรวจสุขภาพข้อมูลของฐานข้อมูลที่ใช้งานจริง — อ่านอย่างเดียว ไม่แก้อะไรทั้งสิ้น
//
//   npm run audit              ตรวจฐานข้อมูลที่ใช้งานอยู่
//   npm run audit -- <path>    ตรวจไฟล์สำรอง
//
// ใช้กติกาชุดเดียวกับเทสต์ (test/helpers/invariants.js) ทั้งสองฝั่งจึงตรวจมาตรฐานเดียวกันเสมอ
// คืน exit code 1 เมื่อพบปัญหา — เอาไปต่อกับงานตั้งเวลาให้เตือนอัตโนมัติได้
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INVARIANTS, findViolations } from '../test/helpers/invariants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.join(here, '..', 'identifier.sqlite');
const db = new Database(target, { readonly: true });

console.log(`ตรวจฐานข้อมูล: ${target}\n`);

const violations = findViolations(db);
for (const { name, rows } of violations) {
  console.log(`⚠️  ${name} — ${rows.length} รายการ`);
  console.table(rows.slice(0, 10));
  if (rows.length > 10) console.log(`   (แสดง 10 จาก ${rows.length})\n`);
}

const integrity = db.pragma('integrity_check')[0].integrity_check;
const fkIssues = db.pragma('foreign_key_check').length;

console.log('─'.repeat(52));
console.log(`กติกาข้อมูล      : ผ่าน ${INVARIANTS.length - violations.length}/${INVARIANTS.length}`);
console.log(`integrity_check  : ${integrity}`);
console.log(`foreign_key_check: ${fkIssues} ปัญหา`);

const summary = db.prepare(`
  SELECT (SELECT COUNT(*) FROM items) items,
         (SELECT COUNT(*) FROM item_locations) locations,
         (SELECT COUNT(*) FROM storage_racks WHERE deleted_at IS NULL) racks,
         (SELECT COUNT(*) FROM storage_racks WHERE deleted_at IS NULL AND project_id IS NOT NULL) stagingZones,
         (SELECT COUNT(*) FROM wms_transactions) transactions
`).get();
console.log(`ข้อมูลในระบบ     : สินค้า ${summary.items} · ตำแหน่ง ${summary.locations} · ชั้นวาง ${summary.racks} (พื้นที่จัดเตรียม ${summary.stagingZones}) · ใบเบิก ${summary.transactions}`);

const healthy = violations.length === 0 && integrity === 'ok' && fkIssues === 0;
console.log(healthy ? '\n✅ ข้อมูลสมบูรณ์ ไม่พบปัญหา' : `\n⚠️  พบปัญหา ${violations.length} กติกา — ดูรายละเอียดด้านบน`);
db.close();
process.exit(healthy ? 0 : 1);

// ย่อรูปในโฟลเดอร์ uploads ให้เล็กลง — รันครั้งเดียวกับข้อมูลเก่าที่อัปไว้ก่อนมีระบบย่อรูป
//
// ทำไม: รูปจากกล้องมือถือถูกเก็บเป็นต้นฉบับ 1-4 MB แต่แอปแสดงใหญ่สุดแค่ระดับการ์ด (~400px)
// เปิดชั้นวางที่มีสินค้า 58 รายการ เบราว์เซอร์ต้องโหลดรูปรวม 78 MB ทีเดียว
//
// ⚠️ เขียนทับไฟล์เดิม — ต้องสำรอง uploads/ ก่อนเสมอ และควรซ้อมกับสำเนาก่อนลงมือจริง
//
//   node tools/shrink-uploads.mjs                     ดูผลอย่างเดียว ไม่แก้ไฟล์
//   node tools/shrink-uploads.mjs --apply             ย่อจริง
//   node tools/shrink-uploads.mjs --dir=<path> --apply  ซ้อมกับสำเนา
//
// หมายเหตุ: ต้องมี sharp (devDependency) — ใช้เฉพาะตอนรันสคริปต์นี้
// รูปที่อัปโหลดใหม่ถูกย่อจากฝั่งเบราว์เซอร์แล้ว (src/utils/image.js) เครื่องที่รับช่วงต่อจึงไม่ต้องมี sharp
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_EDGE = 1200;
const QUALITY = 82;
const SKIP_BELOW = 300 * 1024;   // เล็กอยู่แล้ว ไม่ต้องยุ่ง
const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const here = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const dirArg = process.argv.find((a) => a.startsWith('--dir='))?.slice(6);
const dir = dirArg || path.join(here, '..', 'uploads');

// sharp ไม่ได้อยู่ใน dependencies (ใช้เฉพาะสคริปต์นี้ครั้งเดียว) — บอกวิธีติดตั้งถ้ายังไม่มี
let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('สคริปต์นี้ต้องใช้ sharp ซึ่งไม่ได้ติดตั้งไว้ถาวร (ใช้ครั้งเดียวตอนย่อรูปเก่า)');
  console.error('ติดตั้งชั่วคราว:  npm i -D sharp     แล้วถอนออกเมื่อเสร็จ:  npm uninstall sharp');
  process.exit(1);
}

const mb = (bytes) => (bytes / 1048576).toFixed(2);
const files = fs.readdirSync(dir).filter((name) => EXT.has(path.extname(name).toLowerCase()));

let before = 0;
let after = 0;
let shrunk = 0;
let skipped = 0;
const failures = [];
const samples = [];

console.log(`โฟลเดอร์: ${dir}`);
console.log(`ไฟล์รูปทั้งหมด: ${files.length}${APPLY ? '' : '  (โหมดดูอย่างเดียว)'}\n`);

for (const name of files) {
  const file = path.join(dir, name);
  const size = fs.statSync(file).size;
  before += size;

  if (size <= SKIP_BELOW) { after += size; skipped += 1; continue; }

  try {
    // อ่านทั้งไฟล์เข้า memory ก่อน แล้วค่อยเขียนทับ — sharp อ่านและเขียนไฟล์เดียวกันพร้อมกันไม่ได้
    const input = fs.readFileSync(file);
    const image = sharp(input, { failOn: 'none' });
    const meta = await image.metadata();
    const longest = Math.max(meta.width || 0, meta.height || 0);

    const output = await image
      .rotate()                                                   // เคารพ EXIF orientation ก่อนย่อ ไม่งั้นรูปจะตะแคง
      .resize({ width: longest > MAX_EDGE ? MAX_EDGE : undefined, // ไม่ขยายรูปที่เล็กกว่าเป้าอยู่แล้ว
                height: longest > MAX_EDGE ? MAX_EDGE : undefined,
                fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer();

    if (output.length >= size) { after += size; skipped += 1; continue; }   // ย่อแล้วไม่เล็กลง อย่าแตะ

    if (APPLY) fs.writeFileSync(file, output);
    after += output.length;
    shrunk += 1;
    if (samples.length < 8) samples.push({ ไฟล์: name.slice(0, 34), จาก: `${mb(size)} MB`, เหลือ: `${mb(output.length)} MB`, ขนาดภาพ: `${meta.width}×${meta.height}` });
  } catch (err) {
    after += size;
    failures.push(`${name}: ${err.message}`);
  }
}

if (samples.length) { console.log('ตัวอย่างผลลัพธ์:'); console.table(samples); }
if (failures.length) { console.log(`\n⚠️ ย่อไม่ได้ ${failures.length} ไฟล์ (ปล่อยไว้ตามเดิม):`); failures.slice(0, 5).forEach((f) => console.log('   ' + f)); }

console.log(`\nย่อได้ ${shrunk} ไฟล์ · ข้าม ${skipped} ไฟล์ (เล็กอยู่แล้ว)`);
console.log(`ขนาดรวม: ${mb(before)} MB → ${mb(after)} MB  (ลดลง ${(100 - (after / before) * 100).toFixed(0)}%)`);
if (!APPLY) console.log('\n(ยังไม่ได้แก้ไฟล์ — ใส่ --apply เพื่อย่อจริง)');

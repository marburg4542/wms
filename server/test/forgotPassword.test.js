// เส้นทางลืมรหัสผ่าน — คุมพฤติกรรมที่ผู้ใช้มองไม่เห็นแต่พังง่ายและเจ็บตอนพัง
//
// 16 ก.ย. 2569 วัดของจริงได้ว่าคำขอนี้ใช้เวลา 3.9-4.4 วินาทีเมื่ออีเมลมีบัญชีอยู่จริง
// เทียบกับ 0.4 วินาทีเมื่อไม่มี ทั้งที่งานฐานข้อมูลใช้เวลาแค่ 0.0006 วินาที
// เวลาที่หายไปคือการยืนรอ Gmail ตอบ ซึ่งสร้างปัญหาสองชั้นที่เทสต์ในไฟล์นี้กันไว้
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempDatabase, call, callOk } from './helpers/apiHarness.js';

const temp = createTempDatabase('forgot-password');
// ปิดบัญชีอีเมลก่อน import — ไม่งั้นเทสต์หยิบบัญชีใน .env ไปยิงจดหมายจริงออก Gmail
// ทุกครั้งที่รัน กินโควตารายวันและส่งไปที่อยู่ปลอมจนเด้งกลับ (ต้องตั้งก่อน config.js ถูกโหลด)
process.env.EMAIL_USER = '';
process.env.EMAIL_PASS = '';
process.env.EMAIL_HOST = '';
const { default: db } = await import('../db.js');
const auth = await import('../controllers/authController.js');

const email = 'somchai@example.com';
await callOk('register', auth.register, {
  body: { username: 'somchai', email, password: 'TestPass1234' }
});

const userId = db.prepare('SELECT id FROM app_users WHERE email = ?').get(email).id;
const นับลิงก์ = () =>
  db.prepare('SELECT COUNT(*) c FROM password_reset_tokens WHERE user_id = ?').get(userId).c;
const ลิงก์ล่าสุด = () =>
  db.prepare('SELECT token_hash FROM password_reset_tokens WHERE user_id = ?').get(userId)?.token_hash;

test('ตอบข้อความเดียวกันไม่ว่าอีเมลนั้นจะมีบัญชีอยู่จริงหรือไม่', async () => {
  // กันไม่ให้ใครยิงทีละอีเมลเพื่อไล่เดาว่าใครเป็นพนักงานในระบบ
  const มีบัญชี = await call(auth.forgotPassword, { body: { email } });
  const ไม่มีบัญชี = await call(auth.forgotPassword, { body: { email: 'nobody@example.com' } });

  assert.equal(มีบัญชี.success, ไม่มีบัญชี.success);
  assert.equal(มีบัญชี.message, ไม่มีบัญชี.message);
});

test('อีเมลที่ไม่มีบัญชี ต้องไม่ทิ้งลิงก์รีเซ็ตค้างไว้ในระบบ', () => {
  const ค้างอยู่ = db
    .prepare('SELECT COUNT(*) c FROM password_reset_tokens WHERE user_id NOT IN (SELECT id FROM app_users)')
    .get().c;
  assert.equal(ค้างอยู่, 0);
});

test('ขอลิงก์ใหม่แล้วลิงก์เก่าตายทันที — เหตุผลที่ต้องล็อกปุ่มไม่ให้กดซ้ำ', async () => {
  await call(auth.forgotPassword, { body: { email } });
  const ฉบับแรก = ลิงก์ล่าสุด();

  await call(auth.forgotPassword, { body: { email } });
  const ฉบับสอง = ลิงก์ล่าสุด();

  // กดสองครั้ง = ได้อีเมลสองฉบับ แต่ใช้ได้ฉบับเดียว
  // ผู้ใช้ที่เปิดฉบับแรก (ซึ่งมาถึงก่อน) จะเจอลิงก์ตายโดยไม่รู้สาเหตุ
  assert.equal(นับลิงก์(), 1, 'ต้องเหลือลิงก์เดียวเสมอ');
  assert.notEqual(ฉบับแรก, ฉบับสอง, 'ลิงก์เก่าต้องถูกแทนที่ด้วยอันใหม่');
});

test('ไม่กรอกอีเมลต้องถูกปัดตั้งแต่ต้น ไม่ไปแตะฐานข้อมูล', async () => {
  const ก่อนหน้า = นับลิงก์();
  const ผล = await call(auth.forgotPassword, { body: {} });

  assert.equal(ผล.success, false);
  assert.equal(ผล.status, 400);
  assert.equal(นับลิงก์(), ก่อนหน้า);
});

test.after(() => temp.cleanup(db));

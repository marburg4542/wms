// กติกาชื่อผู้ใช้/รหัสผ่าน + endpoint ที่บังคับใช้ (สมัคร, ตั้งรหัสผ่านใหม่, แก้โปรไฟล์, เช็กชื่อว่าง)
//
// ปิดระบบอีเมลก่อนโหลด config — ไม่งั้นเทสต์สมัครสมาชิกจะส่งอีเมลจริงออกไปด้วย .env ของเครื่อง
// (dotenv ไม่เขียนทับตัวแปรที่ตั้งไว้แล้ว แม้เป็นค่าว่าง)
process.env.EMAIL_HOST = '';
process.env.EMAIL_USER = '';
process.env.EMAIL_PASS = '';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createTempDatabase, call, callOk } from './helpers/apiHarness.js';
import { passwordChecks, passwordStrength, validatePassword, validateUsername } from '../../shared/credentialPolicy.js';

const temp = createTempDatabase('credentials');
const { default: db } = await import('../db.js');
const auth = await import('../controllers/authController.js');
const users = await import('../controllers/userController.js');

const STRONG = 'Wh3n-Pigs-Fly';

// ---- กติกาล้วน ----
test('ชื่อผู้ใช้: ภาษาอังกฤษ ตัวเลข . _ - ยาว 3–30 ห้ามเว้นวรรค', () => {
  for (const ok of ['somchai', 'somchai.k', 'user_01', 'a-b', 'Pai', 'marburg']) {
    assert.equal(validateUsername(ok), null, `${ok} ต้องใช้ได้`);
  }
  for (const bad of ['ab', 'a'.repeat(31), 'has space', 'สมชาย', '.dot', 'dash-', 'x<y', 'system', 'SYSTEM']) {
    assert.ok(validateUsername(bad), `${bad} ต้องใช้ไม่ได้`);
  }
});

test('รหัสผ่าน: ต้องมีตัวอักษร+ตัวเลข ไม่คาดเดาง่าย ไม่มีชื่อผู้ใช้ และไม่เกิน 72 ไบต์', () => {
  assert.match(validatePassword('abc1'), /8 ตัว/);
  assert.match(validatePassword('abcdefgh'), /ตัวเลข/);
  assert.match(validatePassword('12345678'), /ตัวอักษร/);
  assert.match(validatePassword('password123'), /คาดเดาง่าย/);
  assert.match(validatePassword('Somchai2026', { username: 'somchai' }), /ชื่อผู้ใช้/);
  assert.equal(validatePassword('รหัสลับ2026ของฉัน'), null, 'ตัวอักษรไทยนับเป็นตัวอักษรได้');
  assert.match(validatePassword(`ก${'ข'.repeat(24)}1`), /72 ไบต์/, 'ไทย 26 ตัว = 76+ ไบต์ เกินที่ bcrypt ใช้ได้');
  assert.equal(validatePassword(STRONG, { username: 'somchai' }), null);

  const hidden = passwordChecks(STRONG).find((check) => check.id === 'maxBytes');
  assert.ok(hidden.hiddenWhenOk && hidden.ok, 'ข้อจำกัดความยาวซ่อนไว้จนกว่าจะเกิน');
});

test('มาตรวัดความแข็งแรง: ยาวและหลากหลายได้คะแนนสูง รหัสยอดนิยมได้ศูนย์', () => {
  assert.equal(passwordStrength('').score, 0);
  assert.equal(passwordStrength('password1').score, 0);
  assert.ok(passwordStrength('abcdefg1').score < passwordStrength('Abcdefg1!long').score);
  assert.equal(passwordStrength('Abcdefg1!long').score, 4);
});

// ---- สมัครสมาชิก ----
const register = (body) => call(auth.register, { body });

test('สมัครสมาชิก: ปฏิเสธชื่อ/อีเมล/รหัสผ่านที่ผิดกติกา พร้อมบอกเหตุผล', async () => {
  const base = { username: 'somchai.k', email: 'somchai@example.com', password: STRONG };
  // ฐานข้อมูลใหม่มีบัญชีแอดมินตั้งต้นอยู่แล้ว 1 บัญชี — นับเทียบก่อน/หลัง
  const countUsers = () => db.prepare('SELECT COUNT(*) n FROM app_users').get().n;
  const before = countUsers();
  const cases = [
    [{ ...base, username: 'has space' }, /ห้ามเว้นวรรค/],
    [{ ...base, username: 'system' }, /สงวนไว้/],
    [{ ...base, email: 'not-an-email' }, /อีเมล/],
    [{ ...base, password: 'password123' }, /คาดเดาง่าย/],
    [{ ...base, password: 'somchai.k2026' }, /ชื่อผู้ใช้/]
  ];
  for (const [body, pattern] of cases) {
    const res = await register(body);
    assert.equal(res.success, false, JSON.stringify(body));
    assert.match(res.message, pattern);
  }
  assert.equal(countUsers(), before, 'ต้องไม่มีบัญชีหลุดเข้าไป');

  await callOk('register', auth.register, { body: base });
  const dup = await register({ ...base, username: 'SOMCHAI.K', email: 'other@example.com' });
  assert.equal(dup.success, false, 'ชื่อซ้ำแบบต่างตัวพิมพ์เล็ก/ใหญ่ต้องไม่ผ่าน');
});

test('เช็กชื่อผู้ใช้ขณะพิมพ์: บอกได้ทั้งรูปแบบผิด มีคนใช้แล้ว และว่าง', async () => {
  const check = (username) => callOk('checkUsernameAvailable', auth.checkUsernameAvailable, { query: { username } });
  assert.equal((await check('Somchai.K')).reason, 'taken');
  assert.equal((await check('has space')).reason, 'format');
  const free = await check('newperson');
  assert.equal(free.available, true);
});

// ---- แก้โปรไฟล์ ----
test('แก้โปรไฟล์: เปลี่ยนรหัสผ่าน/อีเมลต้องยืนยันรหัสผ่านปัจจุบัน ส่วนอย่างอื่นไม่ต้อง', async () => {
  const me = db.prepare("SELECT id, username FROM app_users WHERE username = 'somchai.k'").get();
  const update = (body) => call(users.updateProfile, { body: { email: 'somchai@example.com', ...body }, user: { id: me.id, username: me.username } });

  const noConfirm = await update({ password: 'Brand-new-2026' });
  assert.equal(noConfirm.success, false);
  assert.equal(noConfirm.code, 'CURRENT_PASSWORD');
  assert.equal(noConfirm.status, 400, 'ต้องไม่ใช่ 401/403 ไม่งั้นหน้าเว็บจะเด้งผู้ใช้ออกจากระบบ');

  const wrong = await update({ password: 'Brand-new-2026', currentPassword: 'wrong-pass-1' });
  assert.match(wrong.message, /ไม่ถูกต้อง/);

  const stealEmail = await update({ email: 'attacker@example.com' });
  assert.equal(stealEmail.success, false, 'เปลี่ยนอีเมลโดยไม่ยืนยันรหัสผ่านไม่ได้ (กันยึดบัญชีผ่านลืมรหัสผ่าน)');

  const weak = await update({ password: 'password123', currentPassword: STRONG });
  assert.match(weak.message, /คาดเดาง่าย/);

  await callOk('updateProfile (avatar only)', users.updateProfile, {
    body: { email: 'somchai@example.com', avatarUrl: '/uploads/a.png' }, user: { id: me.id, username: me.username }
  });

  await callOk('updateProfile (password)', users.updateProfile, {
    body: { email: 'somchai@example.com', password: 'Brand-new-2026', currentPassword: STRONG },
    user: { id: me.id, username: me.username }
  });
  const hash = db.prepare('SELECT password FROM app_users WHERE id = ?').get(me.id).password;
  assert.ok(await bcrypt.compare('Brand-new-2026', hash), 'รหัสผ่านใหม่ต้องใช้ได้จริง');

  const badName = await update({ newUsername: 'bad name' });
  assert.equal(badName.success, false, 'เปลี่ยนชื่อผู้ใช้ต้องผ่านกติกาเดียวกับตอนสมัคร');
});

// ---- ตั้งรหัสผ่านใหม่จากลิงก์อีเมล ----
test('ตั้งรหัสผ่านใหม่: รหัสอ่อนถูกปฏิเสธโดยลิงก์ยังใช้ต่อได้', async () => {
  const me = db.prepare("SELECT id FROM app_users WHERE username = 'somchai.k'").get();
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), me.id, Date.now() + 60000, Date.now());

  const weak = await call(auth.resetPassword, { body: { token, newPassword: 'somchai.k99' } });
  assert.match(weak.message, /ชื่อผู้ใช้/, 'ต้องตรวจข้อ "ห้ามมีชื่อผู้ใช้" ได้ แม้หน้าเว็บไม่รู้ชื่อ');

  await callOk('resetPassword', auth.resetPassword, { body: { token, newPassword: 'Another-strong-7' } });
  const reused = await call(auth.resetPassword, { body: { token, newPassword: 'Another-strong-8' } });
  assert.equal(reused.success, false, 'ลิงก์ใช้ได้ครั้งเดียว');
});

test.after(() => temp.cleanup(db));

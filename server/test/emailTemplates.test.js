// เทมเพลตอีเมลในนามบริษัท — ไม่ต้องต่อฐานข้อมูลหรือระบบอีเมลจริง
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountStatusEmail,
  escapeHtml,
  LOGO_CID,
  passwordResetEmail,
  registrationReceivedEmail
} from '../utils/emailTemplates.js';

const base = { username: 'somchai', roleLabel: 'ผู้ชม (ดูอย่างเดียว)', loginUrl: 'https://wms.example/login' };

test('อีเมลสถานะบัญชี: เลือกฉบับตามสถานะเดิม → สถานะใหม่', () => {
  const kind = (previousStatus, status) => accountStatusEmail({ ...base, previousStatus, status })?.kind ?? null;
  assert.equal(kind('Pending', 'Active'), 'approved');
  assert.equal(kind('Denied', 'Active'), 'restored');
  assert.equal(kind('Pending', 'Denied'), 'rejected');
  assert.equal(kind('Active', 'Denied'), 'suspended', 'ระงับบัญชีที่ใช้งานอยู่ ต้องไม่ส่งฉบับ "ไม่ได้รับการอนุมัติ"');
  assert.equal(kind('Active', 'Active'), null, 'สถานะไม่เปลี่ยนต้องไม่ส่งอีเมล');
  assert.equal(kind('Active', 'Pending'), null);
});

test('อีเมลในนามบริษัท: มีหัวเรื่อง โลโก้ ชื่อบริษัท และฉบับข้อความล้วน', () => {
  const mail = accountStatusEmail({ ...base, previousStatus: 'Pending', status: 'Active' });
  assert.match(mail.subject, /^\[iCreativeSystems WMS\] /);
  assert.ok(mail.html.includes(`cid:${LOGO_CID}`), 'ต้องอ้างโลโก้ที่แนบไว้');
  assert.ok(mail.html.includes('iCreativeSystems Co., Ltd.'));
  assert.ok(mail.html.includes('href="https://wms.example/login"'), 'ต้องมีปุ่มเข้าสู่ระบบ');
  assert.ok(mail.text.includes('https://wms.example/login'), 'ฉบับข้อความล้วนต้องมีลิงก์ด้วย');
  assert.ok(mail.text.includes('ผู้ชม (ดูอย่างเดียว)'), 'ต้องบอกสิทธิ์ที่ได้รับ');
});

test('ชื่อผู้ใช้ที่มี HTML ต้องถูก escape ไม่ให้แทรกลิงก์ปลอมลงอีเมลบริษัทได้', () => {
  const evil = '<a href="https://phish.example">คลิกรับรางวัล</a>';
  const mail = registrationReceivedEmail({ username: evil, email: 'x@example.com' });
  assert.ok(!mail.html.includes('<a href="https://phish.example">'), 'ห้ามมีแท็กที่ผู้ใช้ใส่มาใน HTML');
  assert.ok(mail.html.includes(escapeHtml(evil)), 'ต้องแสดงเป็นข้อความธรรมดาแทน');
});

test('อีเมลตั้งรหัสผ่านใหม่: มีลิงก์ทั้งปุ่มและตัวลิงก์สำรอง พร้อมบอกอายุลิงก์', () => {
  const link = 'https://wms.example/reset-password/abc123?x=1&y=2';
  const mail = passwordResetEmail({ username: 'somchai', resetLink: link, expiresInMinutes: 30 });
  assert.equal((mail.html.match(/href="https:\/\/wms\.example\/reset-password\/abc123\?x=1&amp;y=2"/g) || []).length, 2,
    'ต้องมีทั้งปุ่มและลิงก์สำรอง (& ต้อง escape เป็น &amp; ใน href)');
  assert.match(mail.html, /30 นาที/);
  assert.ok(mail.text.includes(link));
});

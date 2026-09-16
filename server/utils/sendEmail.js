// server/utils/sendEmail.js
//
// รองรับ 2 แบบ เลือกจาก .env โดยไม่ต้องแก้โค้ด:
//   1. SMTP ขององค์กร  → ตั้ง EMAIL_HOST (+ EMAIL_PORT / EMAIL_SECURE)
//   2. Gmail            → ไม่ต้องตั้ง EMAIL_HOST ใส่แค่ EMAIL_USER / EMAIL_PASS (App Password)
//
// ทำไมต้องเลือกได้: Gmail มีเพดานส่งต่อวัน พอชนเพดานแล้วลิงก์รีเซ็ตรหัสผ่าน
// กับอีเมลอนุมัติบัญชีจะส่งไม่ออกทั้งระบบ (เคยเกิดจริง 27 ส.ค. 2026)
// SMTP ขององค์กรไม่มีข้อจำกัดแบบนั้น และไม่ต้องผูกกับบัญชีส่วนตัวของใครคนหนึ่ง
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { COMPANY, LOGO_CID } from './emailTemplates.js';

const { host, port, secure, user, pass, from } = config.email;

// สร้าง transporter ครั้งเดียวตอนโหลดโมดูล — ยังไม่ต่อเน็ตจนกว่าจะส่งจริง
const transporter = (user || host)
  ? nodemailer.createTransport(host
    ? { host, port, secure, auth: user ? { user, pass } : undefined }
    : { service: 'gmail', auth: { user, pass } })
  : null;

export const emailMode = host ? `SMTP ${host}:${port}` : user ? 'Gmail' : 'ปิดอยู่';

// โลโก้บริษัทสำหรับแนบในอีเมล — ใช้ไฟล์เดียวกับหน้าเว็บ (public/ ตอนพัฒนา, dist/ หลัง build)
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const logoPath = ['public', 'dist']
  .map((dir) => path.join(serverDir, '..', dir, 'icons', 'ICS.png'))
  .find((file) => fs.existsSync(file));

// เช็คว่าตั้งค่าถูกไหมตั้งแต่ตอนสตาร์ท จะได้รู้ก่อนที่ผู้ใช้จะกดลืมรหัสผ่านแล้วเงียบหาย
export const verifyEmailTransport = async () => {
  if (!transporter) return false;
  try {
    await transporter.verify();
    console.log(`📧 ระบบอีเมลพร้อมใช้งาน (${emailMode})`);
    return true;
  } catch (error) {
    console.warn(`⚠️ ต่อระบบอีเมลไม่ได้ (${emailMode}): ${error.message}`);
    if (/Invalid login|BadCredentials|535/i.test(error.message || '') && !host) {
      console.warn('   ↳ Gmail ไม่ยอมรับ App Password นี้แล้ว (มักเกิดหลังเปลี่ยนรหัสผ่าน Google หรือปิดการยืนยัน 2 ขั้นตอน)');
      console.warn('   ↳ แก้: สร้าง App Password ใหม่ที่ myaccount.google.com/apppasswords แล้วใส่ EMAIL_PASS ใน server/.env จากนั้นรีสตาร์ทระบบ');
    }
    return false;
  }
};

/**
 * ส่งอีเมล — message มาจากเทมเพลตใน emailTemplates.js ({ subject, html, text })
 * คืน true เมื่อส่งสำเร็จ, false เมื่อส่งไม่ได้ (ผู้เรียกควรเช็คค่านี้)
 */
export const sendEmail = async (to, { subject, html, text }) => {
  if (!transporter) {
    console.warn(`Email is not configured. Skipped message to ${to}.`);
    return false;
  }

  // แนบโลโก้เฉพาะฉบับที่อ้างถึง — ถ้าหาไฟล์ไม่เจอ อีเมลยังส่งได้ แค่ขึ้นข้อความ alt แทนรูป
  const attachments = logoPath && html.includes(`cid:${LOGO_CID}`)
    ? [{ filename: 'icreativesystems-logo.png', path: logoPath, cid: LOGO_CID, contentDisposition: 'inline' }]
    : [];

  try {
    await transporter.sendMail({
      from: from || `"${COMPANY.system}" <${user}>`,
      to,
      subject,
      html,
      text,        // ฉบับข้อความล้วน — โปรแกรมอ่านอีเมลที่ไม่แสดง HTML ก็ยังอ่านได้ และช่วยไม่ให้ตกไปอยู่ในสแปม
      attachments
    });
    console.log(`✅ ส่งอีเมลสำเร็จไปยัง: ${to}`);
    return true;
  } catch (error) {
    // ชนเพดานรายวันของ Gmail — แยกข้อความให้ชัด เพราะวิธีแก้ต่างจาก error อื่น
    const quotaHit = /limit exceeded|rate limit|4\.7\.0|5\.4\.5/i.test(error.message || '');
    console.error(`❌ ส่งอีเมลไปที่ ${to} ไม่สำเร็จ (${emailMode}): ${error.message}`);
    if (quotaHit) {
      console.error('   ↳ ชนเพดานส่งอีเมลต่อวันของผู้ให้บริการ — โควตาจะรีเซ็ตเองในวันถัดไป');
      console.error('   ↳ แก้ถาวร: ตั้ง EMAIL_HOST ใน server/.env ให้ชี้ไป SMTP ขององค์กร');
    }
    return false;
  }
};

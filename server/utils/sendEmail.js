// server/utils/sendEmail.js
import nodemailer from 'nodemailer';
import { config } from '../config.js';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendEmail = async (to, subject, html) => {
  if (!config.email.user || !config.email.pass) {
    console.warn(`Email is not configured. Skipped message to ${to}.`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"WMS iCreativeSystem" <${config.email.user}>`,
      to,
      subject,
      html
    });
    console.log(`✅ ส่งอีเมลสำเร็จไปยัง: ${to}`);
    return true;
  } catch (error) {
    console.error(`❌ เกิดข้อผิดพลาดในการส่งอีเมลไปที่ ${to}:`, error.message);
    return false;
  }
};

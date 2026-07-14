import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getUserById, getUserByUsername, getUserByEmail, createUser, updateUser, setSessionId } from '../data/userManager.js';
import { sendEmail } from '../utils/sendEmail.js';
import { config } from '../config.js';
import db, { logAudit } from '../db.js';
import { broadcast } from '../events.js';

const RESET_TOKEN_TTL_MS = 1000 * 60 * 30;

const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const signToken = (user, sessionId) => jwt.sign(
  { id: user.id, username: user.username, role: user.role, sid: sessionId },
  config.jwtSecret,
  { expiresIn: '1d' }
);

const avatarForUser = (user) => (
  user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=0D8ABC&color=fff`
);

const safeUser = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role,
  status: user.status,
  avatarUrl: avatarForUser(user)
});

export const login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอก Username และ Password' });
  }

  const user = getUserByUsername(String(username).trim());

  if (!user) {
    return res.status(401).json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
  }

  if (user.status === 'Pending') {
    return res.status(403).json({ success: false, message: 'บัญชีรอผลการอนุมัติ' });
  }
  if (user.status === 'Denied') {
    return res.status(403).json({ success: false, message: 'บัญชีนี้ไม่ได้รับอนุมัติให้ใช้งานระบบ' });
  }

  // สร้าง session ใหม่ทุกครั้งที่ login และบันทึกทับของเดิม → อุปกรณ์เก่าที่ถือ token เดิมจะถูกตัด
  const sessionId = crypto.randomBytes(16).toString('hex');
  setSessionId(user.id, sessionId);
  const token = signToken(user, sessionId);
  logAudit(user.username, 'auth.login', 'user', user.id);

  return res.status(200).json({
    success: true,
    token,
    ...safeUser(user)
  });
};

export const register = async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลสมัครสมาชิกให้ครบถ้วน' });
  }

  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
  }

  // แยกข้อความให้ชัดว่าซ้ำที่ช่องไหน — บัญชีที่ถูก "ระงับ (Denied)" ยังอยู่ในระบบและกันชื่อ/อีเมลไว้
  // ต่างจากบัญชีที่ถูก "ลบ" ซึ่งหายไปจริงและสมัครซ้ำได้
  if (getUserByUsername(username)) {
    return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว (อาจเป็นบัญชีเดิมที่ยังไม่ถูกลบ)' });
  }
  if (getUserByEmail(email)) {
    return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว (อาจเป็นบัญชีเดิมที่ยังไม่ถูกลบ)' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  // ผู้สมัครใหม่เริ่มที่สิทธิ์ต่ำสุด (ดูอย่างเดียว) — Admin ค่อยปรับ role ให้ทีหลัง
  const newUser = createUser({ username, email, password: hashedPassword, role: 'Viewer', status: 'Pending' });
  logAudit(username, 'auth.register', 'user', newUser.id, { status: 'Pending' });
  broadcast('users'); // ให้กระดิ่งของ Admin เด้งทันทีที่มีคนสมัคร

  await sendEmail(email, 'WMS - ยืนยันการสมัครสมาชิก (รอผลอนุมัติ)', `
    <h2>สวัสดีคุณ ${username}</h2>
    <p>ระบบได้รับคำขอสมัครสมาชิกของคุณเรียบร้อยแล้ว ขณะนี้สถานะคือ <b>กำลังรอการอนุมัติ</b></p>
    <p>หากผู้ดูแลระบบทำการอนุมัติ คุณจะได้รับอีเมลแจ้งเตือนอีกครั้ง</p>
  `);

  return res.status(200).json({ success: true, message: 'สมัครสมาชิกสำเร็จ กรุณารอการอนุมัติ' });
};

export const forgotPassword = async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุอีเมล' });
  }

  const user = getUserByEmail(email);

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(token);
    const now = Date.now();

    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at < ? OR used_at IS NOT NULL')
      .run(user.id, now);
    db.prepare(`
      INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(tokenHash, user.id, now + RESET_TOKEN_TTL_MS, now);

    // ใช้ origin ที่ผู้ใช้เข้าจริง (LAN/tunnel) เฉพาะเมื่ออยู่ใน allowlist เพื่อให้ลิงก์ใช้งานได้
    // ไม่งั้น fallback เป็นค่าแรกใน FRONTEND_URL (กัน host-header injection ในลิงก์รีเซ็ต)
    const origin = String(req.get('origin') || '').replace(/\/$/, '');
    const baseUrl = config.frontendUrls.includes(origin) ? origin : config.frontendUrl;
    const resetLink = `${baseUrl}/reset-password/${token}`;

    await sendEmail(email, 'WMS - รีเซ็ตรหัสผ่าน', `
      <h2>คำขอรีเซ็ตรหัสผ่าน</h2>
      <p>คลิกที่ลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ของคุณ:</p>
      <a href="${resetLink}" style="padding: 10px 20px; background: #0D8ABC; color: white; text-decoration: none; border-radius: 5px;">รีเซ็ตรหัสผ่าน</a>
      <p><i>หากคุณไม่ได้ทำรายการนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</i></p>
    `);
  }

  return res.json({ success: true, message: 'หากอีเมลนี้อยู่ในระบบ เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้' });
};

export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง' });
  }

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' });
  }

  const tokenHash = hashResetToken(token);
  const tokenData = db.prepare(`
    SELECT prt.token_hash, prt.user_id, prt.expires_at, prt.used_at, u.email
    FROM password_reset_tokens prt
    JOIN app_users u ON u.id = prt.user_id
    WHERE prt.token_hash = ?
  `).get(tokenHash);

  if (!tokenData || tokenData.used_at || tokenData.expires_at < Date.now()) {
    if (tokenData) db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(tokenHash);
    return res.status(400).json({ success: false, message: 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง หรือหมดอายุแล้ว' });
  }

  const user = getUserById(tokenData.user_id);

  if (!user) {
    return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  updateUser(user.id, { password: hashedPassword });
  db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), tokenHash);
  logAudit(user.username, 'auth.password_reset', 'user', user.id);

  return res.json({ success: true, message: 'รีเซ็ตรหัสผ่านสำเร็จ คุณสามารถเข้าสู่ระบบได้ทันที' });
};

export const verifyToken = (req, res) => {
  const user = getUserById(req.user.id);

  if (!user || user.status !== 'Active') {
    return res.status(403).json({ success: false, message: 'บัญชีนี้ไม่พร้อมใช้งาน' });
  }

  return res.status(200).json({ success: true, user: safeUser(user) });
};

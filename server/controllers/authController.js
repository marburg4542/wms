import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getUserById, getUserByUsername, getUserByEmail, createUser, updateUser, setSessionId } from '../data/userManager.js';
import { sendEmail } from '../utils/sendEmail.js';
import { passwordResetEmail, registrationReceivedEmail } from '../utils/emailTemplates.js';
import { isValidEmail, validatePassword, validateUsername } from '../../shared/credentialPolicy.js';
import { config } from '../config.js';
import db, { logAudit } from '../db.js';
import { broadcast } from '../events.js';
import { sendPushToRoles } from '../push.js';

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

  // กติกาเดียวกับที่หน้าเว็บแสดงขณะพิมพ์ (shared/credentialPolicy.js) — ตรวจซ้ำที่นี่เพราะยิง API ตรงได้
  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ success: false, message: usernameError });
  if (!isValidEmail(email)) return res.status(400).json({ success: false, message: 'รูปแบบอีเมลไม่ถูกต้อง' });
  const passwordError = validatePassword(password, { username });
  if (passwordError) return res.status(400).json({ success: false, message: passwordError });

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

  // แจ้งแอดมินว่ามีคนรออนุมัติ — ผู้สมัครใช้งานไม่ได้จนกว่าจะมีคนกดอนุมัติ
  // ถ้าไม่มีใครเห็น คนสมัครจะรอเก้อ
  //
  // ส่งเฉพาะ Admin ไม่รวม Manager เพราะหน้าจัดการผู้ใช้เปิดได้แค่ Admin
  // ถ้าส่งให้ Manager ด้วย กดแจ้งเตือนแล้วจะโดนเด้งออกจากหน้า
  sendPushToRoles(['Admin'], {
    title: 'มีผู้สมัครใช้งานใหม่',
    body: `${username} (${email}) รออนุมัติอยู่`,
    url: '/users'
  }).catch(() => {});

  await sendEmail(email, registrationReceivedEmail({ username, email }));

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

    // ไม่ยืนรอผลส่งอีเมลก่อนตอบผู้ใช้ — ข้อความตอบกลับเหมือนกันทุกกรณีอยู่แล้ว รอไปก็ไม่ได้อะไรเพิ่ม
    // แต่เสียสองอย่าง: จอค้าง ~4 วินาทีจนคนกดซ้ำ แล้วลิงก์ฉบับแรกตายทันทีเพราะโดนลบทิ้งตอนขอใหม่
    // และเวลาตอบที่ต่างกัน 10 เท่า (4 วินาที vs 0.4) ฟ้องว่าอีเมลนี้มีบัญชีอยู่จริงไหม
    // ทั้งที่ข้อความกลางๆ ข้างล่างตั้งใจปิดเรื่องนั้นไว้
    // เฉพาะจุดนี้เท่านั้น — หน้าอนุมัติบัญชีต้องรอผลจริงต่อไป เพราะมันรายงานผลส่งให้แอดมินเห็น
    sendEmail(email, passwordResetEmail({
      username: user.username,
      resetLink,
      expiresInMinutes: RESET_TOKEN_TTL_MS / 60000
    })).catch((error) => {
      // sendEmail กลืน error ไว้เองอยู่แล้ว ด่านนี้กันเฉพาะกรณีที่โยนออกมานอกเหนือจากนั้น
      // ไม่งั้น promise ที่ไม่มีใครรับจะทำให้ process ทั้งตัวดับ
      console.error(`❌ ส่งลิงก์รีเซ็ตรหัสผ่านไปที่ ${email} ไม่สำเร็จ: ${error.message}`);
    });
  }

  return res.json({ success: true, message: 'หากอีเมลนี้อยู่ในระบบ เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้' });
};

export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง' });
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

  // ตรวจหลังรู้ตัวผู้ใช้แล้ว จะได้เช็กข้อ "ห้ามมีชื่อผู้ใช้ในรหัสผ่าน" ได้ด้วย
  // ตั้งไม่ผ่านก็ไม่เสียลิงก์ — ลิงก์ถูกใช้ (used_at) เฉพาะตอนตั้งสำเร็จ
  const passwordError = validatePassword(newPassword, { username: user.username });
  if (passwordError) return res.status(400).json({ success: false, message: passwordError });

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  updateUser(user.id, { password: hashedPassword });
  db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), tokenHash);
  logAudit(user.username, 'auth.password_reset', 'user', user.id);

  return res.json({ success: true, message: 'รีเซ็ตรหัสผ่านสำเร็จ คุณสามารถเข้าสู่ระบบได้ทันที' });
};

// เช็กชื่อผู้ใช้ขณะพิมพ์ในหน้าสมัคร/ตั้งค่า — ไม่ต้องล็อกอิน (ผู้สมัครยังไม่มีบัญชี) จึงมี rate limit คุม
// ตอบ 200 ทุกกรณี แล้วบอกผลใน available/reason ให้หน้าเว็บแสดงข้อความใต้ช่องกรอก
export const checkUsernameAvailable = (req, res) => {
  const username = String(req.query.username || '').trim();
  const formatError = validateUsername(username);
  if (formatError) return res.json({ success: true, available: false, reason: 'format', message: formatError });

  const taken = getUserByUsername(username);   // เทียบแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ เหมือนตอนสมัครจริง
  return res.json({
    success: true,
    available: !taken,
    reason: taken ? 'taken' : null,
    message: taken ? 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' : 'ใช้ชื่อนี้ได้'
  });
};

export const verifyToken = (req, res) => {
  const user = getUserById(req.user.id);

  if (!user || user.status !== 'Active') {
    return res.status(403).json({ success: false, message: 'บัญชีนี้ไม่พร้อมใช้งาน' });
  }

  return res.status(200).json({ success: true, user: safeUser(user) });
};

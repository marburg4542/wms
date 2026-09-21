// server/controllers/userController.js
import {
  getUsers,
  getUserById,
  getUserByUsername,
  getUserByEmail,
  updateUser,
  deleteUser as deleteUserRecord,
  countActiveAdmins,
  getSessionId
} from '../data/userManager.js';
import { sendEmail } from '../utils/sendEmail.js';
import { accountStatusEmail } from '../utils/emailTemplates.js';
import { isValidEmail, validatePassword, validateUsername } from '../../shared/credentialPolicy.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { logAudit } from '../db.js';
import { broadcast } from '../events.js';
import { sendPushToUser } from '../push.js';

const VALID_STATUSES = ['Pending', 'Active', 'Denied'];
const VALID_ROLES = ['Admin', 'Manager', 'Operator', 'Viewer'];

// ชื่อบทบาทภาษาไทย — ต้องตรงกับ roleLabel ใน src/utils/labels.js ที่หน้าเว็บใช้
const ROLE_LABEL = {
  Admin: 'ผู้ดูแลระบบ',
  Manager: 'ผู้จัดการ',
  Operator: 'พนักงาน',
  Viewer: 'ผู้ชม (ดูอย่างเดียว)'
};

export const getUsersList = (req, res) => {
  // ไม่ส่ง password กลับไปที่หน้าเว็บ
  const safeUsers = getUsers().map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarUrl
  }));
  res.json({ success: true, users: safeUsers });
};

// ฝั่ง Admin กด Accept หรือ Deny
export const updateUserStatus = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { status } = req.body; // รับค่า 'Active' หรือ 'Denied'

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'สถานะผู้ใช้ไม่ถูกต้อง' });
    }

    const existing = getUserById(userId);
    if (!existing) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });

    if (existing.role === 'Admin' && status !== 'Active' && countActiveAdmins() <= 1) {
      return res.status(400).json({ success: false, message: 'ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน' });
    }

    const previousStatus = existing.status;
    const user = updateUser(userId, { status });
    logAudit(req.user?.username, 'user.status_update', 'user', userId, { status, previousStatus });

    // ฉบับอีเมลขึ้นกับสถานะเดิมด้วย — ปุ่ม "ระงับ" กับ "ปฏิเสธ" ส่งสถานะเดียวกัน แต่ความหมายต่างกัน
    const email = accountStatusEmail({
      previousStatus,
      status,
      username: user.username,
      roleLabel: ROLE_LABEL[user.role] || user.role,
      loginUrl: `${config.frontendUrl}/login`
    });
    // null = ไม่มีอีเมลต้องส่ง | true/false = ผลการส่ง — หน้าเว็บต้องรู้ จะได้ไม่บอกว่าส่งแล้วทั้งที่ส่งไม่ออก
    const emailSent = email ? await sendEmail(user.email, email) : null;

    broadcast('users');
    res.json({
      success: true,
      emailSent,
      message: emailSent === false
        ? 'อัปเดตสถานะแล้ว แต่ส่งอีเมลแจ้งผู้ใช้ไม่สำเร็จ'
        : emailSent ? 'อัปเดตสถานะและส่งอีเมลแจ้งผู้ใช้แล้ว' : 'อัปเดตสถานะแล้ว'
    });
  } catch {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateUserRole = (req, res) => {
  const userId = parseInt(req.params.id);
  const { role } = req.body;

  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: 'บทบาทผู้ใช้ไม่ถูกต้อง' });
  }

  const existing = getUserById(userId);
  if (!existing) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });

  if (existing.role === 'Admin' && role !== 'Admin' && countActiveAdmins() <= 1) {
    return res.status(400).json({ success: false, message: 'ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน' });
  }

  updateUser(userId, { role });
  logAudit(req.user?.username, 'user.role_update', 'user', userId, { role });

  // แจ้งเจ้าตัวว่าสิทธิ์เปลี่ยน — ไม่งั้นเมนูในแอปเปลี่ยนไปเฉยๆ โดยไม่มีคำอธิบาย
  // ข้ามถ้าแอดมินเปลี่ยนบทบาทของตัวเอง เพราะรู้อยู่แล้ว
  if (existing.username !== req.user?.username) {
    sendPushToUser(existing.username, {
      title: 'สิทธิ์การใช้งานของคุณเปลี่ยนแล้ว',
      body: `จาก "${ROLE_LABEL[existing.role] || existing.role}" เป็น "${ROLE_LABEL[role] || role}"
เข้าสู่ระบบใหม่เพื่อให้เมนูอัปเดต`,
      url: '/homepage'
    }).catch(() => {});
  }

  return res.json({ success: true });
};

export const deleteUser = (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user?.id) {
    return res.status(400).json({ success: false, message: 'ไม่สามารถลบบัญชีของตัวเองได้' });
  }

  const targetUser = getUserById(userId);
  if (!targetUser) {
    return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานที่ต้องการลบ' });
  }

  if (targetUser.role === 'Admin' && countActiveAdmins() <= 1) {
    return res.status(400).json({ success: false, message: 'ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน' });
  }

  deleteUserRecord(userId);
  logAudit(req.user?.username, 'user.delete', 'user', userId, { username: targetUser.username });
  broadcast('users');
  res.json({ success: true, message: 'ลบผู้ใช้งานสำเร็จ' });
};

export const updateProfile = async (req, res) => {
  try {
    const { newUsername, email, password, currentPassword, avatarUrl } = req.body;

    const current = getUserById(req.user?.id);
    if (!current) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });

    const updates = {};

    // 1. Username ใหม่ — ตรวจกติกาเฉพาะตอนเปลี่ยน (ชื่อเดิมที่ตั้งก่อนมีกติกายังใช้ต่อได้)
    const wantedUsername = typeof newUsername === 'string' ? newUsername.trim() : '';
    if (wantedUsername && wantedUsername !== current.username) {
      const usernameError = validateUsername(wantedUsername);
      if (usernameError) return res.status(400).json({ success: false, message: usernameError });
      const isTaken = getUserByUsername(wantedUsername);
      if (isTaken && isTaken.id !== current.id) {
        return res.status(400).json({ success: false, message: 'Username นี้ถูกใช้งานแล้ว' });
      }
      updates.username = wantedUsername;
    }

    // 2. Email ใหม่ — หน้าตั้งค่าส่งอีเมลเดิมมาทุกครั้ง นับว่า "เปลี่ยน" เฉพาะเมื่อไม่ตรงของเดิม
    let emailChanged = false;
    if (email) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (normalizedEmail !== current.email) {
        if (!isValidEmail(normalizedEmail)) return res.status(400).json({ success: false, message: 'รูปแบบอีเมลไม่ถูกต้อง' });
        const emailTaken = getUserByEmail(normalizedEmail);
        if (emailTaken && emailTaken.id !== current.id) {
          return res.status(400).json({ success: false, message: 'Email นี้ถูกใช้งานแล้ว' });
        }
        updates.email = normalizedEmail;
        emailChanged = true;
      }
    }
    if (typeof avatarUrl === 'string') updates.avatarUrl = avatarUrl;

    if (password) {
      const passwordError = validatePassword(password, { username: updates.username || current.username });
      if (passwordError) return res.status(400).json({ success: false, message: passwordError });
    }

    // 3. เปลี่ยนรหัสผ่านหรืออีเมลต้องยืนยันรหัสผ่านปัจจุบัน
    //    อีเมลคือทางกู้บัญชี — ถ้าใครใช้เครื่องที่ล็อกอินค้างไว้แล้วเปลี่ยนอีเมลเป็นของตัวเอง
    //    จะกด "ลืมรหัสผ่าน" ยึดบัญชีไปได้ทันที
    //    ตอบ 400 ไม่ใช่ 401 เพราะหน้าเว็บถือว่า 401/403 = session หลุด แล้วเด้งออกจากระบบ
    if (password || emailChanged) {
      const confirmed = typeof currentPassword === 'string' && currentPassword.length > 0
        && await bcrypt.compare(currentPassword, current.password);
      if (!confirmed) {
        return res.status(400).json({
          success: false,
          code: 'CURRENT_PASSWORD',
          message: currentPassword ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง' : 'กรุณากรอกรหัสผ่านปัจจุบันเพื่อยืนยันการเปลี่ยนรหัสผ่านหรืออีเมล'
        });
      }
      if (password) updates.password = await bcrypt.hash(password, 10);
    }

    const updated = updateUser(current.id, updates);
    logAudit(req.user?.username, 'user.profile_update', 'user', updated.id, { fields: Object.keys(updates) });

    // 4. ออก Token ใหม่เฉพาะตอนที่ Username เปลี่ยน (เพราะ payload เปลี่ยน)
    //    ต้องพก session_id ปัจจุบันไปด้วย ไม่งั้น token ใหม่จะไม่ตรงกับ session แล้วตัดตัวเองออก
    const newToken = updates.username
      ? jwt.sign({ id: updated.id, username: updated.username, role: updated.role, sid: getSessionId(updated.id) }, config.jwtSecret, { expiresIn: '1d' })
      : null;

    res.json({
      success: true,
      message: 'อัปเดตข้อมูลสำเร็จ',
      token: newToken,
      user: {
        id: updated.id,
        username: updated.username,
        email: updated.email,
        role: updated.role,
        avatarUrl: updated.avatarUrl
      }
    });
  } catch {
    res.status(500).json({ success: false, message: 'Update profile error' });
  }
};

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
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { logAudit } from '../db.js';
import { broadcast } from '../events.js';

const VALID_STATUSES = ['Pending', 'Active', 'Denied'];
const VALID_ROLES = ['Admin', 'Manager', 'Operator', 'Viewer'];

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

    const user = updateUser(userId, { status });
    logAudit(req.user?.username, 'user.status_update', 'user', userId, { status });

    const subject = status === 'Active' ? 'WMS - บัญชีของคุณได้รับการอนุมัติแล้ว 🎉' : 'WMS - บัญชีของคุณถูกปฏิเสธ';
    const htmlMessage = status === 'Active'
      ? `<h2>ยินดีด้วยคุณ ${user.username}</h2><p>บัญชีของคุณได้รับการอนุมัติให้เข้าใช้งานระบบ WMS แล้ว คุณสามารถเข้าสู่ระบบได้ทันที</p><a href="${config.frontendUrl}/login">เข้าสู่ระบบ</a>`
      : `<h2>เรียนคุณ ${user.username}</h2><p>ขออภัย บัญชีของคุณไม่ได้รับการอนุมัติให้เข้าใช้งานระบบ</p>`;

    await sendEmail(user.email, subject, htmlMessage);

    broadcast('users');
    res.json({ success: true, message: 'อัปเดตสถานะและส่งอีเมลแจ้งเตือนสำเร็จ' });
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
    const { newUsername, email, password, avatarUrl } = req.body;

    const current = getUserById(req.user?.id);
    if (!current) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });

    const updates = {};

    // 1. เช็คว่า Username ใหม่ซ้ำกับคนอื่นไหม
    if (newUsername && newUsername !== current.username) {
      const isTaken = getUserByUsername(newUsername);
      if (isTaken && isTaken.id !== current.id) {
        return res.status(400).json({ success: false, message: 'Username นี้ถูกใช้งานแล้ว' });
      }
      updates.username = newUsername;
    }

    // 2. เช็คว่า Email ใหม่ซ้ำกับคนอื่นไหม
    if (email) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const emailTaken = getUserByEmail(normalizedEmail);
      if (emailTaken && emailTaken.id !== current.id) {
        return res.status(400).json({ success: false, message: 'Email นี้ถูกใช้งานแล้ว' });
      }
      updates.email = normalizedEmail;
    }
    if (typeof avatarUrl === 'string') updates.avatarUrl = avatarUrl;

    // 3. Hash รหัสผ่านใหม่ก่อนเซฟเสมอ
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ success: false, message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' });
      }
      updates.password = await bcrypt.hash(password, 10);
    }

    const updated = updateUser(current.id, updates);
    logAudit(req.user?.username, 'user.profile_update', 'user', updated.id);

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

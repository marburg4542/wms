import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getUserById, getSessionId } from '../data/userManager.js';

export const verifyAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'ไม่อนุญาตให้เข้าถึง (ไม่มี Token)' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = getUserById(decoded.id);

    if (!user || user.status !== 'Active') {
      return res.status(403).json({ success: false, message: 'บัญชีนี้ไม่พร้อมใช้งาน' });
    }

    // จำกัด 1 บัญชี = 1 อุปกรณ์: ถ้ามีการ login จากอุปกรณ์อื่นทีหลัง session_id จะเปลี่ยน
    // token ของอุปกรณ์เก่าจะไม่ตรงกับของปัจจุบัน → ถูกตัดออก
    const currentSession = getSessionId(user.id);
    if (currentSession && decoded.sid !== currentSession) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REPLACED',
        message: 'บัญชีนี้ถูกเข้าสู่ระบบจากอุปกรณ์อื่น กรุณาเข้าสู่ระบบใหม่'
      });
    }

    req.user = { id: user.id, username: user.username, role: user.role };
    next();
  } catch {
    return res.status(403).json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุแล้ว' });
  }
};

export const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบก่อน' });
  }

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'สิทธิ์ของคุณไม่สามารถทำรายการนี้ได้' });
  }

  next();
};

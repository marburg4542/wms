// จำกัดจำนวนครั้งการเรียก endpoint ที่อ่อนไหว เพื่อกันการเดารหัส/สแปม
import rateLimit from 'express-rate-limit';

const makeLimiter = ({ windowMs, max, message, skipSuccessfulRequests = false }) =>
  rateLimit({
    windowMs,
    max,
    skipSuccessfulRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message }
  });

// Login/Reset: นับเฉพาะครั้งที่ "ล้มเหลว" (skipSuccessfulRequests) — พนักงานที่ล็อกอินถูกจะไม่โดนจำกัด
// แม้ทั้งออฟฟิศจะใช้ IP สาธารณะเดียวกัน (NAT) ก็ตาม แต่คนเดารหัสผิดซ้ำๆ จะถูกบล็อก
export const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  message: 'พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่'
});

export const resetPasswordLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  message: 'พยายามรีเซ็ตรหัสผ่านบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
});

// Forgot/Register: นับทุกครั้ง (กันสแปมอีเมล/สมัครรัว) — ค่าตั้งให้พอสำหรับใช้งานจริง
export const forgotPasswordLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 6,
  message: 'ขอรีเซ็ตรหัสผ่านบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
});

export const registerLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'สมัครสมาชิกบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
});

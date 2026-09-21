// กติกาชื่อผู้ใช้/รหัสผ่าน — ใช้ร่วมกันทั้งหน้าเว็บและเซิร์ฟเวอร์ ไฟล์เดียว
//
// หน้าเว็บใช้แสดงผลทันทีขณะพิมพ์ (เช็กลิสต์ + มาตรวัดความแข็งแรง)
// เซิร์ฟเวอร์ใช้บังคับจริง — ถ้าแยกกันเขียนสองที่ วันหนึ่งกติกาจะไม่ตรงกัน
// แล้วหน้าเว็บบอกว่าผ่าน แต่กดส่งแล้วโดนปฏิเสธโดยไม่รู้ว่าผิดตรงไหน
//
// ใช้ตอน "ตั้ง" ชื่อ/รหัสใหม่เท่านั้น บัญชีเดิมที่ตั้งไว้ก่อนมีกติกานี้ยังล็อกอินได้ตามปกติ

// ---------------------------------------------------------------------------
// ชื่อผู้ใช้
// ---------------------------------------------------------------------------
// 3–30 ตัว: ภาษาอังกฤษ ตัวเลข จุด ขีดล่าง ขีด — ขึ้นต้นและลงท้ายด้วยตัวอักษรหรือตัวเลข
// ไม่รับช่องว่างและอักขระพิเศษ เพราะชื่อผู้ใช้ไปโผล่ในอีเมล รายงาน PDF และประวัติทุกหน้า
const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{1,28})[A-Za-z0-9]$/;

// ชื่อที่ระบบใช้เอง — ถ้าให้คนสมัครได้ จะแยกไม่ออกว่ารายการไหนระบบทำ รายการไหนคนทำ
// (เช่น ประวัติรับเข้าที่เติมย้อนหลังบันทึกผู้ทำเป็น "system")
const RESERVED_USERNAMES = new Set(['system', 'root', 'administrator', 'null', 'undefined']);

export const USERNAME_HINT = 'ภาษาอังกฤษ ตัวเลข . _ - ยาว 3–30 ตัว';

/** คืนข้อความข้อผิดพลาด หรือ null เมื่อใช้ได้ */
export const validateUsername = (value) => {
  const name = String(value ?? '').trim();
  if (!name) return 'กรุณากรอกชื่อผู้ใช้';
  if (name.length < 3 || name.length > 30) return 'ชื่อผู้ใช้ต้องยาว 3–30 ตัวอักษร';
  if (!USERNAME_PATTERN.test(name)) {
    return 'ชื่อผู้ใช้ใช้ได้เฉพาะภาษาอังกฤษ ตัวเลข จุด (.) ขีดล่าง (_) ขีด (-) ห้ามเว้นวรรค และต้องขึ้นต้น/ลงท้ายด้วยตัวอักษรหรือตัวเลข';
  }
  if (RESERVED_USERNAMES.has(name.toLowerCase())) return 'ชื่อผู้ใช้นี้สงวนไว้สำหรับระบบ กรุณาใช้ชื่ออื่น';
  return null;
};

// ---------------------------------------------------------------------------
// อีเมล
// ---------------------------------------------------------------------------
export const isValidEmail = (value) => {
  const email = String(value ?? '').trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
};

// ---------------------------------------------------------------------------
// รหัสผ่าน
// ---------------------------------------------------------------------------
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt ใช้แค่ 72 ไบต์แรก ส่วนที่เกินถูกตัดทิ้งเงียบๆ — ยาวกว่านี้ผู้ใช้จะเข้าใจผิดว่าปลอดภัยกว่า
// (ภาษาไทยนับตัวละ 3 ไบต์ จึงพิมพ์ไทยได้ราว 24 ตัว)
export const PASSWORD_MAX_BYTES = 72;

// รหัสผ่านยอดนิยมที่ผ่านกติกาตัวอักษร+ตัวเลขได้ แต่ถูกเดาเป็นอันดับต้นๆ เสมอ
// รวมชื่อบริษัท/ระบบไว้ด้วย เพราะเป็นสิ่งแรกที่คนในองค์กรนึกถึงตอนตั้งรหัส
const COMMON_PASSWORDS = new Set([
  'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1', 'pa55word', 'pass1234',
  'qwerty12', 'qwerty123', 'qwerty1234', 'qwertyui1', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', 'zaq12wsx', 'qazwsx123',
  'abc12345', 'abc123456', 'abcd1234', 'abcde12345', 'a1234567', 'a12345678', 'aa123456', 'aa12345678',
  'asdf1234', 'asd12345', 'zxcv1234', 'admin123', 'admin1234', 'admin12345', 'administrator1',
  'welcome1', 'welcome123', 'iloveyou1', 'iloveyou2', 'letmein1', 'changeme1', 'test1234', 'test12345',
  'user1234', 'login123', 'monkey123', 'dragon123', 'sunshine1', 'football1', 'baseball1', 'superman1',
  'trustno1', 'master123', 'princess1', 'secret123', 'hello123', 'computer1', 'internet1', 'qwe12345',
  '12345qwert', '123qweasd', '1234qwer', '12345abc', '123456abc', '123abc456', 'abc123abc',
  'wms12345', 'wms123456', 'warehouse1', 'warehouse123', 'icreative1', 'icreative123', 'icreativesystems1',
  'ics12345', 'ics123456', 'company1', 'company123', 'thailand1', 'bangkok1', 'bangkok123'
]);

const byteLength = (text) => new TextEncoder().encode(text).length;

/**
 * เช็กลิสต์ทีละข้อ — หน้าเว็บเอาไปแสดงติ๊กถูก/วงกลม, เซิร์ฟเวอร์ใช้ข้อแรกที่ไม่ผ่านเป็นข้อความตอบกลับ
 * username ว่างได้ (หน้าตั้งรหัสผ่านใหม่จากลิงก์อีเมลไม่รู้ชื่อผู้ใช้ — เซิร์ฟเวอร์ตรวจข้อนี้แทน)
 */
export const passwordChecks = (password, { username = '' } = {}) => {
  const pw = String(password ?? '');
  const lower = pw.toLowerCase();
  const name = String(username ?? '').trim().toLowerCase();
  return [
    {
      id: 'length',
      label: `อย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`,
      error: `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`,
      ok: pw.length >= PASSWORD_MIN_LENGTH
    },
    {
      id: 'letter',
      label: 'มีตัวอักษร',
      error: 'รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว',
      ok: /\p{L}/u.test(pw)
    },
    {
      id: 'digit',
      label: 'มีตัวเลข',
      error: 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว',
      ok: /\d/.test(pw)
    },
    {
      id: 'username',
      label: 'ไม่มีชื่อผู้ใช้อยู่ในรหัสผ่าน',
      error: 'รหัสผ่านต้องไม่มีชื่อผู้ใช้อยู่ข้างใน',
      ok: name.length < 3 || !lower.includes(name)
    },
    {
      id: 'common',
      label: 'ไม่ใช่รหัสผ่านที่คาดเดาง่าย',
      error: 'รหัสผ่านนี้คาดเดาง่ายเกินไป กรุณาตั้งใหม่',
      ok: pw.length > 0 && !COMMON_PASSWORDS.has(lower)
    },
    {
      id: 'maxBytes',
      label: `ไม่ยาวเกิน ${PASSWORD_MAX_BYTES} ไบต์`,
      error: `รหัสผ่านยาวเกินไป (สูงสุด ${PASSWORD_MAX_BYTES} ไบต์ — ภาษาไทยนับตัวละ 3 ไบต์)`,
      ok: byteLength(pw) <= PASSWORD_MAX_BYTES,
      hiddenWhenOk: true   // ข้อนี้แทบไม่มีใครเจอ ไม่ต้องโชว์ให้รกตา จนกว่าจะเกิน
    }
  ];
};

/** คืนข้อความข้อผิดพลาดข้อแรกที่ไม่ผ่าน หรือ null เมื่อใช้ได้ */
export const validatePassword = (password, context) =>
  passwordChecks(password, context).find((check) => !check.ok)?.error ?? null;

/**
 * คะแนนความแข็งแรง 0–4 สำหรับมาตรวัดเท่านั้น (ไม่ได้ใช้ตัดสินว่าผ่าน/ไม่ผ่าน)
 * ความยาวมีผลมากสุด แล้วจึงดูความหลากหลายของชนิดตัวอักษร
 */
export const passwordStrength = (password) => {
  const pw = String(password ?? '');
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (pw.length >= 12) score += 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (kinds >= 2) score += 1;
  if (kinds >= 3) score += 1;
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) score = 0;
  return { score, label: ['อ่อนมาก', 'อ่อน', 'พอใช้', 'ดี', 'แข็งแรง'][score] };
};

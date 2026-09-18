import { INITIAL_STOCK_LABEL } from './initialStockHistory.js';

// normalize ชื่อโปรเจกต์ให้เทียบกันได้ — กัน "งานTAI", "tai", "TAI", "งาน TAI" กลายเป็นคนละโปรเจกต์
// กติกา: ตัดช่องว่างหัวท้าย → พิมพ์เล็ก → ตัดคำว่า "งาน" นำหน้า → ตัดช่องว่างภายในทั้งหมด
//   "งานTAI" → "tai" | "tai" → "tai" | "TAI" → "tai" | "งาน TAI" → "tai"
export const normalizeProject = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/^งาน\s*/, '')
    .replace(/\s+/g, '');

// ป้ายที่ระบบเขียนลงช่อง project เองเพื่อกำกับ "ประเภทใบ" ไม่ใช่ชื่อโปรเจกต์จริง
//
// สำคัญตอนเปลี่ยนชื่อโปรเจกต์: การเปลี่ยนชื่อต้องไล่แก้ชื่อในประวัติด้วยการเทียบข้อความตรงๆ
// ถ้าปล่อยให้ชื่อโปรเจกต์ชนป้ายพวกนี้ ใบปรับยอด/ใบรับเข้าจะโดนลากไปเป็นของโปรเจกต์นั้นทั้งยวง
// (ฐานจริงมีใบปรับยอดเกินร้อยใบ) ส่วนป้ายสต็อกตั้งต้นหนักกว่านั้น — มันคือกุญแจที่ใช้เช็กว่า
// เคยสร้างใบรับเข้าคู่กับ stock_in แถวนั้นไปแล้วหรือยัง แก้ข้อความเมื่อไรความสามารถ "เติมย้อนหลังซ้ำได้" หายทันที
export const ADJUSTMENT_LABEL = 'ปรับยอดสต็อก';
export const INBOUND_FALLBACK_LABEL = 'รับอะไหล่เข้า';
export const RESERVED_PROJECT_LABELS = [ADJUSTMENT_LABEL, INBOUND_FALLBACK_LABEL, INITIAL_STOCK_LABEL];

const RESERVED_NORMS = new Set(RESERVED_PROJECT_LABELS.map(normalizeProject));

// เทียบด้วย norm ไม่ใช่ข้อความดิบ — ระบบถือว่า "ปรับยอด สต็อก" กับ "ปรับยอดสต็อก" เป็นชื่อเดียวกันอยู่แล้ว
// ด่านนี้จึงต้องใช้มาตรฐานเดียวกัน ไม่งั้นเลี่ยงได้ด้วยการเคาะวรรคเพิ่มหนึ่งที
export const isReservedProjectLabel = (name) => RESERVED_NORMS.has(normalizeProject(name));

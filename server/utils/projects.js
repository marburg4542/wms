// normalize ชื่อโปรเจกต์ให้เทียบกันได้ — กัน "งานTAI", "tai", "TAI", "งาน TAI" กลายเป็นคนละโปรเจกต์
// กติกา: ตัดช่องว่างหัวท้าย → พิมพ์เล็ก → ตัดคำว่า "งาน" นำหน้า → ตัดช่องว่างภายในทั้งหมด
//   "งานTAI" → "tai" | "tai" → "tai" | "TAI" → "tai" | "งาน TAI" → "tai"
export const normalizeProject = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/^งาน\s*/, '')
    .replace(/\s+/g, '');

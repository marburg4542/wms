// จัดลำดับเส้นทางเดินหยิบสินค้าตามใบเบิก (pick route)
//
// หลักการ: เดินแบบ "งูเลื้อย" (serpentine) — ไล่เป็นแถวจากบนลงล่าง
// แถวเลขคู่เดินซ้าย→ขวา แถวเลขคี่เดินขวา→ซ้าย จะได้ไม่ต้องเดินย้อนกลับสุดทางทุกแถว
//
// ผังมี 2 ระดับพิกัด จึงเรียง 2 ชั้น:
//   ระดับผัง  — ชั้นวางที่อยู่ในห้อง ใช้ตำแหน่งของ "ห้อง" เป็นหมุด ส่วนชั้นลอยใช้ตำแหน่งตัวเอง
//   ระดับห้อง — ภายในห้องเดียวกัน ค่อยเรียงตามตำแหน่งของชั้นวางในห้องอีกที
// (พิกัดในห้องกับบนผังคนละระบบ เทียบข้ามห้องตรงๆ ไม่ได้ จึงต้องแยกชั้น)

export const PICK_BAND_HEIGHT = 120; // ความสูงของ "แถว" ที่ถือว่าเดินแนวเดียวกัน (px บน canvas)

// จุดแวะ 1 จุด = ชั้นวาง 1 ชั้น หรือพื้นที่ 1 แห่ง — สินค้าตัวเดียวอาจต้องแวะหลายจุดถ้าวางไว้หลายที่
export const stopKeyOf = (item) => {
  if (!item) return null;
  if (item.rackId) return `rack:${item.rackId}`;
  if (item.roomId && !item.rackId) return `room:${item.roomId}`;
  return null;
};

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bandOf = (y, bandHeight) => Math.floor(num(y) / Math.max(1, bandHeight));

// พิกัดที่ใช้ตัดสินลำดับ: ชั้นในห้องยึดตำแหน่งห้อง, ชั้นลอยยึดตำแหน่งตัวเอง
const planAnchor = (stop) => (stop.roomId
  ? { x: num(stop.roomX), y: num(stop.roomY) }
  : { x: num(stop.rackX), y: num(stop.rackY) });

const roomAnchor = (stop) => (stop.roomId
  ? { x: num(stop.rackX), y: num(stop.rackY) }
  : { x: 0, y: 0 });

// เทียบพิกัดแบบงูเลื้อย: แถวบนมาก่อน, ในแถวเดียวกันสลับทิศตามเลขแถว
const compareSerpentine = (a, b, bandHeight) => {
  const bandA = bandOf(a.y, bandHeight);
  const bandB = bandOf(b.y, bandHeight);
  if (bandA !== bandB) return bandA - bandB;
  return bandA % 2 === 0 ? a.x - b.x : b.x - a.x;
};

const compareStops = (a, b, bandHeight) => {
  const planDiff = num(a.planId) - num(b.planId);
  if (planDiff !== 0) return planDiff;

  const planDelta = compareSerpentine(planAnchor(a), planAnchor(b), bandHeight);
  if (planDelta !== 0) return planDelta;

  const roomDiff = num(a.roomId) - num(b.roomId);
  if (roomDiff !== 0) return roomDiff;

  const roomDelta = compareSerpentine(roomAnchor(a), roomAnchor(b), bandHeight);
  if (roomDelta !== 0) return roomDelta;

  const rackDiff = num(a.rackId) - num(b.rackId); // กันลำดับสลับไปมาเมื่อพิกัดเท่ากันเป๊ะ
  if (rackDiff !== 0) return rackDiff;
  return String(stopKeyOf(a)).localeCompare(String(stopKeyOf(b)));
};

/**
 * จัดลำดับรายการหยิบของ
 * @param {Array} items รายการสินค้า (ต้องมี rackId, roomId, planId, rackX/rackY, roomX/roomY, storageLevel, sku)
 * @returns {{ located: Array, unlocated: Array, stops: number }}
 *   located   = รายการที่รู้ตำแหน่ง เรียงตามเส้นทางเดิน พร้อมฟิลด์ order (เริ่มที่ 1) และ stop (ลำดับชั้นวาง)
 *   unlocated = รายการที่ยังไม่ระบุตำแหน่งจัดเก็บ (ไม่มี rackId)
 *   stops     = จำนวนชั้นวางที่ต้องแวะทั้งหมด
 */
export const buildPickRoute = (items = [], bandHeight = PICK_BAND_HEIGHT) => {
  const located = [];
  const unlocated = [];
  for (const item of items) {
    if (!item) continue;
    if (stopKeyOf(item)) located.push(item);
    else unlocated.push(item);
  }

  // ยุบเหลือ 1 หมุดต่อ 1 จุดแวะ แล้วเรียงหมุด — สินค้าที่จุดเดียวกันจะถูกหยิบพร้อมกันเสมอ
  const stops = new Map();
  for (const item of located) {
    const key = stopKeyOf(item);
    if (!stops.has(key)) stops.set(key, item);
  }
  const stopOrder = new Map(
    [...stops.entries()]
      .sort(([, a], [, b]) => compareStops(a, b, bandHeight))
      .map(([key], index) => [key, index + 1])
  );

  const ordered = [...located].sort((a, b) => {
    const stopDiff = stopOrder.get(stopKeyOf(a)) - stopOrder.get(stopKeyOf(b));
    if (stopDiff !== 0) return stopDiff;
    const levelDiff = num(a.storageLevel) - num(b.storageLevel); // ในชั้นเดียวกันไล่จากเลเวลล่างขึ้นบน
    if (levelDiff !== 0) return levelDiff;
    return String(a.sku || '').localeCompare(String(b.sku || ''));
  }).map((item, index) => ({ ...item, order: index + 1, stop: stopOrder.get(stopKeyOf(item)) }));

  return { located: ordered, unlocated, stops: stopOrder.size };
};

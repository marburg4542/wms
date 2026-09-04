// กติกาที่ข้อมูลต้องรักษาไว้เสมอ ไม่ว่าผู้ใช้จะกดอะไร
//
// ใช้ 2 ที่: เทสต์ (รันหลังจำลองการใช้งานจริง) และ tools/audit.mjs (รันกับฐานข้อมูลจริง)
// เขียนไว้ที่เดียวกันเพื่อไม่ให้ 2 ฝั่งตรวจคนละมาตรฐาน
export const INVARIANTS = [
  ['ยอดคงเหลือติดลบ',
    'SELECT item_id, stock_balance FROM warehouse_balance WHERE stock_balance < 0'],

  ['วางไว้เกินยอดคงเหลือ',
    `SELECT l.item_id, SUM(l.quantity) placed, COALESCE(wb.stock_balance, 0) stock
     FROM item_locations l LEFT JOIN warehouse_balance wb ON wb.item_id = l.item_id
     GROUP BY l.item_id HAVING placed > stock`],

  ['แถวตำแหน่งจำนวนติดลบ',
    'SELECT id, item_id, quantity FROM item_locations WHERE quantity < 0'],

  ['แถวตำแหน่งกำพร้า (สินค้าไม่มีอยู่จริง)',
    'SELECT l.id, l.item_id FROM item_locations l LEFT JOIN items i ON i.item_id = l.item_id WHERE i.item_id IS NULL'],

  ['ตำแหน่งชี้ชั้นวาง/ห้องที่ถูกลบไปแล้ว',
    `SELECT l.id, l.item_id FROM item_locations l
     LEFT JOIN storage_racks r ON r.id = l.rack_id LEFT JOIN rooms rm ON rm.id = l.room_id
     WHERE (l.rack_id IS NOT NULL AND (r.id IS NULL OR r.deleted_at IS NOT NULL))
        OR (l.room_id IS NOT NULL AND (rm.id IS NULL OR rm.deleted_at IS NOT NULL))`],

  ['ตำแหน่งหลักไม่ตรงกับผังคลังจริง',
    `SELECT i.item_id, i.rack_id, i.storage_level, i.primary_room_id FROM items i
     WHERE (i.rack_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM item_locations l
            WHERE l.item_id = i.item_id AND l.rack_id = i.rack_id
              AND IFNULL(l.storage_level, -1) = IFNULL(i.storage_level, -1)))
        OR (i.primary_room_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM item_locations l
            WHERE l.item_id = i.item_id AND l.room_id = i.primary_room_id))`],

  ['ตำแหน่งหลักชี้ทั้งชั้นวางและห้องพร้อมกัน',
    'SELECT item_id FROM items WHERE rack_id IS NOT NULL AND primary_room_id IS NOT NULL'],

  ['มีของวางอยู่แต่ตำแหน่งหลักว่าง',
    `SELECT i.item_id FROM items i WHERE i.rack_id IS NULL AND i.primary_room_id IS NULL
       AND EXISTS (SELECT 1 FROM item_locations l WHERE l.item_id = i.item_id AND l.quantity > 0)`],

  ['เลเวลเกินจำนวนชั้นของชั้นวางนั้น',
    `SELECT l.id, l.item_id, l.storage_level, r.levels FROM item_locations l
     JOIN storage_racks r ON r.id = l.rack_id WHERE l.storage_level > r.levels`],

  ['พื้นที่วางพื้นแต่มีของอยู่เลเวล 2 ขึ้นไป',
    `SELECT l.id, r.name FROM item_locations l JOIN storage_racks r ON r.id = l.rack_id
     WHERE r.is_floor = 1 AND l.storage_level > 1`],

  ['ของอยู่บนชั้นวางแต่ไม่ระบุเลเวล',
    `SELECT l.id, l.item_id, r.name FROM item_locations l
     JOIN storage_racks r ON r.id = l.rack_id AND r.deleted_at IS NULL WHERE l.storage_level IS NULL`],

  ['พื้นที่จัดเตรียมที่ยังเป็นห้อง (ต้องย้ายเป็นพื้นที่วางพื้นแล้ว)',
    'SELECT id, name FROM rooms WHERE is_staging = 1 AND deleted_at IS NULL'],

  ['ชั้นวางผูกโครงการที่ไม่มีอยู่จริง',
    `SELECT r.id, r.name FROM storage_racks r LEFT JOIN projects p ON p.id = r.project_id
     WHERE r.project_id IS NOT NULL AND p.id IS NULL`],

  ['ชั้นวางแบบมีเลเวลแต่ผูกโครงการ (ต้องเป็นพื้นที่วางพื้นเท่านั้น)',
    'SELECT id, name FROM storage_racks WHERE project_id IS NOT NULL AND is_floor = 0 AND deleted_at IS NULL'],

  ['อนุมัติเกินจำนวนที่ขอเบิก',
    'SELECT id, sku, requestedQty, approvedQty FROM wms_transaction_items WHERE approvedQty > requestedQty'],

  ['รายการในใบเบิกที่ไม่มีสินค้าในระบบ',
    `SELECT ti.id, ti.productId FROM wms_transaction_items ti
     LEFT JOIN items i ON i.item_id = ti.productId WHERE i.item_id IS NULL`],

  ['สินค้าไม่มี product_settings',
    'SELECT i.item_id FROM items i LEFT JOIN product_settings ps ON ps.item_id = i.item_id WHERE ps.item_id IS NULL'],

  ['ราคาต่อหน่วยติดลบ',
    'SELECT stock_in_id, item_id, unit_cost FROM stock_in WHERE unit_cost < 0'],

  ['แถวตำแหน่งซ้ำ (สินค้าเดียวกัน ที่เดียวกัน มากกว่า 1 แถว)',
    `SELECT item_id, COUNT(*) n FROM item_locations
     GROUP BY item_id, rack_id, IFNULL(storage_level, -1), IFNULL(room_id, -1) HAVING n > 1`],

  // ของชิ้นเดิมจะถูกส่งกลับได้ไม่เกินจำนวนที่รับไป ไม่งั้นสต็อกจะงอกจากอากาศ
  ['คืนของเกินจำนวนที่รับไป',
    `SELECT p.transactionId, ri.productId,
            SUM(ri.requestedQty) AS returned,
            (SELECT approvedQty FROM wms_transaction_items
              WHERE tx_id = p.id AND productId = ri.productId) AS pickedUp
     FROM wms_transactions rt
     JOIN wms_transactions p ON p.id = rt.parent_tx_id
     JOIN wms_transaction_items ri ON ri.tx_id = rt.id
     WHERE rt.type = 'RETURN'
     GROUP BY p.id, ri.productId
     HAVING returned > IFNULL(pickedUp, 0)`],

  ['ใบคืนของที่ไม่ได้ผูกกับใบเบิกต้นทาง',
    `SELECT id, transactionId FROM wms_transactions
     WHERE type = 'RETURN' AND parent_tx_id IS NULL`]
];

/** คืนรายการกติกาที่ถูกละเมิด พร้อมตัวอย่างแถวที่ผิด
 *
 * onUnsupported — ใส่มาเมื่อผู้เรียกยอมให้ข้ามกติกาที่ไฟล์นั้นรันไม่ได้ เพราะไม่มีตาราง/คอลัมน์
 * ที่กติกาอ้างถึง เกิดกับไฟล์สำรองที่ทำไว้ก่อนฟีเจอร์นั้นจะมี ซึ่ง tools/audit.mjs ต้องตรวจได้
 * ไม่งั้นวันที่ต้องกู้ข้อมูลจะไม่มีเครื่องมือบอกว่าสำเนาชุดไหนใช้ได้
 *
 * ไม่ใส่ = พังทันทีเหมือนเดิม ซึ่งถูกแล้วสำหรับฝั่งเทสต์ เพราะ DB ชั่วคราวสร้างใหม่ทุกครั้ง
 * schema ครบเสมอ กติกาที่รันไม่ได้จึงแปลว่าเขียนผิด ต้องเห็นทันที ไม่ใช่ถูกข้ามเงียบ ๆ
 *
 * ข้ามเฉพาะ "no such table/column" — syntax error ยังโยนต่อทั้งสองฝั่ง
 * ไม่งั้นกติกาที่พิมพ์ผิดจะไปโผล่ในรายงานว่า "ข้าม" แล้วไม่มีใครเอะใจ
 */
export const findViolations = (db, { onUnsupported } = {}) => {
  const violations = [];
  for (const [name, sql] of INVARIANTS) {
    let rows;
    try {
      rows = db.prepare(sql).all();
    } catch (err) {
      if (!onUnsupported || !/no such (table|column)/i.test(err.message)) throw err;
      onUnsupported(name, err.message);
      continue;
    }
    if (rows.length > 0) violations.push({ name, rows });
  }
  return violations;
};

// เปลี่ยนรหัสสินค้า (item_id) แล้วลากทุกตารางลูกที่อ้างถึงไปด้วย
//
// ทำไมต้องรวมไว้ที่เดียว: item_id เป็น primary key ที่หลายตารางอ้างถึงแบบ TEXT
// เมื่อก่อนมีรายชื่อตารางกระจายอยู่ 2 ที่ (จัดเรียงรหัสใหม่ / เปลี่ยน SKU ในหน้าสินค้า)
// พอเพิ่มตาราง item_locations เข้ามาทีหลัง มีที่หนึ่งลืมใส่ ตำแหน่งจัดเก็บเลยค้างอยู่กับรหัสเก่า
// แล้วไปสวมให้สินค้าตัวอื่นที่มารับรหัสนั้นต่อ — ตรวจไม่เจอเพราะตอนเปลี่ยนรหัสต้องปิด FK ไว้
//
// เพิ่มตารางใหม่ที่มีคอลัมน์ item_id/productId/sku เมื่อไร ต้องมาเพิ่มที่นี่ด้วย
// (มีเทสต์ที่ไล่ดู schema จริงแล้วฟ้องถ้าลืม — server/test/skuRetarget.test.js)
export const SKU_CHILD_TABLES = [
  { table: 'stock_in', column: 'item_id' },
  { table: 'stock_out', column: 'item_id' },
  { table: 'product_settings', column: 'item_id' },
  { table: 'item_locations', column: 'item_id' },
  { table: 'wms_transaction_items', column: 'productId' },
  { table: 'wms_transaction_items', column: 'sku' }
];

/**
 * ย้ายรหัสสินค้าจาก fromSku ไป toSku ทั้งตารางหลักและตารางลูกทุกตาราง
 * ผู้เรียกต้องครอบ transaction เอง (และปิด foreign_keys ถ้ารหัสปลายทางยังชนกันระหว่างทาง)
 * @param {object} db  better-sqlite3 database
 * @param {string} fromSku
 * @param {string} toSku
 * @param {string|null} seq  ค่า item_seq ใหม่ (ไม่ส่งมา = ไม่แตะ)
 */
export const retargetSku = (db, fromSku, toSku, seq = null) => {
  if (seq == null) db.prepare('UPDATE items SET item_id = ? WHERE item_id = ?').run(toSku, fromSku);
  else db.prepare('UPDATE items SET item_id = ?, item_seq = ? WHERE item_id = ?').run(toSku, seq, fromSku);

  for (const { table, column } of SKU_CHILD_TABLES) {
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(toSku, fromSku);
  }
};

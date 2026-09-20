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
 *
 * ⚠️ ผู้เรียกต้องปิด foreign_keys **ก่อนเปิด transaction** เสมอ — items.item_id เป็น primary key
 * ที่ตารางลูกอ้างถึง พอเปลี่ยนค่าในตารางหลัก แถวลูกจะกลายเป็นกำพร้าชั่วขณะแล้วโดน FK ตีตก
 * (สั่ง pragma ตอนอยู่ใน transaction แล้ว SQLite จะเมินเงียบๆ เหมือนไม่ได้สั่ง — ต้องสั่งข้างนอก)
 *
 * @param {object} db  better-sqlite3 database
 * @param {string} fromSku
 * @param {string} toSku
 * @param {string|null} seq  ค่า item_seq ใหม่ (ไม่ส่งมา = ไม่แตะ)
 * @param {{id: string, name?: string}|null} group  ย้ายหมวดด้วย — อัปเดต items.group_id
 *        และชื่อหมวดที่ snapshot ไว้ในใบเบิกเก่าให้ตรงกัน (ไม่ส่งมา = เปลี่ยนแค่รหัส ไม่แตะหมวด)
 */
export const retargetSku = (db, fromSku, toSku, seq = null, group = null) => {
  const sets = ['item_id = @toSku'];
  const params = { fromSku, toSku };
  if (seq != null) { sets.push('item_seq = @seq'); params.seq = seq; }
  if (group) { sets.push('group_id = @groupId'); params.groupId = group.id; }
  db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE item_id = @fromSku`).run(params);

  for (const { table, column } of SKU_CHILD_TABLES) {
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(toSku, fromSku);
  }

  // ต้องอยู่หลังลูปข้างบนจบแล้วเท่านั้น — ใบเบิกถูกหาด้วยรหัสใหม่ ถ้าทำก่อนจะยังหาแถวไม่เจอ
  // (ชื่อหมวดใน snapshot อัปเดตเฉพาะตอนส่ง name มา ไม่งั้นจะไปล้างชื่อเดิมทิ้งเป็นค่าว่าง)
  if (group) {
    if (group.name != null) {
      db.prepare('UPDATE wms_transaction_items SET groupId = ?, groupName = ? WHERE productId = ?')
        .run(group.id, group.name, toSku);
    } else {
      db.prepare('UPDATE wms_transaction_items SET groupId = ? WHERE productId = ?').run(group.id, toSku);
    }
  }
};

/**
 * เลือกรหัสใหม่ให้สินค้าที่ย้ายไปอยู่หมวดอื่น
 *
 * เก็บเลขลำดับเดิมไว้ถ้าหมวดปลายทางยังไม่มีใครใช้เลขนั้น — ของชิ้นเดิมจะได้จำง่ายขึ้น
 * (02003 → 05003) ถ้าเลขนั้นถูกจองแล้วค่อยต่อคิวท้ายสุดของหมวดปลายทาง
 *
 * กติกา "เก็บเลขเดิมถ้าว่าง" ใช้ได้เฉพาะการย้ายทีละตัวเท่านั้น — ตอนยุบหมวดทั้งก้อน
 * ต้องต่อคิวท้ายสุดเสมอ เพราะสินค้าหลายตัวจากหมวดต้นทางมีสิทธิ์ชนเลขเดียวกันที่ปลายทาง
 *
 * @returns {{sku: string, seq: string}|null}  null = หมวดปลายทางเต็มเพดานเลขรัน 3 หลักแล้ว
 */
export const planSkuForGroup = (db, { itemSeq, groupId }) => {
  const taken = (sku) => Boolean(db.prepare('SELECT 1 FROM items WHERE item_id = ?').get(sku));

  // ต้องเป็นตัวเลข 1-999 จริงๆ ถึงจะรักษาเลขเดิมได้ — ข้อมูลเก่าบางแถวเลขลำดับว่างหรือเพี้ยน
  // ถ้าเผลอเติมศูนย์ให้ค่าว่างจะกลายเป็นรหัสลงท้าย 000 ซึ่งไม่ใช่เลขที่ระบบออกให้ใครเลย
  const raw = String(itemSeq ?? '').trim();
  const keepSeq = /^\d{1,3}$/.test(raw) && Number(raw) >= 1 ? raw.padStart(3, '0') : null;
  if (keepSeq && !taken(`${groupId}${keepSeq}`)) {
    return { sku: `${groupId}${keepSeq}`, seq: keepSeq };
  }

  const max = db.prepare('SELECT MAX(CAST(item_seq AS INTEGER)) AS mx FROM items WHERE group_id = ?').get(groupId)?.mx || 0;
  const next = max + 1;
  if (next > 999) return null;   // เพดานเลขรัน 3 หลัก — ผู้เรียกต้องบอกผู้ใช้ ไม่ใช่เขียนรหัส 4 หลักลงไปเงียบๆ
  const seq = String(next).padStart(3, '0');
  return { sku: `${groupId}${seq}`, seq };
};

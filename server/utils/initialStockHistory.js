// สต็อกตั้งต้นตอนเพิ่มสินค้าใหม่ ต้องขึ้นเป็นใบ "รับเข้า" ในประวัติด้วย
//
// เดิม createProduct เขียนแค่ stock_in ยอดคงเหลือจึงถูก แต่หน้าประวัติการทำรายการและรายงาน PDF
// อ่านจาก wms_transactions อย่างเดียว ของที่เข้าคลังพร้อมสินค้าใหม่เลยหายไปจากประวัติทั้งหมด
// (เจอ 209 รายการช่วง 16 ก.ค. – 27 ส.ค. 2026 — เติมย้อนหลังด้วย tools/backfill-initial-stock-history.mjs)
//
// ตัวเชื่อม stock_in ↔ ใบรับเข้า = รหัสสินค้า + เวลาเดียวกัน (input_date = requestDate) + ป้ายโปรเจกต์นี้
// ตอนสร้างจริงกับตอนเติมย้อนหลังใช้กติกาเดียวกัน จึงรันเติมซ้ำได้โดยไม่เกิดใบซ้ำ

export const INITIAL_STOCK_NOTE = 'Initial stock';   // ค่า stock_in.note เดิม — ประวัติราคาต่อ lot อ่านค่านี้อยู่ ห้ามเปลี่ยน
export const INITIAL_STOCK_LABEL = 'สต็อกตั้งต้น (เพิ่มสินค้าใหม่)';

/** สร้างใบรับเข้าคู่กับ stock_in ของสต็อกตั้งต้น — ผู้เรียกต้องครอบ transaction เอง */
export const recordInitialStockHistory = (db, {
  transactionId, sku, productName, imageUrl = '', groupId = null, groupName = null, quantity, date, username = null
}) => {
  const tx = db.prepare(`
    INSERT INTO wms_transactions (transactionId, type, requesterUsername, project, status, requestDate, resolvedDate, adminUsername)
    VALUES (?, 'INBOUND', ?, ?, 'Approved', ?, ?, ?)
  `).run(transactionId, username, INITIAL_STOCK_LABEL, date, date, username);

  // snapshot หมวดหมู่ไว้ในใบ ประวัติจะคงชื่อหมวดเดิมแม้ลบสินค้าถาวรภายหลัง
  db.prepare(`
    INSERT INTO wms_transaction_items (tx_id, productId, sku, productName, imageUrl, groupId, groupName, requestedQty, approvedQty, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved')
  `).run(tx.lastInsertRowid, sku, sku, productName, imageUrl || '', groupId, groupName, quantity, quantity);
};

/**
 * หาสต็อกตั้งต้นที่ยังไม่มีใบรับเข้า แล้ว (ถ้า apply) สร้างให้ครบในทรานแซกชันเดียว
 * ใช้เวลาเดิมของ stock_in เป็นวันที่ของใบ รายงานย้อนหลังจึงลงเดือนที่ของเข้าคลังจริง
 * @returns {{ rows: Array<object>, applied: boolean }}
 */
export const backfillInitialStockHistory = (db, { apply = false } = {}) => {
  const missing = db.prepare(`
    SELECT s.stock_in_id AS stockInId, s.item_id AS sku, s.quantity, s.input_date AS date,
           i.item_name AS name, COALESCE(ps.image_url, '') AS imageUrl,
           i.group_id AS groupId, g.group_name AS groupName
    FROM stock_in s
    JOIN items i ON i.item_id = s.item_id
    LEFT JOIN product_settings ps ON ps.item_id = s.item_id
    LEFT JOIN item_groups g ON g.group_id = i.group_id
    WHERE s.note = @note AND s.input_date IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM wms_transactions t
        JOIN wms_transaction_items ti ON ti.tx_id = t.id
        WHERE t.type = 'INBOUND' AND t.project = @label
          AND ti.productId = s.item_id AND t.requestDate = s.input_date
      )
    ORDER BY s.input_date ASC, s.stock_in_id ASC
  `).all({ note: INITIAL_STOCK_NOTE, label: INITIAL_STOCK_LABEL });

  // หาว่าใครเป็นคนเพิ่มสินค้า จาก audit log ที่บันทึกในทรานแซกชันเดียวกัน (ห่างกันไม่ถึงวินาที)
  // ต้องมีอย่างน้อยหนึ่งอย่างตรงกันด้วย: รหัส / ชื่อ / จำนวนสต็อกตั้งต้น
  // รหัสกับชื่อเชื่อไม่ได้อย่างเดียว — ข้อมูลจริงถูกจัดเรียงรหัสใหม่และแก้คำผิดในชื่อภายหลังไปแล้ว 22 ตัว
  // แต่จำนวนสต็อกตั้งต้นใน audit ไม่เคยถูกแก้ ส่วนการเพิ่มสินค้าสองตัวห่างกันน้อยสุดที่เจอคือ 25 วินาที
  const findActor = db.prepare(`
    SELECT actor_username AS actor FROM audit_logs
    WHERE action = 'product.create' AND actor_username IS NOT NULL
      AND ABS(julianday(created_at) - julianday(@date)) * 86400 <= 2
      AND (
        entity_id = @sku
        OR CASE WHEN json_valid(details) THEN json_extract(details, '$.name') END = @name
        OR CASE WHEN json_valid(details) THEN json_extract(details, '$.initialStock') END = @quantity
      )
    ORDER BY ABS(julianday(created_at) - julianday(@date))
    LIMIT 1
  `);
  const idTaken = db.prepare('SELECT 1 FROM wms_transactions WHERE transactionId = ?');
  const used = new Set();

  const rows = missing.map((row) => {
    let stamp = Date.parse(row.date);
    let transactionId = `INB-${stamp}`;
    while (used.has(transactionId) || idTaken.get(transactionId)) {
      stamp += 1;
      transactionId = `INB-${stamp}`;
    }
    used.add(transactionId);
    const actor = findActor.get({ date: row.date, sku: row.sku, name: row.name, quantity: row.quantity })?.actor || 'system';
    return { ...row, transactionId, actor };
  });

  if (apply && rows.length > 0) {
    db.transaction(() => {
      for (const row of rows) {
        recordInitialStockHistory(db, {
          transactionId: row.transactionId, sku: row.sku, productName: row.name, imageUrl: row.imageUrl,
          groupId: row.groupId, groupName: row.groupName, quantity: row.quantity, date: row.date, username: row.actor
        });
      }
      db.prepare(`
        INSERT INTO audit_logs (actor_username, action, entity_type, entity_id, details)
        VALUES ('system', 'transaction.backfill_initial_stock', 'transaction', NULL, ?)
      `).run(JSON.stringify({ count: rows.length, from: rows[0].date, to: rows[rows.length - 1].date }));
    })();
  }

  return { rows, applied: apply && rows.length > 0 };
};

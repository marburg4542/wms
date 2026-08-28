import db, { logAudit } from '../db.js';
import { broadcast } from '../events.js';
import { buildPickRoute } from '../utils/pickRoute.js';
import { getItemLocations, LocationError, moveQuantity, setLocationQuantity } from '../utils/itemLocations.js';

// ผูกสินค้าเข้ากับตำแหน่งจัดเก็บ (ชั้นวาง + เลเวล) และดึงรายการหยิบของตามใบเบิก
// ตำแหน่งเก็บอยู่บน items.rack_id / items.storage_level จึงเป็นค่าสดเสมอ ไม่ใช่ snapshot

// ใบเบิก 1 ใบ → รายการสินค้าพร้อมตำแหน่งจัดเก็บ เรียงตามเส้นทางเดินหยิบ
export const getPickList = (req, res) => {
  try {
    const key = String(req.params.txId || '').trim();
    // Homepage ส่งมาได้ทั้งเลข id ภายใน และรหัสใบเบิก REQ-xxxx
    const tx = db.prepare(`
      SELECT id, transactionId, type, status, project, requesterUsername, requestDate, pickedUpAt
      FROM wms_transactions WHERE transactionId = ? OR CAST(id AS TEXT) = ?
    `).get(key, key);
    if (!tx) return res.status(404).json({ success: false, message: 'ไม่พบใบเบิก' });

    // อ่านจาก item_locations ทุกแถว ไม่ใช่ items.rack_id ที่เก็บได้ที่เดียว
    // สินค้าที่วางหลายที่จะได้ 1 แถวต่อ 1 ตำแหน่ง คนหยิบจะได้รู้ว่าต้องแวะที่ไหนบ้าง อย่างละกี่ชิ้น
    const rows = db.prepare(`
      SELECT
        ti.productId, ti.sku, ti.productName AS name, ti.requestedQty, ti.approvedQty,
        COALESCE(NULLIF(ti.imageUrl, ''), ps.image_url, '') AS imageUrl,
        l.id AS locationId, l.quantity AS qtyHere,
        l.rack_id AS rackId, r.name AS rackName, l.storage_level AS storageLevel,
        COALESCE(r.room_id, l.room_id) AS roomId,
        COALESCE(rmRack.name, rmDirect.name) AS roomName,
        COALESCE(r.plan_id, rmRack.plan_id, rmDirect.plan_id) AS planId,
        fp.name AS planName,
        r.pos_x AS rackX, r.pos_y AS rackY,
        COALESCE(rmRack.pos_x, rmDirect.pos_x) AS roomX,
        COALESCE(rmRack.pos_y, rmDirect.pos_y) AS roomY,
        COALESCE(wb.stock_balance, 0) AS stock
      FROM wms_transaction_items ti
      LEFT JOIN item_locations l ON l.item_id = ti.productId AND l.quantity > 0
      LEFT JOIN storage_racks r ON r.id = l.rack_id AND r.deleted_at IS NULL
      LEFT JOIN rooms rmRack ON rmRack.id = r.room_id AND rmRack.deleted_at IS NULL
      LEFT JOIN rooms rmDirect ON rmDirect.id = l.room_id AND rmDirect.deleted_at IS NULL
      LEFT JOIN floor_plans fp ON fp.id = COALESCE(r.plan_id, rmRack.plan_id, rmDirect.plan_id)
      LEFT JOIN product_settings ps ON ps.item_id = ti.productId
      LEFT JOIN warehouse_balance wb ON wb.item_id = ti.productId
      WHERE ti.tx_id = ?
      ORDER BY ti.id ASC
    `).all(tx.id);

    const { located, unlocated, stops } = buildPickRoute(rows);
    // key ไม่ซ้ำต่อ 1 จุดหยิบ — สินค้าตัวเดียวที่อยู่ 2 ที่ต้องติ๊กแยกกันได้
    const withKey = located.map((row) => ({ ...row, pickKey: `${row.sku}@${row.locationId}` }));
    res.json({ success: true, transaction: tx, items: withKey, unlocated, stops });
  } catch (err) {
    console.error('getPickList error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// สินค้าที่ยัง "วางไม่ครบ" — มีของในคลังมากกว่าที่ระบุตำแหน่งไว้ (รวมพวกที่ยังไม่วางเลย)
export const listUnassignedItems = (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '50', 10), 1), 200);
    const where = ["COALESCE(ps.is_active, 1) = 1", "COALESCE(wb.stock_balance, 0) > COALESCE(loc.placed, 0)"];
    const params = { limit };
    if (search) {
      // single quote เท่านั้น — better-sqlite3 ตีความ double quote เป็นชื่อคอลัมน์
      where.push("(LOWER(i.item_id) LIKE @search OR LOWER(i.item_name) LIKE @search)");
      params.search = `%${search}%`;
    }
    const whereSql = where.join(' AND ');
    const fromSql = `
      FROM items i
      LEFT JOIN product_settings ps ON ps.item_id = i.item_id
      LEFT JOIN warehouse_balance wb ON wb.item_id = i.item_id
      LEFT JOIN (SELECT item_id, SUM(quantity) AS placed FROM item_locations GROUP BY item_id) loc ON loc.item_id = i.item_id
    `;

    const total = db.prepare(`SELECT COUNT(*) AS count ${fromSql} WHERE ${whereSql}`).get(params).count;
    const items = db.prepare(`
      SELECT i.item_id AS sku, i.item_name AS name, i.group_id AS groupId,
             wb.group_name AS groupName, COALESCE(ps.image_url, '') AS imageUrl,
             COALESCE(wb.stock_balance, 0) AS stock,
             COALESCE(loc.placed, 0) AS placed,
             COALESCE(wb.stock_balance, 0) - COALESCE(loc.placed, 0) AS unplaced
      ${fromSql}
      WHERE ${whereSql}
      ORDER BY i.item_name COLLATE NOCASE ASC
      LIMIT @limit
    `).all(params);

    res.json({ success: true, items, total });
  } catch (err) {
    console.error('listUnassignedItems error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// ยอดรวมที่ตำแหน่งนั้นหลังบันทึก (ใช้ประกอบข้อความตอบกลับ)
const placedHere = (result, body) => {
  const match = result.locations.find((loc) => (body?.rackId
    ? Number(loc.rackId) === Number(body.rackId) && String(loc.storageLevel ?? '') === String(body.level ?? '')
    : Number(loc.roomId) === Number(body?.roomId)));
  return Number(match?.quantity ?? 0);
};

// กำหนดจำนวนสินค้าที่ตำแหน่งหนึ่ง (Admin/Manager)
// quantity = 0 → เอาสินค้าออกจากตำแหน่งนั้น | ไม่ส่ง quantity มา → ใส่เท่าที่ยังไม่ได้ระบุตำแหน่งทั้งหมด
export const assignItemLocation = (req, res) => {
  try {
    const sku = String(req.body?.sku || '').trim();
    const clearing = req.body?.rackId == null && req.body?.roomId == null;

    // ถอนออกจากทุกตำแหน่ง (ใช้กับปุ่มถังขยะเดิม)
    if (clearing) {
      if (!db.prepare('SELECT item_id FROM items WHERE item_id = ?').get(sku)) {
        return res.status(404).json({ success: false, message: `ไม่พบสินค้ารหัส ${sku}` });
      }
      db.transaction(() => {
        db.prepare('DELETE FROM item_locations WHERE item_id = ?').run(sku);
        db.prepare('UPDATE items SET rack_id = NULL, storage_level = NULL WHERE item_id = ?').run(sku);
      })();
      logAudit(req.user?.username, 'storage.item_unassign', 'product', sku, {});
      broadcast('products');
      return res.json({ success: true, message: `ถอน ${sku} ออกจากตำแหน่งจัดเก็บแล้ว`, sku });
    }

    // ไม่ระบุจำนวน = ใส่ของที่ยังไม่ได้ระบุตำแหน่งทั้งหมดลงที่นี่
    let quantity = req.body?.quantity;
    if (quantity == null || quantity === '') {
      const current = getItemLocations(db, sku);
      quantity = Math.max(0, current.unplaced);
      if (quantity === 0) {
        return res.status(400).json({
          success: false,
          message: `${sku} ระบุตำแหน่งครบทุกชิ้นแล้ว (มีของ ${current.stock} วางไว้แล้ว ${current.placed}) — ถ้าต้องการย้าย ให้ระบุจำนวน`
        });
      }
    }

    // mode 'add' = เติมเข้าของเดิมที่ตำแหน่งนั้น (ปุ่ม "เพิ่มสินค้า")
    // ไม่ส่งมา = 'set' คือตั้งจำนวนใหม่ทับของเดิม (ช่องกรอกตัวเลขในตาราง)
    const mode = req.body?.mode === 'add' ? 'add' : 'set';
    const result = setLocationQuantity(db, {
      itemId: sku,
      rackId: req.body?.rackId ?? null,
      storageLevel: req.body?.level ?? null,
      roomId: req.body?.roomId ?? null,
      quantity,
      mode,
      createdBy: req.user?.username
    });

    // จำนวน 0 = เอาของออกจากตำแหน่งนั้น ไม่ใช่การวางของ — แยก action ให้ประวัติอ่านรู้เรื่อง
    logAudit(req.user?.username, Number(quantity) === 0 ? 'storage.item_unassign' : 'storage.item_assign', 'product', sku, {
      rackId: req.body?.rackId ?? null, roomId: req.body?.roomId ?? null, level: req.body?.level ?? null, quantity
    });
    broadcast('products');

    const where = req.body?.rackId
      ? db.prepare('SELECT name FROM storage_racks WHERE id = ?').get(Number(req.body.rackId))?.name
      : db.prepare('SELECT name FROM rooms WHERE id = ?').get(Number(req.body.roomId))?.name;
    res.json({
      success: true,
      message: Number(quantity) === 0
        ? `เอา ${sku} ออกจาก ${where} แล้ว`
        : `${mode === 'add' ? 'เติม' : 'เก็บ'} ${sku} จำนวน ${quantity} ที่ ${where}${req.body?.level ? ` เลเวล ${req.body.level}` : ''}`
          + (mode === 'add' ? ` (รวมเป็น ${placedHere(result, req.body)})` : ''),
      sku, ...result
    });
  } catch (err) {
    if (err instanceof LocationError) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('assignItemLocation error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// ตำแหน่งทั้งหมดของสินค้า 1 ตัว + ส่วนที่ยังไม่ได้ระบุตำแหน่ง
export const getLocationsOfItem = (req, res) => {
  try {
    const sku = String(req.params.sku || '').trim();
    if (!db.prepare('SELECT item_id FROM items WHERE item_id = ?').get(sku)) {
      return res.status(404).json({ success: false, message: `ไม่พบสินค้ารหัส ${sku}` });
    }
    res.json({ success: true, sku, ...getItemLocations(db, sku) });
  } catch (err) {
    console.error('getLocationsOfItem error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// ย้ายของบางส่วนจากตำแหน่งหนึ่งไปอีกตำแหน่ง (Admin/Manager)
export const moveItemQuantity = (req, res) => {
  try {
    const sku = String(req.body?.sku || '').trim();
    const result = moveQuantity(db, {
      itemId: sku,
      from: req.body?.from || {},
      to: req.body?.to || {},
      quantity: req.body?.quantity,
      createdBy: req.user?.username
    });
    logAudit(req.user?.username, 'storage.item_move_qty', 'product', sku, {
      from: req.body?.from, to: req.body?.to, quantity: req.body?.quantity
    });
    broadcast('products');
    res.json({ success: true, message: `ย้าย ${sku} จำนวน ${req.body?.quantity} เรียบร้อย`, sku, ...result });
  } catch (err) {
    if (err instanceof LocationError) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('moveItemQuantity error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// จัดการตำแหน่งจัดเก็บแบบหลายที่ต่อสินค้า 1 ตัว
//
// กติกาสำคัญ: ยอดคงเหลือจริงมาจาก stock_in − stock_out (view warehouse_balance) เท่านั้น
// ตารางนี้เป็นแค่ "การกระจายของ" ว่ายอดนั้นวางอยู่ที่ไหนบ้าง จึงบังคับว่า
//     ผลรวมทุกตำแหน่ง ≤ ยอดคงเหลือจริง
// ส่วนที่เหลือ (ยอดคงเหลือ − ผลรวมที่วางไว้) = ของที่ยังไม่ได้ระบุตำแหน่ง
// ทำแบบนี้เพื่อให้ผังคลังไม่มีทางทำให้บัญชีสต็อกเพี้ยน

export class LocationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const asQty = (value, label = 'จำนวน') => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new LocationError(`${label}ต้องเป็นตัวเลขไม่ติดลบ`);
  return parsed;
};

export const getStockBalance = (db, itemId) => {
  const row = db.prepare('SELECT stock_balance FROM warehouse_balance WHERE item_id = ?').get(String(itemId));
  return Number(row?.stock_balance || 0);
};

// ผลรวมของที่วางไว้ตามตำแหน่งต่างๆ (ข้ามแถวที่กำลังจะแก้ได้ด้วย excludeId)
export const getPlacedTotal = (db, itemId, { excludeId = null } = {}) => {
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS total FROM item_locations
    WHERE item_id = ? AND (@excludeId IS NULL OR id != @excludeId)
  `).get(String(itemId), { excludeId });
  return Number(row?.total || 0);
};

// สรุปตำแหน่งทั้งหมดของสินค้า 1 ตัว + ส่วนที่ยังไม่ได้ระบุตำแหน่ง
export const getItemLocations = (db, itemId) => {
  const locations = db.prepare(`
    SELECT l.id, l.rack_id AS rackId, l.storage_level AS storageLevel, l.room_id AS roomId,
           l.quantity, l.note,
           r.name AS rackName, rm.name AS roomName,
           COALESCE(rr.name, rm.name) AS areaName
    FROM item_locations l
    LEFT JOIN storage_racks r ON r.id = l.rack_id AND r.deleted_at IS NULL
    LEFT JOIN rooms rr ON rr.id = r.room_id AND rr.deleted_at IS NULL
    LEFT JOIN rooms rm ON rm.id = l.room_id AND rm.deleted_at IS NULL
    WHERE l.item_id = ?
    ORDER BY l.quantity DESC, l.id ASC
  `).all(String(itemId));
  const stock = getStockBalance(db, itemId);
  const placed = locations.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  return { locations, stock, placed, unplaced: stock - placed };
};

// items.rack_id/storage_level/primary_room_id = "ตำแหน่งหลัก" ที่ derive จากตำแหน่งที่มีของมากสุด
// เก็บไว้เพื่อให้หน้าจอ/รายงานเดิมที่อ่านคอลัมน์นี้ยังทำงานได้ โดยมีจุดเขียนที่เดียวคือฟังก์ชันนี้
// ตำแหน่งหลักเป็นได้ทั้งชั้นวางและห้อง/โซน — ถ้าเก็บได้แต่ชั้นวาง ของที่อยู่ในโซนจัดเตรียม
// จะกลายเป็น "ไม่รู้ว่าอยู่ไหน" บนการ์ดสินค้า ทั้งที่ผังคลังรู้ดี
export const syncPrimaryLocation = (db, itemId) => {
  const primary = db.prepare(`
    SELECT rack_id, storage_level, room_id FROM item_locations
    WHERE item_id = ?
    ORDER BY quantity DESC, (rack_id IS NULL), id ASC LIMIT 1
  `).get(String(itemId));
  db.prepare('UPDATE items SET rack_id = ?, storage_level = ?, primary_room_id = ? WHERE item_id = ?')
    .run(primary?.rack_id ?? null, primary?.storage_level ?? null, primary?.room_id ?? null, String(itemId));
  return primary || null;
};

/**
 * กำหนดจำนวนของสินค้าที่ตำแหน่งหนึ่ง
 * ระบุ rackId (พร้อม level ถ้ามี) หรือ roomId อย่างใดอย่างหนึ่ง
 *
 * mode = 'set'  (ค่าเริ่มต้น) → quantity คือจำนวนใหม่ทั้งหมดของตำแหน่งนั้น (ตั้งเป็น 0 = เอาออก)
 *                               ใช้ตอนผู้ใช้แก้ตัวเลขในตารางโดยตรง
 * mode = 'add'                → บวก quantity เพิ่มจากที่มีอยู่เดิม
 *                               ใช้ตอนกด "เพิ่มสินค้าเข้าที่นี่" — ถ้าใช้ set จะไปทับของเดิมที่วางอยู่
 *
 * ceiling = เพดานยอดวางรวมที่ยอมรับได้ (ไม่ส่งมา = ใช้ยอดวางรวม ณ ตอนนี้)
 *           ผู้เรียกที่ลดยอดต้นทางไปก่อนแล้ว (เช่น moveQuantity) ต้องส่งยอดก่อนเริ่มมาด้วย
 */
export const setLocationQuantity = (db, { itemId, rackId = null, storageLevel = null, roomId = null, quantity, mode = 'set', ceiling = null, note = null, createdBy = null }) => {
  const sku = String(itemId || '').trim();
  if (!sku) throw new LocationError('กรุณาระบุรหัสสินค้า');
  if (!db.prepare('SELECT item_id FROM items WHERE item_id = ?').get(sku)) {
    throw new LocationError(`ไม่พบสินค้ารหัส ${sku}`, 404);
  }

  const hasRack = rackId != null && rackId !== '';
  const hasRoom = roomId != null && roomId !== '';
  if (hasRack === hasRoom) throw new LocationError('ต้องระบุชั้นวางหรือพื้นที่อย่างใดอย่างหนึ่ง');

  const qty = asQty(quantity);
  let level = null;
  let existing;

  if (hasRack) {
    const rack = db.prepare('SELECT id, name, levels FROM storage_racks WHERE id = ? AND deleted_at IS NULL').get(Number(rackId));
    if (!rack) throw new LocationError('ไม่พบชั้นวาง', 404);
    if (storageLevel != null && storageLevel !== '') {
      level = Number.parseInt(storageLevel, 10);
      if (!Number.isInteger(level) || level < 1 || level > rack.levels) {
        throw new LocationError(`เลเวลต้องอยู่ระหว่าง 1 ถึง ${rack.levels}`);
      }
    }
    existing = db.prepare(
      'SELECT id, quantity FROM item_locations WHERE item_id = ? AND rack_id = ? AND IFNULL(storage_level, -1) = IFNULL(?, -1)'
    ).get(sku, rack.id, level);
  } else {
    const room = db.prepare('SELECT id, name FROM rooms WHERE id = ? AND deleted_at IS NULL').get(Number(roomId));
    if (!room) throw new LocationError('ไม่พบพื้นที่จัดเก็บ', 404);
    existing = db.prepare('SELECT id, quantity FROM item_locations WHERE item_id = ? AND room_id = ?').get(sku, room.id);
  }

  // mode 'add' = บวกจากของเดิมที่ตำแหน่งนี้ ไม่ใช่เขียนทับ
  const finalQty = mode === 'add' ? Number(existing?.quantity || 0) + qty : qty;

  // ห้ามทำให้ยอดวางรวม "เกินยอดคงเหลือมากขึ้น" — ผังคลังต้องไม่ทำให้บัญชีสต็อกเพี้ยน
  //
  // ทำไมไม่ใช่ "ห้ามเกินยอดคงเหลือ" เฉยๆ: ถ้าข้อมูลเก่าวางเกินอยู่แล้ว กฎแบบนั้นจะล็อกตาย
  // ย้ายของก็ไม่ได้ แก้ตัวเลขก็ไม่ได้ ทั้งที่การกระทำนั้นไม่ได้ทำให้แย่ลงเลย เหลือทางเดียวคือลบทิ้ง
  // กฎนี้จึงยอมให้ "เท่าเดิมหรือดีขึ้น" ผ่านได้ แต่ยังกันการเพิ่มของเกินยอดคงเหลือเหมือนเดิม
  const stock = getStockBalance(db, sku);
  const others = getPlacedTotal(db, sku, { excludeId: existing?.id ?? null });
  const before = ceiling == null ? getPlacedTotal(db, sku) : Number(ceiling);
  const allowedTotal = Math.max(stock, before);
  if (others + finalQty > allowedTotal) {
    const room = Math.max(0, allowedTotal - others);
    throw new LocationError(
      allowedTotal > stock
        ? `วางเกินยอดคงเหลือ — ${sku} มีของ ${stock} แต่ระบบบันทึกว่าวางไว้แล้ว ${before} (เกินอยู่ก่อนแล้ว) จึงวางที่นี่ได้ไม่เกิน ${room} จนกว่าจะแก้ยอดให้ตรง`
        : `วางเกินยอดคงเหลือ — ${sku} มีของ ${stock} วางไว้ที่อื่นแล้ว ${others} จึงวางที่นี่ได้ไม่เกิน ${room}`
    );
  }

  if (existing) {
    if (finalQty === 0) db.prepare('DELETE FROM item_locations WHERE id = ?').run(existing.id);
    else db.prepare("UPDATE item_locations SET quantity = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(finalQty, note, existing.id);
  } else if (finalQty > 0) {
    db.prepare(`
      INSERT INTO item_locations (item_id, rack_id, storage_level, room_id, quantity, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sku, hasRack ? Number(rackId) : null, level, hasRoom ? Number(roomId) : null, finalQty, note, createdBy);
  }

  syncPrimaryLocation(db, sku);
  return getItemLocations(db, sku);
};

// ย้ายของจากตำแหน่งหนึ่งไปอีกตำแหน่ง (ใช้ตอนจัดผังใหม่ / แยกของไปโซนจัดเตรียม)
export const moveQuantity = (db, { itemId, from, to, quantity, createdBy = null }) => {
  const qty = asQty(quantity, 'จำนวนที่ย้าย');
  if (qty === 0) throw new LocationError('จำนวนที่ย้ายต้องมากกว่า 0');

  const sku = String(itemId || '').trim();
  const source = from?.rackId != null
    ? db.prepare('SELECT * FROM item_locations WHERE item_id = ? AND rack_id = ? AND IFNULL(storage_level,-1) = IFNULL(?,-1)')
      .get(sku, Number(from.rackId), from.storageLevel ?? null)
    : db.prepare('SELECT * FROM item_locations WHERE item_id = ? AND room_id = ?').get(sku, Number(from?.roomId));
  if (!source) throw new LocationError('ไม่พบสินค้าที่ตำแหน่งต้นทาง', 404);
  if (Number(source.quantity) < qty) {
    throw new LocationError(`ตำแหน่งต้นทางมีของ ${source.quantity} ย้ายได้ไม่เกินนี้`);
  }

  // ยอดวางรวมก่อนเริ่มย้าย — ใช้เป็นเพดานตอนเขียนปลายทาง เพราะการย้ายไม่ได้ทำให้ยอดรวมเพิ่ม
  // (ถ้าไม่ส่งไป ปลายทางจะเห็นยอดที่ลดไปแล้วเป็นเพดาน แล้วบล็อกการย้ายของที่เกินอยู่ก่อน)
  const totalBefore = getPlacedTotal(db, sku);

  const run = db.transaction(() => {
    // ลดต้นทางก่อนแล้วค่อยเพิ่มปลายทาง ผลรวมจึงไม่เกินยอดคงเหลือระหว่างทาง
    const left = Number(source.quantity) - qty;
    if (left === 0) db.prepare('DELETE FROM item_locations WHERE id = ?').run(source.id);
    else db.prepare('UPDATE item_locations SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(left, source.id);

    const targetQty = to?.rackId != null
      ? Number(db.prepare('SELECT quantity FROM item_locations WHERE item_id = ? AND rack_id = ? AND IFNULL(storage_level,-1) = IFNULL(?,-1)')
        .get(sku, Number(to.rackId), to.storageLevel ?? null)?.quantity || 0)
      : Number(db.prepare('SELECT quantity FROM item_locations WHERE item_id = ? AND room_id = ?')
        .get(sku, Number(to?.roomId))?.quantity || 0);

    setLocationQuantity(db, {
      itemId: sku,
      rackId: to?.rackId ?? null,
      storageLevel: to?.storageLevel ?? null,
      roomId: to?.roomId ?? null,
      quantity: targetQty + qty,
      ceiling: totalBefore,
      createdBy
    });
  });
  run();
  return getItemLocations(db, sku);
};

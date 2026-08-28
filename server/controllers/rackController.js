import db, { logAudit } from '../db.js';
import {
  clamp,
  finiteNumber,
  nextLayerZ,
  normalizeRotation,
  normalizeScopeLayers,
  STORAGE_CANVAS,
  StorageValidationError
} from '../utils/storageLayout.js';
import { touchPlan } from '../utils/storageWorkflow.js';

const RACK_WIDTH = 140;
const RACK_HEIGHT = 84;
const RACK_MIN_WIDTH = 60;
const RACK_MIN_HEIGHT = 40;

const sendError = (res, err, label) => {
  const status = err instanceof StorageValidationError ? err.statusCode : 500;
  if (status === 500) console.error(`${label} error:`, err);
  return res.status(status).json({ success: false, code: err.code, message: status === 500 ? 'Database error' : err.message });
};

// ชั้นวาง: ?room=<id> = ชั้นในห้อง | ?plan=<id>&floor=1 = ชั้นลอยบนผังคลัง (ไม่อยู่ในห้อง) | ไม่ระบุ = ทั้งหมด
export const listRacks = (req, res) => {
  try {
    const roomId = req.query.room ? Number(req.query.room) : null;
    const planId = req.query.plan ? Number(req.query.plan) : null;
    const floorOnly = req.query.floor === '1' || req.query.floor === 'true';
    let where = '';
    if (roomId) where = 'WHERE r.room_id = @roomId AND r.deleted_at IS NULL';
    else if (planId && floorOnly) where = 'WHERE r.plan_id = @planId AND r.room_id IS NULL AND r.deleted_at IS NULL';
    else if (planId) where = 'WHERE r.plan_id = @planId AND r.deleted_at IS NULL';
    else where = 'WHERE r.deleted_at IS NULL';
    const racks = db.prepare(`
      SELECT r.id, r.name, r.levels, r.is_floor AS isFloor, r.project_id AS projectId, pj.name AS projectName,
             r.room_id AS roomId, rm.name AS roomName, r.plan_id AS planId,
             fp.name AS planName, r.pos_x AS posX, r.pos_y AS posY, r.width, r.height, r.rotation, r.locked,
             r.capacity, r.group_id AS groupId, r.z, COUNT(DISTINCT l.item_id) AS itemCount,
             COUNT(DISTINCT l.item_id) AS skuCount, COALESCE(SUM(l.quantity), 0) AS quantity
      FROM storage_racks r
      LEFT JOIN item_locations l ON l.rack_id = r.id
      LEFT JOIN rooms rm ON rm.id = r.room_id
      LEFT JOIN floor_plans fp ON fp.id = r.plan_id
      LEFT JOIN projects pj ON pj.id = r.project_id
      ${where}
      GROUP BY r.id ORDER BY fp.name, rm.name, r.name COLLATE NOCASE ASC
    `).all({ roomId, planId });
    res.json({ success: true, racks });
  } catch (err) {
    console.error('listRacks error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// รายละเอียดชั้น: สินค้าจัดกลุ่มตามเลเวล (สำหรับ blueprint)
export const getRack = (req, res) => {
  try {
    const rack = db.prepare(`
      SELECT r.id, r.name, r.levels, r.is_floor AS isFloor, r.project_id AS projectId, pj.name AS projectName,
             r.room_id AS roomId, r.plan_id AS planId, r.pos_x AS posX, r.pos_y AS posY,
             r.width, r.height, r.rotation, r.locked, r.capacity, r.group_id AS groupId
      FROM storage_racks r LEFT JOIN projects pj ON pj.id = r.project_id
      WHERE r.id = ? AND r.deleted_at IS NULL
    `).get(Number(req.params.id));
    if (!rack) return res.status(404).json({ success: false, message: 'ไม่พบชั้นวาง' });
    // อ่านจาก item_locations — สินค้า 1 ตัวอยู่ได้หลายชั้น/หลายเลเวล qtyHere = จำนวนที่วางตรงนี้
    const items = db.prepare(`
      SELECT l.item_id AS sku, i.item_name AS name, COALESCE(l.storage_level, 0) AS level,
             l.quantity AS qtyHere,
             i.group_id AS groupId, wb.group_name AS groupName,
             COALESCE(ps.image_url, '') AS imageUrl,
             COALESCE(wb.stock_balance, 0) AS stock
      FROM item_locations l
      JOIN items i ON i.item_id = l.item_id
      LEFT JOIN warehouse_balance wb ON wb.item_id = l.item_id
      LEFT JOIN product_settings ps ON ps.item_id = l.item_id
      WHERE l.rack_id = ? ORDER BY l.storage_level, i.item_name COLLATE NOCASE
    `).all(rack.id);
    res.json({ success: true, rack, items });
  } catch (err) {
    console.error('getRack error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// เพิ่มชั้นวาง (Admin/Manager)
// โครงการผูกได้เฉพาะพื้นที่วางพื้น (= พื้นที่จัดเตรียม) ชั้นวางปกติผูกไม่ได้
const resolveProjectId = (raw, isFloor) => {
  if (!raw) return null;
  if (!isFloor) throw new StorageValidationError('ผูกโครงการได้เฉพาะพื้นที่วางพื้น — ชั้นวางแบบมีเลเวลผูกไม่ได้');
  const id = Number(raw);
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) throw new StorageValidationError('ไม่พบโครงการที่เลือก');
  return id;
};

export const addRack = (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    // พื้นที่วางพื้น = ของกองกับพื้น ไม่มีชั้นย่อย จึงบังคับให้เป็น 1 เลเวลเสมอ
    const isFloor = req.body.isFloor ? 1 : 0;
    const levels = isFloor ? 1 : Math.min(Math.max(Number.parseInt(req.body.levels, 10) || 1, 1), 50);
    // ผูกโครงการ = พื้นที่จัดเตรียมของโครงการนั้น (ของถูกกันไว้ โครงการอื่นเบิกไม่ได้)
    const projectId = resolveProjectId(req.body.projectId, isFloor);
    const capacity = Math.min(Math.max(Number.parseInt(req.body.capacity, 10) || 100, 1), 1000000);
    const roomId = req.body.roomId ? Number(req.body.roomId) : null;
    // plan: ถ้าอยู่ในห้อง ใช้ plan ของห้อง, ถ้าเป็นชั้นลอยรับ planId มาตรง
    let planId = req.body.planId ? Number(req.body.planId) : null;
    if (roomId) planId = db.prepare('SELECT plan_id FROM rooms WHERE id = ?').get(roomId)?.plan_id ?? planId;
    if (!name) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อชั้นวาง' });
    if (!Number.isInteger(planId) || planId <= 0) throw new StorageValidationError('กรุณาระบุคลังของชั้นวาง');
    // ชื่อชั้นห้ามซ้ำภายในห้อง/ผังเดียวกัน
    if (db.prepare('SELECT id FROM storage_racks WHERE name = ? AND IFNULL(room_id, 0) = IFNULL(?, 0) AND IFNULL(plan_id,0) = IFNULL(?,0)').get(name, roomId, planId)) {
      return res.status(409).json({ success: false, message: 'มีชั้นวางชื่อนี้ในบริเวณนี้แล้ว' });
    }
    const width = clamp(finiteNumber(req.body.width, RACK_WIDTH, 'ความกว้าง'), RACK_MIN_WIDTH, STORAGE_CANVAS.width);
    const height = clamp(finiteNumber(req.body.height, RACK_HEIGHT, 'ความสูง'), RACK_MIN_HEIGHT, STORAGE_CANVAS.height);
    const posX = clamp(finiteNumber(req.body.posX, 20, 'ตำแหน่ง X'), 0, STORAGE_CANVAS.width - width);
    const posY = clamp(finiteNumber(req.body.posY, 20, 'ตำแหน่ง Y'), 0, STORAGE_CANVAS.height - height);
    const scope = roomId ? { roomId } : { planId };
    const z = nextLayerZ(db, scope);
    const info = db.prepare('INSERT INTO storage_racks (name, levels, is_floor, project_id, room_id, plan_id, pos_x, pos_y, width, height, rotation, locked, capacity, z) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, levels, isFloor, projectId, roomId, planId, posX, posY, width, height, 0, 0, capacity, z);
    touchPlan(db, planId);
    logAudit(req.user?.username, 'rack.add', 'rack', String(info.lastInsertRowid), { name, levels, isFloor, projectId, roomId, planId });
    const projectName = projectId ? db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId)?.name : null;
    res.status(201).json({ success: true, rack: { id: info.lastInsertRowid, name, levels, isFloor, projectId, projectName, roomId, planId, posX, posY, width, height, rotation: 0, locked: false, capacity, z, itemCount: 0, skuCount: 0, quantity: 0 } });
  } catch (err) {
    sendError(res, err, 'addRack');
  }
};

// แก้ไขชั้น (Admin/Manager) — ชื่อ/จำนวนเลเวล/ตำแหน่งบนผัง (ใช้ตอนลากบล็อก)
export const updateRack = (req, res) => {
  try {
    const id = Number(req.params.id);
    const rack = db.prepare('SELECT * FROM storage_racks WHERE id = ?').get(id);
    if (!rack) return res.status(404).json({ success: false, message: 'ไม่พบชั้นวาง' });

    const name = req.body.name != null ? String(req.body.name).trim() : rack.name;
    // สลับประเภทได้: ชั้นวาง (มีเลเวล) ↔ พื้นที่วางพื้น (ไม่มีเลเวล บังคับ 1 เสมอ)
    const isFloor = req.body.isFloor != null ? (req.body.isFloor ? 1 : 0) : (rack.is_floor || 0);
    const projectId = req.body.projectId !== undefined
      ? resolveProjectId(req.body.projectId, isFloor)
      : (isFloor ? rack.project_id : null);   // เปลี่ยนกลับเป็นชั้นวางปกติ = เลิกเป็นพื้นที่จัดเตรียม
    // เลิกผูกโครงการไม่ได้ถ้ายังมีของที่กันไว้ให้โครงการนั้นวางอยู่
    if (rack.project_id && !projectId) {
      const left = db.prepare('SELECT COUNT(*) c FROM item_locations WHERE rack_id = ? AND quantity > 0').get(id).c;
      if (left > 0) return res.status(400).json({ success: false, message: `ยังมีสินค้า ${left} รายการที่จัดเตรียมไว้ในพื้นที่นี้ — ย้ายออกก่อน` });
    }
    const levels = isFloor
      ? 1
      : (req.body.levels != null ? Math.min(Math.max(Number.parseInt(req.body.levels, 10) || 1, 1), 50) : rack.levels);
    const width = clamp(finiteNumber(req.body.width, rack.width || RACK_WIDTH, 'ความกว้าง'), RACK_MIN_WIDTH, STORAGE_CANVAS.width);
    const height = clamp(finiteNumber(req.body.height, rack.height || RACK_HEIGHT, 'ความสูง'), RACK_MIN_HEIGHT, STORAGE_CANVAS.height);
    const posX = clamp(finiteNumber(req.body.posX, rack.pos_x, 'ตำแหน่ง X'), 0, STORAGE_CANVAS.width - width);
    const posY = clamp(finiteNumber(req.body.posY, rack.pos_y, 'ตำแหน่ง Y'), 0, STORAGE_CANVAS.height - height);
    const rotation = normalizeRotation(req.body.rotation, rack.rotation);
    const locked = req.body.locked != null ? (req.body.locked ? 1 : 0) : rack.locked;
    const capacity = req.body.capacity != null ? Math.min(Math.max(Number.parseInt(req.body.capacity, 10) || 1, 1), 1000000) : (rack.capacity || 100);
    const groupId = req.body.groupId !== undefined ? (req.body.groupId || null) : rack.group_id;
    const z = Math.max(1, Math.round(finiteNumber(req.body.z, rack.z || 1, 'ลำดับ layer')));

    // ลดจำนวนเลเวลไม่ได้ถ้ามีสินค้าอยู่เลเวลที่จะหาย (เปลี่ยนเป็นพื้นที่วางพื้นก็เข้าเงื่อนไขนี้ เพราะเหลือเลเวลเดียว)
    if (levels < rack.levels) {
      const orphan = db.prepare('SELECT COUNT(*) c FROM item_locations WHERE rack_id = ? AND storage_level > ?').get(id, levels).c;
      if (orphan > 0) {
        return res.status(400).json({
          success: false,
          message: isFloor && !rack.is_floor
            ? `เปลี่ยนเป็นพื้นที่วางพื้นไม่ได้ — ยังมีสินค้า ${orphan} รายการอยู่เลเวล 2 ขึ้นไป ย้ายลงมาเลเวล 1 ก่อน`
            : `มีสินค้า ${orphan} รายการอยู่เลเวลที่จะถูกลบ — ย้ายก่อน`
        });
      }
    }
    db.prepare('UPDATE storage_racks SET name = ?, levels = ?, is_floor = ?, project_id = ?, pos_x = ?, pos_y = ?, width = ?, height = ?, rotation = ?, locked = ?, capacity = ?, group_id = ?, z = ? WHERE id = ? AND deleted_at IS NULL').run(name, levels, isFloor, projectId, posX, posY, width, height, rotation, locked, capacity, groupId, z, id);
    touchPlan(db, rack.plan_id);
    logAudit(req.user?.username, 'storage.rack_update', 'plan', String(rack.plan_id), { planId: rack.plan_id, kind: 'rack', id, patch: req.body });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'updateRack');
  }
};

// ลบชั้น (Admin/Manager) — บล็อกถ้ายังมีสินค้าอยู่
export const deleteRack = (req, res) => {
  try {
    const id = Number(req.params.id);
    const rack = db.prepare('SELECT name, locked, room_id AS roomId, plan_id AS planId FROM storage_racks WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!rack) return res.status(404).json({ success: false, message: 'ไม่พบชั้นวาง' });
    if (rack.locked) return res.status(400).json({ success: false, message: 'กรุณาปลดล็อก Component ก่อนลบ' });
    const cnt = db.prepare('SELECT COUNT(*) c FROM item_locations WHERE rack_id = ? AND quantity > 0').get(id).c;
    if (cnt > 0) return res.status(400).json({ success: false, message: `ลบไม่ได้ — มีสินค้า ${cnt} รายการในชั้นนี้ (ต้องย้ายออกก่อน)` });
    db.prepare('UPDATE storage_racks SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    normalizeScopeLayers(db, rack.roomId ? { roomId: rack.roomId } : { planId: rack.planId });
    touchPlan(db, rack.planId);
    logAudit(req.user?.username, 'storage.rack_trash', 'plan', String(rack.planId), { planId: rack.planId, kind: 'rack', id, name: rack.name });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'deleteRack');
  }
};

// ย้ายชั้นวางไปห้องอื่น / ออกมาเป็นชั้นลอยบนผัง / ข้ามคลัง (Admin/Manager)
// ใช้ตอนบริษัทจัดผังใหม่ — สินค้าที่อยู่บนชั้นย้ายตามไปเองเพราะผูกกับ rack_id ไม่ใช่ห้อง
export const moveRack = (req, res) => {
  try {
    const id = Number(req.params.id);
    const rack = db.prepare('SELECT * FROM storage_racks WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!rack) return res.status(404).json({ success: false, message: 'ไม่พบชั้นวาง' });
    if (rack.locked) return res.status(400).json({ success: false, message: 'กรุณาปลดล็อก Component ก่อนย้าย' });

    // roomId = null → ย้ายออกมาเป็นชั้นลอยบนผัง (ต้องระบุ planId มาด้วย)
    const toRoomId = req.body?.roomId == null || req.body?.roomId === '' ? null : Number(req.body.roomId);
    let toPlanId = req.body?.planId == null || req.body?.planId === '' ? null : Number(req.body.planId);

    if (toRoomId != null) {
      const room = db.prepare('SELECT id, name, plan_id AS planId, is_storage AS isStorage FROM rooms WHERE id = ? AND deleted_at IS NULL').get(toRoomId);
      if (!room) return res.status(404).json({ success: false, message: 'ไม่พบห้องปลายทาง' });
      if (!room.isStorage) return res.status(400).json({ success: false, message: `“${room.name}” ไม่ใช่ห้องเก็บของ — เปิดสวิตช์ “เป็นห้องเก็บของ” ก่อนย้ายชั้นวางเข้าไป` });
      toPlanId = room.planId;
    } else {
      if (!Number.isInteger(toPlanId) || toPlanId <= 0) toPlanId = rack.plan_id;
      if (!db.prepare('SELECT id FROM floor_plans WHERE id = ?').get(toPlanId)) {
        return res.status(404).json({ success: false, message: 'ไม่พบคลังปลายทาง' });
      }
    }

    const sameSpot = (rack.room_id ?? null) === toRoomId && rack.plan_id === toPlanId;
    if (sameSpot) return res.json({ success: true, message: 'ชั้นวางอยู่ที่นี่อยู่แล้ว', moved: false });

    // ชื่อชั้นห้ามซ้ำในบริเวณปลายทาง (กติกาเดียวกับตอนสร้าง)
    const dup = db.prepare(`
      SELECT id FROM storage_racks
      WHERE name = ? AND IFNULL(room_id, 0) = IFNULL(?, 0) AND IFNULL(plan_id, 0) = IFNULL(?, 0)
        AND id != ? AND deleted_at IS NULL
    `).get(rack.name, toRoomId, toPlanId, id);
    if (dup) return res.status(409).json({ success: false, message: `ปลายทางมีชั้นวางชื่อ “${rack.name}” อยู่แล้ว — เปลี่ยนชื่อก่อนย้าย` });

    const width = rack.width || RACK_WIDTH;
    const height = rack.height || RACK_HEIGHT;
    const posX = clamp(rack.pos_x, 0, STORAGE_CANVAS.width - width);
    const posY = clamp(rack.pos_y, 0, STORAGE_CANVAS.height - height);

    const fromScope = rack.room_id ? { roomId: rack.room_id } : { planId: rack.plan_id };
    const toScope = toRoomId ? { roomId: toRoomId } : { planId: toPlanId };

    const run = db.transaction(() => {
      const z = nextLayerZ(db, toScope);
      db.prepare('UPDATE storage_racks SET room_id = ?, plan_id = ?, pos_x = ?, pos_y = ?, z = ? WHERE id = ?')
        .run(toRoomId, toPlanId, posX, posY, z, id);
      // จัดลำดับ layer ใหม่ทั้งต้นทางและปลายทาง ไม่ให้เหลือช่องว่าง
      normalizeScopeLayers(db, fromScope);
      normalizeScopeLayers(db, toScope);
      touchPlan(db, rack.plan_id);
      if (toPlanId !== rack.plan_id) touchPlan(db, toPlanId);
      logAudit(req.user?.username, 'storage.rack_move', 'rack', String(id), {
        name: rack.name,
        from: { roomId: rack.room_id, planId: rack.plan_id },
        to: { roomId: toRoomId, planId: toPlanId }
      });
    });
    run();

    const itemCount = db.prepare('SELECT COUNT(*) c FROM item_locations WHERE rack_id = ?').get(id).c;
    const where = toRoomId
      ? db.prepare('SELECT name FROM rooms WHERE id = ?').get(toRoomId)?.name
      : 'ผังคลัง (ชั้นลอย)';
    res.json({
      success: true,
      moved: true,
      message: `ย้าย “${rack.name}” ไปที่ ${where} แล้ว${itemCount ? ` (สินค้า ${itemCount} รายการย้ายตามไปด้วย)` : ''}`,
      rack: { id, roomId: toRoomId, planId: toPlanId, posX, posY }
    });
  } catch (err) {
    sendError(res, err, 'moveRack');
  }
};

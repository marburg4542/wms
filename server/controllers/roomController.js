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

const ROOM_MIN_WIDTH = 80;
const ROOM_MIN_HEIGHT = 60;
const ROOM_DEFAULT_WIDTH = 240;
const ROOM_DEFAULT_HEIGHT = 160;

const sendError = (res, err, label) => {
  const status = err instanceof StorageValidationError ? err.statusCode : 500;
  if (status === 500) console.error(`${label} error:`, err);
  return res.status(status).json({ success: false, code: err.code, message: status === 500 ? 'Database error' : err.message });
};

// ห้อง/โซนทั้งหมด + จำนวนชั้นวางในห้อง (เฉพาะห้องเก็บของ)
export const listRooms = (req, res) => {
  try {
    const planId = req.query.plan ? Number(req.query.plan) : null;
    const rooms = db.prepare(`
      SELECT rm.id, rm.name, rm.is_storage AS isStorage, rm.is_staging AS isStaging,
             rm.project_id AS projectId, p.name AS projectName,
             rm.plan_id AS planId, rm.pos_x AS posX, rm.pos_y AS posY,
             rm.width, rm.height, rm.rotation, rm.locked, rm.group_id AS groupId, rm.z,
             COUNT(DISTINCT r.id) AS rackCount,
             COALESCE((SELECT SUM(l.quantity) FROM item_locations l WHERE l.room_id = rm.id), 0) AS stagedQty,
             (SELECT COUNT(*) FROM item_locations l WHERE l.room_id = rm.id) AS stagedItems
      FROM rooms rm
      LEFT JOIN storage_racks r ON r.room_id = rm.id AND r.deleted_at IS NULL
      LEFT JOIN projects p ON p.id = rm.project_id
      ${planId ? 'WHERE rm.plan_id = @planId AND rm.deleted_at IS NULL' : 'WHERE rm.deleted_at IS NULL'}
      GROUP BY rm.id ORDER BY rm.id ASC
    `).all({ planId });
    res.json({ success: true, rooms });
  } catch (err) {
    console.error('listRooms error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// เพิ่มห้อง (Admin/Manager)
export const addRoom = (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อห้อง' });
    // พื้นที่จัดเตรียมย้ายไปเป็น "พื้นที่วางพื้น" ในห้องแล้ว (ของจริงกองกับพื้น ไม่ใช่ห้องแยกอีกห้อง)
    // ห้องที่สร้างใหม่จึงเป็นห้องธรรมดาเสมอ
    const isStaging = 0;
    const isStorage = req.body.isStorage === false || req.body.isStorage === 0 ? 0 : 1;
    const projectId = null;
    const planId = req.body.planId ? Number(req.body.planId) : null;
    if (!Number.isInteger(planId) || planId <= 0) throw new StorageValidationError('กรุณาระบุคลังที่ต้องการเพิ่มห้อง');
    const width = clamp(finiteNumber(req.body.width, ROOM_DEFAULT_WIDTH, 'ความกว้าง'), ROOM_MIN_WIDTH, STORAGE_CANVAS.width);
    const height = clamp(finiteNumber(req.body.height, ROOM_DEFAULT_HEIGHT, 'ความสูง'), ROOM_MIN_HEIGHT, STORAGE_CANVAS.height);
    const posX = clamp(finiteNumber(req.body.posX, 20, 'ตำแหน่ง X'), 0, STORAGE_CANVAS.width - width);
    const posY = clamp(finiteNumber(req.body.posY, 20, 'ตำแหน่ง Y'), 0, STORAGE_CANVAS.height - height);
    const z = nextLayerZ(db, { planId });
    const info = db.prepare('INSERT INTO rooms (name, is_storage, is_staging, project_id, plan_id, pos_x, pos_y, width, height, rotation, locked, z) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, isStorage, isStaging, projectId, planId, posX, posY, width, height, 0, 0, z);
    touchPlan(db, planId);
    logAudit(req.user?.username, 'room.add', 'room', String(info.lastInsertRowid), { name, isStorage, planId });
    // ส่ง projectName กลับด้วย ไม่งั้นผังจะขึ้นว่า "ยังไม่ผูกโครงการ" จนกว่าจะโหลดใหม่
    const projectName = projectId ? db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId)?.name || null : null;
    res.status(201).json({ success: true, room: { id: info.lastInsertRowid, name, isStorage, isStaging, projectId, projectName, planId, posX, posY, width, height, rotation: 0, locked: false, z, rackCount: 0, stagedQty: 0, stagedItems: 0 } });
  } catch (err) {
    sendError(res, err, 'addRoom');
  }
};

// แก้ไขห้อง (ชื่อ/ประเภท/ตำแหน่ง/ขนาด) — ใช้ตอนลาก/ปรับขนาดสี่เหลี่ยม
export const updateRoom = (req, res) => {
  try {
    const id = Number(req.params.id);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room) return res.status(404).json({ success: false, message: 'ไม่พบห้อง' });
    const name = req.body.name != null ? String(req.body.name).trim() : room.name;
    // ตั้งห้องเป็นพื้นที่จัดเตรียมใหม่ไม่ได้แล้ว แต่ห้องเก่าที่ยังเป็นอยู่ไม่ถูกล้างทิ้ง (ของยังถูกกันไว้ตามเดิม)
    const isStaging = room.is_staging;
    const isStorage = isStaging ? 0 : (req.body.isStorage != null ? (req.body.isStorage ? 1 : 0) : room.is_storage);
    const projectId = room.project_id;
    const width = clamp(finiteNumber(req.body.width, room.width, 'ความกว้าง'), ROOM_MIN_WIDTH, STORAGE_CANVAS.width);
    const height = clamp(finiteNumber(req.body.height, room.height, 'ความสูง'), ROOM_MIN_HEIGHT, STORAGE_CANVAS.height);
    const posX = clamp(finiteNumber(req.body.posX, room.pos_x, 'ตำแหน่ง X'), 0, STORAGE_CANVAS.width - width);
    const posY = clamp(finiteNumber(req.body.posY, room.pos_y, 'ตำแหน่ง Y'), 0, STORAGE_CANVAS.height - height);
    const rotation = normalizeRotation(req.body.rotation, room.rotation);
    const locked = req.body.locked != null ? (req.body.locked ? 1 : 0) : room.locked;
    const groupId = req.body.groupId !== undefined ? (req.body.groupId || null) : room.group_id;
    const z = Math.max(1, Math.round(finiteNumber(req.body.z, room.z || 1, 'ลำดับ layer')));
    db.prepare('UPDATE rooms SET name = ?, is_storage = ?, is_staging = ?, project_id = ?, pos_x = ?, pos_y = ?, width = ?, height = ?, rotation = ?, locked = ?, group_id = ?, z = ? WHERE id = ? AND deleted_at IS NULL')
      .run(name, isStorage, isStaging, projectId, posX, posY, width, height, rotation, locked, groupId, z, id);
    touchPlan(db, room.plan_id);
    logAudit(req.user?.username, 'storage.room_update', 'plan', String(room.plan_id), { planId: room.plan_id, kind: 'room', id, patch: req.body });
    const projectName = projectId ? db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId)?.name || null : null;
    res.json({ success: true, room: { id, isStaging, isStorage, projectId, projectName } });
  } catch (err) {
    sendError(res, err, 'updateRoom');
  }
};

// ลบห้อง — บล็อกถ้ายังมีชั้นวางอยู่
export const deleteRoom = (req, res) => {
  try {
    const id = Number(req.params.id);
    const room = db.prepare('SELECT name, locked, plan_id AS planId FROM rooms WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!room) return res.status(404).json({ success: false, message: 'ไม่พบห้อง' });
    if (room.locked) return res.status(400).json({ success: false, message: 'กรุณาปลดล็อก Component ก่อนลบ' });
    const cnt = db.prepare('SELECT COUNT(*) c FROM storage_racks WHERE room_id = ? AND deleted_at IS NULL').get(id).c;
    if (cnt > 0) return res.status(400).json({ success: false, message: `ลบไม่ได้ — มีชั้นวาง ${cnt} ชั้นในห้องนี้ (ต้องย้าย/ลบก่อน)` });
    const staged = db.prepare('SELECT COUNT(*) c FROM item_locations WHERE room_id = ? AND quantity > 0').get(id).c;
    if (staged > 0) return res.status(400).json({ success: false, message: `ลบไม่ได้ — มีสินค้า ${staged} รายการวางอยู่ในพื้นที่นี้ (ต้องย้ายออกก่อน)` });
    db.prepare('UPDATE rooms SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    if (room.planId) normalizeScopeLayers(db, { planId: room.planId });
    touchPlan(db, room.planId);
    logAudit(req.user?.username, 'storage.room_trash', 'plan', String(room.planId), { planId: room.planId, kind: 'room', id, name: room.name });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'deleteRoom');
  }
};

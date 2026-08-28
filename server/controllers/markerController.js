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

const TYPES = ['wall', 'line'];
// ขนาดเริ่มต้นตามชนิดสัญลักษณ์
const DEFAULT_SIZE = {
  door: { width: 64, height: 64 },
  wall: { width: 160, height: 14 },
  stairs: { width: 60, height: 60 },
  line: { width: 160, height: 4 },
  label: { width: 120, height: 32 }
};

const sendError = (res, err, label) => {
  const status = err instanceof StorageValidationError ? err.statusCode : 500;
  if (status === 500) console.error(`${label} error:`, err);
  return res.status(status).json({ success: false, code: err.code, message: status === 500 ? 'Database error' : err.message });
};

// สัญลักษณ์บนผัง (?plan=<id>) หรือในห้อง (?room=<id>)
export const listMarkers = (req, res) => {
  try {
    const roomId = req.query.room ? Number(req.query.room) : null;
    const planId = req.query.plan ? Number(req.query.plan) : null;
    let rows;
    if (roomId) {
      rows = db.prepare("SELECT id, type, text, pos_x AS posX, pos_y AS posY, width, height, rotation, locked, group_id AS groupId, z FROM markers WHERE room_id = ? AND deleted_at IS NULL AND type IN ('wall','line')").all(roomId);
    } else {
      rows = db.prepare("SELECT id, type, text, pos_x AS posX, pos_y AS posY, width, height, rotation, locked, group_id AS groupId, z FROM markers WHERE plan_id = ? AND room_id IS NULL AND deleted_at IS NULL AND type IN ('wall','line')").all(planId);
    }
    res.json({ success: true, markers: rows });
  } catch (err) {
    console.error('listMarkers error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

export const addMarker = (req, res) => {
  try {
    const type = String(req.body.type || '');
    if (!TYPES.includes(type)) return res.status(400).json({ success: false, message: 'ชนิดสัญลักษณ์ไม่ถูกต้อง' });
    let planId = req.body.planId ? Number(req.body.planId) : null;
    const roomId = req.body.roomId ? Number(req.body.roomId) : null;
    if (roomId) planId = db.prepare('SELECT plan_id FROM rooms WHERE id = ? AND deleted_at IS NULL').get(roomId)?.plan_id || null;
    const text = req.body.text != null ? String(req.body.text) : null;
    if (!planId || (req.body.planId && roomId)) throw new StorageValidationError('ต้องระบุผังหรือห้องของสัญลักษณ์');
    const defaults = DEFAULT_SIZE[type];
    const width = clamp(finiteNumber(req.body.width, defaults.width, 'ความกว้าง'), 6, STORAGE_CANVAS.width);
    const height = clamp(finiteNumber(req.body.height, defaults.height, 'ความสูง'), 4, STORAGE_CANVAS.height);
    const posX = clamp(finiteNumber(req.body.posX, 20, 'ตำแหน่ง X'), 0, STORAGE_CANVAS.width - width);
    const posY = clamp(finiteNumber(req.body.posY, 20, 'ตำแหน่ง Y'), 0, STORAGE_CANVAS.height - height);
    const rotation = normalizeRotation(req.body.rotation, 0);
    const scope = roomId ? { roomId } : { planId };
    const z = nextLayerZ(db, scope);
    const info = db.prepare('INSERT INTO markers (plan_id, room_id, type, text, pos_x, pos_y, width, height, rotation, locked, z) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(planId, roomId, type, text, posX, posY, width, height, rotation, 0, z);
    touchPlan(db, planId);
    logAudit(req.user?.username, 'storage.marker_add', 'plan', String(planId), { planId, kind: 'marker', id: info.lastInsertRowid, type, roomId });
    res.status(201).json({ success: true, marker: { id: info.lastInsertRowid, type, text, posX, posY, width, height, rotation, locked: false, z } });
  } catch (err) {
    sendError(res, err, 'addMarker');
  }
};

export const updateMarker = (req, res) => {
  try {
    const id = Number(req.params.id);
    const m = db.prepare('SELECT * FROM markers WHERE id = ?').get(id);
    if (!m) return res.status(404).json({ success: false, message: 'ไม่พบสัญลักษณ์' });
    const width = clamp(finiteNumber(req.body.width, m.width, 'ความกว้าง'), 6, STORAGE_CANVAS.width);
    const height = clamp(finiteNumber(req.body.height, m.height, 'ความสูง'), 4, STORAGE_CANVAS.height);
    const posX = clamp(finiteNumber(req.body.posX, m.pos_x, 'ตำแหน่ง X'), 0, STORAGE_CANVAS.width - width);
    const posY = clamp(finiteNumber(req.body.posY, m.pos_y, 'ตำแหน่ง Y'), 0, STORAGE_CANVAS.height - height);
    const text = req.body.text != null ? String(req.body.text) : m.text;
    const rotation = normalizeRotation(req.body.rotation, m.rotation);
    const locked = req.body.locked != null ? (req.body.locked ? 1 : 0) : m.locked;
    const groupId = req.body.groupId !== undefined ? (req.body.groupId || null) : m.group_id;
    const z = Math.max(1, Math.round(finiteNumber(req.body.z, m.z || 1, 'ลำดับ layer')));
    db.prepare('UPDATE markers SET pos_x = ?, pos_y = ?, width = ?, height = ?, text = ?, rotation = ?, locked = ?, group_id = ?, z = ? WHERE id = ? AND deleted_at IS NULL')
      .run(posX, posY, width, height, text, rotation, locked, groupId, z, id);
    const planId = m.plan_id || db.prepare('SELECT plan_id FROM rooms WHERE id = ?').get(m.room_id)?.plan_id;
    touchPlan(db, planId);
    logAudit(req.user?.username, 'storage.marker_update', 'plan', String(planId), { planId, kind: 'marker', id, patch: req.body });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'updateMarker');
  }
};

export const deleteMarker = (req, res) => {
  try {
    const id = Number(req.params.id);
    const marker = db.prepare('SELECT locked, room_id AS roomId, plan_id AS planId FROM markers WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!marker) return res.status(404).json({ success: false, message: 'ไม่พบสัญลักษณ์' });
    if (marker.locked) return res.status(400).json({ success: false, message: 'กรุณาปลดล็อก Component ก่อนลบ' });
    db.prepare('UPDATE markers SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    normalizeScopeLayers(db, marker.roomId ? { roomId: marker.roomId } : { planId: marker.planId });
    touchPlan(db, marker.planId);
    logAudit(req.user?.username, 'storage.marker_trash', 'plan', String(marker.planId), { planId: marker.planId, kind: 'marker', id });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'deleteMarker');
  }
};

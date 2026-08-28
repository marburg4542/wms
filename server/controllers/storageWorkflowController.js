import db, { logAudit } from '../db.js';
import { clamp, finiteNumber, normalizeRotation, normalizeScopeLayers, STORAGE_CANVAS, StorageValidationError } from '../utils/storageLayout.js';
import { newGroupId, restorePlanSnapshot, snapshotPlan, TABLE_BY_KIND, touchPlan } from '../utils/storageWorkflow.js';

const RACK_SIZE = { width: 140, height: 84 };
const sendError = (res, error, label) => {
  const status = error instanceof StorageValidationError ? error.statusCode : 500;
  if (status === 500) console.error(`${label} error:`, error);
  res.status(status).json({ success: false, code: error.code, message: status === 500 ? 'Database error' : error.message });
};

const parseMembers = (members) => {
  if (!Array.isArray(members) || members.length === 0) throw new StorageValidationError('กรุณาเลือก Component อย่างน้อย 1 รายการ');
  const parsed = members.map((member) => ({ kind: String(member?.kind || ''), id: Number(member?.id) }));
  const keys = new Set(parsed.map((member) => `${member.kind}:${member.id}`));
  if (keys.size !== parsed.length || parsed.some((member) => !TABLE_BY_KIND[member.kind] || !Number.isInteger(member.id) || member.id <= 0)) {
    throw new StorageValidationError('รายการ Component ไม่ถูกต้อง');
  }
  return parsed;
};

const scopeForRow = (row) => row.room_id ? { roomId: row.room_id } : { planId: row.plan_id };

const fetchMemberRows = (members, { includeDeleted = false } = {}) => members.map((member) => {
  const table = TABLE_BY_KIND[member.kind];
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).get(member.id);
  if (!row) throw new StorageValidationError('ข้อมูล Component เปลี่ยนไปแล้ว กรุณาโหลดผังใหม่', 409, 'LAYOUT_CONFLICT');
  return { ...member, row };
});

const assertSingleScope = (rows, scope) => {
  const planId = Number(scope?.planId || 0);
  const roomId = Number(scope?.roomId || 0);
  if ((planId > 0) === (roomId > 0)) throw new StorageValidationError('Scope ไม่ถูกต้อง');
  const mismatch = rows.some(({ kind, row }) => roomId
    ? kind === 'room' || Number(row.room_id) !== roomId
    : Number(row.plan_id) !== planId || (kind !== 'room' && row.room_id != null));
  if (mismatch) throw new StorageValidationError('Component ต้องอยู่ในผังเดียวกัน', 409, 'LAYOUT_CONFLICT');
  return { planId: planId || rows[0]?.row.plan_id, roomId: roomId || null };
};

export const groupComponents = (req, res) => {
  try {
    const members = parseMembers(req.body.members);
    if (members.length < 2) throw new StorageValidationError('การ Group ต้องเลือกอย่างน้อย 2 Component');
    const rows = fetchMemberRows(members);
    const scope = assertSingleScope(rows, req.body.scope);
    const groupId = newGroupId();
    db.transaction(() => rows.forEach(({ kind, id }) => db.prepare(`UPDATE ${TABLE_BY_KIND[kind]} SET group_id = ? WHERE id = ?`).run(groupId, id)))();
    touchPlan(db, scope.planId);
    logAudit(req.user?.username, 'storage.group', 'plan', String(scope.planId), { planId: scope.planId, groupId, members });
    res.json({ success: true, groupId });
  } catch (error) { sendError(res, error, 'groupComponents'); }
};

export const ungroupComponents = (req, res) => {
  try {
    const members = parseMembers(req.body.members);
    const rows = fetchMemberRows(members);
    const scope = assertSingleScope(rows, req.body.scope);
    db.transaction(() => rows.forEach(({ kind, id }) => db.prepare(`UPDATE ${TABLE_BY_KIND[kind]} SET group_id = NULL WHERE id = ?`).run(id)))();
    touchPlan(db, scope.planId);
    logAudit(req.user?.username, 'storage.ungroup', 'plan', String(scope.planId), { planId: scope.planId, members });
    res.json({ success: true });
  } catch (error) { sendError(res, error, 'ungroupComponents'); }
};

const patchForRow = (kind, row, rawPatch) => {
  const patch = {};
  const minWidth = kind === 'room' ? 80 : kind === 'rack' ? 60 : 6;
  const minHeight = kind === 'room' ? 60 : kind === 'rack' ? 40 : 4;
  const width = clamp(finiteNumber(rawPatch.width, row.width ?? RACK_SIZE.width, 'ความกว้าง'), minWidth, STORAGE_CANVAS.width);
  const height = clamp(finiteNumber(rawPatch.height, row.height ?? RACK_SIZE.height, 'ความสูง'), minHeight, STORAGE_CANVAS.height);
  if (rawPatch.width != null) patch.width = width;
  if (rawPatch.height != null) patch.height = height;
  if (rawPatch.posX != null) patch.pos_x = clamp(finiteNumber(rawPatch.posX, row.pos_x, 'ตำแหน่ง X'), 0, STORAGE_CANVAS.width - width);
  if (rawPatch.posY != null) patch.pos_y = clamp(finiteNumber(rawPatch.posY, row.pos_y, 'ตำแหน่ง Y'), 0, STORAGE_CANVAS.height - height);
  if (rawPatch.rotation != null) patch.rotation = normalizeRotation(rawPatch.rotation, row.rotation);
  if (rawPatch.locked != null) patch.locked = rawPatch.locked ? 1 : 0;
  if (rawPatch.groupId !== undefined) patch.group_id = rawPatch.groupId || null;
  return patch;
};

export const bulkUpdateComponents = (req, res) => {
  try {
    if (!Array.isArray(req.body.changes) || req.body.changes.length === 0) throw new StorageValidationError('กรุณาระบุรายการเปลี่ยนแปลง');
    const members = parseMembers(req.body.changes);
    const rows = fetchMemberRows(members);
    const scope = assertSingleScope(rows, req.body.scope);
    const byKey = new Map(rows.map((entry) => [`${entry.kind}:${entry.id}`, entry.row]));
    db.transaction(() => req.body.changes.forEach((change) => {
      const kind = String(change.kind);
      const id = Number(change.id);
      const row = byKey.get(`${kind}:${id}`);
      const patch = patchForRow(kind, row, change.patch || {});
      const entries = Object.entries(patch);
      if (!entries.length) return;
      const params = { id };
      const set = entries.map(([column, value], index) => { params[`v${index}`] = value; return `${column} = @v${index}`; }).join(', ');
      db.prepare(`UPDATE ${TABLE_BY_KIND[kind]} SET ${set} WHERE id = @id AND deleted_at IS NULL`).run(params);
    }))();
    touchPlan(db, scope.planId);
    logAudit(req.user?.username, 'storage.bulk_update', 'plan', String(scope.planId), { planId: scope.planId, count: members.length });
    res.json({ success: true });
  } catch (error) { sendError(res, error, 'bulkUpdateComponents'); }
};

const ensureDeletable = ({ kind, id, row }) => {
  if (row.locked) throw new StorageValidationError('กรุณาปลดล็อก Component ก่อนลบ');
  if (kind === 'room') {
    const count = db.prepare('SELECT COUNT(*) AS count FROM storage_racks WHERE room_id = ? AND deleted_at IS NULL').get(id).count;
    if (count) throw new StorageValidationError(`ลบไม่ได้ — มีชั้นวาง ${count} ชั้นในห้อง`);
  }
  if (kind === 'rack') {
    const count = db.prepare('SELECT COUNT(*) AS count FROM items WHERE rack_id = ?').get(id).count;
    if (count) throw new StorageValidationError(`ลบไม่ได้ — มีสินค้า ${count} รายการในชั้นวาง`);
  }
};

export const trashComponents = (req, res) => {
  try {
    const members = parseMembers(req.body.members);
    const rows = fetchMemberRows(members);
    const scope = assertSingleScope(rows, req.body.scope);
    rows.forEach(ensureDeletable);
    db.transaction(() => rows.forEach(({ kind, id }) => db.prepare(`UPDATE ${TABLE_BY_KIND[kind]} SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)))();
    normalizeScopeLayers(db, scope.roomId ? { roomId: scope.roomId } : { planId: scope.planId });
    touchPlan(db, scope.planId);
    logAudit(req.user?.username, 'storage.trash', 'plan', String(scope.planId), { planId: scope.planId, members });
    res.json({ success: true });
  } catch (error) { sendError(res, error, 'trashComponents'); }
};

export const listTrash = (req, res) => {
  try {
    const planId = Number(req.query.plan);
    if (!Number.isInteger(planId) || planId <= 0) throw new StorageValidationError('กรุณาระบุคลัง');
    const union = [
      `SELECT 'room' AS kind, id, name AS title, deleted_at AS deletedAt FROM rooms WHERE plan_id = ? AND deleted_at IS NOT NULL`,
      `SELECT 'rack' AS kind, id, name AS title, deleted_at AS deletedAt FROM storage_racks WHERE plan_id = ? AND deleted_at IS NOT NULL`,
      `SELECT 'marker' AS kind, id, COALESCE(NULLIF(text,''), type) AS title, deleted_at AS deletedAt FROM markers WHERE plan_id = ? AND deleted_at IS NOT NULL AND type IN ('wall','line')`
    ].join(' UNION ALL ');
    res.json({ success: true, items: db.prepare(`${union} ORDER BY deletedAt DESC`).all(planId, planId, planId) });
  } catch (error) { sendError(res, error, 'listTrash'); }
};

export const restoreTrash = (req, res) => {
  try {
    const members = parseMembers(req.body.members);
    const rows = fetchMemberRows(members, { includeDeleted: true });
    if (rows.some(({ row }) => row.deleted_at == null)) throw new StorageValidationError('Component บางรายการไม่ได้อยู่ในถังขยะ');
    const planId = rows[0].row.plan_id;
    if (rows.some(({ row }) => row.plan_id !== planId)) throw new StorageValidationError('Component ต้องอยู่ในคลังเดียวกัน');
    db.transaction(() => rows.forEach(({ kind, id, row }) => {
      db.prepare(`UPDATE ${TABLE_BY_KIND[kind]} SET deleted_at = NULL WHERE id = ?`).run(id);
      normalizeScopeLayers(db, scopeForRow(row));
    }))();
    touchPlan(db, planId);
    logAudit(req.user?.username, 'storage.restore', 'plan', String(planId), { planId, members });
    res.json({ success: true });
  } catch (error) { sendError(res, error, 'restoreTrash'); }
};

export const publishPlan = (req, res) => {
  try {
    const planId = Number(req.params.id);
    const plan = db.prepare('SELECT id, name FROM floor_plans WHERE id = ?').get(planId);
    if (!plan) throw new StorageValidationError('ไม่พบคลัง', 404, 'PLAN_NOT_FOUND');
    const versionNumber = db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM layout_versions WHERE plan_id = ?').get(planId).next;
    const snapshot = snapshotPlan(db, planId);
    const versionName = String(req.body.name || `Version ${versionNumber}`).trim();
    const info = db.transaction(() => {
      const result = db.prepare(`INSERT INTO layout_versions (plan_id, version_number, name, snapshot_json, created_by)
        VALUES (?, ?, ?, ?, ?)`).run(planId, versionNumber, versionName, JSON.stringify(snapshot), req.user?.username || null);
      db.prepare(`UPDATE floor_plans SET layout_status = 'published', published_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP, layout_revision = COALESCE(layout_revision, 0) + 1 WHERE id = ?`).run(planId);
      return result;
    })();
    logAudit(req.user?.username, 'storage.publish', 'plan', String(planId), { planId, versionNumber, versionName });
    res.json({ success: true, version: { id: info.lastInsertRowid, versionNumber, name: versionName } });
  } catch (error) { sendError(res, error, 'publishPlan'); }
};

export const listVersions = (req, res) => {
  try {
    const planId = Number(req.params.id);
    const versions = db.prepare(`SELECT id, version_number AS versionNumber, name, status, created_by AS createdBy, created_at AS createdAt
      FROM layout_versions WHERE plan_id = ? ORDER BY version_number DESC`).all(planId);
    res.json({ success: true, versions });
  } catch (error) { sendError(res, error, 'listVersions'); }
};

export const restoreVersion = (req, res) => {
  try {
    const planId = Number(req.params.id);
    const version = db.prepare('SELECT * FROM layout_versions WHERE id = ? AND plan_id = ?').get(Number(req.params.versionId), planId);
    if (!version) throw new StorageValidationError('ไม่พบ Version', 404, 'VERSION_NOT_FOUND');
    restorePlanSnapshot(db, planId, JSON.parse(version.snapshot_json));
    logAudit(req.user?.username, 'storage.version_restore', 'plan', String(planId), { planId, versionNumber: version.version_number });
    res.json({ success: true });
  } catch (error) { sendError(res, error, 'restoreVersion'); }
};

export const listStorageHistory = (req, res) => {
  try {
    const planId = Number(req.params.id);
    const rows = db.prepare(`SELECT id, actor_username AS actor, action, entity_type AS entityType,
      entity_id AS entityId, details, created_at AS createdAt FROM audit_logs
      WHERE (entity_type = 'plan' AND entity_id = ?) OR details LIKE ?
      ORDER BY id DESC LIMIT 100`).all(String(planId), `%"planId":${planId}%`);
    res.json({ success: true, history: rows.map((row) => ({ ...row, details: (() => { try { return JSON.parse(row.details || '{}'); } catch { return {}; } })() })) });
  } catch (error) { sendError(res, error, 'listStorageHistory'); }
};

export const layoutMeta = (req, res) => {
  try {
    const plan = db.prepare(`SELECT id, layout_status AS status, layout_revision AS revision,
      published_at AS publishedAt, updated_at AS updatedAt FROM floor_plans WHERE id = ?`).get(Number(req.params.id));
    if (!plan) throw new StorageValidationError('ไม่พบคลัง', 404, 'PLAN_NOT_FOUND');
    res.json({ success: true, meta: plan });
  } catch (error) { sendError(res, error, 'layoutMeta'); }
};

import { randomUUID } from 'node:crypto';
import { normalizeScopeLayers, StorageValidationError } from './storageLayout.js';

export const TABLE_BY_KIND = Object.freeze({ room: 'rooms', rack: 'storage_racks', marker: 'markers' });

export const entityPlanId = (db, kind, id) => {
  const table = TABLE_BY_KIND[kind];
  if (!table) throw new StorageValidationError('ชนิด Component ไม่ถูกต้อง');
  const row = db.prepare(`SELECT plan_id AS planId FROM ${table} WHERE id = ?`).get(Number(id));
  if (!row) throw new StorageValidationError('ไม่พบ Component', 404, 'COMPONENT_NOT_FOUND');
  return row.planId;
};

export const touchPlan = (db, planId, { draft = true } = {}) => {
  if (!planId) return;
  db.prepare(`UPDATE floor_plans
    SET layout_revision = COALESCE(layout_revision, 0) + 1,
        layout_status = CASE WHEN @draft = 1 THEN 'draft' ELSE layout_status END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @planId`).run({ planId, draft: draft ? 1 : 0 });
};

export const newGroupId = () => `group-${randomUUID()}`;

export const snapshotPlan = (db, planId) => ({
  planId,
  rooms: db.prepare(`SELECT id, plan_id, name, is_storage, pos_x, pos_y, width, height, rotation, locked, group_id, z
    FROM rooms WHERE plan_id = ? AND deleted_at IS NULL ORDER BY id`).all(planId),
  racks: db.prepare(`SELECT id, plan_id, room_id, name, levels, pos_x, pos_y, width, height, rotation, locked, capacity, group_id, z
    FROM storage_racks WHERE plan_id = ? AND deleted_at IS NULL ORDER BY id`).all(planId),
  markers: db.prepare(`SELECT id, plan_id, room_id, type, text, pos_x, pos_y, width, height, rotation, locked, group_id, z
    FROM markers WHERE plan_id = ? AND deleted_at IS NULL ORDER BY id`).all(planId)
});

const upsertRows = (db, table, rows, columns) => {
  const names = ['id', ...columns];
  const placeholders = names.map((name) => `@${name}`).join(', ');
  const updates = columns.map((name) => `${name} = excluded.${name}`).join(', ');
  const statement = db.prepare(`INSERT INTO ${table} (${names.join(', ')}, deleted_at) VALUES (${placeholders}, NULL)
    ON CONFLICT(id) DO UPDATE SET ${updates}, deleted_at = NULL`);
  rows.forEach((row) => statement.run(row));
};

export const restorePlanSnapshot = (db, planId, snapshot) => {
  const snapshotRackIds = new Set((snapshot.racks || []).map((rack) => Number(rack.id)));
  const protectedRack = db.prepare(`SELECT r.id, r.name, COUNT(i.item_id) AS itemCount
    FROM storage_racks r LEFT JOIN items i ON i.rack_id = r.id
    WHERE r.plan_id = ? AND r.deleted_at IS NULL GROUP BY r.id
    HAVING itemCount > 0`).all(planId).find((rack) => !snapshotRackIds.has(Number(rack.id)));
  if (protectedRack) {
    throw new StorageValidationError(`กู้คืนไม่ได้ — ชั้นวาง ${protectedRack.name} ที่เพิ่มภายหลังมีสินค้าอยู่`);
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE rooms SET deleted_at = CURRENT_TIMESTAMP WHERE plan_id = ?').run(planId);
    db.prepare('UPDATE storage_racks SET deleted_at = CURRENT_TIMESTAMP WHERE plan_id = ?').run(planId);
    db.prepare('UPDATE markers SET deleted_at = CURRENT_TIMESTAMP WHERE plan_id = ?').run(planId);
    upsertRows(db, 'rooms', snapshot.rooms || [], ['plan_id', 'name', 'is_storage', 'pos_x', 'pos_y', 'width', 'height', 'rotation', 'locked', 'group_id', 'z']);
    const racks = (snapshot.racks || []).map((rack) => ({ ...rack, width: rack.width ?? 140, height: rack.height ?? 84 }));
    upsertRows(db, 'storage_racks', racks, ['plan_id', 'room_id', 'name', 'levels', 'pos_x', 'pos_y', 'width', 'height', 'rotation', 'locked', 'capacity', 'group_id', 'z']);
    upsertRows(db, 'markers', snapshot.markers || [], ['plan_id', 'room_id', 'type', 'text', 'pos_x', 'pos_y', 'width', 'height', 'rotation', 'locked', 'group_id', 'z']);
    normalizeScopeLayers(db, { planId });
    const rooms = db.prepare('SELECT id FROM rooms WHERE plan_id = ? AND deleted_at IS NULL').all(planId);
    rooms.forEach((room) => normalizeScopeLayers(db, { roomId: room.id }));
    touchPlan(db, planId);
  });
  tx();
};

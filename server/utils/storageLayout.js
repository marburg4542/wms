export const STORAGE_CANVAS = Object.freeze({ width: 1600, height: 900 });

const KIND_ORDER = Object.freeze({ marker: 0, room: 1, rack: 2 });
const TABLE_BY_KIND = Object.freeze({
  room: 'rooms',
  rack: 'storage_racks',
  marker: 'markers'
});

export class StorageValidationError extends Error {
  constructor(message, statusCode = 400, code = 'INVALID_STORAGE_LAYOUT') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const finiteNumber = (value, fallback, label = 'ค่า') => {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new StorageValidationError(`${label} ต้องเป็นตัวเลข`);
  return parsed;
};

export const normalizeRotation = (value, fallback = 0) => {
  const parsed = finiteNumber(value, fallback, 'องศาการหมุน');
  return ((parsed % 360) + 360) % 360;
};

export const normalizeLayerRows = (rows = []) => (
  [...rows]
    .sort((a, b) => {
      const zDiff = Number(a.z || 0) - Number(b.z || 0);
      if (zDiff !== 0) return zDiff;
      const kindDiff = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
      if (kindDiff !== 0) return kindDiff;
      return Number(a.id) - Number(b.id);
    })
    .map((row, index) => ({ ...row, z: index + 1 }))
);

const normalizeScope = (scope = {}) => {
  const planId = scope.planId == null ? null : Number(scope.planId);
  const roomId = scope.roomId == null ? null : Number(scope.roomId);
  const hasPlan = Number.isInteger(planId) && planId > 0;
  const hasRoom = Number.isInteger(roomId) && roomId > 0;
  if (hasPlan === hasRoom) {
    throw new StorageValidationError('ต้องระบุ planId หรือ roomId อย่างใดอย่างหนึ่ง');
  }
  return hasPlan ? { planId, roomId: null } : { planId: null, roomId };
};

export const getScopeLayers = (db, rawScope) => {
  const scope = normalizeScope(rawScope);
  // Unit tests and temporary databases may use the legacy schema. Keep layer
  // normalization compatible while production adds soft-delete columns.
  const active = (table) => db.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === 'deleted_at')
    ? ' AND deleted_at IS NULL'
    : '';
  const markerTypes = db.prepare('PRAGMA table_info(markers)').all().some((column) => column.name === 'type')
    ? " AND type IN ('wall','line')"
    : '';
  if (scope.planId) {
    return db.prepare(`
      SELECT 'marker' AS kind, id, COALESCE(z, 0) AS z FROM markers WHERE plan_id = @planId AND room_id IS NULL${markerTypes}${active('markers')}
      UNION ALL
      SELECT 'room' AS kind, id, COALESCE(z, 0) AS z FROM rooms WHERE plan_id = @planId${active('rooms')}
      UNION ALL
      SELECT 'rack' AS kind, id, COALESCE(z, 0) AS z FROM storage_racks WHERE plan_id = @planId AND room_id IS NULL${active('storage_racks')}
    `).all(scope);
  }
  return db.prepare(`
    SELECT 'marker' AS kind, id, COALESCE(z, 0) AS z FROM markers WHERE room_id = @roomId${markerTypes}${active('markers')}
    UNION ALL
    SELECT 'rack' AS kind, id, COALESCE(z, 0) AS z FROM storage_racks WHERE room_id = @roomId${active('storage_racks')}
  `).all(scope);
};

const scopeClause = (kind, scope) => {
  if (scope.planId) {
    if (kind === 'room') return { sql: 'id = @id AND plan_id = @planId', params: scope };
    return { sql: 'id = @id AND plan_id = @planId AND room_id IS NULL', params: scope };
  }
  if (kind === 'room') throw new StorageValidationError('ห้องไม่สามารถอยู่ภายในห้องอื่นได้');
  return { sql: 'id = @id AND room_id = @roomId', params: scope };
};

export const applyLayerOrder = (db, rawScope, rawOrder) => {
  const scope = normalizeScope(rawScope);
  const current = getScopeLayers(db, scope);
  if (!Array.isArray(rawOrder)) throw new StorageValidationError('order ต้องเป็น array');

  const order = rawOrder.map((entry) => ({ kind: String(entry?.kind || ''), id: Number(entry?.id) }));
  const keyOf = (entry) => `${entry.kind}:${entry.id}`;
  const currentKeys = new Set(current.map(keyOf));
  const requestedKeys = new Set(order.map(keyOf));
  const validKinds = scope.planId ? new Set(['room', 'rack', 'marker']) : new Set(['rack', 'marker']);

  const invalid = order.some((entry) => !validKinds.has(entry.kind) || !Number.isInteger(entry.id) || entry.id <= 0);
  if (invalid || requestedKeys.size !== order.length || order.length !== current.length
      || [...currentKeys].some((key) => !requestedKeys.has(key))) {
    throw new StorageValidationError(
      'รายการ layer ไม่ตรงกับข้อมูลล่าสุด กรุณาโหลดผังใหม่',
      409,
      'LAYER_CONFLICT'
    );
  }

  const update = db.transaction(() => {
    order.forEach((entry, index) => {
      const table = TABLE_BY_KIND[entry.kind];
      const clause = scopeClause(entry.kind, scope);
      const info = db.prepare(`UPDATE ${table} SET z = @z WHERE ${clause.sql}`)
        .run({ ...clause.params, id: entry.id, z: index + 1 });
      if (info.changes !== 1) {
        throw new StorageValidationError('ข้อมูล layer เปลี่ยนระหว่างบันทึก', 409, 'LAYER_CONFLICT');
      }
    });
  });
  update();
  return order.map((entry, index) => ({ ...entry, z: index + 1 }));
};

export const normalizeScopeLayers = (db, scope) => {
  const current = getScopeLayers(db, scope);
  const normalized = normalizeLayerRows(current);
  const needsRepair = normalized.some((entry, index) => Number(current.find((row) => row.kind === entry.kind && row.id === entry.id)?.z || 0) !== index + 1);
  if (needsRepair) applyLayerOrder(db, scope, normalized);
  return normalized;
};

export const normalizeAllStorageLayers = (db) => {
  const plans = db.prepare('SELECT id FROM floor_plans ORDER BY id').all();
  const hasDeletedAt = db.prepare('PRAGMA table_info(rooms)').all().some((column) => column.name === 'deleted_at');
  const rooms = db.prepare(`SELECT id FROM rooms${hasDeletedAt ? ' WHERE deleted_at IS NULL' : ''} ORDER BY id`).all();
  for (const plan of plans) normalizeScopeLayers(db, { planId: plan.id });
  for (const room of rooms) normalizeScopeLayers(db, { roomId: room.id });
};

export const nextLayerZ = (db, scope) => {
  const rows = getScopeLayers(db, scope);
  return rows.reduce((max, row) => Math.max(max, Number(row.z || 0)), 0) + 1;
};

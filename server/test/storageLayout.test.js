import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  applyLayerOrder,
  getScopeLayers,
  nextLayerZ,
  normalizeAllStorageLayers,
  StorageValidationError
} from '../utils/storageLayout.js';

const makeDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE floor_plans (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE rooms (id INTEGER PRIMARY KEY, plan_id INTEGER, z INTEGER);
    CREATE TABLE storage_racks (id INTEGER PRIMARY KEY, plan_id INTEGER, room_id INTEGER, z INTEGER);
    CREATE TABLE markers (id INTEGER PRIMARY KEY, plan_id INTEGER, room_id INTEGER, z INTEGER);
    INSERT INTO floor_plans (id, name) VALUES (1, 'Main');
    INSERT INTO rooms (id, plan_id, z) VALUES (10, 1, -1), (11, 1, 0);
    INSERT INTO storage_racks (id, plan_id, room_id, z) VALUES (20, 1, NULL, 0), (21, 1, 10, -3);
    INSERT INTO markers (id, plan_id, room_id, z) VALUES (30, 1, NULL, -2), (31, 1, 10, -4);
  `);
  return db;
};

test('repairs every floor and room scope to positive contiguous layers', () => {
  const db = makeDb();
  normalizeAllStorageLayers(db);
  const floor = getScopeLayers(db, { planId: 1 }).sort((a, b) => a.z - b.z);
  const room = getScopeLayers(db, { roomId: 10 }).sort((a, b) => a.z - b.z);
  assert.deepEqual(floor.map((entry) => entry.z), [1, 2, 3, 4]);
  assert.deepEqual(room.map((entry) => entry.z), [1, 2]);
  assert.equal(nextLayerZ(db, { planId: 1 }), 5);
  db.close();
});

test('persists a cross-kind layer order atomically', () => {
  const db = makeDb();
  normalizeAllStorageLayers(db);
  const order = [
    { kind: 'rack', id: 20 },
    { kind: 'room', id: 11 },
    { kind: 'marker', id: 30 },
    { kind: 'room', id: 10 }
  ];
  const result = applyLayerOrder(db, { planId: 1 }, order);
  assert.deepEqual(result.map((entry) => entry.z), [1, 2, 3, 4]);
  assert.deepEqual(
    getScopeLayers(db, { planId: 1 }).sort((a, b) => a.z - b.z).map(({ kind, id }) => ({ kind, id })),
    order
  );
  db.close();
});

test('rejects stale or incomplete layer payloads without changing data', () => {
  const db = makeDb();
  normalizeAllStorageLayers(db);
  const before = getScopeLayers(db, { planId: 1 }).sort((a, b) => a.z - b.z);
  assert.throws(
    () => applyLayerOrder(db, { planId: 1 }, [{ kind: 'room', id: 10 }]),
    (error) => error instanceof StorageValidationError && error.statusCode === 409 && error.code === 'LAYER_CONFLICT'
  );
  const after = getScopeLayers(db, { planId: 1 }).sort((a, b) => a.z - b.z);
  assert.deepEqual(after, before);
  db.close();
});


import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { restorePlanSnapshot, snapshotPlan, touchPlan } from '../utils/storageWorkflow.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE floor_plans (id INTEGER PRIMARY KEY, name TEXT, layout_status TEXT, layout_revision INTEGER, updated_at TEXT);
    CREATE TABLE rooms (id INTEGER PRIMARY KEY, plan_id INTEGER, name TEXT, is_storage INTEGER, pos_x REAL, pos_y REAL, width REAL, height REAL, rotation REAL, locked INTEGER, group_id TEXT, z INTEGER, deleted_at TEXT);
    CREATE TABLE storage_racks (id INTEGER PRIMARY KEY, plan_id INTEGER, room_id INTEGER, name TEXT, levels INTEGER, pos_x REAL, pos_y REAL, width REAL, height REAL, rotation REAL, locked INTEGER, capacity INTEGER, group_id TEXT, z INTEGER, deleted_at TEXT);
    CREATE TABLE markers (id INTEGER PRIMARY KEY, plan_id INTEGER, room_id INTEGER, type TEXT, text TEXT, pos_x REAL, pos_y REAL, width REAL, height REAL, rotation REAL, locked INTEGER, group_id TEXT, z INTEGER, deleted_at TEXT);
    CREATE TABLE items (item_id TEXT PRIMARY KEY, rack_id INTEGER);
    INSERT INTO floor_plans VALUES (1, 'Main', 'published', 4, CURRENT_TIMESTAMP);
    INSERT INTO rooms VALUES (10, 1, 'A', 1, 20, 30, 200, 120, 0, 0, NULL, 1, NULL);
    INSERT INTO storage_racks VALUES (20, 1, 10, 'R1', 3, 40, 50, 140, 84, 0, 0, 500, NULL, 1, NULL);
    INSERT INTO markers VALUES (30, 1, NULL, 'door', NULL, 60, 70, 64, 64, 0, 0, NULL, 2, NULL);
  `);
  return db;
};

test('touching a layout increments revision and returns it to draft', () => {
  const db = createDb();
  touchPlan(db, 1);
  const plan = db.prepare('SELECT layout_status AS status, layout_revision AS revision FROM floor_plans WHERE id = 1').get();
  assert.deepEqual(plan, { status: 'draft', revision: 5 });
  db.close();
});

test('version snapshots restore component geometry without changing ids', () => {
  const db = createDb();
  const snapshot = snapshotPlan(db, 1);
  db.prepare('UPDATE rooms SET pos_x = 700 WHERE id = 10').run();
  db.prepare("INSERT INTO markers VALUES (31, 1, NULL, 'label', 'new', 10, 10, 100, 30, 0, 0, NULL, 3, NULL)").run();
  restorePlanSnapshot(db, 1, snapshot);
  assert.equal(db.prepare('SELECT pos_x FROM rooms WHERE id = 10').get().pos_x, 20);
  assert.equal(db.prepare('SELECT deleted_at IS NOT NULL AS deleted FROM markers WHERE id = 31').get().deleted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM markers WHERE id = 30 AND deleted_at IS NULL').get().count, 1);
  db.close();
});

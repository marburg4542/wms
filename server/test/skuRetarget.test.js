import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { SKU_CHILD_TABLES, retargetSku } from '../utils/skuRetarget.js';

// จำลองตารางชุดเดียวกับของจริงเท่าที่เกี่ยวข้องกับการเปลี่ยนรหัสสินค้า
const makeDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE items (item_id TEXT PRIMARY KEY, item_seq TEXT, group_id TEXT, item_name TEXT, rack_id INTEGER, storage_level INTEGER);
    CREATE TABLE stock_in (id INTEGER PRIMARY KEY, item_id TEXT, quantity REAL);
    CREATE TABLE stock_out (id INTEGER PRIMARY KEY, item_id TEXT, quantity REAL);
    CREATE TABLE product_settings (item_id TEXT PRIMARY KEY, min_stock REAL);
    CREATE TABLE item_locations (id INTEGER PRIMARY KEY, item_id TEXT, rack_id INTEGER, storage_level INTEGER, room_id INTEGER, quantity REAL);
    CREATE TABLE wms_transaction_items (id INTEGER PRIMARY KEY, tx_id INTEGER, productId TEXT, sku TEXT);

    INSERT INTO items (item_id, item_seq, group_id, item_name) VALUES ('01042','042','01','ค้อน'), ('01043','043','01','ไขควง');
    INSERT INTO stock_in (item_id, quantity) VALUES ('01043', 10);
    INSERT INTO stock_out (item_id, quantity) VALUES ('01043', 2);
    INSERT INTO product_settings (item_id, min_stock) VALUES ('01043', 1);
    INSERT INTO item_locations (item_id, rack_id, storage_level, quantity) VALUES ('01043', 9, 3, 8);
    INSERT INTO wms_transaction_items (tx_id, productId, sku) VALUES (1, '01043', '01043');
  `);
  return db;
};

test('เปลี่ยนรหัสสินค้าแล้ว ตำแหน่งจัดเก็บต้องย้ายตามไปด้วย', () => {
  const db = makeDb();
  retargetSku(db, '01043', '01099', '099');

  const loc = db.prepare('SELECT item_id, rack_id, storage_level, quantity FROM item_locations').get();
  assert.equal(loc.item_id, '01099', 'ตำแหน่งจัดเก็บต้องผูกกับรหัสใหม่ ไม่ค้างอยู่กับรหัสเก่า');
  assert.equal(loc.quantity, 8);
  assert.equal(db.prepare('SELECT item_seq FROM items WHERE item_id = ?').get('01099').item_seq, '099');
});

test('ตารางลูกทุกตารางต้องย้ายตาม ไม่มีแถวไหนค้างอยู่กับรหัสเก่า', () => {
  const db = makeDb();
  retargetSku(db, '01043', '01099', '099');

  for (const { table, column } of SKU_CHILD_TABLES) {
    const stale = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${column} = '01043'`).get().c;
    assert.equal(stale, 0, `${table}.${column} ยังค้างอยู่กับรหัสเก่า`);
    const moved = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${column} = '01099'`).get().c;
    assert.ok(moved > 0, `${table}.${column} ไม่ได้ย้ายมารหัสใหม่`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM items WHERE item_id = '01043'").get().c, 0);
});

// เทสต์ตัวสำคัญ: ไล่ดู schema จริงของฐานข้อมูล แล้วฟ้องถ้ามีตารางที่อ้างรหัสสินค้าแต่ไม่ได้อยู่ในรายชื่อ
// บั๊กเดิมเกิดจากตาราง item_locations ถูกเพิ่มทีหลังแล้วลืมมาเติมในจุดที่เปลี่ยนรหัส
test('รายชื่อตารางลูกต้องครบตาม schema จริง (กันลืมตอนเพิ่มตารางใหม่)', async () => {
  // ชี้ DB_FILE ไปไฟล์ชั่วคราวก่อน import db.js — จะได้ schema จริงครบทุกตารางโดยไม่ไปแตะฐานข้อมูลที่ใช้งานอยู่
  const tmp = path.join(os.tmpdir(), `wms-schema-check-${process.pid}.sqlite`);
  process.env.DB_FILE = tmp;
  const dbModule = await import('../db.js');
  const live = dbModule.default;
  const listed = new Set(SKU_CHILD_TABLES.map(({ table, column }) => `${table}.${column}`));

  const missing = [];
  for (const { name } of live.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    if (name === 'items') continue; // ตารางหลัก จัดการแยกใน retargetSku
    for (const col of live.pragma(`table_info(${name})`)) {
      if (!/^(item_id|productId|sku)$/i.test(col.name)) continue;
      if (!listed.has(`${name}.${col.name}`)) missing.push(`${name}.${col.name}`);
    }
  }
  live.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${tmp}${suffix}`, { force: true });
  assert.deepEqual(missing, [], `มีตารางที่อ้างรหัสสินค้าแต่ยังไม่ได้ใส่ใน SKU_CHILD_TABLES: ${missing.join(', ')}`);
});

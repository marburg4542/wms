import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  getItemLocations,
  getPlacedTotal,
  LocationError,
  moveQuantity,
  setLocationQuantity,
  syncPrimaryLocation
} from '../utils/itemLocations.js';

// ฐานข้อมูลจำลองเล็กๆ: สินค้า HAMMER มีของ 5 ชิ้น, ชั้นวาง 2 ตัว (3 เลเวล), พื้นที่ 1 แห่ง
const makeDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE items (item_id TEXT PRIMARY KEY, rack_id INTEGER, storage_level INTEGER, primary_room_id INTEGER);
    CREATE TABLE rooms (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
    CREATE TABLE storage_racks (id INTEGER PRIMARY KEY, name TEXT, levels INTEGER, room_id INTEGER, deleted_at TEXT);
    CREATE TABLE item_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL, rack_id INTEGER, storage_level INTEGER, room_id INTEGER,
      quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      note TEXT, created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      CHECK ((rack_id IS NOT NULL AND room_id IS NULL) OR (rack_id IS NULL AND room_id IS NOT NULL))
    );
    CREATE VIEW warehouse_balance AS SELECT 'HAMMER' AS item_id, 5 AS stock_balance;
    INSERT INTO items (item_id) VALUES ('HAMMER');
    INSERT INTO rooms (id, name) VALUES (1, 'โซนจัดเตรียม TAI');
    INSERT INTO storage_racks (id, name, levels) VALUES (10, 'A1', 3), (11, 'A2', 3);
  `);
  return db;
};

const qtyAt = (db, where) => {
  const row = db.prepare(`SELECT quantity FROM item_locations WHERE item_id = 'HAMMER' AND ${where}`).get();
  return row ? Number(row.quantity) : 0;
};

test('วางของที่ชั้นวางแล้วอ่านกลับมาได้ พร้อมบอกส่วนที่ยังไม่ระบุตำแหน่ง', () => {
  const db = makeDb();
  const result = setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 4 });
  assert.equal(result.stock, 5);
  assert.equal(result.placed, 4);
  assert.equal(result.unplaced, 1, 'เหลืออีก 1 ที่ยังไม่ได้ระบุตำแหน่ง');
  assert.equal(result.locations.length, 1);
});

test('สินค้าตัวเดียวกันวางได้หลายที่พร้อมกัน', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 4 });
  setLocationQuantity(db, { itemId: 'HAMMER', roomId: 1, quantity: 1 });
  const { locations, placed, unplaced } = getItemLocations(db, 'HAMMER');
  assert.equal(locations.length, 2);
  assert.equal(placed, 5);
  assert.equal(unplaced, 0);
  assert.equal(qtyAt(db, 'rack_id = 10'), 4);
  assert.equal(qtyAt(db, 'room_id = 1'), 1);
});

test('วางรวมกันเกินยอดคงเหลือไม่ได้', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 4 });
  assert.throws(
    () => setLocationQuantity(db, { itemId: 'HAMMER', rackId: 11, quantity: 2 }),
    (err) => err instanceof LocationError && /วางที่นี่ได้ไม่เกิน 1/.test(err.message)
  );
  assert.equal(getPlacedTotal(db, 'HAMMER'), 4, 'ของเดิมต้องไม่ถูกแตะ');
});

test('แก้จำนวนที่ตำแหน่งเดิมได้ ไม่สร้างแถวซ้ำ', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 4 });
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 2 });
  const { locations, placed } = getItemLocations(db, 'HAMMER');
  assert.equal(locations.length, 1);
  assert.equal(placed, 2);
});

test('ตั้งจำนวนเป็น 0 = เอาสินค้าออกจากตำแหน่งนั้น', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 4 });
  const result = setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 0 });
  assert.equal(result.locations.length, 0);
  assert.equal(result.unplaced, 5);
});

test('เลเวลคนละชั้นของชั้นวางเดียวกันนับเป็นคนละตำแหน่ง', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 2 });
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 2, quantity: 3 });
  assert.equal(getItemLocations(db, 'HAMMER').locations.length, 2);
  assert.equal(getPlacedTotal(db, 'HAMMER'), 5);
});

test('ตรวจค่าที่ไม่ถูกต้อง', () => {
  const db = makeDb();
  assert.throws(() => setLocationQuantity(db, { itemId: 'NOPE', rackId: 10, quantity: 1 }), /ไม่พบสินค้า/);
  assert.throws(() => setLocationQuantity(db, { itemId: 'HAMMER', rackId: 999, quantity: 1 }), /ไม่พบชั้นวาง/);
  assert.throws(() => setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 9, quantity: 1 }), /เลเวลต้องอยู่ระหว่าง 1 ถึง 3/);
  assert.throws(() => setLocationQuantity(db, { itemId: 'HAMMER', quantity: 1 }), /ชั้นวางหรือพื้นที่อย่างใดอย่างหนึ่ง/);
  assert.throws(() => setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, roomId: 1, quantity: 1 }), /อย่างใดอย่างหนึ่ง/);
  assert.throws(() => setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, quantity: -1 }), /ไม่ติดลบ/);
});

test('ตำแหน่งหลักใน items sync ตามที่ที่มีของมากสุด', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 1 });
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 11, storageLevel: 2, quantity: 4 });
  let row = db.prepare("SELECT rack_id, storage_level FROM items WHERE item_id = 'HAMMER'").get();
  assert.deepEqual(row, { rack_id: 11, storage_level: 2 }, 'ชั้นที่มีของมากสุดต้องเป็นตำแหน่งหลัก');

  // เอาของออกจากชั้นที่มากสุด → ตำแหน่งหลักต้องเลื่อนไปชั้นที่เหลือ
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 11, storageLevel: 2, quantity: 0 });
  row = db.prepare("SELECT rack_id, storage_level FROM items WHERE item_id = 'HAMMER'").get();
  assert.deepEqual(row, { rack_id: 10, storage_level: 1 });

  // ไม่เหลือที่ไหนเลย → ตำแหน่งหลักต้องว่าง
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 0 });
  assert.deepEqual(syncPrimaryLocation(db, 'HAMMER'), null);
  row = db.prepare("SELECT rack_id, storage_level FROM items WHERE item_id = 'HAMMER'").get();
  assert.deepEqual(row, { rack_id: null, storage_level: null });
});

test('ของวางกับพื้นในพื้นที่ ไม่ถูกนับเป็นตำแหน่งหลักของชั้นวาง', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', roomId: 1, quantity: 5 });
  const row = db.prepare("SELECT rack_id FROM items WHERE item_id = 'HAMMER'").get();
  assert.equal(row.rack_id, null);
  assert.equal(getPlacedTotal(db, 'HAMMER'), 5);
});

test('ย้ายของบางส่วนจากชั้นวางไปพื้นที่จัดเตรียม', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 5 });
  // ลูกค้าสั่ง 1 → แยกออกไปโซนจัดเตรียม เหลือบนชั้น 4
  const result = moveQuantity(db, {
    itemId: 'HAMMER',
    from: { rackId: 10, storageLevel: 1 },
    to: { roomId: 1 },
    quantity: 1
  });
  assert.equal(qtyAt(db, 'rack_id = 10'), 4);
  assert.equal(qtyAt(db, 'room_id = 1'), 1);
  assert.equal(result.placed, 5, 'ผลรวมต้องเท่าเดิม');
  assert.equal(result.unplaced, 0);
});

test('ย้ายทั้งหมดออกจากตำแหน่งต้นทาง แถวต้นทางต้องหายไป', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 3 });
  moveQuantity(db, { itemId: 'HAMMER', from: { rackId: 10, storageLevel: 1 }, to: { rackId: 11 }, quantity: 3 });
  assert.equal(qtyAt(db, 'rack_id = 10'), 0);
  assert.equal(qtyAt(db, 'rack_id = 11'), 3);
  assert.equal(getItemLocations(db, 'HAMMER').locations.length, 1);
});

test('ย้ายมากกว่าที่มีอยู่ต้นทางไม่ได้', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 2 });
  assert.throws(
    () => moveQuantity(db, { itemId: 'HAMMER', from: { rackId: 10, storageLevel: 1 }, to: { roomId: 1 }, quantity: 5 }),
    /ย้ายได้ไม่เกิน/
  );
  assert.equal(qtyAt(db, 'rack_id = 10'), 2, 'ของต้องไม่ถูกแตะเมื่อย้ายไม่สำเร็จ');
  assert.equal(qtyAt(db, 'room_id = 1'), 0);
});

test('ย้ายจากตำแหน่งที่ไม่มีสินค้าอยู่ไม่ได้', () => {
  const db = makeDb();
  assert.throws(
    () => moveQuantity(db, { itemId: 'HAMMER', from: { rackId: 10 }, to: { roomId: 1 }, quantity: 1 }),
    /ไม่พบสินค้าที่ตำแหน่งต้นทาง/
  );
});

// --- เคสที่ผู้ใช้เจอจริง: เติมของเข้าที่เดิมแล้วจำนวนถูกทับแทนที่จะบวกเพิ่ม ---
// สถานการณ์: แบตเตอรี่มี 23 อยู่ในโซน 23 → เบิกออก 1 (โซนเหลือ 22) → ปรับยอดคืนเป็น 23
//            ตอนนี้โซนมี 22 ยังไม่ได้วาง 1 → กด "เพิ่มสินค้าเข้าพื้นที่นี้" ต้องได้ 23 ไม่ใช่ 1
test('เติมของเข้าตำแหน่งที่มีอยู่แล้ว ต้องบวกเพิ่ม ไม่ใช่เขียนทับ', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', roomId: 1, quantity: 4 });   // มีอยู่แล้ว 4
  assert.equal(getItemLocations(db, 'HAMMER').unplaced, 1, 'เหลือยังไม่ได้วาง 1');

  // เติมส่วนที่เหลือเข้าไปที่เดิม
  const result = setLocationQuantity(db, { itemId: 'HAMMER', roomId: 1, quantity: 1, mode: 'add' });
  assert.equal(qtyAt(db, 'room_id = 1'), 5, 'ต้องเป็น 4+1=5 ไม่ใช่ 1');
  assert.equal(result.unplaced, 0);
});

test('โหมด add กับตำแหน่งที่ยังไม่มีสินค้า = เพิ่มปกติ', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 2, mode: 'add' });
  assert.equal(qtyAt(db, 'rack_id = 10'), 2);
});

test('โหมด add ยังห้ามเกินยอดคงเหลือ', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', roomId: 1, quantity: 4 });
  assert.throws(
    () => setLocationQuantity(db, { itemId: 'HAMMER', roomId: 1, quantity: 5, mode: 'add' }),
    /วางเกินยอดคงเหลือ/
  );
  assert.equal(qtyAt(db, 'room_id = 1'), 4, 'ของเดิมต้องไม่ถูกแตะเมื่อเกิน');
});

test('โหมดปกติ (set) ยังเขียนทับเหมือนเดิม — ใช้ตอนแก้ตัวเลขในตาราง', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', roomId: 1, quantity: 4 });
  setLocationQuantity(db, { itemId: 'HAMMER', roomId: 1, quantity: 2 });
  assert.equal(qtyAt(db, 'room_id = 1'), 2, 'แก้เป็น 2 ต้องได้ 2 ไม่ใช่ 6');
});

// ---- ข้อมูลที่วางเกินยอดคงเหลืออยู่ก่อนแล้ว (เกิดจากบั๊กเก่า) ต้องยังแก้ไข/ย้ายได้ ----
// กฎคือ "ห้ามทำให้แย่ลง" ไม่ใช่ "ห้ามเกิน" — ไม่งั้นข้อมูลเพี้ยนจะล็อกตาย แก้ไม่ได้นอกจากลบทิ้ง
const overPlaced = (db) => {
  // ยัดของเกินยอดคงเหลือเข้าไปตรงๆ เลียนแบบข้อมูลที่เพี้ยนมาจากอดีต (stock ของ HAMMER = 5)
  db.prepare("INSERT INTO item_locations (item_id, rack_id, storage_level, quantity) VALUES ('HAMMER', 10, 1, 60)").run();
  db.prepare("INSERT INTO item_locations (item_id, rack_id, storage_level, quantity) VALUES ('HAMMER', 10, 2, 1)").run();
};

test('ของที่วางเกินยอดอยู่ก่อนแล้ว ย้ายไปที่อื่นได้ (ยอดรวมไม่เพิ่ม)', () => {
  const db = makeDb();
  overPlaced(db);
  moveQuantity(db, { itemId: 'HAMMER', from: { rackId: 10, storageLevel: 2 }, to: { rackId: 11, storageLevel: 1 }, quantity: 1 });
  assert.equal(qtyAt(db, 'rack_id = 11 AND storage_level = 1'), 1, 'ต้องย้ายไปชั้น A2 ได้');
  assert.equal(qtyAt(db, 'rack_id = 10 AND storage_level = 2'), 0, 'ต้นทางต้องว่าง');
  assert.equal(getPlacedTotal(db, 'HAMMER'), 61, 'ยอดวางรวมต้องเท่าเดิม');
});

test('ของที่วางเกินยอดอยู่ก่อนแล้ว ลดจำนวนลงได้', () => {
  const db = makeDb();
  overPlaced(db);
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 4 });
  assert.equal(qtyAt(db, 'rack_id = 10 AND storage_level = 1'), 4);
  assert.equal(getPlacedTotal(db, 'HAMMER'), 5, 'ลดแล้วยอดรวมต้องลดตาม');
});

test('ของที่วางเกินยอดอยู่ก่อนแล้ว เพิ่มของเข้าไปอีกไม่ได้', () => {
  const db = makeDb();
  overPlaced(db);
  assert.throws(
    () => setLocationQuantity(db, { itemId: 'HAMMER', rackId: 11, storageLevel: 1, quantity: 1 }),
    LocationError,
    'ยอดรวมกำลังจะเพิ่มจาก 61 เป็น 62 ต้องถูกปฏิเสธ'
  );
  assert.equal(getPlacedTotal(db, 'HAMMER'), 61, 'ข้อมูลต้องไม่ถูกแตะ');
});

test('กรณีปกติ (ไม่ได้วางเกิน) ยังกันการวางเกินยอดคงเหลือเหมือนเดิม', () => {
  const db = makeDb();
  setLocationQuantity(db, { itemId: 'HAMMER', rackId: 10, storageLevel: 1, quantity: 5 });
  assert.throws(
    () => setLocationQuantity(db, { itemId: 'HAMMER', rackId: 11, storageLevel: 1, quantity: 1 }),
    LocationError
  );
});

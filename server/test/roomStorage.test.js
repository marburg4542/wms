// เก็บของในห้องโดยตรง (ไม่ต้องมีชั้นวาง) + ลบสินค้าถาวรที่ยังผูกตำแหน่งอยู่
//
// ห้องเล็กที่เก็บของชิ้นใหญ่ไม่ต้องสร้างชั้นวาง/พื้นที่วางพื้นขึ้นมาซ้อนอีกชั้น จึงต้องวางของเข้าห้องได้เลย
// และ "ลบถาวร" ต้องถอนตำแหน่งบนผังคลังไปด้วย ไม่งั้นฐานข้อมูลปฏิเสธคำสั่งลบ (item_locations อ้าง items ด้วย FK)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempDatabase, call, callOk } from './helpers/apiHarness.js';

const temp = createTempDatabase('room-storage');
const { default: db } = await import('../db.js');
const products = await import('../controllers/productController.js');
const racks = await import('../controllers/rackController.js');
const rooms = await import('../controllers/roomController.js');
const storage = await import('../controllers/storageItemController.js');

const planId = db.prepare('SELECT id FROM floor_plans LIMIT 1').get().id;

const smallRoom = await callOk('addRoom (ห้องเล็ก)', rooms.addRoom, {
  body: { name: 'ห้องของชิ้นใหญ่', isStorage: true, planId, posX: 20, posY: 20, width: 200, height: 160 }
});
const otherRoom = await callOk('addRoom (ห้องที่สอง)', rooms.addRoom, {
  body: { name: 'ห้องปลายทาง', isStorage: true, planId, posX: 300, posY: 20, width: 200, height: 160 }
});
const shelf = await callOk('addRack', racks.addRack, {
  body: { name: 'ชั้น R1', levels: 3, roomId: smallRoom.room.id, posX: 20, posY: 20 }
});

const roomId = smallRoom.room.id;
const placedIn = (sku, room) => db.prepare('SELECT quantity FROM item_locations WHERE item_id = ? AND room_id = ?').get(sku, room)?.quantity ?? 0;

test('สร้างสินค้าแล้วเลือกห้องเป็นที่เก็บได้เลย — สต็อกตั้งต้นไปวางในห้อง', async () => {
  const made = await callOk('createProduct (roomId)', products.createProduct, {
    body: { name: 'ตู้ควบคุมชิ้นใหญ่', groupId: '01', groupName: 'ทดสอบ', unit: 'ตู้', initialStock: 3, roomId }
  });
  assert.equal(placedIn(made.sku, roomId), 3);
  const row = db.prepare('SELECT rack_id, storage_level FROM item_locations WHERE item_id = ?').get(made.sku);
  assert.equal(row.rack_id, null, 'ของในห้องต้องไม่ผูกชั้นวาง');
  assert.equal(row.storage_level, null, 'ห้องไม่มีเลเวล');
});

test('เลือกทั้งชั้นวางและห้องมาพร้อมกัน — ยึดชั้นวาง (ตำแหน่งต้องมีอย่างเดียว)', async () => {
  const made = await callOk('createProduct (rack + room)', products.createProduct, {
    body: {
      name: 'ของที่เลือกมาทั้งสองแบบ', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น',
      initialStock: 2, rackId: shelf.rack.id, storageLevel: 2, roomId
    }
  });
  assert.equal(placedIn(made.sku, roomId), 0);
  const row = db.prepare('SELECT rack_id, storage_level, quantity FROM item_locations WHERE item_id = ?').get(made.sku);
  assert.deepEqual([row.rack_id, row.storage_level, row.quantity], [shelf.rack.id, 2, 2]);
});

test('ตารางของในห้อง (getRoomItems) เห็นของที่วางในห้องโดยตรง', async () => {
  const made = await callOk('createProduct', products.createProduct, {
    body: { name: 'แผงเหล็กใหญ่', groupId: '01', groupName: 'ทดสอบ', unit: 'แผง', initialStock: 6, roomId }
  });
  const result = await callOk('getRoomItems', storage.getRoomItems, { params: { id: String(roomId) } });
  assert.equal(result.room.name, 'ห้องของชิ้นใหญ่');
  const row = result.items.find((item) => item.sku === made.sku);
  assert.ok(row, 'ต้องเจอสินค้าที่วางในห้อง');
  assert.equal(row.qtyHere, 6);
  assert.equal(row.stock, 6);

  const missing = await call(storage.getRoomItems, { params: { id: '999999' } });
  assert.equal(missing.status, 404);
});

test('แก้จำนวน / เอาออก / ย้ายของในห้องได้ครบเหมือนชั้นวาง', async () => {
  const made = await callOk('createProduct', products.createProduct, {
    body: { name: 'มอเตอร์ใหญ่', groupId: '01', groupName: 'ทดสอบ', unit: 'ตัว', initialStock: 10, roomId }
  });
  const sku = made.sku;

  // แก้จำนวนที่วางในห้อง
  await callOk('assign (ตั้งจำนวนใหม่)', storage.assignItemLocation, { body: { sku, roomId, quantity: 7 } });
  assert.equal(placedIn(sku, roomId), 7);

  // ย้ายจากห้องขึ้นชั้นวาง (ชั้นที่แบ่งเลเวลต้องระบุเลเวล)
  await callOk('move ห้อง → ชั้นวาง', storage.moveItemQuantity, {
    body: { sku, from: { roomId }, to: { rackId: shelf.rack.id, storageLevel: 3 }, quantity: 4 }
  });
  assert.equal(placedIn(sku, roomId), 3);
  assert.equal(db.prepare('SELECT quantity FROM item_locations WHERE item_id = ? AND rack_id = ? AND storage_level = 3').get(sku, shelf.rack.id).quantity, 4);

  // ย้ายข้ามห้อง
  await callOk('move ห้อง → ห้อง', storage.moveItemQuantity, {
    body: { sku, from: { roomId }, to: { roomId: otherRoom.room.id }, quantity: 3 }
  });
  assert.equal(placedIn(sku, roomId), 0);
  assert.equal(placedIn(sku, otherRoom.room.id), 3);

  // เอาออกจากห้องปลายทาง — ยอดคงเหลือรวมไม่เปลี่ยน
  await callOk('assign (เอาออก)', storage.assignItemLocation, { body: { sku, roomId: otherRoom.room.id, quantity: 0 } });
  assert.equal(placedIn(sku, otherRoom.room.id), 0);
  assert.equal(db.prepare('SELECT stock_balance FROM warehouse_balance WHERE item_id = ?').get(sku).stock_balance, 10);
});

test('ลบสินค้าถาวรได้แม้ยังผูกตำแหน่งอยู่ — ตำแหน่งถูกถอนออกไปด้วย', async () => {
  const made = await callOk('createProduct', products.createProduct, {
    body: { name: 'ของที่จะลบถาวร', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น', initialStock: 5, roomId }
  });
  const sku = made.sku;
  await callOk('assign เพิ่มอีกจุด', storage.assignItemLocation, {
    body: { sku, rackId: shelf.rack.id, level: 1, quantity: 0 }
  });
  await callOk('move ไปชั้นวาง', storage.moveItemQuantity, {
    body: { sku, from: { roomId }, to: { rackId: shelf.rack.id, storageLevel: 1 }, quantity: 2 }
  });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM item_locations WHERE item_id = ?').get(sku).c, 2);

  // ต้องปิดใช้งานก่อน แล้วจึงลบถาวรได้ (ทางเดียวกับที่หน้าเว็บทำ)
  await callOk('deleteProduct (ปิดใช้งาน)', products.deleteProduct, { params: { id: sku } });
  const removed = await callOk('permanentlyDeleteProduct', products.permanentlyDeleteProduct, { params: { id: sku } });
  assert.match(removed.message, /ถอนออกจากผังคลัง 2 จุด รวม 5 ชิ้น/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM item_locations WHERE item_id = ?').get(sku).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM items WHERE item_id = ?').get(sku).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM stock_in WHERE item_id = ?').get(sku).c, 0);
});

test.after(() => temp.cleanup(db));

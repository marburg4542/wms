// ยิงทุก endpoint หลักด้วยข้อมูลจริงที่สร้างผ่าน API เอง — จับ SQL ที่พัง (ลืม JOIN / คอลัมน์หาย)
// ซึ่งเทสต์ตรรกะล้วนๆ จับไม่ได้เลย
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempDatabase, call, callOk } from './helpers/apiHarness.js';

const temp = createTempDatabase('endpoints');
const { default: db } = await import('../db.js');
const products = await import('../controllers/productController.js');
const racks = await import('../controllers/rackController.js');
const rooms = await import('../controllers/roomController.js');
const storage = await import('../controllers/storageItemController.js');
const transactions = await import('../controllers/transactionController.js');

// ---- สร้างคลังจำลองให้ครบทุกชนิดที่ระบบรองรับ ----
const planId = db.prepare('SELECT id FROM floor_plans LIMIT 1').get().id;
const project = db.prepare("INSERT INTO projects (name, norm) VALUES ('โครงการทดสอบ', 'โครงการทดสอบ')").run();

const room = await callOk('addRoom', rooms.addRoom, {
  body: { name: 'ห้องทดสอบ', isStorage: true, planId, posX: 20, posY: 20, width: 400, height: 300 }
});
const shelf = await callOk('addRack (ชั้นวาง)', racks.addRack, {
  body: { name: 'ชั้น T1', levels: 3, roomId: room.room.id, posX: 20, posY: 20 }
});
const floorZone = await callOk('addRack (พื้นที่วางพื้น)', racks.addRack, {
  body: { name: 'พื้นโซน T', isFloor: true, roomId: room.room.id, posX: 300, posY: 20 }
});
const stagingZone = await callOk('addRack (พื้นที่จัดเตรียม)', racks.addRack, {
  body: { name: 'จัดเตรียม T', isFloor: true, projectId: project.lastInsertRowid, roomId: room.room.id, posX: 20, posY: 300 }
});
const made = await callOk('createProduct', products.createProduct, {
  body: { name: 'สินค้าทดสอบ', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น', latestCost: 25, initialStock: 20, rackId: shelf.rack.id, storageLevel: 1 }
});
const sku = made.sku;

// กระจายของไปหลายที่ ให้ครอบคลุมทั้งชั้นวาง พื้นที่วางพื้น และพื้นที่จัดเตรียม
await callOk('moveItemQuantity → พื้นที่วางพื้น', storage.moveItemQuantity, {
  body: { sku, from: { rackId: shelf.rack.id, storageLevel: 1 }, to: { rackId: floorZone.rack.id, storageLevel: 1 }, quantity: 5 }
});
await callOk('moveItemQuantity → พื้นที่จัดเตรียม', storage.moveItemQuantity, {
  body: { sku, from: { rackId: shelf.rack.id, storageLevel: 1 }, to: { rackId: stagingZone.rack.id, storageLevel: 1 }, quantity: 4 }
});

// ใบเบิก 1 ใบ ให้มีข้อมูลสำหรับเส้นทางหยิบของ
const outbound = await callOk('createOutboundRequest', transactions.createOutboundRequest, {
  body: { project: 'โครงการทดสอบ', items: [{ productId: sku, quantity: 2 }] },
  user: { username: 'tester', role: 'Operator' }
});

test('endpoint อ่านข้อมูลทุกตัวต้องรันได้จริง', async () => {
  const cases = [
    ['รายการสินค้า', products.getProducts, { query: { limit: '50' } }],
    ['รายการสินค้า + ค้นหา', products.getProducts, { query: { limit: '20', search: 'ทดสอบ' } }],
    ['รายการสินค้า + รวมที่ปิดใช้งาน', products.getProducts, { query: { limit: '20', includeInactive: '1' } }],
    ['หมวดหมู่สินค้า', products.getProductGroups, {}],
    ['SKU ถัดไป', products.getNextSku, { query: { group: '01' } }],
    ['ประวัติราคาต่อ lot', products.getPriceHistory, { params: { id: sku } }],
    ['สรุปหน้าแรก', products.getDashboardStats, {}],
    ['ชั้นวางทั้งหมด', racks.listRacks, {}],
    ['ชั้นวางในห้อง', racks.listRacks, { query: { room: String(room.room.id) } }],
    ['ชั้นวางบนผัง', racks.listRacks, { query: { plan: String(planId) } }],
    ['ชั้นวางลอย (ไม่อยู่ในห้อง)', racks.listRacks, { query: { plan: String(planId), floor: '1' } }],
    ['รายละเอียดชั้นวาง', racks.getRack, { params: { id: String(shelf.rack.id) } }],
    ['รายละเอียดพื้นที่จัดเตรียม', racks.getRack, { params: { id: String(stagingZone.rack.id) } }],
    ['ห้องทั้งหมด', rooms.listRooms, {}],
    ['สินค้ายังไม่ระบุตำแหน่ง', storage.listUnassignedItems, { query: { limit: '100' } }],
    ['สินค้ายังไม่ระบุตำแหน่ง + ค้นหา', storage.listUnassignedItems, { query: { limit: '20', search: 'ทดสอบ' } }],
    ['ตำแหน่งของสินค้า', storage.getLocationsOfItem, { params: { sku } }],
    ['เส้นทางหยิบของ', storage.getPickList, { params: { txId: outbound.transactionId } }],
    ['ประวัติใบเบิก', transactions.getTransactions, { query: { limit: '20' } }],
    ['ประวัติย้อนหลัง', transactions.getHistory, { query: { limit: '20' } }]
  ];

  for (const [name, handler, options] of cases) {
    const result = await call(handler, options);
    assert.equal(result.success, true, `${name} ล้มเหลว (${result.status}): ${result.message}`);
  }
});

test('รายละเอียดชั้นวางส่งประเภทและโครงการกลับมาถูกต้อง', async () => {
  const plain = await callOk('getRack', racks.getRack, { params: { id: String(shelf.rack.id) } });
  assert.equal(Number(plain.rack.isFloor), 0);
  assert.equal(plain.rack.projectId, null);

  const staging = await callOk('getRack', racks.getRack, { params: { id: String(stagingZone.rack.id) } });
  assert.equal(Number(staging.rack.isFloor), 1, 'พื้นที่จัดเตรียมต้องเป็นพื้นที่วางพื้น');
  assert.equal(staging.rack.projectName, 'โครงการทดสอบ', 'ต้องส่งชื่อโครงการกลับมาด้วย (เคยลืม JOIN แล้วพังทั้งหน้า)');
});

test('การ์ดสินค้าบอกตำแหน่งได้ทั้งชั้นวาง พื้นที่วางพื้น และห้อง', async () => {
  const list = await callOk('getProducts', products.getProducts, { query: { limit: '100' } });
  const row = (list.products || list.items).find((item) => item.sku === sku);
  assert.ok(row, 'ต้องเจอสินค้าที่เพิ่งสร้าง');
  assert.ok('isFloorZone' in row, 'ต้องบอกได้ว่าตำแหน่งเป็นพื้นที่วางพื้นหรือไม่');
  assert.ok('roomName' in row, 'ต้องรองรับตำแหน่งที่เป็นห้อง/โซน');
});

test('เส้นทางหยิบของแสดงครบทุกจุดที่ของวางอยู่', async () => {
  const route = await callOk('getPickList', storage.getPickList, { params: { txId: outbound.transactionId } });
  const mine = route.items.filter((item) => item.sku === sku);
  assert.equal(mine.length, 3, 'ของกระจาย 3 ที่ ต้องขึ้นครบ 3 จุด ไม่ใช่แค่ตำแหน่งหลัก');
  assert.equal(new Set(mine.map((item) => item.pickKey)).size, 3, 'แต่ละจุดต้องมี key ไม่ซ้ำ (ติ๊กแยกกันได้)');
  for (const item of mine) assert.ok(Number(item.qtyHere) > 0, 'ต้องบอกว่าจุดนั้นมีของกี่ชิ้น');
  assert.equal(route.stops, 3, 'ต้องนับจุดแวะครบ');
});

test.after(() => temp.cleanup(db));

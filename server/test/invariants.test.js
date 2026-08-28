// จำลองการใช้งานจริงตั้งแต่ต้นจนจบ แล้วตรวจว่ากติกาของข้อมูลไม่เคยถูกละเมิดในทุกขั้น
//
// บั๊กที่เจอมาทั้งหมดในโปรเจกต์นี้ (ตำแหน่งผูกผิดตัว, วางเกินยอด, ปรับยอดแล้วชั้นไม่ลดตาม)
// ล้วนเป็น "ข้อมูลผิดกติกา" ที่ไม่มีใครฟ้อง ณ ตอนเกิด ชุดนี้จึงตรวจหลังทุกก้าว
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempDatabase, call, callOk } from './helpers/apiHarness.js';
import { INVARIANTS, findViolations } from './helpers/invariants.js';

const temp = createTempDatabase('invariants');
const { default: db } = await import('../db.js');
const products = await import('../controllers/productController.js');
const racks = await import('../controllers/rackController.js');
const rooms = await import('../controllers/roomController.js');
const storage = await import('../controllers/storageItemController.js');
const transactions = await import('../controllers/transactionController.js');

const assertClean = (step) => {
  const violations = findViolations(db);
  assert.deepEqual(
    violations.map((v) => `${v.name} (${v.rows.length})`),
    [],
    `หลัง "${step}" ข้อมูลผิดกติกา`
  );
};

const planId = db.prepare('SELECT id FROM floor_plans LIMIT 1').get().id;
const projectId = db.prepare("INSERT INTO projects (name, norm) VALUES ('TESTPROJ', 'testproj')").run().lastInsertRowid;
const room = (await callOk('addRoom', rooms.addRoom, {
  body: { name: 'ห้อง', isStorage: true, planId, posX: 10, posY: 10, width: 400, height: 300 }
})).room;
const shelf = (await callOk('addRack', racks.addRack, { body: { name: 'S1', levels: 3, roomId: room.id, posX: 10, posY: 10 } })).rack;
const zone = (await callOk('addRack', racks.addRack, { body: { name: 'Z1', isFloor: true, projectId, roomId: room.id, posX: 200, posY: 10 } })).rack;

let sku;   // ตั้งค่าในเทสต์แรก — เทสต์ที่เหลือใช้ต่อกันเป็นลำดับ
const stock = (sku) => Number(db.prepare('SELECT stock_balance s FROM warehouse_balance WHERE item_id = ?').get(sku)?.s || 0);
const placed = (sku) => Number(db.prepare('SELECT COALESCE(SUM(quantity), 0) t FROM item_locations WHERE item_id = ?').get(sku).t);

test('สร้างสินค้าพร้อมวางบนชั้น แล้วข้อมูลยังถูกกติกา', async () => {
  const made = await callOk('createProduct', products.createProduct, {
    body: { name: 'ของทดสอบ', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น', latestCost: 10, initialStock: 30, rackId: shelf.id, storageLevel: 2 }
  });
  sku = made.sku;
  assert.equal(stock(made.sku), 30);
  assert.equal(placed(made.sku), 30, 'สต็อกตั้งต้นต้องถูกวางลงชั้นให้ครบ');
  assertClean('สร้างสินค้า');
});

test('ย้ายของข้ามชั้นและเข้าพื้นที่จัดเตรียม ยอดรวมต้องไม่เปลี่ยน', async () => {
  await callOk('move → เลเวลอื่น', storage.moveItemQuantity, {
    body: { sku, from: { rackId: shelf.id, storageLevel: 2 }, to: { rackId: shelf.id, storageLevel: 3 }, quantity: 10 }
  });
  await callOk('move → พื้นที่จัดเตรียม', storage.moveItemQuantity, {
    body: { sku, from: { rackId: shelf.id, storageLevel: 2 }, to: { rackId: zone.id, storageLevel: 1 }, quantity: 8 }
  });
  assert.equal(placed(sku), 30, 'ย้ายที่วางไม่ทำให้ยอดรวมเปลี่ยน');
  assert.equal(stock(sku), 30, 'ย้ายที่วางไม่แตะยอดคงเหลือ');
  assertClean('ย้ายของ');
});

test('เบิกออกจนรับของแล้ว ของต้องหายจากชั้นตามจำนวนที่หยิบ', async () => {
  const request = await callOk('createOutboundRequest', transactions.createOutboundRequest, {
    body: { project: 'TESTPROJ', items: [{ productId: sku, quantity: 5 }] },
    user: { username: 'staff', role: 'Operator' }
  });
  const tx = db.prepare('SELECT id FROM wms_transactions WHERE transactionId = ?').get(request.transactionId);
  await callOk('resolveTransaction', transactions.resolveTransaction, {
    params: { id: String(tx.id) },
    body: { action: 'APPROVE', updatedItems: [{ productId: sku, approvedQty: 5 }], adminMessage: 'ok' }
  });
  assertClean('อนุมัติใบเบิก');

  await callOk('markPickedUp', transactions.markPickedUp, { params: { id: String(tx.id) } });
  assert.equal(stock(sku), 25, 'รับของแล้วสต็อกต้องลด');
  assert.equal(placed(sku), 25, 'ของบนชั้นต้องลดตามด้วย');
  assertClean('รับของแล้ว');
});

test('ปรับยอดลงต้องหักของออกจากชั้น และห้ามเดาเองเมื่อของอยู่หลายที่', async () => {
  const spots = db.prepare('SELECT id, quantity FROM item_locations WHERE item_id = ? ORDER BY quantity DESC').all(sku);
  assert.ok(spots.length > 1, 'เคสนี้ต้องมีของอยู่หลายที่');

  const asked = await call(transactions.adjustStock, { body: { sku, countedQty: stock(sku) - 3, note: 'นับจริง' } });
  assert.equal(asked.needsLocationChoice, true, 'ของอยู่หลายที่ ต้องถามก่อนว่าหายจากไหน');
  assert.equal(placed(sku), spots.reduce((sum, s) => sum + s.quantity, 0), 'ยังไม่ตอบ ต้องไม่แตะข้อมูล');
  assertClean('ถูกถามให้ระบุตำแหน่ง');

  const before = stock(sku);
  await callOk('adjustStock + deductions', transactions.adjustStock, {
    body: { sku, countedQty: before - 3, note: 'นับจริง', deductions: [{ locationId: spots[0].id, quantity: 3 }] }
  });
  assert.equal(stock(sku), before - 3);
  assert.equal(placed(sku), before - 3, 'ของบนชั้นต้องลดเท่ากับที่หายไปจริง');
  assertClean('ปรับยอดลง');
});

test('ปรับยอดเป็น 0 แล้วตำแหน่งต้องหายจากชั้นทั้งหมด', async () => {
  const rows = db.prepare('SELECT id, quantity FROM item_locations WHERE item_id = ? ORDER BY quantity DESC').all(sku);
  const deductions = rows.map((row) => ({ locationId: row.id, quantity: row.quantity }));
  await callOk('adjustStock → 0', transactions.adjustStock, {
    body: { sku, countedQty: 0, note: 'ของหมด', deductions }
  });
  assert.equal(stock(sku), 0);
  assert.equal(placed(sku), 0, 'ของหมดแล้วต้องไม่เหลือตำแหน่งค้างบนชั้น');
  assertClean('ปรับยอดเป็นศูนย์');
});

test('ตรวจกติกาครบทุกข้อจริง ไม่ได้ข้ามข้อไหนไป', () => {
  assert.ok(INVARIANTS.length >= 19, `ต้องตรวจอย่างน้อย 19 กติกา (ตอนนี้ ${INVARIANTS.length})`);
  for (const [name, sql] of INVARIANTS) {
    assert.ok(name && sql, 'ทุกกติกาต้องมีชื่อและคำสั่งตรวจ');
    db.prepare(sql).all();   // รันได้จริงไม่พัง
  }
});

test.after(() => temp.cleanup(db));

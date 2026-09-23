// ยิงทุก endpoint หลักด้วยข้อมูลจริงที่สร้างผ่าน API เอง — จับ SQL ที่พัง (ลืม JOIN / คอลัมน์หาย)
// ซึ่งเทสต์ตรรกะล้วนๆ จับไม่ได้เลย
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempDatabase, call, callOk } from './helpers/apiHarness.js';
import { ADJUSTMENT_LABEL } from '../utils/projects.js';

const temp = createTempDatabase('endpoints');
const { default: db } = await import('../db.js');
const products = await import('../controllers/productController.js');
const racks = await import('../controllers/rackController.js');
const rooms = await import('../controllers/roomController.js');
const storage = await import('../controllers/storageItemController.js');
const transactions = await import('../controllers/transactionController.js');
const reports = await import('../controllers/reportController.js');
const projects = await import('../controllers/projectController.js');
const push = await import('../push.js');
const initialStock = await import('../utils/initialStockHistory.js');

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

// ---- คืนของที่รับไปแล้ว ----
// เดินเส้นทางจริงทั้งเส้น: อนุมัติ → ส่งมอบ (ตัดสต็อก) → คืน → ตรวจว่ายอดกลับมา
test('คืนของที่รับไปแล้ว: ยอดกลับเข้าสต็อก และคืนซ้ำเกินไม่ได้', async () => {
  const made2 = await callOk('createProduct', products.createProduct, {
    body: { name: 'สินค้าคืนของ', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น', latestCost: 10, initialStock: 30, rackId: shelf.rack.id, storageLevel: 2 }
  });
  const sku2 = made2.sku;
  const req = await callOk('createOutboundRequest', transactions.createOutboundRequest, {
    body: { project: 'โครงการทดสอบ', items: [{ productId: sku2, quantity: 10 }] },
    user: { username: 'tester', role: 'Operator' }
  });
  const txRow = db.prepare('SELECT id FROM wms_transactions WHERE transactionId = ?').get(req.transactionId);

  await callOk('resolveTransaction', transactions.resolveTransaction, {
    params: { id: String(txRow.id) },
    body: { action: 'APPROVE', updatedItems: [{ productId: sku2, approvedQty: 10 }] }
  });

  const stockBefore = db.prepare('SELECT stock_balance b FROM warehouse_balance WHERE item_id = ?').get(sku2).b;
  await callOk('markPickedUp', transactions.markPickedUp, { params: { id: String(txRow.id) } });
  const afterPickup = db.prepare('SELECT stock_balance b FROM warehouse_balance WHERE item_id = ?').get(sku2).b;
  assert.equal(afterPickup, stockBefore - 10, 'ส่งมอบแล้วต้องตัดสต็อก 10');

  // คืนยังไม่ได้ถ้าไม่ระบุเหตุผล
  const noReason = await call(transactions.returnItems, {
    params: { id: String(txRow.id) },
    body: { items: [{ productId: sku2, quantity: 1 }] }
  });
  assert.equal(noReason.success, false, 'ต้องบังคับกรอกเหตุผล');

  // คืน 4 ชิ้น: ใช้ได้ 3 ชำรุด 1 (ยิงแยกใบ เพราะหนึ่งสินค้าใส่ได้ครั้งละสภาพเดียว)
  await callOk('returnItems (ใช้ได้)', transactions.returnItems, {
    params: { id: String(txRow.id) },
    body: { items: [{ productId: sku2, quantity: 3, condition: 'usable' }], reason: 'เบิกเกินความต้องการ' }
  });
  assert.equal(
    db.prepare('SELECT stock_balance b FROM warehouse_balance WHERE item_id = ?').get(sku2).b,
    afterPickup + 3,
    'ของสภาพใช้ได้ต้องกลับเข้าสต็อก'
  );

  await callOk('returnItems (ชำรุด)', transactions.returnItems, {
    params: { id: String(txRow.id) },
    body: { items: [{ productId: sku2, quantity: 1, condition: 'damaged' }], reason: 'ตกแตกระหว่างใช้งาน' }
  });
  assert.equal(
    db.prepare('SELECT stock_balance b FROM warehouse_balance WHERE item_id = ?').get(sku2).b,
    afterPickup + 3,
    'ของชำรุดต้องไม่ถูกนับกลับเข้าสต็อก'
  );

  // รับไป 10 คืนแล้ว 4 (ใช้ได้ 3 + ชำรุด 1) เหลือคืนได้อีก 6
  const tooMany = await call(transactions.returnItems, {
    params: { id: String(txRow.id) },
    body: { items: [{ productId: sku2, quantity: 7, condition: 'usable' }], reason: 'คืนเกิน' }
  });
  assert.equal(tooMany.success, false, 'คืนเกินยอดที่รับไปต้องถูกปฏิเสธ');
  assert.match(tooMany.message, /6/, 'ต้องบอกด้วยว่าคืนได้อีกเท่าไร');

  // ของคืนต้องไม่สร้าง lot ราคาใหม่ ไม่งั้นประวัติราคาเพี้ยน
  const lots = await callOk('getPriceHistory', products.getPriceHistory, { params: { id: sku2 } });
  assert.equal(lots.lots.filter((lot) => String(lot.note || '').startsWith('คืนจากใบ')).length, 0,
    'ของคืนต้องไม่โผล่ในประวัติราคาต่อ lot');

  // endpoint ค้นหาใบที่คืนได้ต้องเห็นใบนี้ และบอกยอดคงเหลือที่คืนได้ถูกต้อง
  const list = await callOk('getReturnableTransactions', transactions.getReturnableTransactions, { query: {} });
  const found = list.transactions.find((tx) => tx.id === txRow.id);
  assert.ok(found, 'ใบที่ยังคืนได้ต้องขึ้นในรายการค้นหา');
  assert.equal(found.items.find((item) => item.productId === sku2).returnable, 6);
});

test('คืนของจากใบที่ยังไม่ส่งมอบไม่ได้', async () => {
  const pending = db.prepare('SELECT id FROM wms_transactions WHERE transactionId = ?').get(outbound.transactionId);
  const res = await call(transactions.returnItems, {
    params: { id: String(pending.id) },
    body: { items: [{ productId: sku, quantity: 1 }], reason: 'ทดสอบ' }
  });
  assert.equal(res.success, false, 'ใบที่ยังไม่ส่งมอบต้องคืนไม่ได้');
  assert.match(res.message, /ยกเลิกจอง/, 'ต้องบอกทางเลือกที่ถูกต้องให้ผู้ใช้');
});

// ---- ข้อมูลรายงาน ----
// ตรรกะกรอง/ประกอบแถวย้ายจากหน้าเว็บมาไว้ที่เซิร์ฟเวอร์ตอนทำ PDF ฝั่งเซิร์ฟเวอร์
// ต้องมีเทสต์คุมไว้ ไม่งั้นรายงานเพี้ยนแบบเงียบๆ โดยไม่มีใครรู้
test('ข้อมูลรายงาน: กรองใบที่ยังไม่ส่งมอบออก และแยกตามประเภทได้', async () => {
  // ต้องมีใบรับเข้าอย่างน้อยหนึ่งใบ ตัวกรองประเภทถึงจะทดสอบได้จริง
  await callOk('createInboundTransaction', transactions.createInboundTransaction, {
    body: { sku, name: 'สินค้าทดสอบ', quantity: 5, unitCost: 25, note: 'รับเข้าทดสอบ' }
  });

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const all = reports.collectReport({ type: 'month', value: month });
  assert.ok(all.rows.length > 0, 'ต้องมีแถวในรายงาน');
  assert.equal(all.periodLabel, `เดือน ${month}`);

  // ใบที่อนุมัติแล้วแต่ยังไม่มีคนมารับ ยังไม่ถือเป็นประวัติ ต้องไม่โผล่ในรายงาน
  const waiting = db.prepare(
    "SELECT transactionId FROM wms_transactions WHERE type = 'OUTBOUND' AND status IN ('Approved','Partial') AND pickedUpAt IS NULL"
  ).all().map((row) => row.transactionId);
  for (const txId of waiting) {
    assert.ok(!all.rows.some((row) => row.txId === txId), `${txId} ยังไม่ส่งมอบ ไม่ควรอยู่ในรายงาน`);
  }

  // กรองประเภทแล้วต้องเหลือเฉพาะประเภทนั้น (แถวต่อเนื่องของใบเดียวกันเว้นช่องประเภทไว้)
  const inbound = reports.collectReport({ type: 'month', value: month, typeFilter: 'INBOUND' });
  const types = new Set(inbound.rows.map((row) => row.type).filter(Boolean));
  assert.deepEqual([...types], ['รับเข้า'], 'กรองรับเข้าแล้วต้องเหลือแต่รับเข้า');
  assert.match(inbound.periodLabel, /รับเข้า/, 'ป้ายช่วงเวลาต้องบอกตัวกรองด้วย');

  // ตารางสรุปนับเฉพาะรับเข้า/เบิกออก ไม่นับปรับยอด
  for (const [, , inQty, outQty] of all.summaryRows) {
    assert.ok(Number.isFinite(Number(inQty)) && Number.isFinite(Number(outQty)), 'ยอดสรุปต้องเป็นตัวเลข');
  }
});

test('ข้อมูลรายงาน: ช่วงเวลาที่ไม่มีข้อมูลต้องคืนแถวว่าง ไม่ใช่พัง', () => {
  const empty = reports.collectReport({ type: 'year', value: '2001' });
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.summaryRows.length, 0);
  assert.equal(empty.txCount, 0);
});

// ---- รหัสใบรายการต้องไม่ซ้ำ ----
// เดิมสร้างจาก Date.now() ตรงๆ สองใบในมิลลิวินาทีเดียวกันจะได้รหัสเดียวกัน
// แล้วชน UNIQUE constraint กลายเป็น error 500 — เจอจริงตอนคืนของสองรายการติดกัน
test('สร้างใบรายการรัวๆ ในมิลลิวินาทีเดียวกันต้องไม่ได้รหัสซ้ำ', async () => {
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const res = await callOk('createInboundTransaction', transactions.createInboundTransaction, {
      body: { sku, name: 'สินค้าทดสอบ', quantity: 1, note: `รัว ${i}` }
    });
    ids.push(res.transactionId || db.prepare('SELECT transactionId FROM wms_transactions ORDER BY id DESC LIMIT 1').get().transactionId);
  }
  assert.equal(new Set(ids).size, ids.length, `รหัสซ้ำกัน: ${ids.join(', ')}`);
});

// ---- กันใบเบิกซ้ำจากการกดปุ่มรัว ----
// 7 ก.ย. 2026 ได้ใบเบิกเดียวกันเป๊ะ 6 ใบ เข้ามาห่างกันรวม 299 มิลลิวินาที เพราะหน้าจอไม่ขยับ
// ระหว่างรอ ผู้ใช้เลยกดซ้ำ แล้วคำขอที่คิวไว้หลุดออกมาพร้อมกันตอนเน็ตติด
const madeDup = await callOk('createProduct (กันกดซ้ำ)', products.createProduct, {
  body: { name: 'สินค้ากันกดซ้ำ', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น', latestCost: 5, initialStock: 60, rackId: shelf.rack.id, storageLevel: 3 }
});
const dupPayload = (username, extra = {}) => ({
  body: { project: 'โครงการทดสอบ', items: [{ productId: madeDup.sku, quantity: 3 }], ...extra },
  user: { username, role: 'Operator' }
});
const countRequestsOf = (username) => db.prepare(
  "SELECT COUNT(*) c FROM wms_transactions WHERE type = 'OUTBOUND' AND requesterUsername = ?"
).get(username).c;

test('ส่งใบเบิกชุดเดิมรัวๆ ต้องได้ใบเดียว', async () => {
  const first = await callOk('createOutboundRequest', transactions.createOutboundRequest, dupPayload('คนกดรัว'));

  // ยิงซ้ำอีก 5 ครั้งเลียนแบบคำขอที่คิวไว้แล้วหลุดออกมาพร้อมกัน
  for (let i = 0; i < 5; i++) {
    const again = await call(transactions.createOutboundRequest, dupPayload('คนกดรัว'));
    assert.equal(again.success, false, `ใบซ้ำครั้งที่ ${i + 2} ไม่ควรผ่าน`);
    assert.ok(
      again.message.includes(first.transactionId),
      `ข้อความต้องบอกรหัสใบเดิมให้ตามไปดูได้ ไม่ใช่ปัดเฉยๆ: ${again.message}`
    );
  }

  assert.equal(countRequestsOf('คนกดรัว'), 1, 'กดรัว 6 ครั้งต้องได้ใบเดียว');
});

test('เบิกคนละชุดติดกันยังส่งได้ปกติ', async () => {
  await callOk('createOutboundRequest', transactions.createOutboundRequest, dupPayload('คนเบิกหลายชุด'));

  // จำนวนต่างกัน = คนละใบ ต้องผ่าน
  await callOk('createOutboundRequest (คนละจำนวน)', transactions.createOutboundRequest,
    dupPayload('คนเบิกหลายชุด', { items: [{ productId: madeDup.sku, quantity: 5 }] }));

  // ของชิ้นเดิมจำนวนเดิมแต่คนละโครงการ ต้องผ่าน
  await callOk('createOutboundRequest (คนละโครงการ)', transactions.createOutboundRequest,
    dupPayload('คนเบิกหลายชุด', { project: 'งานอื่น' }));

  assert.equal(countRequestsOf('คนเบิกหลายชุด'), 3, 'ด่านกันซ้ำต้องไม่ไปขวางการเบิกที่ตั้งใจจริง');
});

test('พ้นหน้าต่างกันซ้ำแล้วส่งชุดเดิมได้', async () => {
  await callOk('createOutboundRequest', transactions.createOutboundRequest, dupPayload('คนเบิกซ้ำทีหลัง'));

  // ดันใบแรกให้เก่ากว่าหน้าต่าง 5 วินาที — เบิกของชิ้นเดิมให้อีกงานหนึ่งเป็นเรื่องปกติ ห้ามล็อกไว้ตลอด
  db.prepare("UPDATE wms_transactions SET requestDate = ? WHERE requesterUsername = ? AND status = 'Pending'")
    .run(new Date(Date.now() - 10_000).toISOString(), 'คนเบิกซ้ำทีหลัง');

  await callOk('createOutboundRequest (พ้นหน้าต่างแล้ว)', transactions.createOutboundRequest, dupPayload('คนเบิกซ้ำทีหลัง'));
  assert.equal(countRequestsOf('คนเบิกซ้ำทีหลัง'), 2, 'พ้น 5 วินาทีแล้วต้องส่งชุดเดิมได้อีก');
});

test('ใบแรกถูกอนุมัติทันทีก็ยังกันใบซ้ำที่ตามมาได้', async () => {
  const first = await callOk('createOutboundRequest', transactions.createOutboundRequest, dupPayload('คนถูกอนุมัติไว'));
  const txRow = db.prepare('SELECT id FROM wms_transactions WHERE transactionId = ?').get(first.transactionId);

  // ผู้อนุมัติกดรับเรื่องก่อนที่คำขอซึ่งคิวค้างอยู่จะตามมาถึง — ใบแรกพ้นสถานะ Pending ไปแล้ว
  // ถ้าด่านกันซ้ำดูแค่ Pending ใบที่สองจะหลุดเข้ามาเป็นใบจริงที่กันของซ้ำอีกชุด
  await callOk('resolveTransaction', transactions.resolveTransaction, {
    params: { id: String(txRow.id) },
    body: { action: 'APPROVE', updatedItems: [{ productId: madeDup.sku, approvedQty: 3 }] }
  });

  const again = await call(transactions.createOutboundRequest, dupPayload('คนถูกอนุมัติไว'));
  assert.equal(again.success, false, 'อนุมัติแล้วแต่ยังไม่มารับ = ใบเดิมยังมีชีวิตอยู่ ต้องยังกันซ้ำได้');
  assert.equal(countRequestsOf('คนถูกอนุมัติไว'), 1, 'ต้องไม่มีใบที่สองเล็ดลอดเข้ามา');
});

// ---- สต็อกตั้งต้นตอนเพิ่มสินค้าใหม่ ----
// เดิมเขียนแค่ stock_in ยอดคงเหลือถูก แต่ไม่ขึ้นในหน้าประวัติและรายงาน PDF เลย
const txsOf = (productSku) => transactions.getFullTransactions()
  .filter((tx) => tx.items.some((item) => item.productId === productSku));

test('เพิ่มสินค้าพร้อมสต็อกตั้งต้น: ขึ้นเป็นรับเข้าในประวัติและรายงาน', async () => {
  const made3 = await callOk('createProduct', products.createProduct, {
    body: { name: 'สินค้าสต็อกตั้งต้น', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น', latestCost: 8, initialStock: 7 },
    user: { username: 'managerX', role: 'Manager' }
  });
  const rows = txsOf(made3.sku);
  assert.equal(rows.length, 1, 'สต็อกตั้งต้นต้องมีใบรับเข้า 1 ใบ');
  assert.equal(rows[0].type, 'INBOUND');
  assert.equal(rows[0].status, 'Approved');
  assert.equal(rows[0].project, initialStock.INITIAL_STOCK_LABEL);
  assert.equal(rows[0].requesterUsername, 'managerX', 'ต้องบันทึกว่าใครเป็นคนเพิ่ม');
  assert.equal(Number(rows[0].items[0].requestedQty), 7);
  assert.equal(rows[0].items[0].groupName, 'ทดสอบ', 'ต้อง snapshot หมวดหมู่ไว้ในใบ');

  const stock = db.prepare('SELECT stock_balance b FROM warehouse_balance WHERE item_id = ?').get(made3.sku).b;
  assert.equal(stock, 7, 'ใบประวัติต้องไม่ทำให้ยอดคงเหลือนับซ้ำ');

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const report = reports.collectReport({ type: 'month', value: month, typeFilter: 'INBOUND' });
  assert.ok(report.rows.some((row) => row.txId === rows[0].transactionId), 'ต้องอยู่ในรายงาน PDF ด้วย');

  const noStock = await callOk('createProduct', products.createProduct, {
    body: { name: 'สินค้าไม่มีสต็อกตั้งต้น', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น' }
  });
  assert.equal(txsOf(noStock.sku).length, 0, 'ไม่ใส่สต็อกตั้งต้น = ไม่มีของเข้าคลัง ต้องไม่สร้างใบ');
});

test('เติมประวัติสต็อกตั้งต้นย้อนหลัง: เติมเฉพาะที่ขาด และรันซ้ำไม่เกิดใบซ้ำ', async () => {
  // จำลองสินค้าที่เพิ่มก่อนแก้บั๊ก: มี stock_in สต็อกตั้งต้น แต่ไม่มีใบรับเข้า
  const old = await callOk('createProduct', products.createProduct, {
    body: { name: 'สินค้าเพิ่มก่อนแก้', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น' }
  });
  const oldDate = '2026-07-16T02:02:01.727Z';
  db.prepare('INSERT INTO stock_in (item_id, quantity, input_date, note) VALUES (?, 12, ?, ?)')
    .run(old.sku, oldDate, initialStock.INITIAL_STOCK_NOTE);
  const stockBefore = db.prepare('SELECT stock_balance b FROM warehouse_balance WHERE item_id = ?').get(old.sku).b;

  const dry = initialStock.backfillInitialStockHistory(db);
  assert.deepEqual(dry.rows.map((row) => row.sku), [old.sku], 'ต้องเจอเฉพาะตัวที่ขาด (ตัวที่สร้างหลังแก้มีใบแล้ว)');
  assert.equal(dry.applied, false);
  assert.equal(txsOf(old.sku).length, 0, 'โหมดดูผลต้องไม่เขียนอะไรลงฐานข้อมูล');

  const done = initialStock.backfillInitialStockHistory(db, { apply: true });
  assert.equal(done.applied, true);
  const rows = txsOf(old.sku);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requestDate, oldDate, 'ใบย้อนหลังต้องลงวันที่ที่ของเข้าคลังจริง รายงานเดือนนั้นจะได้ครบ');
  assert.equal(rows[0].requesterUsername, 'system', 'ไม่มี audit log ตรงเวลานั้น ต้องใส่เป็น system');
  assert.equal(Number(rows[0].items[0].requestedQty), 12);
  assert.equal(
    db.prepare('SELECT stock_balance b FROM warehouse_balance WHERE item_id = ?').get(old.sku).b,
    stockBefore,
    'เติมประวัติต้องไม่เปลี่ยนยอดคงเหลือ'
  );

  const again = initialStock.backfillInitialStockHistory(db, { apply: true });
  assert.equal(again.rows.length, 0, 'รันซ้ำต้องไม่เจออะไรให้เติมอีก');
  assert.equal(txsOf(old.sku).length, 1);
});

// ---- ตัวกรองรายการใหม่ ----
test('ตัวกรองรายการใหม่: แสดงเฉพาะสินค้าที่เพิ่มวันนี้ ตัวล่าสุดขึ้นก่อน', async () => {
  const yesterday = await callOk('createProduct', products.createProduct, {
    body: { name: 'สินค้าเพิ่มเมื่อวาน', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น' }
  });
  // เก็บเป็นรูปแบบ CURRENT_TIMESTAMP (UTC ไม่มี T) เพื่อคุมกรณีข้อมูลเก่าที่ไม่ได้มาจากหน้าเว็บด้วย
  db.prepare("UPDATE items SET created_at = datetime('now', '-1 day') WHERE item_id = ?").run(yesterday.sku);
  const latest = await callOk('createProduct', products.createProduct, {
    body: { name: 'สินค้าเพิ่มล่าสุด', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น' }
  });

  const list = await callOk('getProducts', products.getProducts, { query: { limit: '500', newToday: 'true' } });
  const skus = list.products.map((item) => item.sku);
  assert.ok(skus.includes(latest.sku), 'สินค้าที่เพิ่งเพิ่มต้องอยู่ในรายการใหม่');
  assert.ok(!skus.includes(yesterday.sku), 'สินค้าที่เพิ่มเมื่อวานต้องไม่อยู่ในรายการใหม่');
  assert.equal(skus[0], latest.sku, 'ตัวที่เพิ่มล่าสุดต้องขึ้นบนสุด');
  assert.equal(list.totalItems, skus.length, 'จำนวนรวมต้องนับตามตัวกรองเดียวกัน');
});

test('ตัวกรองรายการใหม่: เลือกย้อนวันได้ และของวันนั้นยังเรียงตัวล่าสุดขึ้นก่อน', async () => {
  const early = await callOk('createProduct', products.createProduct, {
    body: { name: 'ของเมื่อวาน ชิ้นเช้า', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น' }
  });
  const late = await callOk('createProduct', products.createProduct, {
    body: { name: 'ของเมื่อวาน ชิ้นบ่าย', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น' }
  });
  const today = await callOk('createProduct', products.createProduct, {
    body: { name: 'ของวันนี้', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น' }
  });

  // ปักเวลาเป็น "เช้า/บ่ายของเมื่อวาน ตามเวลาเครื่อง" แล้วให้ SQLite แปลงกลับเป็น UTC ก่อนเก็บ (modifier 'utc')
  // ถ้าใช้ datetime('now','-1 day','-1 hour') เฉยๆ เทสต์จะแดงเองตอนรันช่วงเที่ยงคืน–ตีหนึ่ง เพราะ -1 ชม. ข้ามไปอีกวัน
  const yesterday = db.prepare("SELECT date('now', '-1 day', 'localtime') AS d").get().d;
  const backdate = db.prepare("UPDATE items SET created_at = datetime(? || ' ' || ?, 'utc') WHERE item_id = ?");
  backdate.run(yesterday, '09:00:00', early.sku);
  backdate.run(yesterday, '15:00:00', late.sku);

  const list = await callOk('getProducts', products.getProducts, {
    query: { limit: '500', newToday: 'true', newDate: yesterday }
  });
  const skus = list.products.map((item) => item.sku);
  assert.ok(skus.includes(early.sku) && skus.includes(late.sku), 'ของที่เพิ่มในวันที่เลือกต้องมาครบ');
  assert.ok(!skus.includes(today.sku), 'ของวันอื่นต้องไม่ติดมาด้วย');
  assert.ok(skus.indexOf(late.sku) < skus.indexOf(early.sku), 'ในวันเดียวกันตัวล่าสุดต้องขึ้นก่อน');
  assert.equal(list.totalItems, skus.length, 'ตัวเลขบนป้ายต้องนับด้วยเงื่อนไขเดียวกับรายการที่แสดง');

  // วันที่รูปแบบเพี้ยน → ตกกลับไปเป็น "วันนี้" ไม่ใช่คืนรายการเปล่าแบบไม่บอกสาเหตุ
  const fallback = await callOk('getProducts', products.getProducts, {
    query: { limit: '500', newToday: 'true', newDate: '20 ก.ย. 2569' }
  });
  const fallbackSkus = fallback.products.map((item) => item.sku);
  assert.ok(fallbackSkus.includes(today.sku), 'รูปแบบวันที่ไม่ถูกต้องต้องกลับไปแสดงของวันนี้');
  assert.ok(!fallbackSkus.includes(late.sku), 'และต้องไม่เผลอแสดงของวันที่พิมพ์เพี้ยนนั้น');
});

test('ตัวกรองรายการใหม่: เลือกเป็นช่วงวันที่ได้ และใส่กลับด้านก็ยังได้ผลเดิม', async () => {
  const threeDaysAgo = db.prepare("SELECT date('now', '-3 day', 'localtime') AS d").get().d;
  const twoDaysAgo = db.prepare("SELECT date('now', '-2 day', 'localtime') AS d").get().d;
  const fiveDaysAgo = db.prepare("SELECT date('now', '-5 day', 'localtime') AS d").get().d;
  const backdate = db.prepare("UPDATE items SET created_at = datetime(? || ' ' || '10:00:00', 'utc') WHERE item_id = ?");

  const inRangeEarly = await callOk('createProduct', products.createProduct, {
    body: { name: 'ของในช่วง วันแรก', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น' }
  });
  const inRangeLate = await callOk('createProduct', products.createProduct, {
    body: { name: 'ของในช่วง วันหลัง', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น' }
  });
  const outOfRange = await callOk('createProduct', products.createProduct, {
    body: { name: 'ของนอกช่วง', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น' }
  });
  backdate.run(threeDaysAgo, inRangeEarly.sku);
  backdate.run(twoDaysAgo, inRangeLate.sku);
  backdate.run(fiveDaysAgo, outOfRange.sku);

  const inRange = (result) => {
    const skus = result.products.map((item) => item.sku);
    assert.ok(skus.includes(inRangeEarly.sku) && skus.includes(inRangeLate.sku), 'ของทั้งสองวันในช่วงต้องมาครบ');
    assert.ok(!skus.includes(outOfRange.sku), 'ของนอกช่วงต้องไม่ติดมา');
    assert.equal(result.totalItems, skus.length, 'ตัวเลขบนป้ายต้องนับด้วยเงื่อนไขเดียวกัน');
    return skus;
  };

  const skus = inRange(await callOk('getProducts', products.getProducts, {
    query: { limit: '500', newToday: 'true', newFrom: threeDaysAgo, newTo: twoDaysAgo }
  }));
  assert.ok(skus.indexOf(inRangeLate.sku) < skus.indexOf(inRangeEarly.sku), 'ในช่วงเดียวกันตัวล่าสุดต้องขึ้นก่อน');

  // ใส่กลับด้าน (จาก 2 วันก่อน ถึง 3 วันก่อน) ต้องได้ผลเหมือนกัน ไม่ใช่รายการเปล่า
  inRange(await callOk('getProducts', products.getProducts, {
    query: { limit: '500', newToday: 'true', newFrom: twoDaysAgo, newTo: threeDaysAgo }
  }));

  // ปลายช่วงพิมพ์เพี้ยน → ถือว่าไม่ได้เลือกช่วง ตกกลับไปใช้วันเดี่ยวตามเดิม
  const single = await callOk('getProducts', products.getProducts, {
    query: { limit: '500', newToday: 'true', newDate: threeDaysAgo, newTo: 'เมื่อวาน' }
  });
  const singleSkus = single.products.map((item) => item.sku);
  assert.ok(singleSkus.includes(inRangeEarly.sku) && !singleSkus.includes(inRangeLate.sku));
});

// ---- จำนวนจุดที่วางของ (ใช้ตัดสินว่าต้องให้เลือกตำแหน่งก่อนพาไปผังคลังไหม) ----
test('รายการสินค้า: บอกจำนวนจุดที่มีของวางอยู่จริง', async () => {
  const list = await callOk('getProducts', products.getProducts, { query: { limit: '500' } });
  const spread = list.products.find((item) => item.sku === sku);
  assert.equal(spread.locationCount, 3, 'ของทดสอบถูกกระจายไว้ 3 ที่ (ชั้นวาง/พื้นที่วางพื้น/พื้นที่จัดเตรียม)');

  const placedRows = db.prepare('SELECT COUNT(*) AS n FROM item_locations WHERE item_id = ? AND quantity > 0').get(sku).n;
  assert.equal(spread.locationCount, placedRows, 'ต้องนับเฉพาะจุดที่ยังมีของเหลืออยู่');

  const untouched = list.products.find((item) => item.locationCount === 0);
  assert.ok(untouched, 'สินค้าที่ยังไม่ได้ผูกตำแหน่งต้องเป็น 0 ไม่ใช่ null');
});

// ---- เลือกผู้รับแจ้งเตือนตามบทบาท ----
test('แจ้งเตือนตามบทบาท: ส่งเฉพาะบัญชีที่ใช้งานอยู่ และไม่ส่งกลับหาคนที่เป็นต้นเหตุ', async () => {
  const add = db.prepare("INSERT INTO app_users (username, email, password, role, status) VALUES (?, ?, 'x', ?, ?)");
  add.run('adminA', 'a@test.local', 'Admin', 'Active');
  add.run('managerB', 'b@test.local', 'Manager', 'Active');
  add.run('adminPending', 'c@test.local', 'Admin', 'Pending');   // ยังไม่อนุมัติ ไม่ควรได้รับ
  add.run('operatorC', 'd@test.local', 'Operator', 'Active');    // คนละบทบาท ไม่ควรได้รับ

  // ไม่มีใครมี subscription ในฐานข้อมูลทดสอบ จึงไม่มีการยิงออกเน็ตจริง
  // ดูที่ users ว่าเลือกคนถูกกี่คน
  const all = await push.sendPushToRoles(push.WAREHOUSE_STAFF_ROLES, { title: 't', body: 'b', url: '/' });
  assert.equal(all.users, 2, 'ต้องได้เฉพาะ adminA กับ managerB');

  const excluded = await push.sendPushToRoles(push.WAREHOUSE_STAFF_ROLES, { title: 't', body: 'b', url: '/' }, { exclude: 'adminA' });
  assert.equal(excluded.users, 1, 'คนที่เป็นต้นเหตุต้องไม่ได้รับแจ้งเตือนของตัวเอง');

  const adminOnly = await push.sendPushToRoles(['Admin'], { title: 't', body: 'b', url: '/' });
  assert.equal(adminOnly.users, 1, 'ระบุบทบาทเดียวต้องได้เฉพาะบทบาทนั้น');
});


// ---- เปลี่ยนชื่อโปรเจกต์ ----
// ด่านสำคัญของชุดนี้: โปรเจกต์ถูกอ้างสองแบบที่ขยับไม่พร้อมกัน — โซนจัดเตรียมผูกด้วย id
// แต่ใบเบิก/ประวัติถือสำเนาข้อความชื่อ ถ้าเปลี่ยนชื่อแล้วประวัติไม่ตาม โควตาโซนจะคำนวณผิดทันที
test('เปลี่ยนชื่อโปรเจกต์: ใบเบิกและประวัติตามไปทั้งหมด โควตาพื้นที่จัดเตรียมไม่เพี้ยน', async () => {
  const OLD = 'โครงการทดสอบ';
  const NEW = 'โครงการเปลี่ยนชื่อแล้ว';

  const made3 = await callOk('createProduct', products.createProduct, {
    body: { name: 'สินค้าเปลี่ยนชื่อ', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น', latestCost: 5, initialStock: 20, rackId: shelf.rack.id, storageLevel: 3 }
  });
  const sku3 = made3.sku;
  await callOk('moveItemQuantity → พื้นที่จัดเตรียม', storage.moveItemQuantity, {
    body: { sku: sku3, from: { rackId: shelf.rack.id, storageLevel: 3 }, to: { rackId: stagingZone.rack.id, storageLevel: 1 }, quantity: 10 }
  });

  // อนุมัติแล้วยังไม่มารับ = ยอดจองที่ต้องถูกหักออกจากโควตาโซน
  const req = await callOk('createOutboundRequest', transactions.createOutboundRequest, {
    body: { project: OLD, items: [{ productId: sku3, quantity: 4 }] },
    user: { username: 'tester', role: 'Operator' }
  });
  const txRow = db.prepare('SELECT id FROM wms_transactions WHERE transactionId = ?').get(req.transactionId);
  await callOk('resolveTransaction', transactions.resolveTransaction, {
    params: { id: String(txRow.id) },
    body: { action: 'APPROVE', updatedItems: [{ productId: sku3, approvedQty: 4 }] }
  });

  const availableFor = async (name) => {
    const list = await callOk('getProducts', products.getProducts, { query: { limit: '500', project: name } });
    return list.products.find((row) => row.sku === sku3);
  };
  const before = await availableFor(OLD);
  assert.equal(before.availableSource, 'staging', 'โครงการที่มีโซนต้องคิดโควตาจากโซน');
  assert.equal(before.available, 6, 'โซนมี 10 อนุมัติค้างไว้ 4 จึงเบิกได้อีก 6');

  // ใบปรับยอดใช้ช่อง project เดียวกันเก็บป้ายระบบ ต้องไม่โดนลากไปด้วยตอนเปลี่ยนชื่อ
  await callOk('adjustStock', transactions.adjustStock, {
    body: { sku: sku3, countedQty: 21, note: 'นับจริงได้มากกว่า' }
  });
  const adjustBefore = db.prepare('SELECT COUNT(*) c FROM wms_transactions WHERE project = ?').get(ADJUSTMENT_LABEL).c;
  assert.ok(adjustBefore > 0, 'ต้องมีใบปรับยอดไว้ให้ตรวจ');

  const txBefore = db.prepare('SELECT COUNT(*) c FROM wms_transactions WHERE project = ?').get(OLD).c;
  const outBefore = db.prepare('SELECT COUNT(*) c FROM stock_out WHERE project = ?').get(OLD).c;
  const renamed = await callOk('renameProject', projects.renameProject, {
    params: { id: String(project.lastInsertRowid) }, body: { name: NEW }
  });

  assert.equal(renamed.updated.transactions, txBefore, 'ใบเบิกทุกใบของชื่อเดิมต้องถูกแก้ตาม');
  assert.equal(renamed.updated.stockOut, outBefore, 'ประวัติเบิกออกต้องถูกแก้ตามครบ');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM wms_transactions WHERE project = ?').get(OLD).c, 0, 'ต้องไม่เหลือใบที่ค้างชื่อเก่า');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM stock_out WHERE project = ?').get(OLD).c, 0, 'ประวัติเบิกออกต้องไม่ค้างชื่อเก่า');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM stock_in WHERE project = ?').get(OLD).c, 0, 'ประวัติรับเข้าต้องไม่ค้างชื่อเก่า');
  assert.equal(
    db.prepare('SELECT COUNT(*) c FROM wms_transactions WHERE project = ?').get(ADJUSTMENT_LABEL).c,
    adjustBefore,
    'ป้ายระบบต้องไม่ถูกแตะ (เทียบชื่อแบบตรงเป๊ะ ไม่ใช่ LIKE)'
  );

  const after = await availableFor(NEW);
  assert.equal(after.availableSource, 'staging', 'โซนต้องยังผูกกับโครงการเดิม เพราะผูกด้วย id');
  assert.equal(after.available, before.available, 'ยอดที่อนุมัติค้างไว้ต้องยังถูกหักออกจากโควตาเหมือนเดิม');
  assert.equal(await availableFor(OLD).then((row) => row.availableSource), 'free', 'ชื่อเก่าต้องไม่เหลือโควตาโซนค้างอยู่');
});

test('เปลี่ยนชื่อโปรเจกต์: กันชื่อซ้ำ กันชนป้ายระบบ แต่แก้ตัวสะกดของตัวเองได้', async () => {
  const target = db.prepare("INSERT INTO projects (name, norm) VALUES ('งานสีเขียว', 'สีเขียว')").run();
  db.prepare("INSERT INTO projects (name, norm) VALUES ('งานสีแดง', 'สีแดง')").run();
  const rename = (name) => call(projects.renameProject, { params: { id: String(target.lastInsertRowid) }, body: { name } });

  const dup = await rename('สีแดง');
  assert.equal(dup.success, false, 'ชื่อที่ normalize แล้วซ้ำกับโปรเจกต์อื่นต้องถูกปฏิเสธ');
  assert.equal(dup.status, 409);

  const reserved = await rename(ADJUSTMENT_LABEL);
  assert.equal(reserved.success, false, 'ชื่อที่ชนป้ายระบบต้องถูกปฏิเสธ');

  const blank = await rename('   ');
  assert.equal(blank.success, false, 'ชื่อว่างต้องถูกปฏิเสธ');

  // norm ไม่เปลี่ยน (ยังเป็น 'สีเขียว') — ต้องผ่าน ไม่ใช่ติดด่านชื่อซ้ำกับตัวเอง
  const ok = await callOk('renameProject (แก้ตัวสะกดตัวเอง)', projects.renameProject, {
    params: { id: String(target.lastInsertRowid) }, body: { name: 'งาน สีเขียว' }
  });
  assert.equal(ok.project.name, 'งาน สีเขียว');
  assert.equal(db.prepare('SELECT name FROM projects WHERE id = ?').get(target.lastInsertRowid).name, 'งาน สีเขียว');
});


// โหมดเก็บประวัติ: ใช้ตอนชื่อใหม่คืองานคนละรอบ (งานเดิมจบแล้ว ลูกค้าเจ้าเดิมซื้อต่อ)
// ใบที่ปิดจบต้องคงชื่อยุคนั้นไว้ แต่ใบที่ยังเดินอยู่ต้องเปลี่ยนตาม ไม่งั้นโควตาโซนกับการหยิบของเพี้ยน
test('เปลี่ยนชื่อโปรเจกต์แบบเก็บประวัติ: ใบที่ปิดจบคงชื่อเดิม ใบที่ยังไม่ปิดเปลี่ยนตาม', async () => {
  const OLD = 'เฟสหนึ่ง';
  const NEW = 'เฟสสอง';
  const phase = db.prepare('INSERT INTO projects (name, norm) VALUES (?, ?)').run(OLD, OLD);
  const zone = await callOk('addRack (โซนของเฟสนี้)', racks.addRack, {
    body: { name: 'จัดเตรียมเฟส', isFloor: true, projectId: phase.lastInsertRowid, roomId: room.room.id, posX: 300, posY: 300 }
  });
  const made4 = await callOk('createProduct', products.createProduct, {
    body: { name: 'สินค้าเฟส', groupId: '01', groupName: 'ทดสอบ', unit: 'ชิ้น', latestCost: 8, initialStock: 20, rackId: shelf.rack.id, storageLevel: 1 }
  });
  const sku4 = made4.sku;
  await callOk('moveItemQuantity → โซนของเฟส', storage.moveItemQuantity, {
    body: { sku: sku4, from: { rackId: shelf.rack.id, storageLevel: 1 }, to: { rackId: zone.rack.id, storageLevel: 1 }, quantity: 10 }
  });

  const submit = async (quantity) => {
    const req = await callOk('createOutboundRequest', transactions.createOutboundRequest, {
      body: { project: OLD, items: [{ productId: sku4, quantity }] },
      user: { username: 'tester', role: 'Operator' }
    });
    return db.prepare('SELECT id FROM wms_transactions WHERE transactionId = ?').get(req.transactionId).id;
  };
  const approve = (txId, qty) => callOk('resolveTransaction', transactions.resolveTransaction, {
    params: { id: String(txId) }, body: { action: 'APPROVE', updatedItems: [{ productId: sku4, approvedQty: qty }] }
  });

  const closed = await submit(3);        // ปิดจบ: อนุมัติแล้วมารับของไปแล้ว
  await approve(closed, 3);
  await callOk('markPickedUp', transactions.markPickedUp, { params: { id: String(closed) } });

  const waiting = await submit(2);       // ยังเดินอยู่: อนุมัติแล้วรอมารับ
  await approve(waiting, 2);
  const pending = await submit(1);       // ยังเดินอยู่: ยังไม่อนุมัติ

  const availableFor = async (name) => {
    const list = await callOk('getProducts', products.getProducts, { query: { limit: '500', project: name } });
    return list.products.find((row) => row.sku === sku4);
  };
  const before = await availableFor(OLD);
  assert.equal(before.available, 5, 'โซนเหลือ 7 หลังหยิบไป 3 และมีใบรออยู่ 2 จึงเบิกได้อีก 5');

  const renamed = await callOk('renameProject (เก็บประวัติ)', projects.renameProject, {
    params: { id: String(phase.lastInsertRowid) }, body: { name: NEW, keepHistory: true }
  });
  assert.equal(renamed.updated.transactions, 2, 'ต้องแก้เฉพาะใบที่ยังเดินอยู่ 2 ใบ');
  assert.equal(renamed.updated.kept, 1, 'ใบที่ปิดจบแล้วต้องถูกทิ้งไว้ 1 ใบ');
  assert.equal(renamed.updated.stockOut, 0, 'โหมดนี้ต้องไม่แตะประวัติเบิกออกเลย');

  const projectOf = (txId) => db.prepare('SELECT project FROM wms_transactions WHERE id = ?').get(txId).project;
  assert.equal(projectOf(closed), OLD, 'ใบที่มารับของไปแล้วต้องคงชื่อยุคเดิม');
  assert.equal(projectOf(waiting), NEW, 'ใบที่อนุมัติแล้วรอมารับต้องเปลี่ยนตาม');
  assert.equal(projectOf(pending), NEW, 'ใบที่ยังไม่อนุมัติต้องเปลี่ยนตาม');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM stock_out WHERE project = ?').get(OLD).c, 1, 'ประวัติเบิกออกของยุคเดิมต้องอยู่ครบ');

  // ด่านสำคัญ: โควตาต้องคิดได้เหมือนเดิม ยอดที่รออยู่ 2 ต้องยังถูกหัก ไม่ใช่ปล่อยให้เบิกซ้ำได้ 7
  const after = await availableFor(NEW);
  assert.equal(after.availableSource, 'staging', 'โซนต้องยังผูกกับโปรเจกต์เดิม');
  assert.equal(after.available, before.available, 'ยอดที่อนุมัติค้างไว้ต้องยังถูกหักออกจากโควตา');

  // และอนุมัติใบที่ยังค้างต่อได้จริง ไม่ใช่แค่ตัวเลขสวย
  await approve(pending, 1);
  assert.equal((await availableFor(NEW)).available, 4, 'อนุมัติเพิ่ม 1 แล้วโควตาต้องเหลือ 4');
});

test.after(() => temp.cleanup(db));

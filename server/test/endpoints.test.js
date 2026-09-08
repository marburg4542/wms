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
const reports = await import('../controllers/reportController.js');
const push = await import('../push.js');

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

test.after(() => temp.cleanup(db));

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

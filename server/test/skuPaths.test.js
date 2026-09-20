// ทุกทางที่ "เปลี่ยนรหัสสินค้า" ได้ ต้องลากตารางลูกครบทุกตารางเหมือนกันหมด
//
// ทำไมต้องมีชุดนี้แยกจาก skuRetarget.test.js: ชุดนั้นคุมแค่ตัวช่วยกลางว่ารายชื่อตารางครบไหม
// แต่ไม่มีอะไรจับ "คนที่ไม่ยอมเรียกตัวช่วยกลาง" — ซึ่งเป็นบั๊กที่เกิดขึ้นจริงมาแล้ว
// (ปุ่มยุบหมวดกับปุ่มจัดเรียงเลขหมวดเคยไล่เขียนรายชื่อตารางเอง แล้วลืม item_locations
//  กดทีเดียวของทั้งหมวดหลุดจากผังคลัง แถมช่องเก่าไปสวมให้สินค้าตัวอื่นที่มารับรหัสนั้นต่อ)
//
// ชุดนี้จึงยิง endpoint จริงทั้ง 4 ทาง แล้วไล่ตรวจตาม SKU_CHILD_TABLES เป็นตัวตั้ง
// เพิ่มตารางใหม่เข้ารายชื่อเมื่อไร ทุกทางจะถูกตรวจเพิ่มให้เองโดยไม่ต้องมาแก้เทสต์
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempDatabase, call, callOk } from './helpers/apiHarness.js';
import { SKU_CHILD_TABLES } from '../utils/skuRetarget.js';

const temp = createTempDatabase('sku-paths');
const { default: db } = await import('../db.js');
const products = await import('../controllers/productController.js');
const categories = await import('../controllers/categoryController.js');
const racks = await import('../controllers/rackController.js');
const rooms = await import('../controllers/roomController.js');
const transactions = await import('../controllers/transactionController.js');

const planId = db.prepare('SELECT id FROM floor_plans LIMIT 1').get().id;
const room = await callOk('addRoom', rooms.addRoom, {
  body: { name: 'ห้องทดสอบรหัส', isStorage: true, planId, posX: 20, posY: 20, width: 400, height: 300 }
});
const shelf = await callOk('addRack', racks.addRack, {
  body: { name: 'ชั้นทดสอบรหัส', levels: 3, roomId: room.room.id, posX: 20, posY: 20 }
});

// สร้างสินค้าที่มีข้อมูลครบทุกตารางลูก เพื่อให้การตรวจ "ไม่มีแถวค้างรหัสเก่า" มีความหมายจริง
const seedProduct = async (groupId, groupName, name) => {
  const made = await callOk('createProduct', products.createProduct, {
    body: { name, groupId, groupName, unit: 'ชิ้น', latestCost: 10, initialStock: 12, minStock: 3, rackId: shelf.rack.id, storageLevel: 1 }
  });
  await callOk('createOutboundRequest', transactions.createOutboundRequest, {
    body: { project: 'โครงการทดสอบรหัส', items: [{ productId: made.sku, quantity: 2 }] },
    user: { username: 'tester', role: 'Operator' }
  });
  // ใส่แถวเบิกออกตรงๆ แทนการเดินครบวงจรอนุมัติ+รับของ เพราะชุดนี้สนใจแค่ว่ารหัสถูกลากตามไหม
  db.prepare("INSERT INTO stock_out (item_id, quantity, output_date) VALUES (?, 1, '2026-09-21')").run(made.sku);
  for (const { table, column } of SKU_CHILD_TABLES) {
    const c = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${column} = ?`).get(made.sku).c;
    assert.ok(c > 0, `ข้อมูลตั้งต้นไม่ครบ: ${table}.${column} ไม่มีแถวของ ${made.sku}`);
  }
  return made.sku;
};

const skuOf = (name) => db.prepare('SELECT item_id FROM items WHERE item_name = ?').get(name).item_id;

const assertMoved = (label, oldSku, newSku) => {
  assert.notEqual(oldSku, newSku, `${label}: รหัสต้องเปลี่ยนจริง`);
  for (const { table, column } of SKU_CHILD_TABLES) {
    assert.equal(
      db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${column} = ?`).get(oldSku).c, 0,
      `${label}: ${table}.${column} ยังค้างอยู่กับรหัสเก่า ${oldSku}`
    );
    assert.ok(
      db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${column} = ?`).get(newSku).c > 0,
      `${label}: ${table}.${column} ไม่ได้ย้ายมารหัสใหม่ ${newSku}`
    );
  }
  // ทุกทางต้องปิด FK ชั่วคราวระหว่างเปลี่ยน primary key — ต้องมั่นใจว่าเปิดคืนแล้วและไม่มีของกำพร้าตกค้าง
  assert.deepEqual(db.pragma('foreign_key_check'), [], `${label}: มีแถวกำพร้าหลังเปลี่ยนรหัส`);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, `${label}: ลืมเปิด foreign_keys คืน`);
};

test('แก้รหัสสินค้าในหน้าแก้ไข: สินค้าที่มีประวัติแล้วต้องเปลี่ยนรหัสได้ ไม่ใช่ Database error', async () => {
  const name = 'สินค้าแก้รหัสเอง';
  const oldSku = await seedProduct('11', 'หมวดแก้รหัส', name);
  // พิมพ์รหัสใหม่เองก็ต้องผ่านด่านยืนยันเหมือนกัน เพราะป้าย QR เดิมใช้ไม่ได้ทั้งสองทาง
  const blocked = await call(products.updateProduct, {
    params: { id: oldSku },
    body: { sku: '11900', name, groupId: '11', groupName: 'หมวดแก้รหัส' }
  });
  assert.equal(blocked.code, 'SKU_CHANGE_CONFIRM', 'ต้องถามยืนยันก่อนเปลี่ยนรหัส');

  await callOk('updateProduct', products.updateProduct, {
    params: { id: oldSku },
    body: { sku: '11900', name, groupId: '11', groupName: 'หมวดแก้รหัส', confirmSkuChange: true }
  });
  assertMoved('แก้รหัสเอง', oldSku, '11900');
});

test('ยุบหมวด: ของทั้งหมวดต้องไม่หลุดจากผังคลัง', async () => {
  const name = 'สินค้ายุบหมวด';
  const oldSku = await seedProduct('12', 'หมวดต้นทาง', name);
  await seedProduct('13', 'หมวดปลายทาง', 'สินค้าที่รออยู่ปลายทาง');
  await callOk('mergeCategories', categories.mergeCategories, { body: { fromId: '12', toId: '13' } });

  const newSku = skuOf(name);
  assert.ok(newSku.startsWith('13'), 'ต้องย้ายมาอยู่ใต้รหัสหมวดปลายทาง');
  assertMoved('ยุบหมวด', oldSku, newSku);
  assert.equal(
    db.prepare('SELECT groupId FROM wms_transaction_items WHERE productId = ?').get(newSku).groupId, '13',
    'หมวดที่ค้างอยู่ในใบเบิกเก่าต้องอัปเดตตาม'
  );
});

test('จัดเรียงเลขรหัสในหมวด: ตำแหน่งบนผังต้องตามไปด้วย', async () => {
  const name = 'สินค้าจัดเรียงเลข';
  const oldSku = await seedProduct('14', 'หมวดจัดเรียง', name);
  // ดันเลขให้ห่างจาก 001 เพื่อให้ปุ่มจัดเรียงมีอะไรให้ทำ — ต้องปิด FK เองเพราะกำลังขยับ primary key
  db.pragma('foreign_keys = OFF');
  db.prepare('UPDATE items SET item_id = ?, item_seq = ? WHERE item_id = ?').run('14500', '500', oldSku);
  for (const { table, column } of SKU_CHILD_TABLES) {
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run('14500', oldSku);
  }
  db.pragma('foreign_keys = ON');
  await callOk('resequenceSkus', categories.resequenceSkus, { body: { groupId: '14' } });
  assertMoved('จัดเรียงเลขในหมวด', '14500', skuOf(name));
});


test('ย้ายสินค้าไปหมวดอื่น: เก็บเลขเดิมไว้ถ้าหมวดปลายทางยังว่างเลขนั้น', async () => {
  const name = 'สินค้าย้ายหมวดเลขว่าง';
  const oldSku = await seedProduct('31', 'หมวดต้นทางย้าย', name);
  assert.equal(oldSku, '31001');

  // ยังไม่ยืนยัน = ต้องไม่เปลี่ยนอะไรเลย แค่บอกว่ารหัสจะกลายเป็นอะไร
  const blocked = await call(products.updateProduct, {
    params: { id: oldSku }, body: { name, groupId: '32', groupName: 'หมวดปลายทางว่าง' }
  });
  assert.equal(blocked.success, false, 'ต้องถามยืนยันก่อน ห้ามเปลี่ยนทันที');
  assert.equal(blocked.code, 'SKU_CHANGE_CONFIRM');
  assert.equal(blocked.to, '32001', 'เลขเดิม 001 ยังว่างที่หมวดปลายทาง จึงต้องได้เลขเดิม');
  assert.equal(db.prepare('SELECT item_id FROM items WHERE item_name = ?').get(name).item_id, oldSku, 'ยังไม่ยืนยันแล้วรหัสต้องไม่ขยับ');

  // ถามล่วงหน้าต้องได้คำตอบเดียวกับตอนบันทึกจริง ไม่งั้นหน้าจอจะบอกเบอร์ผิด
  const preview = await callOk('previewSkuForGroup', products.previewSkuForGroup, {
    params: { id: oldSku }, query: { group: '32' }
  });
  assert.equal(preview.sku, '32001');
  assert.equal(preview.changed, true);

  const saved = await callOk('updateProduct', products.updateProduct, {
    params: { id: oldSku }, body: { name, groupId: '32', groupName: 'หมวดปลายทางว่าง', confirmSkuChange: true }
  });
  assert.equal(saved.sku, '32001', 'ต้องคืนรหัสจริงที่ได้กลับไปให้หน้าจอ');
  assertMoved('ย้ายหมวด', oldSku, '32001');
  assert.equal(db.prepare('SELECT group_id FROM items WHERE item_id = ?').get('32001').group_id, '32');
  assert.equal(
    db.prepare('SELECT groupName FROM wms_transaction_items WHERE productId = ?').get('32001').groupName,
    'หมวดปลายทางว่าง',
    'ชื่อหมวดที่ค้างอยู่ในใบเบิกเก่าต้องอัปเดตตาม'
  );
});

test('ย้ายสินค้าไปหมวดที่เลขเดิมถูกจองแล้ว: ต่อคิวท้ายสุดแทน', async () => {
  const name = 'สินค้าย้ายหมวดเลขชน';
  const oldSku = await seedProduct('33', 'หมวดต้นทางชน', name);
  await seedProduct('34', 'หมวดปลายทางชน', 'ของที่จองเลข 001 ไว้แล้ว');   // กินเลข 34001 ไปก่อน
  assert.equal(oldSku, '33001');

  const saved = await callOk('updateProduct', products.updateProduct, {
    params: { id: oldSku }, body: { name, groupId: '34', groupName: 'หมวดปลายทางชน', confirmSkuChange: true }
  });
  assert.equal(saved.sku, '34002', 'เลข 001 ถูกจองแล้ว ต้องต่อคิวเป็น 002');
  assertMoved('ย้ายหมวดเลขชน', oldSku, '34002');
});

// ปุ่มนี้รันเลขหมวดใหม่ทั้งระบบ จึงต้องอยู่ท้ายสุด ไม่งั้นรหัสหมวดของเทสต์อื่นจะถูกสลับระหว่างทาง
test('จัดเรียงเลขหมวดใหม่ทั้งระบบ: ของทุกหมวดต้องไม่หลุดจากผังคลัง', async () => {
  const name = 'สินค้าจัดเรียงหมวด';
  const oldSku = await seedProduct('21', 'หมวดเลขห่าง', name);
  await callOk('resequenceCategories', categories.resequenceCategories, { body: {} });
  assertMoved('จัดเรียงเลขหมวด', oldSku, skuOf(name));
});

test.after(() => temp.cleanup(db));

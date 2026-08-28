import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPickRoute, PICK_BAND_HEIGHT } from '../utils/pickRoute.js';

// ชั้นลอยบนผัง (ไม่อยู่ในห้อง) — ใช้ตำแหน่งของตัวเองตัดสินลำดับ
const floorRack = (rackId, rackX, rackY, extra = {}) => ({
  sku: `S${rackId}`, planId: 1, rackId, roomId: null, rackX, rackY, storageLevel: 1, ...extra
});

// ชั้นที่อยู่ในห้อง — ระดับผังใช้ตำแหน่งห้อง ระดับในห้องใช้ตำแหน่งชั้น
const roomRack = (rackId, roomId, roomX, roomY, rackX, rackY, extra = {}) => ({
  sku: `S${rackId}`, planId: 1, rackId, roomId, roomX, roomY, rackX, rackY, storageLevel: 1, ...extra
});

test('แถวเดียวกันเดินซ้ายไปขวา', () => {
  const { located } = buildPickRoute([floorRack(3, 900, 10), floorRack(1, 100, 10), floorRack(2, 500, 10)]);
  assert.deepEqual(located.map((item) => item.rackId), [1, 2, 3]);
  assert.deepEqual(located.map((item) => item.order), [1, 2, 3]);
});

test('แถวถัดไปเดินย้อนกลับขวาไปซ้าย (งูเลื้อย)', () => {
  const y2 = PICK_BAND_HEIGHT * 1 + 10; // แถวที่ 1 (เลขคี่)
  const { located } = buildPickRoute([
    floorRack(1, 100, 10), floorRack(2, 900, 10),      // แถว 0 → ซ้ายไปขวา
    floorRack(3, 100, y2), floorRack(4, 900, y2)       // แถว 1 → ขวาไปซ้าย
  ]);
  assert.deepEqual(located.map((item) => item.rackId), [1, 2, 4, 3]);
});

test('สินค้าในชั้นเดียวกันถูกหยิบติดกันและไล่จากเลเวลล่างขึ้นบน', () => {
  const { located, stops } = buildPickRoute([
    floorRack(1, 100, 10, { sku: 'A', storageLevel: 3 }),
    floorRack(2, 500, 10, { sku: 'B' }),
    floorRack(1, 100, 10, { sku: 'C', storageLevel: 1 })
  ]);
  assert.equal(stops, 2, 'ชั้นเดียวกันต้องนับเป็นจุดแวะเดียว');
  assert.deepEqual(located.map((item) => item.sku), ['C', 'A', 'B']);
  assert.deepEqual(located.map((item) => item.stop), [1, 1, 2]);
});

test('ชั้นในห้องเดียวกันอยู่ติดกัน แม้พิกัดในห้องจะสวนทางกับผัง', () => {
  const { located } = buildPickRoute([
    roomRack(10, 5, 800, 10, 900, 10),  // ห้อง 5 อยู่ทางขวาของผัง
    floorRack(1, 100, 10),              // ชั้นลอยอยู่ทางซ้ายของผัง
    roomRack(11, 5, 800, 10, 100, 10)   // ห้อง 5 อีกชั้น (ในห้องอยู่ซ้าย)
  ]);
  // ชั้นลอยซ้ายสุดมาก่อน แล้วค่อยเข้าห้อง 5 โดยในห้องเรียงซ้ายไปขวา
  assert.deepEqual(located.map((item) => item.rackId), [1, 11, 10]);
});

test('แยกรายการที่ยังไม่ระบุตำแหน่งออกมา ไม่ให้ปนเส้นทางเดิน', () => {
  const { located, unlocated, stops } = buildPickRoute([
    floorRack(1, 100, 10),
    { sku: 'NO-LOC', rackId: null, planId: 1 }
  ]);
  assert.equal(located.length, 1);
  assert.equal(stops, 1);
  assert.deepEqual(unlocated.map((item) => item.sku), ['NO-LOC']);
});

test('ลำดับคงที่เมื่อพิกัดเท่ากันเป๊ะ และไม่พังเมื่อพิกัดหาย', () => {
  const input = [floorRack(9, 0, 0), floorRack(2, 0, 0), floorRack(5, undefined, null)];
  const first = buildPickRoute(input).located.map((item) => item.rackId);
  const second = buildPickRoute([...input].reverse()).located.map((item) => item.rackId);
  assert.deepEqual(first, [2, 5, 9]);
  assert.deepEqual(second, first, 'ลำดับต้องไม่ขึ้นกับลำดับข้อมูลที่ส่งเข้ามา');
});

test('คลังคนละผังไม่ถูกสลับปนกัน', () => {
  const { located } = buildPickRoute([
    { sku: 'B', planId: 2, rackId: 20, roomId: null, rackX: 0, rackY: 0, storageLevel: 1 },
    { sku: 'A', planId: 1, rackId: 10, roomId: null, rackX: 900, rackY: 800, storageLevel: 1 }
  ]);
  assert.deepEqual(located.map((item) => item.sku), ['A', 'B']);
});

test('ไม่ล้มเมื่อไม่มีรายการเลย', () => {
  assert.deepEqual(buildPickRoute([]), { located: [], unlocated: [], stops: 0 });
  assert.deepEqual(buildPickRoute(), { located: [], unlocated: [], stops: 0 });
});

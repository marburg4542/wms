import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angleBetween,
  isLinearMarker,
  linearStartPoint,
  normalizeAngle,
  rectFromDrag,
  rotateAroundStart,
  segmentGeometry
} from '../src/components/Storage/layout.js';

const near = (actual, expected, tolerance = 1.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `คาดว่า ~${expected} แต่ได้ ${actual}`);

test('normalizeAngle คืนค่าในช่วง 0–359 เสมอ', () => {
  assert.equal(normalizeAngle(0), 0);
  assert.equal(normalizeAngle(360), 0);
  assert.equal(normalizeAngle(-90), 270);
  assert.equal(normalizeAngle(450), 90);
  assert.equal(normalizeAngle('abc'), 0);
});

test('angleBetween วัดองศาตามทิศเดียวกับ CSS rotate', () => {
  const origin = { x: 100, y: 100 };
  assert.equal(angleBetween(origin, { x: 200, y: 100 }), 0);    // ขวา
  assert.equal(angleBetween(origin, { x: 100, y: 200 }), 90);   // ลง (แกน y ชี้ลง)
  assert.equal(angleBetween(origin, { x: 0, y: 100 }), 180);    // ซ้าย
  assert.equal(angleBetween(origin, { x: 100, y: 0 }), 270);    // ขึ้น
});

test('isLinearMarker แยกกำแพง/เส้นแบ่งออกจาก component อื่น', () => {
  assert.equal(isLinearMarker({ kind: 'marker', type: 'wall' }), true);
  assert.equal(isLinearMarker({ kind: 'marker', type: 'line' }), true);
  assert.equal(isLinearMarker({ kind: 'marker', type: 'label' }), false);
  assert.equal(isLinearMarker({ kind: 'room' }), false);
  assert.equal(isLinearMarker(null), false);
});

// กำแพงยาว 200 เริ่มที่ (700,450) กลางผัง — หมุนรอบทิศแล้วยังอยู่ในผังทุกมุม
const midWall = { kind: 'marker', type: 'wall', posX: 700, posY: 443, width: 200, height: 14, rotation: 0 };

test('หมุนกำแพงแล้วปลายด้านเริ่มต้นต้องอยู่ที่เดิม', () => {
  const startBefore = linearStartPoint(midWall);
  near(startBefore.x, 700);
  near(startBefore.y, 450);

  for (const angle of [15, 45, 90, 180, 270, 359]) {
    const patch = rotateAroundStart(midWall, angle);
    const startAfter = linearStartPoint({ ...midWall, ...patch });
    near(startAfter.x, startBefore.x);
    near(startAfter.y, startBefore.y);
    assert.equal(patch.rotation, angle);
  }
});

test('หมุนกำแพง 90° แล้วปลายอีกด้านกวาดไปตามที่ควรเป็น', () => {
  const rotated = { ...midWall, ...rotateAroundStart(midWall, 90) };
  // จุดกึ่งกลางต้องย้ายจาก (800,450) ไปอยู่ใต้จุดเริ่ม → (700,550)
  near(rotated.posX + rotated.width / 2, 700);
  near(rotated.posY + rotated.height / 2, 550);
});

test('กำแพงชิดขอบผัง: ยอมให้ถูกดันกลับเข้าผัง (ตรงกับกติกาที่ server บังคับ)', () => {
  // เริ่มที่ x=100 ยาว 200 — หมุน 180° ปลายจะพ้นขอบซ้าย จึงต้องถูก clamp ไม่ให้หลุดผัง
  const edgeWall = { kind: 'marker', type: 'wall', posX: 100, posY: 293, width: 200, height: 14, rotation: 0 };
  const patch = rotateAroundStart(edgeWall, 180);
  assert.ok(patch.posX >= 0, 'ห้ามหลุดขอบซ้ายของผัง');
  assert.ok(patch.posX + edgeWall.width <= 1600, 'ห้ามหลุดขอบขวาของผัง');
});

test('component ที่ไม่ใช่กำแพงยังหมุนรอบจุดกึ่งกลางเหมือนเดิม', () => {
  const room = { kind: 'room', posX: 10, posY: 20, width: 240, height: 160, rotation: 0 };
  const patch = rotateAroundStart(room, 45);
  assert.deepEqual(patch, { rotation: 45 }, 'ต้องไม่แก้ตำแหน่งของห้อง');
});

test('หมุนต่อเนื่องหลายครั้งปลายเริ่มต้นไม่ไหลออก', () => {
  let wall = { kind: 'marker', type: 'wall', posX: 700, posY: 400, width: 120, height: 14, rotation: 0 };
  const origin = linearStartPoint(wall);
  for (const angle of [30, 75, 120, 200, 310, 5]) {
    wall = { ...wall, ...rotateAroundStart(wall, angle) };
  }
  const final = linearStartPoint(wall);
  near(final.x, origin.x, 2);
  near(final.y, origin.y, 2);
});

test('กำแพงที่วาดใหม่แล้วหมุนต่อ ยังยึดปลายเดิม', () => {
  const geometry = segmentGeometry({ x: 50, y: 50 }, { x: 250, y: 50 }, 14, false);
  const wall = { kind: 'marker', type: 'wall', ...geometry };
  const start = linearStartPoint(wall);
  near(start.x, 50);
  near(start.y, 50);
  const turned = { ...wall, ...rotateAroundStart(wall, 45) };
  const startAfter = linearStartPoint(turned);
  near(startAfter.x, 50);
  near(startAfter.y, 50);
});

test('rectFromDrag สร้างสี่เหลี่ยมได้จากการลากทุกทิศทาง', () => {
  const a = rectFromDrag({ x: 100, y: 100 }, { x: 340, y: 260 }, 80, 60);
  assert.deepEqual(a, { width: 240, height: 160, posX: 100, posY: 100 });

  // ลากย้อนกลับ (จากขวาล่างไปซ้ายบน) ต้องได้กรอบเดียวกัน
  const b = rectFromDrag({ x: 340, y: 260 }, { x: 100, y: 100 }, 80, 60);
  assert.deepEqual(b, a);
});

test('rectFromDrag บังคับขนาดขั้นต่ำและไม่ให้ล้นผัง', () => {
  const tiny = rectFromDrag({ x: 10, y: 10 }, { x: 12, y: 12 }, 80, 60);
  assert.equal(tiny.width, 80);
  assert.equal(tiny.height, 60);

  const huge = rectFromDrag({ x: 0, y: 0 }, { x: 9999, y: 9999 }, 80, 60);
  assert.ok(huge.posX + huge.width <= 1600);
  assert.ok(huge.posY + huge.height <= 900);
});

test('rectFromDrag เข้ากริดเมื่อเปิด snap', () => {
  const snapped = rectFromDrag({ x: 101, y: 99 }, { x: 341, y: 259 }, 80, 60, true);
  assert.equal(snapped.posX % 24, 0);
  assert.equal(snapped.posY % 24, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { availableForProject, availableWithoutProject, summarizeItemStock } from '../utils/projectStock.js';

// สถานการณ์อ้างอิงที่ตกลงกันไว้: ค้อน 10 ชิ้น จัดเตรียมให้ TAI 3 ชิ้น
const base = { stock: 10, staged: { TAI: 3 }, approved: {} };

test('ยังไม่มีใครอนุมัติ — ของกลางเหลือ 7, กันให้ TAI 3', () => {
  const s = summarizeItemStock(base);
  assert.equal(s.totalStaged, 3);
  assert.equal(s.freeStock, 7);
  assert.equal(s.reserved, 3);
});

test('TAI เบิกได้เท่าโควตาในโซนเท่านั้น', () => {
  const r = availableForProject({ ...base, project: 'TAI' });
  assert.equal(r.available, 3, 'ไม่ใช่ 10 — โซนคือโควตา');
  assert.equal(r.source, 'staging');
  assert.equal(r.quota, 3);
});

test('โครงการอื่นเบิกได้แค่ของกลาง แตะของ TAI ไม่ได้', () => {
  const r = availableForProject({ ...base, project: 'ALPHA' });
  assert.equal(r.available, 7);
  assert.equal(r.source, 'free');
});

test('โครงการ ICS (ไม่มีโซน) เบิกของกลางได้ทั้งหมด', () => {
  const r = availableForProject({ ...base, project: 'ICS' });
  assert.equal(r.available, 7);
  assert.equal(r.source, 'free');
});

test('อนุมัติให้ TAI ไปแล้ว 3 → TAI เบิกต่อไม่ได้ แต่ของกลางยังเหลือ 7 เท่าเดิม', () => {
  const input = { stock: 10, staged: { TAI: 3 }, approved: { TAI: 3 } };
  assert.equal(availableForProject({ ...input, project: 'TAI' }).available, 0);
  assert.equal(availableForProject({ ...input, project: 'ALPHA' }).available, 7,
    'ของที่อนุมัติอยู่ในโซนอยู่แล้ว ห้ามหักซ้ำจากของกลาง');
});

test('อนุมัติบางส่วนจากโซน — โควตาที่เหลือลดลงตาม', () => {
  const input = { stock: 10, staged: { TAI: 5 }, approved: { TAI: 2 } };
  assert.equal(availableForProject({ ...input, project: 'TAI' }).available, 3);
  assert.equal(availableForProject({ ...input, project: 'ALPHA' }).available, 5, '10 − 5 ที่กันให้ TAI');
});

test('โครงการไม่มีโซนอนุมัติไปแล้ว ของกลางต้องลดลง', () => {
  const input = { stock: 10, staged: { TAI: 3 }, approved: { ICS: 2 } };
  const s = summarizeItemStock(input);
  assert.equal(s.approvedOutsideStaging, 2);
  assert.equal(s.freeStock, 5, '10 − 3 (กันให้ TAI) − 2 (ICS อนุมัติแล้ว)');
  assert.equal(availableForProject({ ...input, project: 'ICS' }).available, 5);
  assert.equal(availableForProject({ ...input, project: 'TAI' }).available, 3, 'โควตา TAI ไม่ถูกกระทบ');
});

test('หลายโครงการมีโซนพร้อมกัน', () => {
  const input = { stock: 20, staged: { TAI: 5, ALPHA: 4 }, approved: { TAI: 1 } };
  const s = summarizeItemStock(input);
  assert.equal(s.totalStaged, 9);
  assert.equal(s.freeStock, 11);
  assert.equal(availableForProject({ ...input, project: 'TAI' }).available, 4);
  assert.equal(availableForProject({ ...input, project: 'ALPHA' }).available, 4);
  assert.equal(availableForProject({ ...input, project: 'BETA' }).available, 11);
});

test('อนุมัติเกินโควตาโซน ส่วนเกินต้องหักจากของกลางด้วย', () => {
  // กรณีนี้ไม่ควรเกิดถ้าบล็อกตอนอนุมัติ แต่ถ้าหลุดมาต้องไม่ทำให้เลขบวม
  const input = { stock: 10, staged: { TAI: 3 }, approved: { TAI: 5 } };
  const s = summarizeItemStock(input);
  assert.equal(s.approvedOutsideStaging, 2);
  assert.equal(s.freeStock, 5);
  assert.equal(availableForProject({ ...input, project: 'TAI' }).available, 0);
});

test('ไม่เลือกโครงการ → บอกได้แค่ของกลาง', () => {
  const r = availableWithoutProject(base);
  assert.equal(r.available, 7);
  assert.equal(r.source, 'free');
});

test('ไม่ล้มเมื่อข้อมูลว่างหรือค่าแปลก', () => {
  assert.equal(summarizeItemStock().freeStock, 0);
  assert.equal(summarizeItemStock({ stock: -5, staged: {}, approved: {} }).freeStock, 0);
  assert.equal(summarizeItemStock({ stock: 5, staged: { A: 'x' }, approved: { B: null } }).freeStock, 5);
  assert.equal(availableForProject({ stock: 5, project: null }).available, 5);
});

test('ของกลางไม่ติดลบแม้จัดเตรียมไว้เกินของที่มี', () => {
  const s = summarizeItemStock({ stock: 2, staged: { TAI: 5 }, approved: {} });
  assert.equal(s.freeStock, 0, 'ต้องเป็น 0 ไม่ใช่ -3');
});

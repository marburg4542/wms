// รายงานแบบเลือกวันเอง — หลายวัน/หลายช่วงในไฟล์เดียว
//
// ไม่ต้องใช้ระบบอีเมล/push ในไฟล์นี้ แต่ปิดไว้กันเผลอ (config อ่าน .env ของเครื่องที่รันเทสต์)
process.env.EMAIL_HOST = '';
process.env.EMAIL_USER = '';
process.env.EMAIL_PASS = '';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempDatabase } from './helpers/apiHarness.js';

const temp = createTempDatabase('report');
const { default: db } = await import('../db.js');
const reports = await import('../controllers/reportController.js');

// วันที่ของรายงานคิดตามเวลาเครื่อง — สร้างข้อมูลทดสอบที่เที่ยงวันตามเวลาเครื่องเหมือนกัน
// จะได้ไม่วืดข้ามวันเวลารันในโซนเวลาอื่น
const localNoon = (year, month, day) => new Date(year, month - 1, day, 12, 0, 0).toISOString();

// ใบเบิกต้องมี pickedUpAt ด้วย — ใบที่อนุมัติแล้วแต่ยังไม่มีคนมารับ ยังไม่ถือเป็นประวัติ รายงานจะกรองทิ้ง
const addTx = (transactionId, isoDate, { type = 'INBOUND', sku = '01001', qty = 2 } = {}) => {
  const info = db.prepare(`
    INSERT INTO wms_transactions (transactionId, type, requesterUsername, project, status, requestDate, resolvedDate, adminUsername, pickedUpAt)
    VALUES (?, ?, 'tester', 'โครงการทดสอบ', 'Approved', ?, ?, 'tester', ?)
  `).run(transactionId, type, isoDate, isoDate, type === 'OUTBOUND' ? isoDate : null);
  db.prepare(`
    INSERT INTO wms_transaction_items (tx_id, productId, sku, productName, imageUrl, requestedQty, approvedQty, status)
    VALUES (?, ?, ?, 'สินค้าทดสอบ', '', ?, ?, 'Approved')
  `).run(info.lastInsertRowid, sku, sku, qty, qty);
};

addTx('INB-D3', localNoon(2026, 9, 3));
addTx('INB-D7', localNoon(2026, 9, 7));
addTx('INB-D15', localNoon(2026, 9, 15));

const txIds = (report) => report.rows.map((row) => row.txId).filter(Boolean);

test('resolveRanges: รวมวันที่ซ้อนกันให้เหลือช่วงเดียว และเรียงตามเวลา', () => {
  const spans = reports.resolveRanges({
    type: 'custom',
    days: ['2026-09-05', '2026-09-03', '2026-09-03'],          // ใส่ซ้ำและสลับลำดับมา
    ranges: [{ from: '2026-09-03', to: '2026-09-04' }]          // ทับกับวันที่ 3 ที่เลือกไว้แล้ว
  });
  assert.equal(spans.length, 1, 'วันที่ 3-4 ต่อกับวันที่ 5 พอดี ต้องยุบเหลือช่วงเดียว');
  assert.equal(spans[0].start.getDate(), 3);
  assert.equal(spans[0].end.getDate(), 6, 'ช่วงเป็นแบบ half-open — จบที่เที่ยงคืนของวันถัดจากวันสุดท้าย');
});

test('resolveRanges: ใส่ช่วงกลับด้านก็ยังได้ช่วงเดิม และวันเดี่ยวคนละเดือนไม่ถูกยุบรวม', () => {
  const swapped = reports.resolveRanges({ type: 'custom', ranges: [{ from: '2026-09-09', to: '2026-09-07' }] });
  assert.equal(swapped.length, 1);
  assert.equal(swapped[0].start.getDate(), 7);

  const scattered = reports.resolveRanges({ type: 'custom', days: ['2026-09-03', '2026-10-03'] });
  assert.equal(scattered.length, 2);
});

test('resolveRanges: แบบเดิม (วัน/เดือน/ปี) ยังได้ช่วงเดียวเท่าเดิม', () => {
  assert.equal(reports.resolveRanges({ type: 'day', value: '2026-09-03' }).length, 1);
  assert.equal(reports.resolveRanges({ type: 'month', value: '2026-09' })[0].end.getMonth(), 9);
  assert.equal(reports.resolveRanges({ type: 'year', value: '2026' })[0].start.getFullYear(), 2026);
});

test('resolveRanges: เลือกกว้างเกินเพดาน และเลือกว่าง ต้องบอกสาเหตุ ไม่ใช่ปล่อยผ่าน', () => {
  assert.throws(
    () => reports.resolveRanges({ type: 'custom', ranges: [{ from: '2026-01-01', to: '2026-12-31' }] }),
    new RegExp(String(reports.MAX_REPORT_DAYS))
  );
  assert.throws(() => reports.resolveRanges({ type: 'custom' }), /อย่างน้อย 1 วัน/);
  assert.throws(() => reports.resolveRanges({ type: 'custom', days: ['20 ก.ย. 2569'] }), /ไม่ถูกต้อง/);
});

test('รายงานแบบเลือกเอง: ได้เฉพาะใบของวันที่เลือก ข้ามวันที่อยู่ระหว่างกลาง', () => {
  const report = reports.collectReport({ type: 'custom', days: ['2026-09-03', '2026-09-15'] });
  assert.deepEqual(txIds(report).sort(), ['INB-D15', 'INB-D3'], 'ใบของวันที่ 7 ต้องไม่ติดมาด้วย');
  assert.equal(report.txCount, 2);
});

test('รายงานแบบเลือกเอง: ช่วงวันที่คลุมใบที่อยู่ในช่วง และวันที่ซ้อนกันไม่ทำให้ใบซ้ำ', () => {
  const byRange = reports.collectReport({ type: 'custom', ranges: [{ from: '2026-09-06', to: '2026-09-08' }] });
  assert.deepEqual(txIds(byRange), ['INB-D7']);

  // วันที่ 7 ถูกเลือกทั้งแบบวันเดี่ยวและอยู่ในช่วง — ต้องนับครั้งเดียว
  const overlap = reports.collectReport({ type: 'custom', days: ['2026-09-07'], ranges: [{ from: '2026-09-06', to: '2026-09-08' }] });
  assert.equal(overlap.txCount, 1);
  assert.equal(txIds(overlap).length, 1);
});

test('ป้ายช่วงเวลาและชื่อไฟล์ของรายงานแบบเลือกเอง', () => {
  const few = reports.collectReport({ type: 'custom', days: ['2026-09-03', '2026-09-15'] });
  assert.match(few.periodLabel, /^วันที่ /);
  assert.match(few.periodLabel, /15/);

  // เลือกหลายช่วงจนเกิน 4 รายการ ต้องย่อให้จบในบรรทัดเดียว (หัวกระดาษ PDF สูงตายตัว)
  const many = reports.collectReport({
    type: 'custom',
    days: ['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-07', '2026-09-09', '2026-09-11']
  });
  assert.match(many.periodLabel, /6 วันที่เลือก/);
  assert.equal(many.dayCount, 6);

  // ชื่อไฟล์ต้องเป็น ASCII ล้วน ปลอดภัยกับหัว Content-Disposition
  assert.match(few.fileTag, /^custom_2026-09-03_2026-09-15_2d$/);
  assert.equal(reports.collectReport({ type: 'day', value: '2026-09-03' }).fileTag, 'day_2026-09-03');
});

test('รายงานแบบเลือกเอง: ตัวกรองประเภทและสรุปยอดยังทำงานเหมือนเดิม', () => {
  addTx('REQ-D3', localNoon(2026, 9, 3), { type: 'OUTBOUND', sku: '01002', qty: 5 });
  const all = reports.collectReport({ type: 'custom', days: ['2026-09-03'] });
  assert.equal(all.txCount, 2);

  const inboundOnly = reports.collectReport({ type: 'custom', days: ['2026-09-03'], typeFilter: 'INBOUND' });
  assert.deepEqual(txIds(inboundOnly), ['INB-D3']);
  assert.match(inboundOnly.periodLabel, /รับเข้า/);

  const summary = Object.fromEntries(all.summaryRows.map(([sku, , inbound, outbound]) => [sku, { inbound, outbound }]));
  assert.equal(summary['01001'].inbound, '2');
  assert.equal(summary['01002'].outbound, '5');
});

test.after(() => temp.cleanup(db));

// สร้างรายงาน PDF ที่ฝั่งเซิร์ฟเวอร์ แล้วส่งกลับเป็นไฟล์แนบ
//
// ทำไมต้องเป็นฝั่งเซิร์ฟเวอร์: iOS Safari สั่งพิมพ์แล้วเข้า AirPrint เสมอ ผู้ใช้บันทึกเป็นไฟล์ไม่ได้
// แต่ไฟล์ที่เซิร์ฟเวอร์ส่งมาพร้อมหัว Content-Disposition: attachment นั้น iOS จัดการได้ปกติ
// (เข้าแอป Files) — จึงย้ายการสร้างไฟล์มาไว้ที่นี่ทั้งหมด
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { config } from '../config.js';
import { logAudit } from '../db.js';
import { sarabunRegular } from '../../src/utils/thaiFont.js';
import { buildReportHtml } from '../utils/reportHtml.js';
import { renderUrlToPdf, RenderError } from '../utils/pdfRenderer.js';
import { getFullTransactions } from './transactionController.js';

const TMP_DIR = path.join(os.tmpdir(), 'wms-reports');
const TTL_MS = 5 * 60 * 1000;   // ลิงก์ดาวน์โหลดมีอายุ 5 นาที

// งานที่รอให้ดาวน์โหลด — เก็บใน memory เพราะเป็นของชั่วคราวล้วน รีสตาร์ทแล้วหายได้
const jobs = new Map();

const TYPE_LABEL = { INBOUND: 'รับเข้า', OUTBOUND: 'เบิกออก', ADJUSTMENT: 'ปรับยอด', RETURN: 'คืนสินค้า' };
const STATUS_LABEL = { Pending: 'รออนุมัติ', Approved: 'อนุมัติ', Partial: 'อนุมัติบางส่วน', Rejected: 'ปฏิเสธ', Cancelled: 'ยกเลิก' };

const sweep = () => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.expires <= now) {
      fs.rmSync(job.pdfPath, { force: true });
      jobs.delete(id);
    }
  }
};

// รายงานแบบเลือกเองได้หลายวัน/หลายช่วง — กันเลือกกว้างเกินจนไฟล์บวมและคิวเรนเดอร์ค้าง
export const MAX_REPORT_DAYS = 62;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayStart = (ymd) => new Date(`${ymd}T00:00:00`);       // เที่ยงคืนตามเวลาเครื่อง เหมือนตรรกะเดิม
const addDays = (date, amount) => { const next = new Date(date); next.setDate(next.getDate() + amount); return next; };
const countDays = (list) => list.reduce((sum, range) => sum + Math.round((range.end - range.start) / DAY_MS), 0);

// รวมช่วงที่ซ้อนกันหรือต่อกันพอดีให้เหลือช่วงเดียว แล้วเรียงตามเวลา
// (เลือกวันที่ 3 กับช่วง 3–7 มาด้วยกัน ต้องไม่กลายเป็นนับใบของวันที่ 3 ซ้ำสองรอบ)
const mergeRanges = (list) => {
  const merged = [];
  for (const range of [...list].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
};

// ช่วงเวลาของรายงาน — ตรรกะเดียวกับที่หน้าแดชบอร์ดเคยคำนวณไว้ฝั่งเบราว์เซอร์
// คืนเป็น array เสมอ: day/month/year ได้ช่วงเดียว ส่วน custom ได้ตามที่ผู้ใช้เลือก
export const resolveRanges = ({ type, value, days = [], ranges = [] }) => {
  if (type === 'custom') {
    const picked = [];
    for (const day of Array.isArray(days) ? days : []) {
      if (!DAY_PATTERN.test(String(day))) throw new RenderError('รูปแบบวันที่ที่เลือกไม่ถูกต้อง');
      picked.push({ start: dayStart(day), end: addDays(dayStart(day), 1) });
    }
    for (const range of Array.isArray(ranges) ? ranges : []) {
      const from = String(range?.from ?? '');
      const to = String(range?.to ?? '');
      if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) throw new RenderError('รูปแบบช่วงวันที่ไม่ถูกต้อง');
      const [first, last] = from <= to ? [from, to] : [to, from];   // ใส่กลับด้านมาก็ยังได้ช่วงที่ถูก
      picked.push({ start: dayStart(first), end: addDays(dayStart(last), 1) });
    }
    if (picked.length === 0) throw new RenderError('กรุณาเลือกวันที่อย่างน้อย 1 วัน');
    if (picked.some((range) => Number.isNaN(range.start.getTime()) || Number.isNaN(range.end.getTime()))) {
      throw new RenderError('ช่วงเวลาที่เลือกไม่ถูกต้อง');
    }
    const merged = mergeRanges(picked);
    const total = countDays(merged);
    if (total > MAX_REPORT_DAYS) {
      throw new RenderError(`เลือกได้ไม่เกิน ${MAX_REPORT_DAYS} วันต่อรายงาน (ตอนนี้เลือกไว้ ${total} วัน)`);
    }
    return merged;
  }
  if (type === 'day') {
    const start = dayStart(value);
    return [{ start, end: addDays(start, 1) }];
  }
  if (type === 'month') {
    const [y, m] = String(value).split('-').map(Number);
    return [{ start: new Date(y, m - 1, 1), end: new Date(y, m, 1) }];
  }
  const y = Number(value);
  return [{ start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) }];
};

const thaiDay = (date) => date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
const ymd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// ป้ายช่วงเวลาของรายงานแบบเลือกเอง — ต้องจบในบรรทัดเดียว
// เพราะหัวกระดาษใน reportHtml.js สูงตายตัวและ overflow: hidden ถ้ายาวเกินจะโดนตัดกลางคัน
const describeRanges = (merged) => {
  const parts = merged.map((range) => {
    const first = thaiDay(range.start);
    return range.end - range.start <= DAY_MS ? first : `${first}–${thaiDay(addDays(range.end, -1))}`;
  });
  if (parts.length <= 4) return `วันที่ ${parts.join(', ')}`;
  const last = addDays(merged[merged.length - 1].end, -1);
  return `${countDays(merged)} วันที่เลือก (${thaiDay(merged[0].start)} – ${thaiDay(last)})`;
};

const getItems = (tx) => {
  if (tx.items && Array.isArray(tx.items)) return tx.items;
  return [{ productId: tx.productId, sku: tx.sku, productName: tx.productName, imageUrl: tx.imageUrl, requestedQty: tx.quantity, approvedQty: tx.quantity }];
};

// ใบที่อนุมัติแล้วแต่ยังไม่มีคนมารับ ยังไม่ถือเป็นประวัติ — ไม่เอาเข้ารายงาน
const isWaitingPickup = (tx) => tx.type === 'OUTBOUND' && ['Approved', 'Partial'].includes(tx.status) && !tx.pickedUpAt;

export const collectReport = ({ type, value, typeFilter = 'all', projectFilter = 'all', days = [], ranges = [] }) => {
  const spans = resolveRanges({ type, value, days, ranges });
  if (spans.some((span) => Number.isNaN(span.start.getTime()))) throw new RenderError('ช่วงเวลาที่เลือกไม่ถูกต้อง');

  const logs = getFullTransactions({ ranges: spans.map((span) => ({ since: span.start.toISOString(), until: span.end.toISOString() })) })
    .filter((tx) => (tx.status !== 'Pending' || tx.type === 'INBOUND') && !isWaitingPickup(tx))
    .filter((tx) => typeFilter === 'all' || tx.type === typeFilter)
    // ใบรับเข้าไม่มีโปรเจกต์ จึงไม่เอาตัวกรองโปรเจกต์ไปใช้กับมัน
    .filter((tx) => projectFilter === 'all' || typeFilter === 'INBOUND' || (tx.project || '') === projectFilter)
    .sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

  // แต่ละแถว = สินค้า 1 ชิ้น (ฟิลด์ระดับใบเบิกโชว์เฉพาะแถวแรกของใบ)
  const rows = [];
  for (const tx of logs) {
    const items = getItems(tx);
    items.forEach((item, idx) => {
      rows.push({
        imageUrl: item.imageUrl || '',
        date: idx === 0 ? new Date(tx.requestDate).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '',
        txId: idx === 0 ? (tx.transactionId || String(tx.id)) : '',
        type: idx === 0 ? (TYPE_LABEL[tx.type] || tx.type) : '',
        sku: item.sku || '-',
        group: item.groupId ? `${item.groupId} — ${item.groupName || ''}` : '-',
        name: item.productName || '-',
        qty: String(tx.type === 'INBOUND' ? item.requestedQty : item.approvedQty),
        requester: idx === 0 ? (tx.requesterUsername || '-') : '',
        project: idx === 0 ? (tx.project || '-') : '',
        status: idx === 0 ? (STATUS_LABEL[tx.status] || tx.status) : '',
        note: idx === 0 ? (tx.adminMessage || '-') : ''
      });
    });
  }

  // ---- ตารางสรุปยอดรวมต่อสินค้า ----
  const summaryMap = new Map();
  for (const tx of logs) {
    // นับเฉพาะรับเข้า/เบิกออกจริง — ข้ามการปรับยอดและประเภทอื่น
    if (tx.type !== 'INBOUND' && tx.type !== 'OUTBOUND') continue;
    for (const item of getItems(tx)) {
      const sku = item.sku || '-';
      const entry = summaryMap.get(sku) || { name: item.productName || '-', inbound: 0, outbound: 0 };
      if (tx.type === 'INBOUND') entry.inbound += Number(item.requestedQty) || 0;
      else entry.outbound += Number(item.approvedQty) || 0;
      summaryMap.set(sku, entry);
    }
  }
  const summaryRows = [...summaryMap.entries()]
    .map(([sku, v]) => [sku, v.name, String(v.inbound), String(v.outbound)])
    .sort((a, b) => a[0].localeCompare(b[0]));

  let periodLabel = type === 'custom' ? describeRanges(spans)
    : type === 'day' ? `วันที่ ${value}`
      : type === 'month' ? `เดือน ${value}` : `ปี ${value}`;
  if (typeFilter !== 'all') periodLabel += ` · ${TYPE_LABEL[typeFilter] || typeFilter}`;
  if (projectFilter !== 'all') periodLabel += ` · โปรเจกต์: ${projectFilter}`;

  // ส่วนท้ายชื่อไฟล์ — ASCII ล้วน ปลอดภัยกับหัว Content-Disposition ตอนดาวน์โหลด
  const fileTag = type === 'custom'
    ? `custom_${ymd(spans[0].start)}_${ymd(addDays(spans[spans.length - 1].end, -1))}_${countDays(spans)}d`
    : `${type}_${value}`;

  return { rows, summaryRows, periodLabel, txCount: logs.length, fileTag, dayCount: countDays(spans) };
};

export const createHistoryReport = async (req, res) => {
  try {
    const { type = 'day', value, typeFilter = 'all', projectFilter = 'all', days = [], ranges = [] } = req.body || {};
    // แบบเลือกเองไม่มีช่อง value เดียว — resolveRanges เป็นคนตรวจว่าเลือกวันมาครบไหม
    if (type !== 'custom' && !value) return res.status(400).json({ success: false, message: 'กรุณาระบุช่วงเวลาของรายงาน' });

    const report = collectReport({ type, value, typeFilter, projectFilter, days, ranges });
    if (report.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่มีข้อมูลในช่วงเวลาที่เลือก' });
    }

    const filename = `WMS_Report_${report.fileTag}`;
    const { html, pages } = buildReportHtml({ ...report, fontBase64: sarabunRegular, filename });

    sweep();
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const id = crypto.randomBytes(24).toString('hex');
    const pdfPath = path.join(TMP_DIR, `${id}.pdf`);

    // เก็บ HTML ไว้ชั่วคราวให้เบราว์เซอร์มาดึงผ่าน HTTP — รูปสินค้าจะได้โหลดจาก /uploads ได้เอง
    jobs.set(id, { html, pdfPath, filename, pages, expires: Date.now() + TTL_MS });
    try {
      await renderUrlToPdf(`http://127.0.0.1:${config.port}/api/reports/render/${id}`, pdfPath);
    } finally {
      const job = jobs.get(id);
      if (job) job.html = null;   // ใช้เสร็จแล้วปล่อยหน่วยความจำทันที
    }

    logAudit(req.user?.username, 'report.create', 'report', id, {
      type, value, typeFilter, projectFilter, pages, rows: report.rows.length,
      ...(type === 'custom' ? { days: days.length, ranges: ranges.length, dayCount: report.dayCount } : {})
    });
    res.json({ success: true, downloadUrl: `/api/reports/download/${id}`, filename: `${filename}.pdf`, pages });
  } catch (err) {
    if (err instanceof RenderError) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('createHistoryReport error:', err);
    res.status(500).json({ success: false, message: 'สร้างรายงานไม่สำเร็จ' });
  }
};

// หน้า HTML ที่เบราว์เซอร์ headless มาดึงไปเรนเดอร์
// รับเฉพาะคำขอจากเครื่องตัวเอง เพราะ Chrome ที่เรียกใช้รันอยู่บนเซิร์ฟเวอร์นี้
export const renderReportPage = (req, res) => {
  // เทียบกับ req.ip เท่านั้น ห้ามใช้ socket.remoteAddress มาช่วย —
  // cloudflared วิ่งอยู่บนเครื่องเดียวกัน ทราฟฟิกจากภายนอกจึงมี socket เป็น loopback ด้วย
  // ส่วน req.ip ผ่าน trust proxy = 'loopback' จะเป็น IP จริงของผู้ใช้ปลายทาง
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (!local.includes(req.ip)) return res.status(403).send('forbidden');
  const job = jobs.get(req.params.id);
  if (!job?.html) return res.status(404).send('not found');
  res.type('html').send(job.html);
};

// ลิงก์ดาวน์โหลด — ไม่ต้องมี token เพราะ id สุ่ม 24 ไบต์ ใช้ได้ครั้งเดียว และหมดอายุใน 5 นาที
// (แอปยืนยันตัวตนด้วย Bearer token ใน header ซึ่งการนำทางของเบราว์เซอร์พกไปด้วยไม่ได้
//  ส่วนการใส่ JWT ลง URL จะทำให้ token ไปโผล่ในประวัติเบราว์เซอร์และ log)
export const downloadReport = (req, res) => {
  sweep();
  const { id } = req.params;
  const job = jobs.get(id);
  if (!job || !fs.existsSync(job.pdfPath)) {
    return res.status(404).json({ success: false, message: 'ลิงก์ดาวน์โหลดหมดอายุหรือถูกใช้ไปแล้ว — กดสร้างรายงานใหม่อีกครั้ง' });
  }

  jobs.delete(id);   // ใช้ครั้งเดียว
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}.pdf"`);
  const stream = fs.createReadStream(job.pdfPath);
  stream.pipe(res);
  stream.on('close', () => fs.rmSync(job.pdfPath, { force: true }));
};

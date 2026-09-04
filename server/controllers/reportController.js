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

// ช่วงเวลาของรายงาน — ตรรกะเดียวกับที่หน้าแดชบอร์ดเคยคำนวณไว้ฝั่งเบราว์เซอร์
const resolveRange = (type, value) => {
  if (type === 'day') {
    const start = new Date(`${value}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (type === 'month') {
    const [y, m] = String(value).split('-').map(Number);
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
  }
  const y = Number(value);
  return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
};

const getItems = (tx) => {
  if (tx.items && Array.isArray(tx.items)) return tx.items;
  return [{ productId: tx.productId, sku: tx.sku, productName: tx.productName, imageUrl: tx.imageUrl, requestedQty: tx.quantity, approvedQty: tx.quantity }];
};

// ใบที่อนุมัติแล้วแต่ยังไม่มีคนมารับ ยังไม่ถือเป็นประวัติ — ไม่เอาเข้ารายงาน
const isWaitingPickup = (tx) => tx.type === 'OUTBOUND' && ['Approved', 'Partial'].includes(tx.status) && !tx.pickedUpAt;

export const collectReport = ({ type, value, typeFilter = 'all', projectFilter = 'all' }) => {
  const { start, end } = resolveRange(type, value);
  if (!start || Number.isNaN(start.getTime())) throw new RenderError('ช่วงเวลาที่เลือกไม่ถูกต้อง');

  const logs = getFullTransactions({ since: start.toISOString(), until: end.toISOString() })
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

  let periodLabel = type === 'day' ? `วันที่ ${value}` : type === 'month' ? `เดือน ${value}` : `ปี ${value}`;
  if (typeFilter !== 'all') periodLabel += ` · ${TYPE_LABEL[typeFilter] || typeFilter}`;
  if (projectFilter !== 'all') periodLabel += ` · โปรเจกต์: ${projectFilter}`;

  return { rows, summaryRows, periodLabel, txCount: logs.length };
};

export const createHistoryReport = async (req, res) => {
  try {
    const { type = 'day', value, typeFilter = 'all', projectFilter = 'all' } = req.body || {};
    if (!value) return res.status(400).json({ success: false, message: 'กรุณาระบุช่วงเวลาของรายงาน' });

    const report = collectReport({ type, value, typeFilter, projectFilter });
    if (report.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่มีข้อมูลในช่วงเวลาที่เลือก' });
    }

    const filename = `WMS_Report_${type}_${value}`;
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

    logAudit(req.user?.username, 'report.create', 'report', id, { type, value, typeFilter, projectFilter, pages, rows: report.rows.length });
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

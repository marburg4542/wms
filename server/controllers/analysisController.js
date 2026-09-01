import db from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// การเคลื่อนไหว "จริง" เท่านั้น — ตัดยอดยกมา (imported) และการปรับยอด (adjustment) ออก
// ไม่งั้น trend จะเพี้ยนจากยอด snapshot ตอนย้ายข้อมูล และการแก้ยอดนับสต็อก
// 'return' = ของที่เบิกไปแล้วส่งกลับคืน ไม่ใช่ของที่รับเข้ามาใหม่
// ถ้านับรวมจะทำให้ยอด "รับเข้า" สูงเกินจริง (ของชิ้นเดิมถูกนับสองรอบ)
const REAL_MOVE = "COALESCE(clean_status, '') NOT IN ('imported', 'adjustment', 'return')";

// อ่านผลพยากรณ์ที่ ML service (Python) เขียนไว้ — ไฟล์ JSON เดียว ไม่ผูก process กัน
// ตั้ง path ผ่าน ML_FORECAST_PATH ใน .env ได้ (ค่าเริ่มต้น: ml/state/forecasts.json ที่ root โปรเจกต์)
const FORECAST_PATH = process.env.ML_FORECAST_PATH
  || path.join(__dirname, '..', '..', 'ml', 'state', 'forecasts.json');

export const getForecast = (req, res) => {
  try {
    if (!fs.existsSync(FORECAST_PATH)) {
      // ยังไม่เคยรัน ML pipeline — หน้าเว็บจะโชว์สถานะ "รอข้อมูล" แทน error
      return res.json({ success: true, available: false });
    }
    const data = JSON.parse(fs.readFileSync(FORECAST_PATH, 'utf8'));
    // ไฟล์เก่าเกิน 48 ชม. = ML ไม่ได้รันมานาน แจ้งให้หน้าเว็บเตือนความสด
    const ageHours = (Date.now() - fs.statSync(FORECAST_PATH).mtimeMs) / 3.6e6;
    return res.json({ success: true, available: true, stale: ageHours > 48, ageHours: Math.round(ageHours), ...data });
  } catch (err) {
    console.error('getForecast error:', err);
    return res.status(500).json({ success: false, message: 'อ่านผลพยากรณ์ไม่สำเร็จ' });
  }
};

// สรุป trend การนำเข้า/เบิกออก + สินค้าที่เบิกเยอะ/บ่อย + แยกหมวดหมู่ สำหรับหน้า Analysis
export const getAnalysis = (req, res) => {
  try {
    // 1) รายการเดือน/ปีที่มีข้อมูล — ไว้ให้ dropdown เลือกช่วงที่จะดูกราฟ (ข้อมูลกราฟจริงมาจาก getTrend)
    const availableMonths = db.prepare(`
      SELECT DISTINCT ym FROM (
        SELECT strftime('%Y-%m', date(input_date, 'localtime')) ym FROM stock_in WHERE ${REAL_MOVE} AND input_date IS NOT NULL
        UNION
        SELECT strftime('%Y-%m', date(output_date, 'localtime')) ym FROM stock_out WHERE ${REAL_MOVE} AND output_date IS NOT NULL
      ) WHERE ym IS NOT NULL ORDER BY ym DESC
    `).all().map(r => r.ym);
    const availableYears = [...new Set(availableMonths.map(m => m.slice(0, 4)))];

    // 2) สินค้าที่เบิกออกมากสุด (ตามจำนวนชิ้น) และบ่อยสุด (ตามจำนวนครั้ง)
    const topByQty = db.prepare(`
      SELECT so.item_id AS sku, i.item_name AS name, i.group_id AS groupId,
             SUM(so.quantity) AS qty, COUNT(*) AS times
      FROM stock_out so JOIN items i ON i.item_id = so.item_id
      WHERE ${REAL_MOVE.replace(/clean_status/g, 'so.clean_status')}
      GROUP BY so.item_id ORDER BY qty DESC LIMIT 10
    `).all();
    const topByFrequency = db.prepare(`
      SELECT so.item_id AS sku, i.item_name AS name, i.group_id AS groupId,
             COUNT(*) AS times, SUM(so.quantity) AS qty
      FROM stock_out so JOIN items i ON i.item_id = so.item_id
      WHERE ${REAL_MOVE.replace(/clean_status/g, 'so.clean_status')}
      GROUP BY so.item_id ORDER BY times DESC, qty DESC LIMIT 10
    `).all();

    // 3) แยกตามหมวดหมู่ — นำเข้า/เบิกออกรวมต่อกลุ่ม
    const inByGroup = db.prepare(`
      SELECT i.group_id AS groupId, SUM(s.quantity) AS qty
      FROM stock_in s JOIN items i ON i.item_id = s.item_id
      WHERE ${REAL_MOVE.replace(/clean_status/g, 's.clean_status')}
      GROUP BY i.group_id
    `).all();
    const outByGroup = db.prepare(`
      SELECT i.group_id AS groupId, SUM(s.quantity) AS qty
      FROM stock_out s JOIN items i ON i.item_id = s.item_id
      WHERE ${REAL_MOVE.replace(/clean_status/g, 's.clean_status')}
      GROUP BY i.group_id
    `).all();
    // แสดงครบทุกหมวดหมู่ 01-23 เรียงตามรหัส (แม้ยังไม่มีการเคลื่อนไหว = แสดง 0)
    const inMap = new Map(inByGroup.map(r => [r.groupId, r.qty || 0]));
    const outMap = new Map(outByGroup.map(r => [r.groupId, r.qty || 0]));
    const byCategory = db.prepare("SELECT group_id, group_name FROM item_groups WHERE group_id != '00' ORDER BY group_id ASC")
      .all()
      .map(g => ({
        groupId: g.group_id,
        groupName: g.group_name,
        inbound: inMap.get(g.group_id) || 0,
        outbound: outMap.get(g.group_id) || 0
      }));

    // 4) ตัวเลขสรุปรวม
    const totalInbound = db.prepare(`SELECT COALESCE(SUM(quantity), 0) t FROM stock_in WHERE ${REAL_MOVE}`).get().t;
    const totalOutbound = db.prepare(`SELECT COALESCE(SUM(quantity), 0) t FROM stock_out WHERE ${REAL_MOVE}`).get().t;
    const activeItems = db.prepare("SELECT COUNT(*) c FROM items i LEFT JOIN product_settings ps ON ps.item_id = i.item_id WHERE COALESCE(ps.is_active, 1) = 1").get().c;
    const discrepancyItems = db.prepare('SELECT COUNT(*) c FROM warehouse_balance WHERE stock_balance < 0').get().c;
    const stockValue = db.prepare('SELECT COALESCE(SUM(stock_balance * latest_cost), 0) v FROM warehouse_balance WHERE latest_cost IS NOT NULL').get().v;

    res.json({
      success: true,
      availableMonths,
      availableYears,
      topByQty,
      topByFrequency,
      byCategory,
      totals: {
        totalInbound,
        totalOutbound,
        activeItems,
        discrepancyItems,
        stockValue: Math.round(stockValue * 100) / 100
      }
    });
  } catch (err) {
    console.error('getAnalysis error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// ข้อมูลกราฟเส้น trend: เลือกเดือน (mode=month, value='2026-07' → รายวัน) หรือปี (mode=year, value='2026' → รายเดือน)
// แกน x = วันที่/เดือน, แกน y = จำนวนอะไหล่ (นำเข้า/เบิกออก)
export const getTrend = (req, res) => {
  try {
    const mode = req.query.mode === 'year' ? 'year' : 'month';
    const value = String(req.query.value || '').trim();
    if (mode === 'month' && !/^\d{4}-\d{2}$/.test(value)) return res.json({ success: true, mode, value, points: [] });
    if (mode === 'year' && !/^\d{4}$/.test(value)) return res.json({ success: true, mode, value, points: [] });

    const bucket = mode === 'year' ? '%m' : '%d';        // ปี→แยกรายเดือน, เดือน→แยกรายวัน
    const matchFmt = mode === 'year' ? '%Y' : '%Y-%m';

    const q = (table, col) => db.prepare(`
      SELECT strftime('${bucket}', date(${col}, 'localtime')) AS k, SUM(quantity) AS qty
      FROM ${table}
      WHERE ${REAL_MOVE} AND ${col} IS NOT NULL
        AND strftime('${matchFmt}', date(${col}, 'localtime')) = ?
      GROUP BY k
    `).all(value);

    const inMap = new Map(q('stock_in', 'input_date').map(r => [r.k, r.qty || 0]));
    const outMap = new Map(q('stock_out', 'output_date').map(r => [r.k, r.qty || 0]));

    // สร้างแกน x เต็มช่วง (เดือน: ทุกวันในเดือน / ปี: 01-12) เพื่อให้เส้นต่อเนื่อง เห็นวันยอด 0 ด้วย
    let keys;
    if (mode === 'year') {
      keys = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    } else {
      const [y, m] = value.split('-').map(Number);
      const days = new Date(y, m, 0).getDate();         // จำนวนวันจริงของเดือนนั้น
      keys = Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, '0'));
    }
    const points = keys.map(k => ({
      label: mode === 'year' ? k : String(Number(k)),   // ปี:'01'..'12' | เดือน:'1'..'31'
      inbound: inMap.get(k) || 0,
      outbound: outMap.get(k) || 0
    }));

    res.json({ success: true, mode, value, points });
  } catch (err) {
    console.error('getTrend error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

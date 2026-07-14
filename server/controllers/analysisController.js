import db from '../db.js';

// การเคลื่อนไหว "จริง" เท่านั้น — ตัดยอดยกมา (imported) และการปรับยอด (adjustment) ออก
// ไม่งั้น trend จะเพี้ยนจากยอด snapshot ตอนย้ายข้อมูล และการแก้ยอดนับสต็อก
const REAL_MOVE = "COALESCE(clean_status, '') NOT IN ('imported', 'adjustment')";

// สรุป trend การนำเข้า/เบิกออก + สินค้าที่เบิกเยอะ/บ่อย + แยกหมวดหมู่ สำหรับหน้า Analysis
export const getAnalysis = (req, res) => {
  try {
    const period = req.query.period === 'year' ? 'year' : 'month';
    const fmt = period === 'year' ? '%Y' : '%Y-%m';

    // 1) trend ตามช่วงเวลา — รวมนำเข้า/เบิกออกต่อเดือน(หรือปี)
    const inByPeriod = db.prepare(`
      SELECT strftime('${fmt}', date(input_date, 'localtime')) AS period, SUM(quantity) AS qty
      FROM stock_in WHERE ${REAL_MOVE} AND input_date IS NOT NULL
      GROUP BY period
    `).all();
    const outByPeriod = db.prepare(`
      SELECT strftime('${fmt}', date(output_date, 'localtime')) AS period, SUM(quantity) AS qty
      FROM stock_out WHERE ${REAL_MOVE} AND output_date IS NOT NULL
      GROUP BY period
    `).all();

    const trendMap = new Map();
    for (const r of inByPeriod) if (r.period) trendMap.set(r.period, { period: r.period, inbound: r.qty || 0, outbound: 0 });
    for (const r of outByPeriod) {
      if (!r.period) continue;
      const e = trendMap.get(r.period) || { period: r.period, inbound: 0, outbound: 0 };
      e.outbound = r.qty || 0;
      trendMap.set(r.period, e);
    }
    const trends = [...trendMap.values()].sort((a, b) => a.period.localeCompare(b.period));

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
    const groupNames = new Map(db.prepare('SELECT group_id, group_name FROM item_groups').all().map(g => [g.group_id, g.group_name]));
    const catMap = new Map();
    for (const r of inByGroup) catMap.set(r.groupId, { groupId: r.groupId, groupName: groupNames.get(r.groupId) || r.groupId, inbound: r.qty || 0, outbound: 0 });
    for (const r of outByGroup) {
      const e = catMap.get(r.groupId) || { groupId: r.groupId, groupName: groupNames.get(r.groupId) || r.groupId, inbound: 0, outbound: 0 };
      e.outbound = r.qty || 0;
      catMap.set(r.groupId, e);
    }
    const byCategory = [...catMap.values()].sort((a, b) => (b.inbound + b.outbound) - (a.inbound + a.outbound));

    // 4) ตัวเลขสรุปรวม
    const totalInbound = db.prepare(`SELECT COALESCE(SUM(quantity), 0) t FROM stock_in WHERE ${REAL_MOVE}`).get().t;
    const totalOutbound = db.prepare(`SELECT COALESCE(SUM(quantity), 0) t FROM stock_out WHERE ${REAL_MOVE}`).get().t;
    const activeItems = db.prepare("SELECT COUNT(*) c FROM items i LEFT JOIN product_settings ps ON ps.item_id = i.item_id WHERE COALESCE(ps.is_active, 1) = 1").get().c;
    const discrepancyItems = db.prepare('SELECT COUNT(*) c FROM warehouse_balance WHERE stock_balance < 0').get().c;
    const stockValue = db.prepare('SELECT COALESCE(SUM(stock_balance * latest_cost), 0) v FROM warehouse_balance WHERE latest_cost IS NOT NULL').get().v;

    res.json({
      success: true,
      period,
      trends,
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

// คำนวณ "เบิกได้เท่าไร" เมื่อมีพื้นที่จัดเตรียมผูกกับโครงการ
//
// กติกาที่ตกลงกันไว้:
//   1. โครงการที่มีพื้นที่จัดเตรียมสำหรับสินค้านั้น → เบิกได้ไม่เกินจำนวนที่จัดเตรียมไว้
//      ถ้าจะเบิกเพิ่ม Admin/Manager ต้องเติมของเข้าโซนก่อน (โซน = โควตาของโครงการ)
//   2. โครงการที่ไม่มีพื้นที่จัดเตรียม → เบิกจาก "ของกลาง" คือของที่ไม่ได้ถูกกันให้โครงการไหน
//   3. ของที่อยู่ในโซนจัดเตรียมยังนับเป็นสต็อก (แค่เปลี่ยนที่วาง) แต่ถูกกันไว้ให้โครงการนั้น
//      โครงการอื่นแตะไม่ได้ — ของหายจากสต็อกจริงตอนกด "รับแล้ว" เท่านั้น

/**
 * @param {object} input
 * @param {number} input.stock          ยอดคงเหลือจริง (stock_in − stock_out)
 * @param {object} input.staged         { ชื่อโครงการ: จำนวนที่จัดเตรียมไว้ }
 * @param {object} input.approved       { ชื่อโครงการ: จำนวนที่อนุมัติแล้วรอรับของ }
 * @returns {{ totalStaged, approvedOutsideStaging, freeStock, reserved }}
 */
export const summarizeItemStock = ({ stock = 0, staged = {}, approved = {} } = {}) => {
  const num = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const totalStaged = Object.values(staged).reduce((sum, qty) => sum + num(qty), 0);

  // ใบที่อนุมัติแล้วของโครงการที่มีโซน จะหยิบจากโซนอยู่แล้ว จึงนับซ้ำไม่ได้
  // นับเฉพาะส่วนที่เกินโควตาโซน (หรือทั้งก้อนถ้าโครงการนั้นไม่มีโซน)
  const approvedOutsideStaging = Object.keys(approved).reduce(
    (sum, project) => sum + Math.max(0, num(approved[project]) - num(staged[project])),
    0
  );

  const freeStock = Math.max(0, num(stock) - totalStaged - approvedOutsideStaging);
  return {
    totalStaged,
    approvedOutsideStaging,
    freeStock,
    reserved: totalStaged + approvedOutsideStaging
  };
};

/**
 * เบิกได้อีกเท่าไรสำหรับโครงการหนึ่ง
 * มีโซน → โควตาที่เหลือของโซนนั้น | ไม่มีโซน → ของกลางที่ยังว่าง
 */
export const availableForProject = ({ stock = 0, staged = {}, approved = {}, project } = {}) => {
  const num = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const key = project == null ? '' : String(project);
  const summary = summarizeItemStock({ stock, staged, approved });
  const myStaged = num(staged[key]);
  const myApproved = num(approved[key]);

  if (myStaged > 0) {
    return {
      available: Math.max(0, myStaged - myApproved),
      source: 'staging',                       // เบิกจากโซนจัดเตรียมของโครงการนี้
      quota: myStaged,
      ...summary
    };
  }
  return { available: summary.freeStock, source: 'free', quota: null, ...summary };
};

// ไม่ได้เลือกโครงการ → บอกได้แค่ของกลาง ต้องเตือนให้เลือกโครงการก่อนถึงจะรู้ยอดจริง
export const availableWithoutProject = (input) => {
  const summary = summarizeItemStock(input);
  return { available: summary.freeStock, source: 'free', quota: null, ...summary };
};

// ---- ตัวอ่านข้อมูลจริงจากฐานข้อมูล ----

// พื้นที่จัดเตรียมมีได้ 2 แบบ: พื้นที่วางพื้นที่ผูกโครงการ (แบบใหม่) และห้องที่ตั้งธง is_staging (แบบเก่า)
// อ่านทั้งสองแบบไว้ เพื่อไม่ให้มีจังหวะไหนที่โควตาโครงการคำนวณหายไประหว่างย้ายข้อมูล
const STAGED_ROWS_SQL = `
  SELECT r.project_id AS projectId, l.id, l.quantity, l.rack_id AS rackId, NULL AS roomId, r.name AS placeName
  FROM item_locations l
  JOIN storage_racks r ON r.id = l.rack_id AND r.deleted_at IS NULL AND r.project_id IS NOT NULL
  WHERE l.item_id = @itemId
  UNION ALL
  SELECT rm.project_id AS projectId, l.id, l.quantity, NULL AS rackId, l.room_id AS roomId, rm.name AS placeName
  FROM item_locations l
  JOIN rooms rm ON rm.id = l.room_id AND rm.deleted_at IS NULL AND rm.is_staging = 1
  WHERE l.item_id = @itemId
`;

// จำนวนที่จัดเตรียมไว้ของสินค้านี้ แยกตามโครงการ { ชื่อโครงการ: จำนวน }
export const getStagedByProject = (db, itemId) => {
  const rows = db.prepare(`
    SELECT p.name AS project, SUM(s.quantity) AS qty
    FROM (${STAGED_ROWS_SQL}) s
    JOIN projects p ON p.id = s.projectId
    GROUP BY p.name
  `).all({ itemId: String(itemId) });
  return Object.fromEntries(rows.map((row) => [row.project, Number(row.qty || 0)]));
};

// จำนวนที่อนุมัติแล้วรอรับของ แยกตามโครงการ
export const getApprovedByProject = (db, itemId, { excludeTxId = null } = {}) => {
  const rows = db.prepare(`
    SELECT COALESCE(t.project, '') AS project, SUM(ti.approvedQty) AS qty
    FROM wms_transaction_items ti
    JOIN wms_transactions t ON t.id = ti.tx_id
    WHERE ti.productId = ?
      AND t.type = 'OUTBOUND' AND t.status IN ('Approved', 'Partial')
      AND t.pickedUpAt IS NULL AND ti.approvedQty > 0
      AND (@excludeTxId IS NULL OR t.id != @excludeTxId)
    GROUP BY COALESCE(t.project, '')
  `).all(String(itemId), { excludeTxId });
  return Object.fromEntries(rows.map((row) => [row.project, Number(row.qty || 0)]));
};

export const readItemStockContext = (db, itemId, options) => ({
  stock: Number(db.prepare('SELECT stock_balance FROM warehouse_balance WHERE item_id = ?').get(String(itemId))?.stock_balance || 0),
  staged: getStagedByProject(db, itemId),
  approved: getApprovedByProject(db, itemId, options)
});

// โซนจัดเตรียมของโครงการนี้ที่มีสินค้าตัวนี้อยู่ (ใช้ตอนตัดสต็อกเวลารับของ)
export const getStagingLocations = (db, itemId, project) => db.prepare(`
  SELECT s.id, s.roomId, s.rackId, s.quantity, s.placeName
  FROM (${STAGED_ROWS_SQL}) s
  JOIN projects p ON p.id = s.projectId
  WHERE p.name = @project AND s.quantity > 0
  ORDER BY s.quantity DESC
`).all({ itemId: String(itemId), project: String(project || '') });

// แถวตำแหน่งที่ "ถูกกันไว้ให้โครงการ" ทั้งหมดของสินค้าตัวหนึ่ง — ใช้กันไม่ให้ไปหยิบของโครงการอื่น
export const getReservedLocationIds = (db, itemId) => new Set(
  db.prepare(`SELECT s.id FROM (${STAGED_ROWS_SQL}) s`).all({ itemId: String(itemId) }).map((row) => row.id)
);

import db, { logAudit } from '../db.js';
import { broadcast } from '../events.js';
import { sendPushToUser } from '../push.js';
import { resolveProjectName } from './projectController.js';

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

const toPositiveInteger = (value) => {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
};

const toNonNegativeInteger = (value) => {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : null;
};

const normalizeSku = (value) => String(value || '').trim().toUpperCase();

const getCurrentStock = (itemId) => {
  // item_id เป็น TEXT เสมอ แต่บาง record เก็บ productId มาเป็นตัวเลข (ตารางสคีมาเก่า)
  // ต้อง cast เป็น String ก่อน ไม่งั้น view จะเทียบคนละ storage class (เลข != ข้อความ) แล้วหาสต็อกไม่เจอ
  const row = db.prepare('SELECT stock_balance FROM warehouse_balance WHERE item_id = ?').get(String(itemId));
  return Number(row?.stock_balance || 0);
};

// ดึงใบเบิกพร้อมรายการสินค้า — กรองจากฝั่งฐานข้อมูลเพื่อไม่ต้องแบกประวัติทั้งหมดทุกครั้ง
// includeActive = รวมใบที่ยังค้างอยู่ (รออนุมัติ/รอส่งมอบ) โดยไม่สนช่วงเวลา
// since/until   = ช่วงเวลาของ COALESCE(resolvedDate, requestDate) แบบ ISO string
const getFullTransactions = ({ includeActive = false, since = null, until = null } = {}) => {
  const params = {};
  const timeConds = [];
  if (since) { timeConds.push('COALESCE(t.resolvedDate, t.requestDate) >= @since'); params.since = since; }
  if (until) { timeConds.push('COALESCE(t.resolvedDate, t.requestDate) < @until'); params.until = until; }
  const timeSql = timeConds.join(' AND ');
  const activeSql = `(t.status = 'Pending' OR (t.type = 'OUTBOUND' AND t.status IN ('Approved', 'Partial') AND t.pickedUpAt IS NULL))`;

  let whereSql = '';
  if (includeActive && timeSql) whereSql = `WHERE (${activeSql} OR (${timeSql}))`;
  else if (includeActive) whereSql = `WHERE ${activeSql}`;
  else if (timeSql) whereSql = `WHERE ${timeSql}`;

  const txs = db.prepare(`SELECT t.* FROM wms_transactions t ${whereSql} ORDER BY t.requestDate DESC`).all(params);
  if (txs.length === 0) return [];

  // ถ้ารายการไหนบันทึกไว้โดยไม่มีรูป ให้ fallback ไปใช้รูปปัจจุบันของสินค้าใน product_settings
  // พร้อมดึงหมวดหมู่ปัจจุบันของสินค้ามาด้วย สำหรับแสดงในหน้าเว็บและ report
  const items = db.prepare(`
    SELECT
      ti.*,
      COALESCE(NULLIF(ti.imageUrl, ''), ps.image_url, '') AS imageUrl,
      -- ใช้หมวดหมู่ที่ snapshot ไว้ในใบก่อน (คงที่แม้ลบสินค้าถาวร) แล้วค่อย fallback ไปหมวดหมู่สดสำหรับใบเก่า
      COALESCE(NULLIF(ti.groupId, ''), it.group_id, '00') AS groupId,
      COALESCE(NULLIF(ti.groupName, ''), g.group_name, 'Default') AS groupName
    FROM wms_transaction_items ti
    JOIN wms_transactions t ON t.id = ti.tx_id
    LEFT JOIN product_settings ps ON ps.item_id = ti.productId
    LEFT JOIN items it ON it.item_id = ti.productId
    LEFT JOIN item_groups g ON g.group_id = it.group_id
    ${whereSql}
    ORDER BY ti.id ASC
  `).all(params);

  // จับกลุ่มรายการเข้าใบด้วย Map — O(จำนวนใบ + จำนวนรายการ) ไม่ใช่คูณกัน
  const itemsByTx = new Map();
  for (const i of items) {
    if (!itemsByTx.has(i.tx_id)) itemsByTx.set(i.tx_id, []);
    itemsByTx.get(i.tx_id).push({
      productId: i.productId,
      sku: i.sku,
      productName: i.productName,
      imageUrl: i.imageUrl,
      groupId: i.groupId,
      groupName: i.groupName,
      requestedQty: i.requestedQty,
      approvedQty: i.approvedQty,
      status: i.status
    });
  }

  return txs.map(tx => ({ ...tx, items: itemsByTx.get(tx.id) || [] }));
};

const handleError = (res, err) => {
  console.error(err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({ success: false, message: statusCode === 500 ? 'Database error' : err.message });
};

// ทุก role เห็นรายการทั้งหมด (ประวัติ/ใบค้างเป็นข้อมูลภาพรวมของคลัง ไม่ใช่ข้อมูลส่วนตัว)
// สิทธิ์การ "กระทำ" ยังแยกตาม role เหมือนเดิม (อนุมัติ/ยกเลิก/รับเข้า)
export const getTransactions = (req, res) => {
  try {
    // client ระบุขอบเขตข้อมูลได้ เพื่อไม่ต้องส่งประวัติทั้งหมดทุกรอบ poll:
    // ?view=active|dashboard → รวมใบค้าง (รออนุมัติ/รอส่งมอบ), ?since/?until → ช่วงเวลา ISO
    const transactions = getFullTransactions({
      includeActive: ['active', 'dashboard'].includes(String(req.query.view || '')),
      since: req.query.since ? String(req.query.since) : null,
      until: req.query.until ? String(req.query.until) : null
    });
    res.json({ success: true, transactions });
  } catch (err) {
    handleError(res, err);
  }
};

export const getHistory = (req, res) => {
  try {
    const transactions = getFullTransactions();
    const history = transactions.filter(t => t.status !== 'Pending');
    res.json({ success: true, history });
  } catch (err) {
    handleError(res, err);
  }
};

export const createOutboundRequest = (req, res) => {
  try {
    const { items, project } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('ไม่มีรายการสินค้า');
    }
    if (!project || String(project).trim() === '') {
      throw new ValidationError('กรุณาระบุโปรเจกต์');
    }
    // แปลงชื่อโปรเจกต์ที่พิมพ์เป็นชื่อ canonical (งานTAI/tai → TAI) หรือเพิ่มใหม่ถ้ายังไม่มี
    const canonicalProject = resolveProjectName(project);

    const normalizedItems = items.map((item) => {
      const productId = normalizeSku(item.productId || item.sku);
      const reqQty = toPositiveInteger(item.quantity);
      if (!productId || !reqQty) throw new ValidationError('จำนวนเบิกไม่ถูกต้อง');

      // snapshot หมวดหมู่ลงในใบด้วย (groupId/groupName) เพื่อให้ประวัติไม่เปลี่ยนแม้ลบสินค้าถาวรภายหลัง
      const product = db.prepare(`
        SELECT i.item_id, i.item_name, COALESCE(ps.image_url, '') AS imageUrl,
               COALESCE(i.group_id, '00') AS groupId,
               COALESCE(g.group_name, 'Default') AS groupName
        FROM items i
        LEFT JOIN product_settings ps ON ps.item_id = i.item_id
        LEFT JOIN item_groups g ON g.group_id = i.group_id
        WHERE i.item_id = ? AND COALESCE(ps.is_active, 1) = 1
      `).get(productId);
      if (!product) throw new ValidationError(`ไม่พบสินค้า ${productId}`);

      const stock = getCurrentStock(productId);
      if (reqQty > stock) throw new ValidationError(`สินค้า ${productId} มีคงเหลือไม่พอ`);

      return {
        productId: product.item_id, // ใช้ item_id ตัวจริงจาก DB (TEXT) เสมอ ไม่เชื่อค่าจาก client — กัน 0 นำหน้าหาย
        sku: product.item_id,
        productName: product.item_name,
        imageUrl: product.imageUrl || item.imageUrl || '',
        groupId: product.groupId,
        groupName: product.groupName,
        quantity: reqQty
      };
    });

    const requestDate = new Date().toISOString();
    const transactionId = `REQ-${Date.now()}`;

    db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO wms_transactions (transactionId, type, requesterUsername, project, status, requestDate)
        VALUES (?, 'OUTBOUND', ?, ?, 'Pending', ?)
      `).run(transactionId, req.user.username, canonicalProject, requestDate);

      const stmtItem = db.prepare(`
        INSERT INTO wms_transaction_items (tx_id, productId, sku, productName, imageUrl, groupId, groupName, requestedQty, approvedQty, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'Pending')
      `);

      for (const item of normalizedItems) {
        stmtItem.run(info.lastInsertRowid, item.productId, item.sku, item.productName, item.imageUrl, item.groupId, item.groupName, item.quantity);
      }
      logAudit(req.user.username, 'transaction.request_outbound', 'transaction', transactionId, {
        project: canonicalProject,
        itemCount: normalizedItems.length
      });
    })();

    broadcast('transactions');
    res.status(201).json({ success: true, message: 'ส่งคำขอเบิกแบบชุดสำเร็จ', transactionId });
  } catch (err) {
    handleError(res, err);
  }
};

export const createInboundTransaction = (req, res) => {
  try {
    const { name, quantity, note, minStock, imageUrl, project } = req.body;
    const inboundQty = toPositiveInteger(quantity);
    const normalizedSku = normalizeSku(req.body.sku);

    if (!normalizedSku || !inboundQty) {
      throw new ValidationError('ข้อมูลไม่ครบถ้วน');
    }

    const requestDate = new Date().toISOString();
    const transactionId = `INB-${Date.now()}`;

    db.transaction(() => {
      let item = db.prepare('SELECT item_id, item_name FROM items WHERE item_id = ?').get(normalizedSku);
      if (!item) {
        db.prepare(`
          INSERT INTO items (item_id, item_name, group_id, item_seq, created_at, updated_at)
          VALUES (?, ?, '00', '000', ?, ?)
        `).run(normalizedSku, name || normalizedSku, requestDate, requestDate);
        item = { item_id: normalizedSku, item_name: name || normalizedSku };
      } else if (name && name !== item.item_name) {
        db.prepare('UPDATE items SET item_name = ?, updated_at = CURRENT_TIMESTAMP WHERE item_id = ?')
          .run(name, normalizedSku);
        item.item_name = name;
      }

      if (minStock != null || imageUrl != null) {
        db.prepare(`
          INSERT INTO product_settings (item_id, min_stock, image_url, is_active, updated_at)
          VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
          ON CONFLICT(item_id) DO UPDATE SET
            min_stock = COALESCE(excluded.min_stock, product_settings.min_stock),
            image_url = COALESCE(excluded.image_url, product_settings.image_url),
            is_active = 1,
            updated_at = CURRENT_TIMESTAMP
        `).run(
          normalizedSku,
          minStock == null ? null : Math.max(Number.parseInt(minStock, 10) || 0, 0),
          imageUrl == null ? null : String(imageUrl)
        );
      } else {
        db.prepare(`
          INSERT OR IGNORE INTO product_settings (item_id, min_stock, image_url, is_active)
          VALUES (?, 10, '', 1)
        `).run(normalizedSku);
      }

      db.prepare(`
        INSERT INTO stock_in (item_id, quantity, input_date, project, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(normalizedSku, inboundQty, requestDate, project || null, note || null, req.user.username);

      const txInfo = db.prepare(`
        INSERT INTO wms_transactions (transactionId, type, requesterUsername, project, status, requestDate, resolvedDate, adminUsername)
        VALUES (?, 'INBOUND', ?, ?, 'Approved', ?, ?, ?)
      `).run(transactionId, req.user.username, note || project || 'รับอะไหล่เข้า', requestDate, requestDate, req.user.username);

      // ถ้าคำขอไม่ได้แนบรูปมา ใช้รูปที่ตั้งค่าไว้แล้วของสินค้าตัวนี้แทน เพื่อให้ประวัติแสดงรูปได้
      const finalImageUrl = imageUrl
        || db.prepare('SELECT image_url FROM product_settings WHERE item_id = ?').get(normalizedSku)?.image_url
        || '';

      db.prepare(`
        INSERT INTO wms_transaction_items (tx_id, productId, sku, productName, imageUrl, requestedQty, approvedQty, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Approved')
      `).run(txInfo.lastInsertRowid, normalizedSku, normalizedSku, item.item_name, finalImageUrl, inboundQty, inboundQty);

      logAudit(req.user.username, 'transaction.inbound', 'transaction', transactionId, { sku: normalizedSku, quantity: inboundQty });
    })();

    broadcast('transactions');
    broadcast('products');
    res.status(201).json({ success: true, message: 'บันทึกรับเข้าสำเร็จ', transactionId });
  } catch (err) {
    handleError(res, err);
  }
};

// ปรับยอดสต็อกตามการนับจริง — ตั้งยอดคงเหลือให้เท่ากับที่นับได้ (แก้สินค้ายอดติดลบ/ไม่ตรงของจริง)
// บันทึกส่วนต่างเป็น stock_in/stock_out ที่ทำเครื่องหมาย clean_status='adjustment' ไว้ (dashboard ไม่นับเป็นรับเข้า/เบิกออก)
export const adjustStock = (req, res) => {
  try {
    const normalizedSku = normalizeSku(req.body.sku);
    const countedQty = toNonNegativeInteger(req.body.countedQty);
    const reason = String(req.body.note || '').trim() || 'ปรับยอดตามการนับจริง';

    if (!normalizedSku) throw new ValidationError('ไม่ได้ระบุสินค้า');
    if (countedQty == null) throw new ValidationError('จำนวนที่นับได้ต้องเป็นจำนวนเต็มไม่ติดลบ');

    const product = db.prepare(`
      SELECT i.item_id, i.item_name, COALESCE(i.group_id, '00') AS groupId,
             COALESCE(g.group_name, 'Default') AS groupName,
             COALESCE(ps.image_url, '') AS imageUrl
      FROM items i
      LEFT JOIN item_groups g ON g.group_id = i.group_id
      LEFT JOIN product_settings ps ON ps.item_id = i.item_id
      WHERE i.item_id = ?
    `).get(normalizedSku);
    if (!product) throw new ValidationError(`ไม่พบสินค้า ${normalizedSku}`);

    const current = getCurrentStock(normalizedSku);
    const delta = countedQty - current;
    if (delta === 0) {
      return res.status(200).json({ success: true, adjusted: false, message: `ยอดตรงกับระบบอยู่แล้ว (${current})` });
    }

    const now = new Date().toISOString();
    const transactionId = `ADJ-${Date.now()}`;
    const absQty = Math.abs(delta);

    db.transaction(() => {
      if (delta > 0) {
        db.prepare(`INSERT INTO stock_in (item_id, quantity, input_date, note, clean_status, created_by) VALUES (?, ?, ?, ?, 'adjustment', ?)`)
          .run(normalizedSku, absQty, now, `ปรับยอด: ${reason}`, req.user.username);
      } else {
        db.prepare(`INSERT INTO stock_out (item_id, quantity, output_date, note, clean_status, created_by) VALUES (?, ?, ?, ?, 'adjustment', ?)`)
          .run(normalizedSku, absQty, now, `ปรับยอด: ${reason}`, req.user.username);
      }

      // บันทึกใบ ADJUSTMENT ไว้ให้เห็นในประวัติ/กิจกรรมล่าสุด (สถานะ Approved ทันที)
      const txInfo = db.prepare(`
        INSERT INTO wms_transactions (transactionId, type, requesterUsername, project, status, requestDate, resolvedDate, adminUsername, adminMessage)
        VALUES (?, 'ADJUSTMENT', ?, 'ปรับยอดสต็อก', 'Approved', ?, ?, ?, ?)
      `).run(transactionId, req.user.username, now, now, req.user.username, `${current} → ${countedQty} (${reason})`);

      db.prepare(`
        INSERT INTO wms_transaction_items (tx_id, productId, sku, productName, imageUrl, groupId, groupName, requestedQty, approvedQty, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved')
      `).run(txInfo.lastInsertRowid, product.item_id, product.item_id, product.item_name, product.imageUrl, product.groupId, product.groupName, absQty, absQty);

      logAudit(req.user.username, 'transaction.adjust', 'transaction', transactionId, { sku: normalizedSku, from: current, to: countedQty, delta });
    })();

    broadcast('products');
    broadcast('transactions');
    res.status(201).json({ success: true, adjusted: true, delta, message: `ปรับยอด ${normalizedSku} จาก ${current} เป็น ${countedQty}` });
  } catch (err) {
    handleError(res, err);
  }
};

export const resolveTransaction = (req, res) => {
  try {
    const { id } = req.params;
    const { action, updatedItems, adminMessage } = req.body;
    const resolvedDate = new Date().toISOString();
    const trimmedMessage = String(adminMessage || '').trim();

    if (!['APPROVE', 'REJECT'].includes(action)) {
      throw new ValidationError('action ไม่ถูกต้อง');
    }

    if (action === 'REJECT' && !trimmedMessage) {
      throw new ValidationError('กรุณาระบุเหตุผลการปฏิเสธใบเบิก');
    }

    const tx = db.prepare('SELECT * FROM wms_transactions WHERE id = ?').get(id);
    if (!tx) return res.status(404).json({ success: false, message: 'ไม่พบรายการ' });
    if (tx.status !== 'Pending') throw new ValidationError('จัดการไปแล้ว');

    const originalItems = db.prepare('SELECT * FROM wms_transaction_items WHERE tx_id = ? ORDER BY id ASC').all(id);
    if (originalItems.length === 0) throw new ValidationError('ไม่พบสินค้าในใบเบิก');

    const requestedUpdates = new Map(
      (Array.isArray(updatedItems) ? updatedItems : []).map(item => [normalizeSku(item.productId || item.sku), item])
    );

    let outcomeStatus = 'Rejected'; // เก็บผลลัพธ์ไว้ส่ง push หลัง transaction เสร็จ
    db.transaction(() => {
      if (action === 'REJECT') {
        db.prepare(`
          UPDATE wms_transactions
          SET status = 'Rejected', resolvedDate = ?, adminUsername = ?, adminMessage = ?
          WHERE id = ?
        `).run(resolvedDate, req.user.username, trimmedMessage, id);
        db.prepare(`UPDATE wms_transaction_items SET status = 'Rejected', approvedQty = 0 WHERE tx_id = ?`).run(id);
        logAudit(req.user.username, 'transaction.reject', 'transaction', tx.transactionId, { adminMessage: trimmedMessage });
        return;
      }

      let allApprovedFull = true;
      let anyApproved = false;
      const updateItemStmt = db.prepare(`
        UPDATE wms_transaction_items
        SET approvedQty = ?, status = ?
        WHERE id = ?
      `);
      const insertStockOut = db.prepare(`
        INSERT INTO stock_out (item_id, quantity, output_date, project, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const originalItem of originalItems) {
        const requestItem = requestedUpdates.get(normalizeSku(originalItem.productId));
        const requestedApprovedQty = requestItem ? requestItem.approvedQty : originalItem.requestedQty;
        const appQty = toNonNegativeInteger(requestedApprovedQty);

        if (appQty == null) throw new ValidationError(`จำนวนอนุมัติของ ${originalItem.sku} ไม่ถูกต้อง`);
        if (appQty > originalItem.requestedQty) throw new ValidationError(`อนุมัติ ${originalItem.sku} เกินจำนวนที่ขอ`);

        const currentStock = getCurrentStock(originalItem.productId);
        if (appQty > currentStock) throw new ValidationError(`สินค้า ${originalItem.sku} มีคงเหลือไม่พอ`);

        let itemStatus = 'Rejected';
        if (appQty > 0) {
          anyApproved = true;
          itemStatus = appQty === originalItem.requestedQty ? 'Approved' : 'Partial';
          insertStockOut.run(String(originalItem.productId), appQty, resolvedDate, tx.project, trimmedMessage || null, req.user.username);
        }

        if (appQty < originalItem.requestedQty) allApprovedFull = false;
        updateItemStmt.run(appQty, itemStatus, originalItem.id);
      }

      // อนุมัติไม่ครบตามที่ขอ (บางส่วน/ตัดเหลือศูนย์) ต้องบอกเหตุผลให้ผู้ขอเบิกรับทราบเสมอ
      if (!allApprovedFull && !trimmedMessage) {
        throw new ValidationError('กรุณาระบุเหตุผลเมื่ออนุมัติไม่ครบตามจำนวนที่ขอ');
      }

      const finalStatus = anyApproved ? (allApprovedFull ? 'Approved' : 'Partial') : 'Rejected';
      outcomeStatus = finalStatus;
      db.prepare(`
        UPDATE wms_transactions
        SET status = ?, resolvedDate = ?, adminUsername = ?, adminMessage = ?
        WHERE id = ?
      `).run(finalStatus, resolvedDate, req.user.username, trimmedMessage, id);
      logAudit(req.user.username, 'transaction.resolve', 'transaction', tx.transactionId, { finalStatus });
    })();

    broadcast('transactions');
    broadcast('products');

    // ส่ง push แจ้งผลให้ผู้ขอเบิก (เด้งแม้ปิดแอป)
    const statusText = outcomeStatus === 'Approved' ? '✅ อนุมัติแล้ว'
      : outcomeStatus === 'Partial' ? '⚠️ อนุมัติบางส่วน' : '❌ ถูกปฏิเสธ';
    const pickupHint = ['Approved', 'Partial'].includes(outcomeStatus) ? ' — มารับสินค้าได้เลย' : '';
    sendPushToUser(tx.requesterUsername, {
      title: `ผลใบเบิก ${tx.transactionId || tx.id}`,
      body: `${statusText}${pickupHint}${trimmedMessage ? `\nหมายเหตุ: ${trimmedMessage}` : ''}`,
      url: '/homepage'
    }).catch(() => {});

    res.json({ success: true, message: 'พิจารณาใบเบิกเสร็จสิ้น' });
  } catch (err) {
    handleError(res, err);
  }
};

// Admin/Manager กดยืนยันว่าส่งมอบสินค้าให้ผู้ขอเบิกแล้ว ใบเบิกจึงเปลี่ยนจาก "รอส่งมอบ" เป็น Approved/Partial เต็มตัว
export const markPickedUp = (req, res) => {
  try {
    const { id } = req.params;
    const tx = db.prepare('SELECT * FROM wms_transactions WHERE id = ?').get(id);

    if (!tx) return res.status(404).json({ success: false, message: 'ไม่พบรายการ' });
    if (tx.type !== 'OUTBOUND' || !['Approved', 'Partial'].includes(tx.status)) {
      throw new ValidationError('รายการนี้ไม่อยู่ในสถานะรอส่งมอบสินค้า');
    }
    if (tx.pickedUpAt) throw new ValidationError('รายการนี้บันทึกการส่งมอบไปแล้ว');

    db.prepare('UPDATE wms_transactions SET pickedUpAt = ? WHERE id = ?').run(new Date().toISOString(), id);
    logAudit(req.user.username, 'transaction.picked_up', 'transaction', tx.transactionId);

    broadcast('transactions');
    res.json({ success: true, message: 'บันทึกการส่งมอบสินค้าเรียบร้อย' });
  } catch (err) {
    handleError(res, err);
  }
};

export const cancelTransaction = (req, res) => {
  try {
    const { id } = req.params;
    const tx = db.prepare('SELECT * FROM wms_transactions WHERE id = ?').get(id);

    if (!tx) return res.status(404).json({ success: false, message: 'ไม่พบรายการ' });
    if (tx.status !== 'Pending') throw new ValidationError('ยกเลิกได้เฉพาะรายการที่รออนุมัติ');

    const isOwner = tx.requesterUsername === req.user.username;
    const isManagerOrAdmin = ['Admin', 'Manager'].includes(req.user.role);
    if (!isOwner && !isManagerOrAdmin) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกรายการนี้' });

    db.transaction(() => {
      db.prepare(`
        UPDATE wms_transactions
        SET status = 'Cancelled', resolvedDate = ?, adminUsername = ?, adminMessage = ?
        WHERE id = ?
      `).run(new Date().toISOString(), req.user.username, req.body?.message || 'Cancelled', id);
      db.prepare(`UPDATE wms_transaction_items SET status = 'Rejected', approvedQty = 0 WHERE tx_id = ?`).run(id);
      logAudit(req.user.username, 'transaction.cancel', 'transaction', tx.transactionId);
    })();

    broadcast('transactions');
    res.json({ success: true, message: 'ยกเลิกคำขอเรียบร้อย' });
  } catch (err) {
    handleError(res, err);
  }
};

import db, { logAudit } from '../db.js';

// รหัสหมวดถัดไป = เลขหมวดสูงสุด +1 (2 หลัก) เช่นมีถึง 23 → 24
const nextGroupId = () => {
  const row = db.prepare("SELECT MAX(CAST(group_id AS INTEGER)) AS mx FROM item_groups WHERE group_id != '00'").get();
  return String((row?.mx || 0) + 1).padStart(2, '0');
};

// เพิ่มหมวดหมู่ (Admin/Manager) — รหัส 2 หลักรันอัตโนมัติ
export const addCategory = (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อหมวดหมู่' });
    if (db.prepare('SELECT group_id FROM item_groups WHERE group_name = ?').get(name)) {
      return res.status(409).json({ success: false, message: 'มีหมวดหมู่ชื่อนี้อยู่แล้ว' });
    }
    const id = nextGroupId();
    db.prepare('INSERT INTO item_groups (group_id, group_name) VALUES (?, ?)').run(id, name);
    logAudit(req.user?.username, 'category.add', 'category', id, { name });
    res.status(201).json({ success: true, group: { id, name, itemCount: 0 } });
  } catch (err) {
    console.error('addCategory error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// ลบหมวดหมู่ (Admin/Manager) — บล็อกถ้ายังมีสินค้าอยู่ (ต้องย้าย/ยุบก่อน)
export const deleteCategory = (req, res) => {
  try {
    const id = String(req.params.id);
    if (id === '00') return res.status(400).json({ success: false, message: 'ลบหมวด Default ไม่ได้' });
    const g = db.prepare('SELECT group_name FROM item_groups WHERE group_id = ?').get(id);
    if (!g) return res.status(404).json({ success: false, message: 'ไม่พบหมวดหมู่' });
    const cnt = db.prepare('SELECT COUNT(*) c FROM items WHERE group_id = ?').get(id).c;
    if (cnt > 0) return res.status(400).json({ success: false, message: `ลบไม่ได้ — มีสินค้า ${cnt} รายการในหมวดนี้ (ต้องยุบหรือย้ายออกก่อน)` });
    db.prepare('DELETE FROM item_groups WHERE group_id = ?').run(id);
    logAudit(req.user?.username, 'category.delete', 'category', id, { name: g.group_name });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteCategory error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// จัดเรียงเลขหมวดใหม่ให้ต่อเนื่อง (ปิดช่องว่างจากการยุบ/ลบ) — เรียงตามรหัสเดิม → 01,02,03,...
// สินค้าในหมวดที่เปลี่ยนรหัสจะถูกรัน SKU ใหม่ (prefix เปลี่ยน, ลำดับเดิม) พร้อมอัปเดตทุก FK
export const resequenceCategories = (req, res) => {
  try {
    const cats = db.prepare("SELECT group_id FROM item_groups WHERE group_id != '00' ORDER BY CAST(group_id AS INTEGER)").all();
    const changed = cats.filter((c, i) => c.group_id !== String(i + 1).padStart(2, '0')).length;
    if (changed === 0) return res.json({ success: true, message: 'เลขหมวดเรียงลำดับดีอยู่แล้ว', changed: 0 });
    if (cats.some(c => Number(c.group_id) > 49)) {
      return res.status(400).json({ success: false, message: 'มีรหัสหมวดสูงเกิน 49 — จัดเรียงอัตโนมัติไม่ได้' });
    }

    // เปลี่ยนรหัสหมวด oldId → newId พร้อมอัปเดต SKU (prefix) ของสินค้าทุกตัวและตารางที่อ้างถึง
    const rename = (oldId, newId) => {
      const items = db.prepare('SELECT item_id, item_seq FROM items WHERE group_id = ?').all(oldId);
      db.prepare('UPDATE item_groups SET group_id = ? WHERE group_id = ?').run(newId, oldId);
      db.prepare('UPDATE items SET group_id = ? WHERE group_id = ?').run(newId, oldId);
      for (const it of items) {
        const oldSku = it.item_id;
        const newSku = `${newId}${it.item_seq}`;   // ลำดับเดิม เปลี่ยนแค่ 2 หลักหน้า
        db.prepare('UPDATE items SET item_id = ? WHERE item_id = ?').run(newSku, oldSku);
        db.prepare('UPDATE stock_in SET item_id = ? WHERE item_id = ?').run(newSku, oldSku);
        db.prepare('UPDATE stock_out SET item_id = ? WHERE item_id = ?').run(newSku, oldSku);
        db.prepare('UPDATE product_settings SET item_id = ? WHERE item_id = ?').run(newSku, oldSku);
        db.prepare('UPDATE wms_transaction_items SET productId = ?, sku = ?, groupId = ? WHERE productId = ? OR sku = ?')
          .run(newSku, newSku, newId, oldSku, oldSku);
      }
    };

    db.pragma('foreign_keys = OFF');
    const run = db.transaction(() => {
      // 2 เฟส: ย้ายไปรหัสชั่วคราว (old+50) ก่อน กันชนกันระหว่างสลับ แล้วค่อยลงรหัสจริง 01..N
      for (const c of cats) rename(c.group_id, String(Number(c.group_id) + 50).padStart(2, '0'));
      cats.forEach((c, i) => rename(String(Number(c.group_id) + 50).padStart(2, '0'), String(i + 1).padStart(2, '0')));
      logAudit(req.user?.username, 'category.resequence', 'category', null, { changed });
    });
    run();
    db.pragma('foreign_keys = ON');

    res.json({ success: true, message: `จัดเรียงเลขหมวดใหม่แล้ว (${changed} หมวดเปลี่ยนรหัส)`, changed });
  } catch (err) {
    console.error('resequenceCategories error:', err);
    try { db.pragma('foreign_keys = ON'); } catch { /* ignore */ }
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// ยุบหมวด from เข้า to — ย้ายสินค้าทุกตัวไป to พร้อม "รัน SKU ใหม่" ตามรหัสหมวดปลายทาง (ตามที่ผู้ใช้เลือก)
// อัปเดตทุกจุดที่อ้าง item_id: stock_in/out, product_settings, wms_transaction_items แล้วลบหมวด from
export const mergeCategories = (req, res) => {
  try {
    const fromId = String(req.body.fromId || '');
    const toId = String(req.body.toId || '');
    if (!fromId || !toId || fromId === toId || fromId === '00' || toId === '00') {
      return res.status(400).json({ success: false, message: 'เลือกหมวดต้นทาง/ปลายทางให้ถูกต้อง' });
    }
    const from = db.prepare('SELECT group_name FROM item_groups WHERE group_id = ?').get(fromId);
    const to = db.prepare('SELECT group_name FROM item_groups WHERE group_id = ?').get(toId);
    if (!from || !to) return res.status(404).json({ success: false, message: 'ไม่พบหมวดหมู่' });

    const items = db.prepare('SELECT item_id FROM items WHERE group_id = ? ORDER BY CAST(item_seq AS INTEGER)').all(fromId);
    let seq = db.prepare('SELECT MAX(CAST(item_seq AS INTEGER)) AS mx FROM items WHERE group_id = ?').get(toId).mx || 0;

    // ปิด FK ชั่วคราวเพราะกำลังเปลี่ยน item_id (PK) ที่มีตารางลูกอ้างถึง — ทำใน transaction เดียว
    db.pragma('foreign_keys = OFF');
    const run = db.transaction(() => {
      for (const it of items) {
        seq += 1;
        const seq3 = String(seq).padStart(3, '0');
        const newSku = `${toId}${seq3}`;
        const oldSku = it.item_id;
        db.prepare('UPDATE items SET item_id = ?, group_id = ?, item_seq = ? WHERE item_id = ?').run(newSku, toId, seq3, oldSku);
        db.prepare('UPDATE stock_in SET item_id = ? WHERE item_id = ?').run(newSku, oldSku);
        db.prepare('UPDATE stock_out SET item_id = ? WHERE item_id = ?').run(newSku, oldSku);
        db.prepare('UPDATE product_settings SET item_id = ? WHERE item_id = ?').run(newSku, oldSku);
        db.prepare('UPDATE wms_transaction_items SET productId = ?, sku = ?, groupId = ?, groupName = ? WHERE productId = ? OR sku = ?')
          .run(newSku, newSku, toId, to.group_name, oldSku, oldSku);
      }
      db.prepare('DELETE FROM item_groups WHERE group_id = ?').run(fromId);
      logAudit(req.user?.username, 'category.merge', 'category', fromId, { from: from.group_name, to: to.group_name, moved: items.length });
    });
    run();
    db.pragma('foreign_keys = ON');

    res.json({ success: true, message: `ยุบ "${from.group_name}" เข้ากับ "${to.group_name}" แล้ว (ย้าย ${items.length} รายการ + รัน SKU ใหม่)` });
  } catch (err) {
    console.error('mergeCategories error:', err);
    try { db.pragma('foreign_keys = ON'); } catch { /* ignore */ }
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

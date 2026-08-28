import db, { logAudit } from '../db.js';

export const listPlans = (req, res) => {
  try {
    const plans = db.prepare(`SELECT id, name, layout_status AS status, layout_revision AS revision,
      published_at AS publishedAt, updated_at AS updatedAt FROM floor_plans ORDER BY id ASC`).all();
    res.json({ success: true, plans });
  } catch (err) {
    console.error('listPlans error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

export const addPlan = (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อคลัง' });
    const info = db.prepare('INSERT INTO floor_plans (name) VALUES (?)').run(name);
    logAudit(req.user?.username, 'plan.add', 'plan', String(info.lastInsertRowid), { name });
    res.status(201).json({ success: true, plan: { id: info.lastInsertRowid, name, status: 'draft', revision: 1 } });
  } catch (err) {
    console.error('addPlan error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

export const renamePlan = (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    if (!Number.isInteger(id) || id <= 0 || !name) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อคลัง' });
    }
    const plan = db.prepare('SELECT name FROM floor_plans WHERE id = ?').get(id);
    if (!plan) return res.status(404).json({ success: false, message: 'ไม่พบคลัง' });
    db.prepare(`UPDATE floor_plans SET name = ?, layout_status = 'draft',
      layout_revision = COALESCE(layout_revision, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(name, id);
    logAudit(req.user?.username, 'plan.rename', 'plan', String(id), { planId: id, before: plan.name, name });
    res.json({ success: true, plan: { id, name } });
  } catch (err) {
    console.error('renamePlan error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

export const deletePlan = (req, res) => {
  try {
    const id = Number(req.params.id);
    const plan = db.prepare('SELECT name FROM floor_plans WHERE id = ?').get(id);
    if (!plan) return res.status(404).json({ success: false, message: 'ไม่พบคลัง' });
    if (db.prepare('SELECT COUNT(*) c FROM floor_plans').get().c <= 1) {
      return res.status(400).json({ success: false, message: 'ต้องมีคลังอย่างน้อย 1 แห่ง' });
    }
    const rooms = db.prepare('SELECT COUNT(*) c FROM rooms WHERE plan_id = ?').get(id).c;
    const racks = db.prepare('SELECT COUNT(*) c FROM storage_racks WHERE plan_id = ?').get(id).c;
    if (rooms > 0 || racks > 0) {
      return res.status(400).json({ success: false, message: `ลบไม่ได้ — มีห้อง ${rooms} / ชั้นวาง ${racks} ในคลังนี้ (ต้องย้าย/ลบก่อน)` });
    }
    db.prepare('DELETE FROM markers WHERE plan_id = ?').run(id);
    db.prepare('DELETE FROM floor_plans WHERE id = ?').run(id);
    logAudit(req.user?.username, 'plan.delete', 'plan', String(id), { name: plan.name });
    res.json({ success: true });
  } catch (err) {
    console.error('deletePlan error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

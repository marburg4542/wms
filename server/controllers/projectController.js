import db, { logAudit } from '../db.js';
import { normalizeProject } from '../utils/projects.js';

// รายชื่อโปรเจกต์ทั้งหมด (ใช้ใน dropdown ตะกร้าเบิก / ตัวกรอง / export)
export const listProjects = (req, res) => {
  try {
    const projects = db.prepare('SELECT id, name FROM projects ORDER BY name COLLATE NOCASE ASC').all();
    res.json({ success: true, projects });
  } catch (err) {
    console.error('listProjects error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// เพิ่มโปรเจกต์ (Admin/Manager) — ถ้า normalize แล้วตรงกับที่มีอยู่ ให้คืนตัวเดิม ไม่สร้างซ้ำ
export const addProject = (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อโปรเจกต์' });
    const norm = normalizeProject(name);
    if (!norm) return res.status(400).json({ success: false, message: 'ชื่อโปรเจกต์ไม่ถูกต้อง' });

    const existing = db.prepare('SELECT id, name FROM projects WHERE norm = ?').get(norm);
    if (existing) return res.json({ success: true, project: existing, existed: true });

    const info = db.prepare('INSERT INTO projects (name, norm) VALUES (?, ?)').run(name, norm);
    logAudit(req.user?.username, 'project.add', 'project', String(info.lastInsertRowid), { name });
    res.status(201).json({ success: true, project: { id: info.lastInsertRowid, name } });
  } catch (err) {
    console.error('addProject error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// ลบโปรเจกต์ (Admin/Manager) — ไม่กระทบใบเบิกเดิม (ชื่อโปรเจกต์เก็บเป็นข้อความในใบอยู่แล้ว)
export const deleteProject = (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT name FROM projects WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, message: 'ไม่พบโปรเจกต์' });
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    logAudit(req.user?.username, 'project.delete', 'project', String(id), { name: existing.name });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteProject error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
};

// ใช้ตอนสร้างใบเบิก: หา canonical จากชื่อที่พิมพ์ (ตาม norm) — ถ้ายังไม่มีให้เพิ่มใหม่อัตโนมัติ
export const resolveProjectName = (raw) => {
  const name = String(raw || '').trim();
  if (!name) return name;
  const norm = normalizeProject(name);
  if (!norm) return name;
  const existing = db.prepare('SELECT name FROM projects WHERE norm = ?').get(norm);
  if (existing) return existing.name;
  db.prepare('INSERT OR IGNORE INTO projects (name, norm) VALUES (?, ?)').run(name, norm);
  return name;
};

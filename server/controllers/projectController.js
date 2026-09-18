import db, { logAudit } from '../db.js';
import { broadcast } from '../events.js';
import { isReservedProjectLabel, normalizeProject } from '../utils/projects.js';

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

// เปลี่ยนชื่อโปรเจกต์ (Admin/Manager) — ต้องลากชื่อในประวัติตามไปด้วยทั้งหมด
//
// ทำไมต้องแก้ประวัติ ไม่ใช่แค่เปลี่ยนชื่อในทะเบียน:
// โปรเจกต์ถูกอ้างถึงสองแบบที่ขยับไม่พร้อมกัน — พื้นที่จัดเตรียมผูกด้วยเลข id (ตามชื่อใหม่ทันที)
// แต่ใบเบิกกับประวัติรับเข้า/เบิกออกถือ "สำเนาข้อความชื่อ" ที่แปะไว้ตอนสร้าง (ไม่ตามมา)
// ถ้าปล่อยให้สองฝั่งไม่ตรงกัน ตรรกะโควตาพื้นที่จัดเตรียมซึ่งจับคู่กันด้วยชื่อจะพังสองทางพร้อมกัน:
//   · โปรเจกต์ที่เพิ่งเปลี่ยนชื่อ มองไม่เห็นยอดที่อนุมัติค้างไว้ → อนุมัติเบิกซ้ำได้เกินโควตาโซน
//   · โปรเจกต์อื่นโดนหักของกลางด้วยยอดชื่อเก่าซ้ำอีกรอบ → เบิกไม่ได้ทั้งที่ของมีอยู่
// และตอนผู้ขอมารับของ ระบบจะหาโซนของโปรเจกต์ไม่เจอ (ใบถือชื่อเก่า) จึงตัดสต็อกแต่ไม่ลดของในตำแหน่ง
// กลายเป็นยอดวางรวมมากกว่ายอดคงเหลือ ผิดกติกาข้อแรกของระบบ แถมไม่มีการเตือนใดๆ จนกว่าจะรัน audit
//
// keepHistory = true : เก็บชื่อเดิมไว้ในใบที่ปิดจบแล้ว — ใช้ตอนที่ "ชื่อใหม่คืองานคนละรอบ"
// (เช่นงานเดิมจบไปแล้ว ลูกค้าเจ้าเดิมซื้อต่อ องค์กรตั้งชื่อรอบใหม่) ใบยุคเก่าจึงควรคงชื่อยุคนั้นไว้
// แต่ **ใบที่ยังเดินอยู่ต้องเปลี่ยนตามเสมอ** ไม่ว่าจะเลือกโหมดไหน เพราะสองจุดนี้อ่าน "ชื่อบนใบ" ไปใช้จริง:
//   · ตอนอนุมัติ — เอาชื่อบนใบไปหาโควตาโซน ชื่อไม่ตรงจะกลายเป็นไปกินของกลางแทนที่จะกินโควตาโซน
//   · ตอนมารับของ — เอาชื่อบนใบไปหาว่าหยิบจากโซนไหน หาไม่เจอแล้วของในโซนก็ถูกล็อกไว้ ของจึงไม่หลุดจากผัง
// ส่วนใบที่ปิดจบแล้ว (มารับของแล้ว/ถูกปฏิเสธ/ยกเลิก) ไม่มีตรรกะไหนอ่านอีกเลย ปล่อยไว้ได้ปลอดภัย
// เช่นเดียวกับ stock_in.project / stock_out.project ที่ทั้งระบบเขียนอย่างเดียว ไม่มีใครอ่าน
export const renameProject = (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id, name, norm FROM projects WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, message: 'ไม่พบโปรเจกต์' });

    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อโปรเจกต์' });
    const norm = normalizeProject(name);
    if (!norm) return res.status(400).json({ success: false, message: 'ชื่อโปรเจกต์ไม่ถูกต้อง' });
    const keepHistory = req.body.keepHistory === true || req.body.keepHistory === 'true';

    const oldName = existing.name;
    if (name === oldName) return res.json({ success: true, project: { id, name }, unchanged: true, updated: { transactions: 0, stockOut: 0, stockIn: 0, kept: 0 } });

    // ชื่อเดิมไปชนป้ายระบบไว้ก่อนหน้านี้ — ถ้าเปลี่ยนชื่อ ใบปรับยอด/รับเข้าที่ใช้ป้ายเดียวกันจะโดนลากไปด้วย
    // ทางออกที่ปลอดภัยกว่าคือลบโปรเจกต์ตัวนี้ทิ้ง เพราะการลบไม่แตะประวัติเลย
    if (isReservedProjectLabel(oldName)) {
      return res.status(409).json({
        success: false,
        message: `"${oldName}" เป็นป้ายที่ระบบใช้กำกับใบปรับยอด/ใบรับเข้าอยู่ เปลี่ยนชื่อไม่ได้เพราะจะทำให้ใบพวกนั้นกลายเป็นของโปรเจกต์นี้ — ให้ลบโปรเจกต์นี้ทิ้งแทน (ประวัติไม่กระทบ)`
      });
    }
    if (isReservedProjectLabel(name)) {
      return res.status(409).json({ success: false, message: `"${name}" เป็นป้ายที่ระบบใช้กำกับใบปรับยอด/ใบรับเข้าอยู่แล้ว กรุณาใช้ชื่ออื่น` });
    }

    // norm เป็น UNIQUE ถ้าไม่ดักเองจะได้ error ดิบของ SQLite ขึ้นหน้าจอแทนข้อความไทย
    // (เทียบแบบไม่รวมตัวเอง เพื่อให้แก้เฉพาะตัวพิมพ์/เว้นวรรค เช่น "TAI" → "งาน TAI" ยังทำได้)
    const clash = db.prepare('SELECT id, name FROM projects WHERE norm = ? AND id != ?').get(norm, id);
    if (clash) {
      return res.status(409).json({ success: false, message: `ชื่อนี้ซ้ำกับโปรเจกต์ "${clash.name}" — ระบบถือว่าเป็นโปรเจกต์เดียวกัน` });
    }

    // เทียบ project = ชื่อเดิมแบบตรงเป๊ะเท่านั้น ห้ามใช้ LIKE — ช่องเดียวกันนี้เก็บป้ายระบบอยู่ด้วย
    // ทั้งหมดอยู่ในทรานแซกชันเดียว ล้มเมื่อไรย้อนหมด ไม่มีสภาพทะเบียนเปลี่ยนแล้วแต่ประวัติยังค้างชื่อเก่า
    const updated = db.transaction(() => {
      db.prepare('UPDATE projects SET name = ?, norm = ? WHERE id = ?').run(name, norm, id);

      if (keepHistory) {
        // ใบที่ยังเดินอยู่ = ยังไม่มารับ และยังไม่ถูกปฏิเสธ/ยกเลิก — เฉพาะใบเบิกออกเท่านั้นที่มีผลกับโควตาโซน
        const transactions = db.prepare(`
          UPDATE wms_transactions SET project = ?
          WHERE project = ? AND type = 'OUTBOUND' AND pickedUpAt IS NULL AND status IN ('Pending', 'Approved', 'Partial')
        `).run(name, oldName).changes;
        const kept = db.prepare('SELECT COUNT(*) c FROM wms_transactions WHERE project = ?').get(oldName).c;
        return { transactions, stockOut: 0, stockIn: 0, kept };
      }

      return {
        transactions: db.prepare('UPDATE wms_transactions SET project = ? WHERE project = ?').run(name, oldName).changes,
        stockOut: db.prepare('UPDATE stock_out SET project = ? WHERE project = ?').run(name, oldName).changes,
        stockIn: db.prepare('UPDATE stock_in SET project = ? WHERE project = ?').run(name, oldName).changes,
        kept: 0
      };
    })();
    // พื้นที่จัดเตรียม (storage_racks.project_id / rooms.project_id) ไม่ต้องแตะ ผูกด้วย id อยู่แล้ว

    logAudit(req.user?.username, 'project.rename', 'project', String(id), { from: oldName, to: name, keepHistory, ...updated });
    broadcast('transactions');
    broadcast('products');

    res.json({
      success: true,
      project: { id, name },
      keepHistory,
      updated,
      message: keepHistory
        ? `เปลี่ยนชื่อ "${oldName}" เป็น "${name}" แล้ว — แก้ตามให้เฉพาะใบเบิกที่ยังไม่ปิด ${updated.transactions} ใบ · ใบที่ปิดจบแล้วอีก ${updated.kept} ใบคงชื่อ "${oldName}" ไว้ตามเดิม`
        : `เปลี่ยนชื่อ "${oldName}" เป็น "${name}" แล้ว — แก้ตามให้ในใบเบิก ${updated.transactions} ใบ · ประวัติเบิกออก ${updated.stockOut} รายการ · ประวัติรับเข้า ${updated.stockIn} รายการ`
    });
  } catch (err) {
    console.error('renameProject error:', err);
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

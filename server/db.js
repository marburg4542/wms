import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { normalizeProject } from './utils/projects.js';
import { normalizeAllStorageLayers } from './utils/storageLayout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// เปลี่ยนไฟล์ฐานข้อมูลได้ผ่าน DB_FILE ใน server/.env (ค่าเริ่มต้น: identifier.sqlite)
const dbPath = path.isAbsolute(config.dbFile) ? config.dbFile : path.join(__dirname, config.dbFile);
console.log(`📂 Using database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS item_groups (
    group_id TEXT PRIMARY KEY,
    group_name TEXT NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS items (
    item_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    item_seq TEXT NOT NULL,
    item_name TEXT NOT NULL,
    unit TEXT,
    latest_cost REAL,
    is_asset INTEGER,
    storage_type TEXT,
    vendor TEXT,
    clean_status TEXT,
    source_row INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES item_groups(group_id)
  );

  CREATE TABLE IF NOT EXISTS stock_in (
    stock_in_id INTEGER PRIMARY KEY AUTOINCREMENT,
    qr_code TEXT,
    period_code TEXT,
    item_id TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0),
    input_date TEXT,
    unit_cost REAL,
    total_cost REAL GENERATED ALWAYS AS (quantity * unit_cost) STORED,
    project TEXT,
    note TEXT,
    source_row INTEGER,
    clean_status TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(item_id)
  );

  CREATE TABLE IF NOT EXISTS stock_out (
    stock_out_id INTEGER PRIMARY KEY AUTOINCREMENT,
    qr_code TEXT,
    period_code TEXT,
    item_id TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0),
    input_date TEXT,
    output_date TEXT,
    days_held INTEGER,
    unit_cost REAL,
    total_cost REAL GENERATED ALWAYS AS (quantity * unit_cost) STORED,
    project TEXT,
    note TEXT,
    source_row INTEGER,
    clean_status TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(item_id)
  );

  CREATE TABLE IF NOT EXISTS data_quality_issues (
    issue_id INTEGER PRIMARY KEY AUTOINCREMENT,
    severity TEXT,
    source_sheet TEXT,
    source_row INTEGER,
    field_name TEXT,
    original_value TEXT,
    issue_description TEXT,
    action_taken TEXT,
    resolved INTEGER DEFAULT 0,
    resolved_by TEXT,
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS product_settings (
    item_id TEXT PRIMARY KEY,
    min_stock INTEGER NOT NULL DEFAULT 10 CHECK(min_stock >= 0),
    image_url TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Admin', 'Manager', 'Operator', 'Viewer')),
    status TEXT NOT NULL CHECK(status IN ('Pending', 'Active', 'Denied')),
    avatarUrl TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS wms_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transactionId TEXT UNIQUE,
    type TEXT NOT NULL CHECK(type IN ('INBOUND', 'OUTBOUND', 'ADJUSTMENT', 'RETURN')),
    requesterUsername TEXT,
    project TEXT,
    status TEXT NOT NULL CHECK(status IN ('Pending', 'Approved', 'Partial', 'Rejected', 'Cancelled')),
    requestDate TEXT,
    resolvedDate TEXT,
    adminUsername TEXT,
    adminMessage TEXT,
    pickedUpAt TEXT
  );

  CREATE TABLE IF NOT EXISTS wms_transaction_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_id INTEGER NOT NULL,
    productId TEXT NOT NULL,
    sku TEXT,
    productName TEXT,
    imageUrl TEXT,
    requestedQty INTEGER NOT NULL CHECK(requestedQty >= 0),
    approvedQty INTEGER NOT NULL DEFAULT 0 CHECK(approvedQty >= 0),
    status TEXT NOT NULL CHECK(status IN ('Pending', 'Approved', 'Rejected', 'Partial')),
    FOREIGN KEY(tx_id) REFERENCES wms_transactions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    subscription TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_username TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,          -- ชื่อที่แสดง (canonical)
    norm TEXT NOT NULL UNIQUE,   -- ชื่อ normalize ใช้กันซ้ำ (งานTAI/tai/TAI = ตัวเดียว)
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ผังคลัง (แต่ละแห่ง/สาขา = 1 ผัง) — ห้อง/ชั้นวาง/สัญลักษณ์ ผูกกับผังผ่าน plan_id
  CREATE TABLE IF NOT EXISTS floor_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    layout_status TEXT NOT NULL DEFAULT 'draft',
    layout_revision INTEGER NOT NULL DEFAULT 1,
    published_at TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS layout_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    version_number INTEGER NOT NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'published',
    snapshot_json TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plan_id, version_number),
    FOREIGN KEY(plan_id) REFERENCES floor_plans(id) ON DELETE CASCADE
  );

  -- สัญลักษณ์บนผัง (ประตู/กำแพง/บันได/เส้นแบ่ง/ป้ายข้อความ) — วางบนผังหรือในห้อง (room_id)
  CREATE TABLE IF NOT EXISTS markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER,
    room_id INTEGER,                       -- NULL = อยู่บนผังคลัง, มีค่า = อยู่ในห้องนั้น
    type TEXT NOT NULL,                    -- door | wall | stairs | line | label
    text TEXT,                             -- ข้อความ (สำหรับ label)
    pos_x REAL DEFAULT 20, pos_y REAL DEFAULT 20,
    width REAL DEFAULT 60, height REAL DEFAULT 60,
    rotation REAL DEFAULT 0,               -- องศาการหมุน (สัญลักษณ์วางแนวตั้ง/นอน)
    locked INTEGER NOT NULL DEFAULT 0,
    z INTEGER DEFAULT 0,                   -- ลำดับชั้น (layer) บนผัง
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ชั้นวางในคลัง สำหรับผังตำแหน่งจัดเก็บ (top view + blueprint เลเวล)
  -- ห้อง/โซนบนผังบริษัท (สี่เหลี่ยมปรับขนาดได้) — เฉพาะห้องเก็บของ (is_storage) คลิกเข้าไปดูชั้นวางได้
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_storage INTEGER NOT NULL DEFAULT 1, -- 1 = ห้องเก็บของ (คลิกได้), 0 = โซนป้ายเฉยๆ (ออฟฟิศ ฯลฯ)
    pos_x REAL DEFAULT 20, pos_y REAL DEFAULT 20,
    width REAL DEFAULT 200, height REAL DEFAULT 140,
    rotation REAL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    z INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS storage_racks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER,                       -- ชั้นวางอยู่ในห้องไหน (ผังภายในห้อง)
    name TEXT NOT NULL,                    -- เช่น "A", "ชั้นเหล็ก 1"
    levels INTEGER NOT NULL DEFAULT 1,     -- จำนวนเลเวลของชั้นวาง
    pos_x REAL DEFAULT 20,                 -- ตำแหน่งบนผังภายในห้อง (px)
    pos_y REAL DEFAULT 20,
    width REAL DEFAULT 140,
    height REAL DEFAULT 84,
    rotation REAL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    z INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);


// กลุ่มสินค้าเริ่มต้นสำหรับ item ที่สร้างเองโดยไม่ระบุกลุ่ม
db.prepare(`
  INSERT OR IGNORE INTO item_groups (group_id, group_name, description)
  VALUES ('00', 'Default', 'Default group for manually created items')
`).run();

// Seed ตาราง projects จากโปรเจกต์ที่เคยเบิกมา (ครั้งแรกที่ตารางว่าง) — dedupe ด้วย norm
if (db.prepare('SELECT COUNT(*) c FROM projects').get().c === 0) {
  const existing = db.prepare(
    "SELECT DISTINCT project FROM wms_transactions WHERE type = 'OUTBOUND' AND project IS NOT NULL AND TRIM(project) != ''"
  ).all();
  const ins = db.prepare('INSERT OR IGNORE INTO projects (name, norm) VALUES (?, ?)');
  for (const r of existing) {
    const norm = normalizeProject(r.project);
    if (norm) ins.run(r.project.trim(), norm);
  }
}

// Migration: ฐานข้อมูลเดิมที่สร้างก่อนมีฟีเจอร์ "รอส่งมอบสินค้า" ยังไม่มีคอลัมน์ pickedUpAt
const txColumns = db.prepare('PRAGMA table_info(wms_transactions)').all().map((col) => col.name);
if (!txColumns.includes('pickedUpAt')) {
  db.exec('ALTER TABLE wms_transactions ADD COLUMN pickedUpAt TEXT');
  // รายการที่อนุมัติไปก่อนหน้านี้ถือว่าส่งมอบแล้ว ไม่ให้ย้อนกลับมาค้างในคิวรอส่งมอบ
  db.exec(`
    UPDATE wms_transactions
    SET pickedUpAt = COALESCE(resolvedDate, requestDate)
    WHERE type = 'OUTBOUND' AND status IN ('Approved', 'Partial')
  `);
}

// Migration: snapshot หมวดหมู่ลงในใบเบิก เพื่อให้ประวัติ/PDF ไม่เปลี่ยนแม้ลบสินค้าถาวร
// (เดิมดึงหมวดหมู่สดจากตาราง items ตอน query — พอลบสินค้าถาวรจะกลายเป็น 'Default')
const txItemColumns = db.prepare('PRAGMA table_info(wms_transaction_items)').all().map((col) => col.name);
if (!txItemColumns.includes('groupId')) {
  db.exec('ALTER TABLE wms_transaction_items ADD COLUMN groupId TEXT');
  db.exec('ALTER TABLE wms_transaction_items ADD COLUMN groupName TEXT');
  // เติม snapshot ย้อนหลังจากหมวดหมู่ปัจจุบันของสินค้า (เท่าที่ยังหาเจอในตาราง items)
  db.exec(`
    UPDATE wms_transaction_items
    SET groupId = (
      SELECT it.group_id FROM items it WHERE it.item_id = wms_transaction_items.productId
    ),
    groupName = (
      SELECT g.group_name FROM items it
      JOIN item_groups g ON g.group_id = it.group_id
      WHERE it.item_id = wms_transaction_items.productId
    )
    WHERE groupId IS NULL
  `);
}

// Migration: เพิ่มคอลัมน์ตำแหน่งจัดเก็บใน items (ชั้นวาง + เลเวล) — nullable = ยังไม่ระบุตำแหน่ง
const itemCols = db.prepare('PRAGMA table_info(items)').all().map((col) => col.name);
if (!itemCols.includes('rack_id')) {
  db.exec('ALTER TABLE items ADD COLUMN rack_id INTEGER');
  db.exec('ALTER TABLE items ADD COLUMN storage_level INTEGER');
}

// Migration: พื้นที่จัดเตรียมของโครงการ — ห้องแบบพิเศษที่วางสินค้าลงได้โดยตรง (ไม่ต้องมีชั้นวาง)
// is_staging = 1 และผูกกับโครงการผ่าน project_id
const roomStagingCols = db.prepare('PRAGMA table_info(rooms)').all().map((col) => col.name);
if (!roomStagingCols.includes('is_staging')) {
  db.exec('ALTER TABLE rooms ADD COLUMN is_staging INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE rooms ADD COLUMN project_id INTEGER');
}

// สินค้า 1 ตัวเก็บได้หลายที่ พร้อมจำนวนของแต่ละที่
//   rack_id = วางบนชั้นวาง (ระบุเลเวลได้)  |  room_id = วางกับพื้นในพื้นที่นั้น (เช่น โซนจัดเตรียม)
// ต้องเลือกอย่างใดอย่างหนึ่งเท่านั้น และผลรวมทุกที่ของสินค้าห้ามเกินยอดคงเหลือจริง
// (items.rack_id/storage_level ยังอยู่ในฐานะ "ตำแหน่งหลัก" ที่ sync มาจากตารางนี้อัตโนมัติ
//  เพื่อให้หน้าจอ/รายงานเดิมที่อ่านคอลัมน์นั้นยังทำงานได้ โดยมีจุดเขียนเดียวคือ syncPrimaryLocation)
db.exec(`
  CREATE TABLE IF NOT EXISTS item_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    rack_id INTEGER,
    storage_level INTEGER,
    room_id INTEGER,
    quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    note TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(item_id),
    CHECK ((rack_id IS NOT NULL AND room_id IS NULL) OR (rack_id IS NULL AND room_id IS NOT NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_item_loc_rack
    ON item_locations(item_id, rack_id, IFNULL(storage_level, -1)) WHERE rack_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_item_loc_room
    ON item_locations(item_id, room_id) WHERE room_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_item_loc_item ON item_locations(item_id);
`);

// Migration: ชั้นวางมี 2 ประเภท — ชั้นวางจริง (มีเลเวล) กับ "พื้นที่วางพื้น" (ของกองกับพื้น ไม่มีเลเวล)
// เดิมมีแต่ชั้นวาง คนเลยต้องสร้างพื้นที่วางพื้นเป็นชั้นวาง 1 เลเวล แล้วสับสนว่า "เลเวล 1" คืออะไร
const rackKindCols = db.prepare('PRAGMA table_info(storage_racks)').all().map((col) => col.name);
if (!rackKindCols.includes('is_floor')) {
  db.exec('ALTER TABLE storage_racks ADD COLUMN is_floor INTEGER NOT NULL DEFAULT 0');
  // ของเดิมที่ตั้งชื่อว่า floorN ไว้ คือพื้นที่วางพื้นทั้งหมด (ยืนยันจากผู้ใช้) ตั้งประเภทให้ถูกตั้งแต่แรก
  db.exec("UPDATE storage_racks SET is_floor = 1, levels = 1 WHERE name LIKE 'floor%'");
}

// Migration: พื้นที่จัดเตรียมของโครงการ ย้ายจาก "ห้อง" มาเป็น "พื้นที่วางพื้น" ที่ผูกกับโครงการ
// ของจริงคือกองไว้กับพื้นในห้องเก็บของ ไม่ใช่ห้องแยกอีกห้อง — ห้องซ้อนห้องไม่ได้ แต่พื้นที่วางพื้นอยู่ในห้องได้
// นิยามใหม่: พื้นที่จัดเตรียม = ชั้นวางที่ project_id ไม่ว่าง (ไม่ต้องมีธงแยกอีกตัว)
if (!rackKindCols.includes('project_id')) {
  db.exec('ALTER TABLE storage_racks ADD COLUMN project_id INTEGER');
}

// Migration: ตำแหน่งหลักของสินค้าอาจเป็น "ห้อง/โซน" ไม่ใช่ชั้นวางเสมอไป
// (ของในโซนจัดเตรียมเคยไม่มีตำแหน่งแสดงบนการ์ดสินค้าเลย เพราะคอลัมน์เดิมเก็บได้แต่ชั้นวาง)
const itemRoomCols = db.prepare('PRAGMA table_info(items)').all().map((col) => col.name);
if (!itemRoomCols.includes('primary_room_id')) {
  db.exec('ALTER TABLE items ADD COLUMN primary_room_id INTEGER');
  // เติมย้อนหลังให้ของที่วางในห้อง/โซนอยู่แล้ว ไม่งั้นต้องรอมีคนไปแตะตำแหน่งนั้นก่อนถึงจะโผล่
  db.exec(`
    UPDATE items SET primary_room_id = (
      SELECT l.room_id FROM item_locations l
      WHERE l.item_id = items.item_id AND l.room_id IS NOT NULL
      ORDER BY l.quantity DESC, l.id ASC LIMIT 1
    )
    WHERE rack_id IS NULL
      AND EXISTS (SELECT 1 FROM item_locations l WHERE l.item_id = items.item_id AND l.room_id IS NOT NULL)
  `);
}


// Migration: ชั้นวางเดิม (สร้างก่อนมีระบบห้อง) ยังไม่มี room_id
const rackCols = db.prepare('PRAGMA table_info(storage_racks)').all().map((col) => col.name);
if (!rackCols.includes('room_id')) {
  db.exec('ALTER TABLE storage_racks ADD COLUMN room_id INTEGER');
}

// Migration: เพิ่ม plan_id ให้ห้อง/ชั้นวาง (ระบบคลังหลายแห่ง) + seed ผังเริ่มต้น "คลังหลัก"
const roomCols = db.prepare('PRAGMA table_info(rooms)').all().map((col) => col.name);
if (!roomCols.includes('plan_id')) {
  db.exec('ALTER TABLE rooms ADD COLUMN plan_id INTEGER');
  if (!rackCols.includes('plan_id')) db.exec('ALTER TABLE storage_racks ADD COLUMN plan_id INTEGER');
  // สร้างผังเริ่มต้น แล้วย้ายห้อง/ชั้นวางเดิมทั้งหมดเข้าผังนี้
  let planId = db.prepare('SELECT id FROM floor_plans LIMIT 1').get()?.id;
  if (!planId) planId = db.prepare("INSERT INTO floor_plans (name) VALUES ('คลังหลัก')").run().lastInsertRowid;
  db.prepare('UPDATE rooms SET plan_id = ? WHERE plan_id IS NULL').run(planId);
  // ชั้นวางในห้อง → ใช้ plan ของห้องนั้น, ชั้นลอย → ผังเริ่มต้น
  db.prepare('UPDATE storage_racks SET plan_id = COALESCE((SELECT plan_id FROM rooms WHERE rooms.id = storage_racks.room_id), ?) WHERE plan_id IS NULL').run(planId);
} else if (!rackCols.includes('plan_id')) {
  db.exec('ALTER TABLE storage_racks ADD COLUMN plan_id INTEGER');
}

// เผื่อ DB สร้างใหม่ (ตารางว่าง) ให้มีผังเริ่มต้นเสมอ
if (db.prepare('SELECT COUNT(*) c FROM floor_plans').get().c === 0) {
  db.prepare("INSERT INTO floor_plans (name) VALUES ('คลังหลัก')").run();
}

// Migration: เพิ่ม z (layer) ให้ห้อง/ชั้น/สัญลักษณ์ + rotation ให้สัญลักษณ์
const addCol = (table, col, def) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addCol('rooms', 'z', 'INTEGER DEFAULT 0');
addCol('storage_racks', 'z', 'INTEGER DEFAULT 0');
addCol('markers', 'z', 'INTEGER DEFAULT 0');
addCol('markers', 'rotation', 'REAL DEFAULT 0');
addCol('rooms', 'rotation', 'REAL DEFAULT 0');
addCol('storage_racks', 'rotation', 'REAL DEFAULT 0');
addCol('rooms', 'locked', 'INTEGER NOT NULL DEFAULT 0');
addCol('storage_racks', 'locked', 'INTEGER NOT NULL DEFAULT 0');
addCol('markers', 'locked', 'INTEGER NOT NULL DEFAULT 0');
addCol('floor_plans', 'layout_status', "TEXT NOT NULL DEFAULT 'draft'");
addCol('floor_plans', 'layout_revision', 'INTEGER NOT NULL DEFAULT 1');
addCol('floor_plans', 'published_at', 'TEXT');
addCol('floor_plans', 'updated_at', 'TEXT');
addCol('rooms', 'group_id', 'TEXT');
addCol('storage_racks', 'group_id', 'TEXT');
addCol('markers', 'group_id', 'TEXT');
addCol('rooms', 'deleted_at', 'TEXT');
addCol('storage_racks', 'deleted_at', 'TEXT');
addCol('markers', 'deleted_at', 'TEXT');

// Migration ครั้งเดียว: ย้ายพื้นที่จัดเตรียมเดิมที่เป็น "ห้อง" มาเป็น "พื้นที่วางพื้น"
// ของจริงกองอยู่กับพื้นในห้องเก็บของ — ห้องซ้อนห้องไม่ได้ เลยเคยต้องวาดเป็นห้องแยกทับกันไว้
const legacyStagingRooms = db.prepare(
  'SELECT * FROM rooms WHERE is_staging = 1 AND deleted_at IS NULL'
).all();
if (legacyStagingRooms.length > 0) {
  // หาที่ว่างในผังของห้องแม่ ไม่ให้ไปทับชั้นวางที่มีอยู่ (ผู้ใช้ลากย้ายเองทีหลังได้)
  const findFreeSpot = (roomId, w, h) => {
    const taken = db.prepare(
      'SELECT pos_x x, pos_y y, width, height FROM storage_racks WHERE room_id = ? AND deleted_at IS NULL'
    ).all(roomId);
    const hits = (x, y) => taken.some((t) => x < t.x + t.width && x + w > t.x && y < t.y + t.height && y + h > t.y);
    for (let y = 20; y + h <= 880; y += 20) {
      for (let x = 20; x + w <= 1580; x += 20) if (!hits(x, y)) return { x, y };
    }
    return { x: 20, y: 20 };
  };
  db.transaction(() => {
    for (const room of legacyStagingRooms) {
      // ห้องเก็บของที่ครอบโซนนี้อยู่บนผัง = ห้องแม่ตัวจริง
      const cx = Number(room.pos_x) + Number(room.width) / 2;
      const cy = Number(room.pos_y) + Number(room.height) / 2;
      const parent = db.prepare(`
        SELECT id FROM rooms
        WHERE id != ? AND plan_id = ? AND is_storage = 1 AND deleted_at IS NULL
          AND ? BETWEEN pos_x AND pos_x + width AND ? BETWEEN pos_y AND pos_y + height
        ORDER BY width * height ASC LIMIT 1
      `).get(room.id, room.plan_id, cx, cy);
      const width = 220;
      const height = 140;
      const spot = parent ? findFreeSpot(parent.id, width, height) : { x: Number(room.pos_x), y: Number(room.pos_y) };
      const z = Number(db.prepare('SELECT COALESCE(MAX(z), 0) + 1 z FROM storage_racks WHERE room_id IS ?').get(parent?.id ?? null)?.z || 1);
      const made = db.prepare(`
        INSERT INTO storage_racks (name, levels, is_floor, project_id, room_id, plan_id, pos_x, pos_y, width, height, rotation, locked, capacity, z)
        VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
      `).run(room.name, room.project_id, parent?.id ?? null, room.plan_id, spot.x, spot.y, width, height, 100000, z);
      // ย้ายของทั้งหมดจากห้องมาอยู่บนพื้นที่วางพื้นแทน (จำนวนเท่าเดิม ไม่แตะสต็อก)
      db.prepare('UPDATE item_locations SET rack_id = ?, storage_level = 1, room_id = NULL WHERE room_id = ?')
        .run(made.lastInsertRowid, room.id);
      // ตำแหน่งหลักของสินค้าที่เคยชี้ห้องนี้ ต้องชี้พื้นที่วางพื้นแทน
      db.prepare('UPDATE items SET rack_id = ?, storage_level = 1, primary_room_id = NULL WHERE primary_room_id = ?')
        .run(made.lastInsertRowid, room.id);
      // ห้องเดิมเก็บลงถังขยะ กู้คืนได้ถ้าผลไม่ถูกใจ
      db.prepare("UPDATE rooms SET deleted_at = datetime('now'), is_staging = 0 WHERE id = ?").run(room.id);
    }
  })();
  console.log(`📦 ย้ายพื้นที่จัดเตรียม ${legacyStagingRooms.length} แห่งจาก "ห้อง" มาเป็น "พื้นที่วางพื้น"`);
}
addCol('storage_racks', 'capacity', 'INTEGER NOT NULL DEFAULT 100');
addCol('storage_racks', 'width', 'REAL NOT NULL DEFAULT 140');
addCol('storage_racks', 'height', 'REAL NOT NULL DEFAULT 84');
db.exec(`
  CREATE TABLE IF NOT EXISTS layout_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    version_number INTEGER NOT NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'published',
    snapshot_json TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plan_id, version_number),
    FOREIGN KEY(plan_id) REFERENCES floor_plans(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_rooms_plan_deleted ON rooms(plan_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_racks_plan_room_deleted ON storage_racks(plan_id, room_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_markers_plan_room_deleted ON markers(plan_id, room_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_layout_versions_plan ON layout_versions(plan_id, version_number DESC);

`);
db.prepare("UPDATE floor_plans SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)").run();
db.prepare(`UPDATE markers SET plan_id = (SELECT plan_id FROM rooms WHERE rooms.id = markers.room_id)
  WHERE plan_id IS NULL AND room_id IS NOT NULL`).run();

// ซ่อม layer เก่าที่เป็นค่าติดลบ/ซ้ำให้เป็น 1..N แบบ idempotent
// โดยรวม room/rack/marker ในบริบทเดียวกัน เพื่อไม่ให้วัตถุหลุดไปหลังพื้น canvas
normalizeAllStorageLayers(db);

// Migration: ตารางเก่าประกาศ productId เป็น INTEGER (affinity ผิด) — SKU ที่เป็นเลขล้วนมี 0 นำหน้า
// เช่น '02143' จะถูกบีบเป็นเลข 2143 เลข 0 หาย → getCurrentStock หาสต็อกไม่เจอ → เบิกไม่ได้ทั้งที่ของมี
// SQLite แก้ชนิดคอลัมน์ตรงๆ ไม่ได้ ต้องสร้างตารางใหม่ (กู้ productId จาก sku ที่เก็บถูกเป็น TEXT อยู่แล้ว)
const pidType = db.prepare('PRAGMA table_info(wms_transaction_items)').all().find((c) => c.name === 'productId')?.type || '';
if (pidType.toUpperCase().includes('INT')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE wms_transaction_items_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_id INTEGER NOT NULL,
      productId TEXT NOT NULL,
      sku TEXT,
      productName TEXT,
      imageUrl TEXT,
      requestedQty INTEGER NOT NULL CHECK(requestedQty >= 0),
      approvedQty INTEGER NOT NULL DEFAULT 0 CHECK(approvedQty >= 0),
      status TEXT NOT NULL CHECK(status IN ('Pending', 'Approved', 'Rejected', 'Partial')),
      groupId TEXT,
      groupName TEXT,
      FOREIGN KEY(tx_id) REFERENCES wms_transactions(id) ON DELETE CASCADE
    );
    INSERT INTO wms_transaction_items_new (id, tx_id, productId, sku, productName, imageUrl, requestedQty, approvedQty, status, groupId, groupName)
      SELECT id, tx_id, COALESCE(NULLIF(sku, ''), CAST(productId AS TEXT)), sku, productName, imageUrl, requestedQty, approvedQty, status, groupId, groupName
      FROM wms_transaction_items;
    DROP TABLE wms_transaction_items;
    ALTER TABLE wms_transaction_items_new RENAME TO wms_transaction_items;
  `);
  db.pragma('foreign_keys = ON');
}

// Migration: สคีมาเก่า CHECK constraint ของ role ไม่มี 'Viewer' — SQLite แก้ CHECK ตรงๆ ไม่ได้
// ต้องสร้างตารางใหม่แล้วย้ายข้อมูลทั้งหมดมา (ปิด FK ชั่วคราวเพราะ password_reset_tokens อ้างถึง)
const appUsersSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'app_users'`).get()?.sql || '';
if (appUsersSql && !appUsersSql.includes(`'Viewer'`)) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN;
    CREATE TABLE app_users_new (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Admin', 'Manager', 'Operator', 'Viewer')),
      status TEXT NOT NULL CHECK(status IN ('Pending', 'Active', 'Denied')),
      avatarUrl TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO app_users_new (id, username, email, password, role, status, avatarUrl, created_at, updated_at)
      SELECT id, username, email, password, role, status, avatarUrl, created_at, updated_at FROM app_users;
    DROP TABLE app_users;
    ALTER TABLE app_users_new RENAME TO app_users;
    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
  console.log('Migrated app_users table to support Viewer role.');
}

// Migration: คอลัมน์ session_id สำหรับจำกัด 1 บัญชี = 1 อุปกรณ์ (อุปกรณ์ล่าสุดที่ login ชนะ)
const userColumns = db.prepare('PRAGMA table_info(app_users)').all().map((col) => col.name);
if (!userColumns.includes('session_id')) {
  db.exec('ALTER TABLE app_users ADD COLUMN session_id TEXT');
}

// หมวดหมู่สินค้ามาตรฐาน — เลข 2 หลักแรกของ SKU ที่สร้างอัตโนมัติอ้างอิงรหัสกลุ่มนี้
const PRODUCT_GROUPS = [
  ['01', 'อุปกรณ์ช่าง'],
  ['02', 'สายไฟ'],
  ['03', 'เบ็ดเตล็ด'],
  ['04', 'แบตเตอรี่'],
  ['05', 'โรบอท'],
  ['06', 'ไลดาร์'],
  ['07', 'กล้อง'],
  ['08', 'การ์ดเก็บข้อมูล'],
  ['09', 'อุปกรณ์สำนักงาน'],
  ['10', 'วัสดุสิ้นเปลือง'],
  ['11', 'น็อต/สกรู'],
  ['12', 'ฟิลาเมนต์'],
  ['13', 'รีโมท'],
  ['14', 'วงจรไฟฟ้า'],
  ['15', 'ส่วนประกอบโดรน'],
  ['16', 'ส่วนประกอบไรดาร์'],
  ['17', 'สายข้อมูล'],
  ['18', 'สายส่งข้อมูล'],
  ['19', 'อุปกรณ์คอมพิวเตอร์'],
  ['20', 'อิเล็กทรอนิกส์'],
  ['21', 'เครื่องใช้สำนักงาน'],
  ['22', 'อุปกรณ์ภาคสนาม'],
  ['23', 'ส่วนประกอบหุ่นยนต์']
];
// seed เฉพาะ "ครั้งแรก" ที่ยังไม่มีหมวดใดๆ เท่านั้น — ไม่งั้นทุก restart จะเติมหมวดที่ผู้ใช้ลบ/ยุบไปแล้วกลับมา
if (db.prepare("SELECT COUNT(*) AS c FROM item_groups WHERE group_id != '00'").get().c === 0) {
  const insertGroup = db.prepare('INSERT OR IGNORE INTO item_groups (group_id, group_name) VALUES (?, ?)');
  for (const [groupId, groupName] of PRODUCT_GROUPS) insertGroup.run(groupId, groupName);
}

// View สรุปยอดคงเหลือ: ยอดรับเข้า - ยอดเบิกออก ต่อ item
db.exec(`
  CREATE VIEW IF NOT EXISTS warehouse_balance AS
  WITH in_sum AS (
    SELECT item_id, SUM(quantity) AS qty_in
    FROM stock_in
    GROUP BY item_id
  ),
  out_sum AS (
    SELECT item_id, SUM(quantity) AS qty_out
    FROM stock_out
    GROUP BY item_id
  )
  SELECT
    i.item_id,
    i.item_name,
    i.unit,
    g.group_name,
    COALESCE(ins.qty_in, 0) AS qty_in,
    COALESCE(outs.qty_out, 0) AS qty_out,
    (COALESCE(ins.qty_in, 0) - COALESCE(outs.qty_out, 0)) AS stock_balance,
    i.latest_cost,
    ((COALESCE(ins.qty_in, 0) - COALESCE(outs.qty_out, 0)) * i.latest_cost) AS stock_value,
    CASE
      WHEN (COALESCE(ins.qty_in, 0) - COALESCE(outs.qty_out, 0)) < 0 THEN 'Negative stock'
      ELSE NULL
    END AS warning
  FROM items i
  LEFT JOIN item_groups g ON i.group_id = g.group_id
  LEFT JOIN in_sum ins ON i.item_id = ins.item_id
  LEFT JOIN out_sum outs ON i.item_id = outs.item_id;
`);

// View ยอดจอง: ใบเบิกที่อนุมัติแล้วแต่ผู้ขอยังไม่มารับ = ของยังอยู่ในคลังแต่ถูกกันไว้แล้ว
// ตั้งแต่ย้ายจุดตัดสต็อกไปที่ "รับแล้ว" ยอดนี้จึงเป็นตัวกันไม่ให้คนอื่นเบิกของชิ้นเดียวกันซ้ำ
// (คำนวณสดจากใบเบิก ไม่เก็บเป็นตารางแยก จะได้ไม่มีทางเพี้ยนจากยอดจริง)
db.exec(`
  CREATE VIEW IF NOT EXISTS item_reserved AS
  SELECT ti.productId AS item_id, SUM(ti.approvedQty) AS reserved_qty
  FROM wms_transaction_items ti
  JOIN wms_transactions t ON t.id = ti.tx_id
  WHERE t.type = 'OUTBOUND'
    AND t.status IN ('Approved', 'Partial')
    AND t.pickedUpAt IS NULL
    AND ti.approvedQty > 0
  GROUP BY ti.productId;
`);

// Migration ครั้งเดียว: ย้ายตำแหน่งเดิมจาก items.rack_id เข้า item_locations
// ของเดิมเก็บได้ที่เดียว จึงถือว่าของทั้งหมดที่มีอยู่ ณ ตอนนี้อยู่ที่ตำแหน่งนั้น
if (db.prepare('SELECT COUNT(*) c FROM item_locations').get().c === 0) {
  const legacy = db.prepare(`
    SELECT i.item_id, i.rack_id, i.storage_level, COALESCE(wb.stock_balance, 0) AS stock
    FROM items i
    LEFT JOIN warehouse_balance wb ON wb.item_id = i.item_id
    WHERE i.rack_id IS NOT NULL
  `).all();
  if (legacy.length > 0) {
    const insert = db.prepare(`
      INSERT INTO item_locations (item_id, rack_id, storage_level, quantity, created_by, note)
      VALUES (?, ?, ?, ?, 'migration', 'ย้ายจากตำแหน่งเดิมอัตโนมัติ')
    `);
    db.transaction(() => {
      for (const row of legacy) insert.run(row.item_id, row.rack_id, row.storage_level, Math.max(0, row.stock));
    })();
    console.log(`📦 ย้ายตำแหน่งจัดเก็บเดิม ${legacy.length} รายการเข้า item_locations`);
  }
}

// Index สำหรับคอลัมน์ที่ JOIN/กรองบ่อย — จำเป็นเมื่อข้อมูลสะสมหลักหมื่น/แสนแถว
// Migration: ฟีเจอร์คืนของที่รับไปแล้ว
//
// parent_tx_id ผูกใบคืนกลับไปยังใบเบิกต้นทาง — ต้องรู้ว่าคืนมาจากใบไหน
// จึงจะกันไม่ให้คืนเกินจำนวนที่รับไปได้
//
// item_condition บอกสภาพของที่คืน ('usable' | 'damaged')
// ของชำรุดถูกบันทึกไว้เป็นหลักฐาน แต่ไม่ถูกนับกลับเข้าสต็อก
//
// ตั้งใจไม่เก็บ "คืนไปแล้วกี่ชิ้น" เป็นคอลัมน์ — คำนวณสดจากใบคืนที่ผูกอยู่
// ข้อมูลสองที่จึงไม่มีทางขัดกันเอง
addCol('wms_transactions', 'parent_tx_id', 'INTEGER');
addCol('wms_transaction_items', 'item_condition', 'TEXT');

// (SQLite ไม่สร้าง index ให้ foreign key อัตโนมัติ)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_tx_parent ON wms_transactions(parent_tx_id);
  CREATE INDEX IF NOT EXISTS idx_tx_items_tx_id ON wms_transaction_items(tx_id);
  CREATE INDEX IF NOT EXISTS idx_tx_items_product ON wms_transaction_items(productId);
  CREATE INDEX IF NOT EXISTS idx_stock_in_item ON stock_in(item_id);
  CREATE INDEX IF NOT EXISTS idx_stock_out_item ON stock_out(item_id);
  CREATE INDEX IF NOT EXISTS idx_tx_status ON wms_transactions(status);
  CREATE INDEX IF NOT EXISTS idx_tx_request_date ON wms_transactions(requestDate);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`);

export const logAudit = (actorUsername, action, entityType, entityId, details = {}) => {
  db.prepare(`
    INSERT INTO audit_logs (actor_username, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    actorUsername || null,
    action,
    entityType || null,
    entityId == null ? null : String(entityId),
    JSON.stringify(details)
  );
};

export default db;

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

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
`);

// กลุ่มสินค้าเริ่มต้นสำหรับ item ที่สร้างเองโดยไม่ระบุกลุ่ม
db.prepare(`
  INSERT OR IGNORE INTO item_groups (group_id, group_name, description)
  VALUES ('00', 'Default', 'Default group for manually created items')
`).run();

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
const insertGroup = db.prepare('INSERT OR IGNORE INTO item_groups (group_id, group_name) VALUES (?, ?)');
for (const [groupId, groupName] of PRODUCT_GROUPS) insertGroup.run(groupId, groupName);

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

// Index สำหรับคอลัมน์ที่ JOIN/กรองบ่อย — จำเป็นเมื่อข้อมูลสะสมหลักหมื่น/แสนแถว
// (SQLite ไม่สร้าง index ให้ foreign key อัตโนมัติ)
db.exec(`
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

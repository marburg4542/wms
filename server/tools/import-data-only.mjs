import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetPath = path.resolve(__dirname, '../identifier.sqlite');
const sourcePath = path.resolve(__dirname, '../../database/identifier (1).sqlite');

const db = new Database(targetPath);
db.pragma('foreign_keys = ON');

try {
  db.prepare('ATTACH DATABASE ? AS source').run(sourcePath);

  // ป้องกันการรันซ้ำจนข้อมูลสต็อกซ้ำ
  const existing = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM items) AS items,
      (SELECT COUNT(*) FROM stock_in) AS stock_in,
      (SELECT COUNT(*) FROM stock_out) AS stock_out
  `).get();

  if (existing.items || existing.stock_in || existing.stock_out) {
    throw new Error(
      `ยกเลิก: ฐานปลายทางมีข้อมูลแล้ว ` +
      `(items=${existing.items}, stock_in=${existing.stock_in}, stock_out=${existing.stock_out})`
    );
  }

  const importData = db.transaction(() => {
    // หมวดหมู่สินค้า
    db.exec(`
      INSERT OR REPLACE INTO item_groups (group_id, group_name, description)
      SELECT group_id, group_name, description
      FROM source.item_groups;
    `);

    // สินค้า
    db.exec(`
      INSERT INTO items (
        item_id, group_id, item_seq, item_name, unit, latest_cost,
        is_asset, storage_type, vendor, clean_status, source_row,
        created_at, updated_at
      )
      SELECT
        item_id, group_id, item_seq, item_name, unit, latest_cost,
        is_asset, storage_type, vendor, clean_status, source_row,
        created_at, updated_at
      FROM source.items;
    `);

    // ตั้งค่าสินค้า เช่น minimum stock
    db.exec(`
      INSERT INTO product_settings (
        item_id, min_stock, image_url, is_active, updated_at
      )
      SELECT item_id, min_stock, image_url, is_active, updated_at
      FROM source.product_settings;
    `);

    // ประวัติรับเข้า — ไม่ใส่ stock_in_id และ total_cost
    // เพราะ ID ให้ฐานปลายทางสร้างเอง และ total_cost เป็น generated column
    db.exec(`
      INSERT INTO stock_in (
        qr_code, period_code, item_id, quantity, input_date, unit_cost,
        project, note, source_row, clean_status, created_by, created_at
      )
      SELECT
        qr_code, period_code, item_id, quantity, input_date, unit_cost,
        project, note, source_row, clean_status, created_by, created_at
      FROM source.stock_in;
    `);

    // ประวัติจ่ายออก
    db.exec(`
      INSERT INTO stock_out (
        qr_code, period_code, item_id, quantity, input_date, output_date,
        days_held, unit_cost, project, note, source_row, clean_status,
        created_by, created_at
      )
      SELECT
        qr_code, period_code, item_id, quantity, input_date, output_date,
        days_held, unit_cost, project, note, source_row, clean_status,
        created_by, created_at
      FROM source.stock_out;
    `);
  });

  importData();

  const result = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM item_groups) AS item_groups,
      (SELECT COUNT(*) FROM items) AS items,
      (SELECT COUNT(*) FROM product_settings) AS product_settings,
      (SELECT COUNT(*) FROM stock_in) AS stock_in,
      (SELECT COUNT(*) FROM stock_out) AS stock_out,
      (SELECT COUNT(*) FROM app_users) AS app_users
  `).get();

  console.log('นำเข้าข้อมูลสำเร็จ:', result);
} finally {
  try {
    db.exec('DETACH DATABASE source');
  } catch {
    // ยังไม่ได้ attach หรือ detach แล้ว
  }
  db.close();
}
import { createRequire } from 'module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database('server/manual-demo2.sqlite');
const password = await bcrypt.hash('ManualDemo!2026', 10);
const users = [
  ['manual.manager', 'manual.manager@example.test', 'Manager'],
  ['manual.operator', 'manual.operator@example.test', 'Operator'],
  ['manual.viewer', 'manual.viewer@example.test', 'Viewer']
];

const saveUser = db.prepare(`
  INSERT INTO app_users (username, email, password, role, status, avatarUrl)
  VALUES (?, ?, ?, ?, 'Active', '')
  ON CONFLICT(username) DO UPDATE SET
    email = excluded.email,
    password = excluded.password,
    role = excluded.role,
    status = 'Active'
`);

for (const [username, email, role] of users) saveUser.run(username, email, password, role);

const now = new Date().toISOString();
const products = [
  ['01001', '01', '001', 'Servo Motor (Demo)', 'pcs', 1250, 'Demo Supplier', 8, 25],
  ['01002', '01', '002', 'Flight Controller (Demo)', 'pcs', 4800, 'Demo Supplier', 5, 7],
  ['02001', '02', '001', 'Power Cable (Demo)', 'm', 85, 'Demo Supplier', 20, 60]
];
db.prepare("INSERT OR IGNORE INTO item_groups (group_id, group_name) VALUES ('01', 'Electronics')").run();
db.prepare("INSERT OR IGNORE INTO item_groups (group_id, group_name) VALUES ('02', 'Accessories')").run();
const saveProduct = db.prepare(`
  INSERT INTO items (item_id, group_id, item_seq, item_name, unit, latest_cost, vendor, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(item_id) DO UPDATE SET item_name=excluded.item_name, unit=excluded.unit, latest_cost=excluded.latest_cost, vendor=excluded.vendor
`);
const saveSettings = db.prepare(`
  INSERT INTO product_settings (item_id, min_stock, image_url, is_active)
  VALUES (?, ?, '', 1)
  ON CONFLICT(item_id) DO UPDATE SET min_stock=excluded.min_stock, is_active=1
`);
const existingStock = db.prepare('SELECT COUNT(*) AS count FROM stock_in WHERE note = ?').get('Manual screenshot inventory').count;
for (const [sku, group, seq, name, unit, cost, vendor, minStock, qty] of products) {
  saveProduct.run(sku, group, seq, name, unit, cost, vendor, now, now);
  saveSettings.run(sku, minStock);
  if (!existingStock) db.prepare('INSERT INTO stock_in (item_id, quantity, input_date, note, created_by) VALUES (?, ?, ?, ?, ?)').run(sku, qty, now, 'Manual screenshot inventory', 'manual.admin');
}
db.prepare("INSERT OR IGNORE INTO projects (name, norm) VALUES ('Manual Demo Project', 'manual demo project')").run();

console.log(db.prepare('SELECT username, role, status FROM app_users ORDER BY id').all());
db.close();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const legacyUsersFilePath = path.join(__dirname, 'users.json');

const VALID_ROLES = ['Admin', 'Manager', 'Operator', 'Viewer'];
const VALID_STATUSES = ['Pending', 'Active', 'Denied'];

// คอลัมน์ที่ปลอดภัยจะดึงออกมาใช้งาน (รวม password ไว้เพราะ auth ต้องใช้เปรียบเทียบ)
const USER_COLUMNS = 'id, username, email, password, role, status, avatarUrl';

// role ที่ไม่รู้จัก → ให้สิทธิ์ต่ำสุด (ดูอย่างเดียว)
const normalizeRole = (role) => (VALID_ROLES.includes(role) ? role : 'Viewer');
const normalizeStatus = (status) => (VALID_STATUSES.includes(status) ? status : 'Pending');

const insertUserStmt = db.prepare(`
  INSERT INTO app_users (id, username, email, password, role, status, avatarUrl)
  VALUES (@id, @username, @email, @password, @role, @status, @avatarUrl)
`);

// ---------------------------------------------------------------------------
// Seed / migration — รันครั้งเดียวตอนโหลดโมดูล ถ้าตาราง app_users ยังว่างอยู่
// ---------------------------------------------------------------------------
const seedUsersIfNeeded = () => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM app_users').get().count;
  if (count > 0) return;

  // 1) ย้ายข้อมูลจากไฟล์ users.json เดิม (ถ้ามี) เข้าสู่ SQLite
  if (fs.existsSync(legacyUsersFilePath)) {
    let legacyUsers = [];
    try {
      legacyUsers = JSON.parse(fs.readFileSync(legacyUsersFilePath, 'utf8'));
    } catch {
      legacyUsers = [];
    }

    let nextId = Date.now();
    const prepared = (Array.isArray(legacyUsers) ? legacyUsers : [])
      .map((user) => ({
        id: Number(user.id) || nextId++,
        username: String(user.username || '').trim(),
        email: String(user.email || '').trim().toLowerCase(),
        password: user.password,
        role: normalizeRole(user.role),
        status: normalizeStatus(user.status),
        avatarUrl: user.avatarUrl || ''
      }))
      .filter((user) => user.username && user.email && user.password);

    if (prepared.length > 0) {
      db.transaction(() => {
        for (const user of prepared) insertUserStmt.run(user);
      })();
      console.log(`Migrated ${prepared.length} user(s) from legacy users.json into SQLite.`);
      return;
    }
  }

  // 2) ถ้าไม่มีข้อมูลเดิมเลย ให้สร้าง admin เริ่มต้นจากค่าใน .env
  if (config.bootstrapAdmin.password) {
    insertUserStmt.run({
      id: 1,
      username: config.bootstrapAdmin.username,
      email: String(config.bootstrapAdmin.email || '').trim().toLowerCase(),
      password: bcrypt.hashSync(config.bootstrapAdmin.password, 10),
      role: 'Admin',
      status: 'Active',
      avatarUrl: ''
    });
    console.log(`Created bootstrap admin user "${config.bootstrapAdmin.username}".`);
  }
};

seedUsersIfNeeded();

// ---------------------------------------------------------------------------
// Query helpers — อ่าน/เขียนแบบราย record ตรงๆ กับ SQLite
// ---------------------------------------------------------------------------
export const getUsers = () =>
  db.prepare(`SELECT ${USER_COLUMNS} FROM app_users ORDER BY username COLLATE NOCASE ASC`).all();

export const getUserById = (id) =>
  db.prepare(`SELECT ${USER_COLUMNS} FROM app_users WHERE id = ?`).get(Number(id));

export const getUserByUsername = (username) =>
  db.prepare(`SELECT ${USER_COLUMNS} FROM app_users WHERE LOWER(username) = LOWER(?)`)
    .get(String(username || '').trim());

export const getUserByEmail = (email) =>
  db.prepare(`SELECT ${USER_COLUMNS} FROM app_users WHERE LOWER(email) = LOWER(?)`)
    .get(String(email || '').trim());

export const countActiveAdmins = () =>
  db.prepare(`SELECT COUNT(*) AS count FROM app_users WHERE role = 'Admin' AND status = 'Active'`)
    .get().count;

// session_id ล่าสุด — ใช้จำกัด 1 บัญชี = 1 อุปกรณ์ (login ใหม่ = ตัด session เดิม)
export const setSessionId = (id, sessionId) =>
  db.prepare('UPDATE app_users SET session_id = ? WHERE id = ?').run(sessionId, Number(id));

export const getSessionId = (id) =>
  db.prepare('SELECT session_id FROM app_users WHERE id = ?').get(Number(id))?.session_id ?? null;

export const createUser = ({ id, username, email, password, role = 'Operator', status = 'Pending', avatarUrl = '' }) => {
  const newUser = {
    id: Number(id) || Date.now(),
    username: String(username || '').trim(),
    email: String(email || '').trim().toLowerCase(),
    password,
    role: normalizeRole(role),
    status: normalizeStatus(status),
    avatarUrl: avatarUrl || ''
  };
  insertUserStmt.run(newUser);
  return newUser;
};

// ฟิลด์ที่อนุญาตให้แก้ไข พร้อมฟังก์ชัน normalize ของแต่ละฟิลด์
const UPDATABLE_FIELDS = {
  username: (value) => String(value).trim(),
  email: (value) => String(value).trim().toLowerCase(),
  password: (value) => value,
  role: (value) => normalizeRole(value),
  status: (value) => normalizeStatus(value),
  avatarUrl: (value) => (value == null ? '' : String(value))
};

export const updateUser = (id, fields = {}) => {
  const numericId = Number(id);
  const setClauses = [];
  const params = { id: numericId };

  for (const [key, transform] of Object.entries(UPDATABLE_FIELDS)) {
    if (fields[key] !== undefined) {
      setClauses.push(`${key} = @${key}`);
      params[key] = transform(fields[key]);
    }
  }

  if (setClauses.length > 0) {
    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    db.prepare(`UPDATE app_users SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
  }

  return getUserById(numericId);
};

export const deleteUser = (id) => {
  const info = db.prepare('DELETE FROM app_users WHERE id = ?').run(Number(id));
  return info.changes > 0;
};

// ตัวช่วยเรียก controller ตรงๆ เหมือน Express เรียกให้ — ใช้ในเทสต์ที่ต้องยิง endpoint จริง
//
// ทำไมต้องมี: เทสต์เดิมคุมแต่ตรรกะล้วนๆ (ฟังก์ชันคำนวณ) ทำให้ SQL ที่พังทั้งดุ้น
// อย่าง "ลืม JOIN ตาราง projects" หลุดผ่านเทสต์ทั้งหมดไปขึ้น production ได้
// ชุดนี้จึงยิงของจริงผ่าน controller เพื่อให้ query ทุกตัวถูกรันอย่างน้อย 1 ครั้ง
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * ชี้ DB_FILE ไปไฟล์ชั่วคราวก่อน import db.js — เทสต์จะได้ schema จริงครบทุกตาราง
 * โดยไม่แตะฐานข้อมูลที่ใช้งานอยู่ (ต้องเรียกก่อน import อย่างอื่นเสมอ)
 */
export const createTempDatabase = (label) => {
  const file = path.join(os.tmpdir(), `wms-test-${label}-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_FILE = file;
  return {
    file,
    cleanup: (db) => {
      try { db?.close(); } catch { /* ปิดไปแล้วก็ไม่เป็นไร */ }
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
    }
  };
};

/** เรียก controller แบบเดียวกับที่ Express เรียก แล้วคืน { status, ...body } */
export const call = (handler, { query = {}, params = {}, body = {}, user = { username: 'tester', role: 'Admin' } } = {}) =>
  new Promise((resolve, reject) => {
    const res = {
      status: (code) => ({ json: (payload) => resolve({ status: code, ...payload }) }),
      json: (payload) => resolve({ status: 200, ...payload })
    };
    try {
      const result = handler({ query, params, body, user, get: () => '' }, res);
      if (result && typeof result.catch === 'function') result.catch(reject);
    } catch (err) {
      reject(err);
    }
  });

/** เรียกแล้วคาดว่าต้องสำเร็จ — ถ้าไม่สำเร็จให้ error บอกชัดว่า endpoint ไหนพังเพราะอะไร */
export const callOk = async (name, handler, options) => {
  const result = await call(handler, options);
  if (!result.success) {
    throw new Error(`${name} ล้มเหลว (${result.status}): ${result.message || 'ไม่มีข้อความ'}`);
  }
  return result;
};

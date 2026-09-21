// เช็กชื่อผู้ใช้ขณะพิมพ์: รูปแบบถูกไหม (เช็กในเครื่องทันที) + มีคนใช้แล้วหรือยัง (ถามเซิร์ฟเวอร์หลังหยุดพิมพ์ 0.5 วิ)
//
// status: idle | invalid | checking | available | taken | unknown
//   unknown = ถามเซิร์ฟเวอร์ไม่สำเร็จ (เช่น โดนจำกัดความถี่) — ไม่ขวางการกดส่ง เพราะเซิร์ฟเวอร์ตรวจซ้ำอยู่แล้ว
import { useEffect, useState } from 'react';
import { fetchApi } from './api';
import { validateUsername } from '../../shared/credentialPolicy';

export function useUsernameCheck(username, { currentUsername = '' } = {}) {
  const name = String(username || '').trim();
  // ชื่อเดิมของตัวเอง (หน้าตั้งค่า) ไม่ต้องเช็ก — ไม่งั้นจะขึ้นว่า "มีคนใช้แล้ว" ใส่ตัวเอง
  const idle = !name || (currentUsername && name.toLowerCase() === currentUsername.toLowerCase());
  const formatError = idle ? null : validateUsername(name);
  const [result, setResult] = useState({ name: '', status: 'idle', message: '' });

  useEffect(() => {
    if (idle || formatError) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetchApi(`/api/username-available?username=${encodeURIComponent(name)}`, { suppressErrorToast: true });
        if (!cancelled) setResult({ name, status: res.available ? 'available' : 'taken', message: res.message });
      } catch {
        if (!cancelled) setResult({ name, status: 'unknown', message: '' });
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [name, idle, formatError]);

  if (idle) return { status: 'idle', message: '' };
  if (formatError) return { status: 'invalid', message: formatError };
  if (result.name !== name) return { status: 'checking', message: 'กำลังตรวจสอบชื่อผู้ใช้…' };
  return result;
}

export const usernameHintTone = (status) => ({
  invalid: 'text-error',
  taken: 'text-error',
  available: 'text-success',
  checking: 'text-base-content/50'
}[status] || 'text-base-content/50');

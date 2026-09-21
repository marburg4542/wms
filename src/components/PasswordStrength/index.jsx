// มาตรวัดความแข็งแรง + เช็กลิสต์กติการหัสผ่าน แสดงใต้ช่องกรอกขณะพิมพ์
// กติกามาจาก shared/credentialPolicy.js ไฟล์เดียวกับที่เซิร์ฟเวอร์ใช้บังคับ
import React from 'react';
import { passwordChecks, passwordStrength } from '../../../shared/credentialPolicy';

const BAR_TONE = ['bg-error', 'bg-error', 'bg-warning', 'bg-success', 'bg-success'];
const TEXT_TONE = ['text-error', 'text-error', 'text-warning', 'text-success', 'text-success'];

export default function PasswordStrength({ password, username = '' }) {
  if (!password) return null;
  const checks = passwordChecks(password, { username });
  const failing = checks.some((check) => !check.ok);
  // ยาวและหลากหลายแต่ยังผิดกติกา (เช่น มีชื่อผู้ใช้อยู่ข้างใน) ห้ามขึ้นว่า "ดี" ให้เข้าใจผิด
  const raw = passwordStrength(password);
  const score = failing ? Math.min(raw.score, 1) : raw.score;
  const label = ['อ่อนมาก', 'อ่อน', 'พอใช้', 'ดี', 'แข็งแรง'][score];

  return (
    <div className="px-2 text-left" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full ${i < Math.max(score, 1) ? BAR_TONE[score] : 'bg-base-300'}`} />
          ))}
        </div>
        <span className={`w-14 text-right text-xs font-semibold ${TEXT_TONE[score]}`}>{label}</span>
      </div>
      <ul className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-2">
        {checks.filter((check) => !(check.hiddenWhenOk && check.ok)).map((check) => (
          <li key={check.id} className={check.ok ? 'text-success' : 'text-base-content/60'}>
            {check.ok ? '✓' : '○'} {check.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

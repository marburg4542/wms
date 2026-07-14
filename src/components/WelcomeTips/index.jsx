// ทิปแนะนำครั้งแรกสำหรับผู้ใช้ใหม่ — แสดงครั้งเดียวต่อ role (จำใน localStorage)
import React, { useEffect, useState } from 'react';
import { roleLabel } from '../../utils/labels';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';

const TIPS_BY_ROLE = {
  Admin: [
    '👥 อนุมัติคำขอสมัครสมาชิกและกำหนดสิทธิ์ได้ที่เมนู "จัดการผู้ใช้งาน"',
    '🏷️ เพิ่ม/แก้ไขสินค้า รับอะไหล่เข้า และนำเข้า CSV ได้ที่ "รายการอะไหล่"',
    '📋 พิจารณาใบเบิก (อนุมัติ/ปฏิเสธ) และกด "ส่งมอบแล้ว" ได้ที่แดชบอร์ด'
  ],
  Manager: [
    '🏷️ จัดการสินค้าได้เต็มที่ที่ "รายการอะไหล่" — เพิ่ม/แก้ไข/รับเข้า/ปิดใช้งาน',
    '📋 พิจารณาใบเบิกที่แดชบอร์ด: ปรับจำนวนอนุมัติ + กรอกเหตุผลเมื่อจ่ายไม่ครบ',
    '📄 ออกรายงาน PDF ย้อนหลังรายวัน/เดือน/ปี ได้ที่ปุ่ม "นำออก PDF"'
  ],
  Operator: [
    '📦 เลือกสินค้าที่ "สินค้าคงคลัง" → กดปุ่มเพิ่มลงใบเบิก → ส่งใบเบิก',
    '📷 กดปุ่มกล้องเพื่อสแกนบาร์โค้ด/QR ค้นหาสินค้าได้เร็วขึ้น',
    '🔔 รอผลอนุมัติที่กระดิ่งแจ้งเตือน — เมื่อขึ้น "มารับสินค้าได้" ให้ไปรับที่คลัง'
  ],
  Viewer: [
    '👁️ บัญชีของคุณเป็นสิทธิ์ "ดูอย่างเดียว" — ดูภาพรวมและสินค้าคงคลังได้',
    '📄 ออกรายงาน PDF ได้ที่ปุ่ม "นำออก PDF" บนแดชบอร์ด',
    'ℹ️ หากต้องการเบิกสินค้า ให้ติดต่อผู้ดูแลเพื่อปรับสิทธิ์เป็น "พนักงาน"'
  ]
};

export default function WelcomeTips() {
  const [role, setRole] = useState(null);
  useBodyScrollLock(!!role); // freeze พื้นหลังตอนแสดงทิปต้อนรับ

  useEffect(() => {
    const user = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
    if (!user.role) return;
    const key = `wms-tips-seen:${user.role}`;
    if (!localStorage.getItem(key)) setRole(user.role);
  }, []);

  if (!role) return null;

  const dismiss = () => {
    localStorage.setItem(`wms-tips-seen:${role}`, '1');
    setRole(null);
  };

  return (
    <div className="fixed inset-0 z-135 flex items-center justify-center backdrop-blur-md p-4" onClick={dismiss}>
      <div className="glass-modal rounded-2xl w-full max-w-md p-6 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-xl text-gradient w-fit">ยินดีต้อนรับสู่ WMS 👋</h3>
        <p className="text-sm text-base-content/60 mt-1 mb-4">สิทธิ์ของคุณ: <span className="font-semibold">{roleLabel(role)}</span> — เคล็ดลับเริ่มต้น:</p>
        <ul className="space-y-3">
          {TIPS_BY_ROLE[role]?.map((tip, i) => (
            <li key={i} className="flex gap-2 text-sm bg-base-200/50 rounded-lg p-3">{tip}</li>
          ))}
        </ul>
        <button className="btn btn-primary text-white w-full mt-6" onClick={dismiss}>เริ่มใช้งาน</button>
      </div>
    </div>
  );
}

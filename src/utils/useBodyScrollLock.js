// ล็อกไม่ให้พื้นหลังเลื่อนตอนเปิด modal (freeze พื้นหลัง)
// - ใช้ตัวนับเพราะ modal อาจซ้อนกัน (เช่น กล่องยืนยันบนฟอร์มสินค้า) ต้องปลดล็อกเมื่อปิดตัวสุดท้าย
// - บน iOS แค่ overflow:hidden ไม่พอ ต้องตรึงด้วย position:fixed แล้วคืนตำแหน่ง scroll เดิม
import { useEffect } from 'react';

let lockCount = 0;
let savedScrollY = 0;

export function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) return;

    if (lockCount === 0) {
      savedScrollY = window.scrollY;
      const body = document.body;
      body.style.position = 'fixed';
      body.style.top = `-${savedScrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        const body = document.body;
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.width = '';
        body.style.overflow = '';
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [active]);
}

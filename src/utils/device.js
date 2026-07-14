// อุปกรณ์ที่ควร "เปิดกล้อง" สแกน = มือถือ/แท็บเล็ต (primary pointer เป็นแบบสัมผัส)
// ส่วนคอม/โน้ตบุ๊ก (มีเมาส์/แทร็กแพด) จะใช้เครื่องสแกนบาร์โค้ดจริงแทน (ทำงานเหมือนคีย์บอร์ด)
export const isCameraScanDevice = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

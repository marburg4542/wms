// แตกรหัสจากป้าย QR/บาร์โค้ดของสินค้า → คืนค่าที่ใช้ค้นหา (item_id)
// ป้ายเดิมในคลังเป็นเลข 9 หลัก = MMYY + item_id(5 ตัวท้าย) ตาม qr_spec.md
//   ตัวอย่าง 116615041 → เดือน 11 ปี พ.ศ.2566 + สินค้า 15041
// กฎทอง: เชื่อถือแค่ 5 ตัวท้าย และต้องคงเป็น string เสมอ (ห้าม Number — เลข 0 นำหน้าจะหาย)
export function parseScannedCode(raw) {
  const s = String(raw || '').trim();

  // ป้ายเดิม 9 หลักตัวเลขล้วน — เอา 5 ตัวท้ายเป็น item_id (ตรวจเดือน 01-12 กันรูปแบบเพี้ยน)
  if (/^\d{9}$/.test(s)) {
    const mm = Number(s.slice(0, 2));
    if (mm >= 1 && mm <= 12) {
      return { searchValue: s.slice(4), itemId: s.slice(4), fromLabel: true };
    }
  }

  // อื่นๆ: บาร์โค้ดที่เป็น item_id ตรงๆ หรือข้อความค้นหา — ส่งกลับไปค้นตามเดิม
  return { searchValue: s, fromLabel: false };
}

// ป้ายภาษาไทยสำหรับค่าสถานะ/ประเภทที่เก็บเป็นภาษาอังกฤษในฐานข้อมูล
// ค่าในฐานข้อมูลคงเดิม (อังกฤษ) — แปลเฉพาะตอนแสดงผลเท่านั้น

export const txTypeLabel = (type) => ({
  INBOUND: 'รับเข้า',
  OUTBOUND: 'เบิกออก',
  ADJUSTMENT: 'ปรับยอด',
  RETURN: 'คืนสินค้า'
}[type] || type);

export const txStatusLabel = (status) => ({
  Pending: 'รออนุมัติ',
  Approved: 'อนุมัติ',
  Partial: 'อนุมัติบางส่วน',
  Rejected: 'ปฏิเสธ',
  Cancelled: 'ยกเลิก'
}[status] || status);

export const stockStatusLabel = (status) => ({
  'Active': 'เบิกได้',
  'Low Stock': 'สต็อกต่ำ',
  'Out of Stock': 'หมดสต็อก'
}[status] || status);

// ตำแหน่งจัดเก็บที่คนอ่านเข้าใจ — คืน null เมื่อยังไม่รู้ว่าอยู่ไหน
//   ชั้นวางปกติ      → "A5 · เลเวล 3"
//   พื้นที่วางพื้น     → "floor2"        (ไม่มีเลเวลให้พูดถึง)
//   วางในห้อง/โซน   → "TAI"           (ของในโซนจัดเตรียมเคยไม่แสดงตำแหน่งเลย)
export const locationLabel = (item) => {
  if (item?.rackName) {
    return item.isFloorZone || !item.storageLevel
      ? item.rackName
      : `${item.rackName} · เลเวล ${item.storageLevel}`;
  }
  return item?.roomName || null;
};

export const userStatusLabel = (status) => ({
  Active: 'ใช้งานอยู่',
  Pending: 'รออนุมัติ',
  Denied: 'ถูกระงับ'
}[status] || status);

export const roleLabel = (role) => ({
  Admin: 'ผู้ดูแลระบบ',
  Manager: 'ผู้จัดการ',
  Operator: 'พนักงาน',
  Viewer: 'ผู้ชม (ดูอย่างเดียว)'
}[role] || role);

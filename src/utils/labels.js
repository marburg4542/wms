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
  'Active': 'พร้อมเบิก',
  'Low Stock': 'สต็อกต่ำ',
  'Out of Stock': 'หมดสต็อก'
}[status] || status);

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

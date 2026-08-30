// ย่อรูปในเบราว์เซอร์ก่อนอัปโหลด
//
// ทำไมต้องย่อ: รูปจากกล้องมือถือมักใหญ่ 1–4 MB แต่แอปแสดงใหญ่สุดแค่ระดับการ์ด (~400px)
// ถ้าเก็บต้นฉบับไว้ หน้าที่มีสินค้าเยอะจะต้องดาวน์โหลดหลายสิบ MB (เคยวัดได้ 78 MB ต่อหนึ่งชั้นวาง)
//
// ทำที่เบราว์เซอร์เพราะไม่ต้องเพิ่ม dependency ฝั่งเซิร์ฟเวอร์เลย — เครื่องที่รับช่วงดูแลต่อ
// จึงไม่ต้องคอมไพล์ native module เพิ่ม (บทเรียนเดียวกับ better-sqlite3)

const MAX_EDGE = 1200;      // ด้านยาวสุดหลังย่อ (พอสำหรับการ์ดและการซูมดูรายละเอียด)
const QUALITY = 0.82;       // คุณภาพ JPEG — ตาแทบไม่เห็นความต่างที่ระดับนี้
const SKIP_BELOW = 300 * 1024;   // เล็กกว่านี้อยู่แล้วก็ไม่ต้องยุ่ง

const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')); };
  img.src = url;
});

/**
 * ย่อรูปให้เล็กลงก่อนอัปโหลด — คืนไฟล์เดิมกลับไปถ้าย่อไม่ได้หรือย่อแล้วไม่ได้เล็กลง
 * ไม่ทำให้การอัปโหลดพังในทุกกรณี (ถ้ามีปัญหาจะใช้ไฟล์ต้นฉบับแทน)
 * @param {File} file ไฟล์จาก <input type="file">
 * @returns {Promise<File>}
 */
export const shrinkImage = async (file) => {
  if (!file || !file.type?.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file;          // GIF เคลื่อนไหวได้ ย่อแล้วจะเหลือเฟรมเดียว
  if (file.size <= SKIP_BELOW) return file;

  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;   // ย่อแล้วไม่เล็กลง ใช้ของเดิมดีกว่า

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;   // เบราว์เซอร์เก่าหรือไฟล์แปลก — อัปโหลดต้นฉบับไปตามเดิม
  }
};

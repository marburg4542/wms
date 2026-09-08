// src/utils/api.js
import toast from 'react-hot-toast';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const getAssetUrl = (url) => {
  if (!url) return '';
  return url.startsWith('http') || url.startsWith('data:') ? url : `${API_BASE_URL}${url}`;
};

// เวลารอสูงสุดก่อนยอมแพ้ — เดิมไม่มีเลย คำขอที่ไปไม่ถึงเซิร์ฟเวอร์จึงหมุนค้างได้ไม่จำกัด
// พอจอไม่ขึ้นอะไรสักอย่าง ผู้ใช้ก็กดซ้ำ แล้วคำขอที่คิวไว้หลุดออกมาพร้อมกันตอนเน็ตติด
// (7 ก.ย. 2026 ได้ใบเบิกเดียวกัน 6 ใบห่างกันรวม 299 มิลลิวินาที จากสาเหตุนี้)
const DEFAULT_TIMEOUT_MS = 20_000;
// อัปโหลดรูปสินค้าไฟล์ใหญ่บนเน็ตมือถือกินเวลาเป็นนาทีได้ตามปกติ ไม่ใช่อาการค้าง จึงต้องให้เวลามากกว่า
const UPLOAD_TIMEOUT_MS = 120_000;

export const fetchApi = async (endpoint, options = {}) => {
  const { suppressErrorToast = false, timeoutMs, ...requestOptions } = options;
  const token = sessionStorage.getItem('token');
  const isFormData = requestOptions.body instanceof FormData;
  const method = (requestOptions.method || 'GET').toUpperCase();
  const limitMs = timeoutMs ?? (isFormData ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

  const defaultHeaders = {
    ...(!isFormData && { 'Content-Type': 'application/json' }),
    ...(token && { 'Authorization': `Bearer ${token}` })
  };

  // ใช้ AbortController ไม่ใช่ AbortSignal.timeout() เพราะไม่รู้ว่ามือถือพนักงานเครื่องไหนเก่าแค่ไหน
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...requestOptions,
      signal: controller.signal,
      headers: {
        ...defaultHeaders,
        ...requestOptions.headers,
      },
    });

    if (!response.ok) {
      // 1. พยายามดึงข้อความ Error จริงๆ จาก Backend ออกมา
      let errorMessage = `พบข้อผิดพลาดจากเซิร์ฟเวอร์ (${response.status})`;
      let errorCode = null;
      try {
        const errorData = await response.json();
        if (errorData.message) errorMessage = errorData.message;
        if (errorData.code) errorCode = errorData.code;
      } catch {
        // กรณี Backend ไม่ได้ส่ง JSON กลับมา
      }

      // 2. เช็คว่าเป็น API เกี่ยวกับการ Auth (Login/Register) หรือไม่
      const isAuthRoute = endpoint.includes('/login') || endpoint.includes('/register') || endpoint.includes('/forgot-password') || endpoint.includes('/reset-password');

      // 3. จัดการ Error แบบแยกประเภท
      if ((response.status === 401 || response.status === 403) && !isAuthRoute) {
        // ถูก login จากอุปกรณ์อื่น (1 บัญชี = 1 อุปกรณ์) แสดงข้อความเฉพาะจาก server ให้ชัด
        const sessionReplaced = errorCode === 'SESSION_REPLACED';
        toast.error(sessionReplaced ? errorMessage : 'สิทธิ์การเข้าถึงมีปัญหา หรือ Token หมดอายุ กรุณาล็อกอินใหม่');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('currentUser');
        setTimeout(() => {
            window.location.href = '/login';
        }, 1500);
      } else if (!suppressErrorToast) {
        // 🔥 แสดงข้อความ Error ที่แท้จริงจาก Backend (เช่น "ไม่พบสินค้า" หรือ "บัญชีรอผลการอนุมัติ")
        toast.error(errorMessage);
      }
      const apiError = new Error(`API Error: ${response.status} ${errorMessage}`);
      apiError.status = response.status;
      apiError.code = errorCode;
      throw apiError;
    }

    if (response.status === 204) {
      return { success: true };
    }

    return await response.json();
  } catch (error) {
    console.error(`🚨 [fetchApi] Error at ${endpoint}:`, error);

    // หมดเวลารอ — ต้องแยกออกมาก่อน ไม่งั้นจะไปตกกรณีล่างแล้วเด้งข้อความคนละเรื่อง
    if (error.name === 'AbortError') {
      const seconds = Math.round(limitMs / 1000);
      // การยกเลิกฝั่งเราไม่ได้แปลว่าเซิร์ฟเวอร์ไม่ได้ทำ คำขออาจไปถึงและบันทึกไปแล้วก็ได้
      // ห้ามบอกว่า "ส่งไม่สำเร็จ" ลอยๆ ไม่งั้นผู้ใช้จะกดส่งใหม่ทันทีแล้วได้ใบซ้ำจริง
      const timeoutError = new Error(
        method === 'GET'
          ? `โหลดข้อมูลไม่สำเร็จ — เซิร์ฟเวอร์ไม่ตอบภายใน ${seconds} วินาที`
          : `เซิร์ฟเวอร์ไม่ตอบกลับภายใน ${seconds} วินาที — ยังไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ กรุณาตรวจในประวัติก่อนส่งซ้ำ`
      );
      timeoutError.timedOut = true;
      if (!suppressErrorToast) toast.error(timeoutError.message, { duration: 8000 });
      throw timeoutError;
    }

    if (!suppressErrorToast && !error.message.includes('API Error')) {
        toast.error('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ โปรดตรวจสอบว่า Backend เปิดทำงานอยู่หรือไม่');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

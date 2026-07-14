// src/utils/api.js
import toast from 'react-hot-toast';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const getAssetUrl = (url) => {
  if (!url) return '';
  return url.startsWith('http') || url.startsWith('data:') ? url : `${API_BASE_URL}${url}`;
};

export const fetchApi = async (endpoint, options = {}) => {
  const token = sessionStorage.getItem('token');
  const isFormData = options.body instanceof FormData;
  
  const defaultHeaders = {
    ...(!isFormData && { 'Content-Type': 'application/json' }),
    ...(token && { 'Authorization': `Bearer ${token}` })
  };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
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
      } else {
        // 🔥 แสดงข้อความ Error ที่แท้จริงจาก Backend (เช่น "ไม่พบสินค้า" หรือ "บัญชีรอผลการอนุมัติ")
        toast.error(errorMessage);
      }
      throw new Error(`API Error: ${response.status} ${errorMessage}`);
    }

    if (response.status === 204) {
      return { success: true };
    }

    return await response.json();
  } catch (error) {
    console.error(`🚨 [fetchApi] Error at ${endpoint}:`, error);
    if (!error.message.includes('API Error')) {
        toast.error('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ โปรดตรวจสอบว่า Backend เปิดทำงานอยู่หรือไม่');
    }
    throw error;
  }
};

import express from 'express';
import { createHistoryReport, downloadReport, renderReportPage } from '../controllers/reportController.js';
import { verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// ขอไฟล์รายงาน — ต้องล็อกอิน (ทุกบทบาทออกรายงานได้ตามสิทธิ์เดิม)
router.post('/reports/history', verifyAuth, createHistoryReport);
// หน้าที่เบราว์เซอร์ headless บนเครื่องนี้มาดึงไปเรนเดอร์ (จำกัดเฉพาะคำขอจากเครื่องตัวเอง)
router.get('/reports/render/:id', renderReportPage);
// ลิงก์ดาวน์โหลด — id สุ่ม ใช้ครั้งเดียว หมดอายุ 5 นาที จึงไม่ต้องแนบ token
router.get('/reports/download/:id', downloadReport);

export default router;

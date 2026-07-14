import express from 'express';
import { getAnalysis, getForecast, getTrend } from '../controllers/analysisController.js';
import { authorizeRoles, verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// วิเคราะห์ trend/สินค้าที่เบิกเยอะ — ระดับผู้จัดการขึ้นไป (เหมือนหน้าจัดการสินค้า)
router.get('/analysis', verifyAuth, authorizeRoles('Admin', 'Manager'), getAnalysis);
// ข้อมูลกราฟเส้น trend ตามเดือน/ปีที่เลือก
router.get('/analysis/trend', verifyAuth, authorizeRoles('Admin', 'Manager'), getTrend);
// ผลพยากรณ์จาก ML service (อ่านไฟล์ forecasts.json)
router.get('/analysis/forecast', verifyAuth, authorizeRoles('Admin', 'Manager'), getForecast);

export default router;

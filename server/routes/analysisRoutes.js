import express from 'express';
import { getAnalysis } from '../controllers/analysisController.js';
import { authorizeRoles, verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// วิเคราะห์ trend/สินค้าที่เบิกเยอะ — ระดับผู้จัดการขึ้นไป (เหมือนหน้าจัดการสินค้า)
router.get('/analysis', verifyAuth, authorizeRoles('Admin', 'Manager'), getAnalysis);

export default router;

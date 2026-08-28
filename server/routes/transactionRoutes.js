import express from 'express';
import {
  adjustStock,
  cancelReservation,
  cancelTransaction,
  createInboundTransaction,
  createOutboundRequest,
  getHistory,
  getTransactions,
  markPickedUp,
  resolveTransaction
} from '../controllers/transactionController.js';
import { authorizeRoles, verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Viewer ดูได้อย่างเดียว — ห้ามสร้าง/ยกเลิกใบเบิก
router.post('/transactions/request', verifyAuth, authorizeRoles('Admin', 'Manager', 'Operator'), createOutboundRequest);
router.post('/transactions/inbound', verifyAuth, authorizeRoles('Admin', 'Manager'), createInboundTransaction);
router.post('/transactions/adjust', verifyAuth, authorizeRoles('Admin', 'Manager'), adjustStock);
router.get('/transactions', verifyAuth, getTransactions);
router.get('/transactions/history', verifyAuth, getHistory);
router.put('/transactions/:id/resolve', verifyAuth, authorizeRoles('Admin', 'Manager'), resolveTransaction);
router.put('/transactions/:id/pickup', verifyAuth, authorizeRoles('Admin', 'Manager'), markPickedUp);
router.put('/transactions/:id/cancel', verifyAuth, authorizeRoles('Admin', 'Manager', 'Operator'), cancelTransaction);
// ยกเลิกการจองของใบที่อนุมัติแล้วแต่ไม่มีคนมารับ — คืนของเข้าสต็อก ต้องระบุเหตุผล
router.put('/transactions/:id/cancel-reservation', verifyAuth, authorizeRoles('Admin', 'Manager'), cancelReservation);

export default router;

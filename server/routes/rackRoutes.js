import express from 'express';
import { listRacks, getRack, addRack, updateRack, deleteRack, moveRack } from '../controllers/rackController.js';
import { authorizeRoles, verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();
const manager = [verifyAuth, authorizeRoles('Admin', 'Manager')];

router.get('/racks', verifyAuth, listRacks);          // ทุก role ดูผังได้
router.get('/racks/:id', verifyAuth, getRack);
router.post('/racks', ...manager, addRack);
router.put('/racks/:id/move', ...manager, moveRack);   // ย้ายข้ามห้อง/ข้ามคลัง — ต้องมาก่อน :id
router.put('/racks/:id', ...manager, updateRack);
router.delete('/racks/:id', ...manager, deleteRack);

export default router;

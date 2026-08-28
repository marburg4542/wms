import express from 'express';
import { listRooms, addRoom, updateRoom, deleteRoom } from '../controllers/roomController.js';
import { authorizeRoles, verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();
const manager = [verifyAuth, authorizeRoles('Admin', 'Manager')];

router.get('/rooms', verifyAuth, listRooms);   // ทุก role ดูผังได้
router.post('/rooms', ...manager, addRoom);
router.put('/rooms/:id', ...manager, updateRoom);
router.delete('/rooms/:id', ...manager, deleteRoom);

export default router;

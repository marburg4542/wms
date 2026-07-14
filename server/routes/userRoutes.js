import express from 'express';
import { getUsersList, deleteUser, updateUserStatus, updateUserRole, updateProfile } from '../controllers/userController.js';
import { authorizeRoles, verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/users', verifyAuth, authorizeRoles('Admin'), getUsersList);
router.delete('/users/:id', verifyAuth, authorizeRoles('Admin'), deleteUser);
router.put('/users/:id/status', verifyAuth, authorizeRoles('Admin'), updateUserStatus);
router.put('/users/:id/role', verifyAuth, authorizeRoles('Admin'), updateUserRole);
router.put('/update-profile', verifyAuth, updateProfile);

export default router;

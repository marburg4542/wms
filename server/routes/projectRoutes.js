import express from 'express';
import { listProjects, addProject, deleteProject } from '../controllers/projectController.js';
import { authorizeRoles, verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/projects', verifyAuth, listProjects);                                          // ทุก role อ่านได้ (ใช้ตอนเบิก)
router.post('/projects', verifyAuth, authorizeRoles('Admin', 'Manager'), addProject);       // เพิ่ม = ผู้จัดการขึ้นไป
router.delete('/projects/:id', verifyAuth, authorizeRoles('Admin', 'Manager'), deleteProject);

export default router;

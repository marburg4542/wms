import express from 'express';
import {
  bulkImportProducts,
  createProduct,
  deleteProduct,
  getDashboardStats,
  getProductGroups,
  getProducts,
  permanentlyDeleteProduct,
  restoreProduct,
  updateProduct
} from '../controllers/productController.js';
import { authorizeRoles, verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();
router.get('/products', verifyAuth, getProducts);
router.get('/product-groups', verifyAuth, getProductGroups);
router.post('/products', verifyAuth, authorizeRoles('Admin', 'Manager'), createProduct);
router.put('/products/:id', verifyAuth, authorizeRoles('Admin', 'Manager'), updateProduct);
// Manager มีสิทธิ์จัดการสินค้าเท่า Admin ทุกอย่าง (เหลือเฉพาะจัดการผู้ใช้ที่เป็นของ Admin)
router.delete('/products/:id', verifyAuth, authorizeRoles('Admin', 'Manager'), deleteProduct);
router.put('/products/:id/restore', verifyAuth, authorizeRoles('Admin', 'Manager'), restoreProduct);
router.delete('/products/:id/permanent', verifyAuth, authorizeRoles('Admin', 'Manager'), permanentlyDeleteProduct);
router.post('/products/import', verifyAuth, authorizeRoles('Admin', 'Manager'), bulkImportProducts);
router.get('/wms/dashboard-stats', verifyAuth, getDashboardStats);

export default router;

import express from 'express';
import {
  bulkImportProducts,
  createProduct,
  deleteProduct,
  getDashboardStats,
  getNextSku,
  getPriceHistory,
  getProductGroups,
  getProducts,
  permanentlyDeleteProduct,
  restoreProduct,
  updateProduct
} from '../controllers/productController.js';
import { addCategory, deleteCategory, mergeCategories, resequenceCategories, resequenceSkus } from '../controllers/categoryController.js';
import { authorizeRoles, verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();
const manager = [verifyAuth, authorizeRoles('Admin', 'Manager')];
router.get('/products', verifyAuth, getProducts);
router.get('/products/next-sku', verifyAuth, getNextSku);
router.get('/products/:id/price-history', verifyAuth, getPriceHistory);
router.get('/product-groups', verifyAuth, getProductGroups);
// จัดการหมวดหมู่ (Admin/Manager) — merge ต้องมาก่อน :id
router.post('/product-groups/merge', ...manager, mergeCategories);
router.post('/product-groups/resequence', ...manager, resequenceCategories);
router.post('/product-groups', ...manager, addCategory);
router.delete('/product-groups/:id', ...manager, deleteCategory);
router.post('/products', verifyAuth, authorizeRoles('Admin', 'Manager'), createProduct);
router.put('/products/:id', verifyAuth, authorizeRoles('Admin', 'Manager'), updateProduct);
// Manager มีสิทธิ์จัดการสินค้าเท่า Admin ทุกอย่าง (เหลือเฉพาะจัดการผู้ใช้ที่เป็นของ Admin)
router.delete('/products/:id', verifyAuth, authorizeRoles('Admin', 'Manager'), deleteProduct);
router.put('/products/:id/restore', verifyAuth, authorizeRoles('Admin', 'Manager'), restoreProduct);
router.delete('/products/:id/permanent', verifyAuth, authorizeRoles('Admin', 'Manager'), permanentlyDeleteProduct);
router.post('/products/import', verifyAuth, authorizeRoles('Admin', 'Manager'), bulkImportProducts);
// จัดเรียงเลขรัน SKU ให้ต่อเนื่อง (Admin/Manager) — ใช้ช่วงพัฒนาหลังลบ/ย้ายสินค้าจนรหัสมีช่องว่าง
router.post('/products/resequence-skus', ...manager, resequenceSkus);
router.get('/wms/dashboard-stats', verifyAuth, getDashboardStats);

export default router;

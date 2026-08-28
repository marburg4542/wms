import express from 'express';
import { listPlans, addPlan, renamePlan, deletePlan } from '../controllers/floorPlanController.js';
import { listMarkers, addMarker, updateMarker, deleteMarker } from '../controllers/markerController.js';
import { reorderLayers } from '../controllers/storageMapController.js';
import {
  bulkUpdateComponents,
  groupComponents,
  layoutMeta,
  listStorageHistory,
  listTrash,
  listVersions,
  publishPlan,
  restoreTrash,
  restoreVersion,
  trashComponents,
  ungroupComponents
} from '../controllers/storageWorkflowController.js';
import { assignItemLocation, getLocationsOfItem, getPickList, listUnassignedItems, moveItemQuantity } from '../controllers/storageItemController.js';
import { authorizeRoles, verifyAuth } from '../middleware/authMiddleware.js';

const router = express.Router();
const manager = [verifyAuth, authorizeRoles('Admin', 'Manager')];

// คลัง (floor plans)
router.get('/floor-plans', verifyAuth, listPlans);
router.post('/floor-plans', ...manager, addPlan);
router.put('/floor-plans/:id', ...manager, renamePlan);
router.delete('/floor-plans/:id', ...manager, deletePlan);

// สัญลักษณ์
router.get('/markers', verifyAuth, listMarkers);
router.post('/markers', ...manager, addMarker);
router.put('/markers/:id', ...manager, updateMarker);
router.delete('/markers/:id', ...manager, deleteMarker);

// ลำดับ layer แบบรวม room/rack/marker ในผังหรือห้องเดียวกัน
router.put('/storage-map/layers', ...manager, reorderLayers);
router.put('/storage-map/bulk', ...manager, bulkUpdateComponents);
router.put('/storage-map/groups', ...manager, groupComponents);
router.delete('/storage-map/groups', ...manager, ungroupComponents);
router.get('/storage-map/trash', ...manager, listTrash);
router.post('/storage-map/trash', ...manager, trashComponents);
router.post('/storage-map/trash/restore', ...manager, restoreTrash);

// ตำแหน่งจัดเก็บของสินค้า — เส้นทางหยิบตามใบเบิก / รายการที่ยังไม่ระบุตำแหน่ง / ผูกสินค้าเข้าชั้น
router.get('/storage-map/pick-list/:txId', ...manager, getPickList);
router.get('/storage-map/unassigned', ...manager, listUnassignedItems);
router.post('/storage-map/assign', ...manager, assignItemLocation);
router.get('/storage-map/locations/:sku', verifyAuth, getLocationsOfItem);   // ทุก role ดูได้ว่าของอยู่ที่ไหนบ้าง
router.post('/storage-map/move-quantity', ...manager, moveItemQuantity);     // ย้ายของบางส่วนข้ามตำแหน่ง

router.get('/floor-plans/:id/layout-meta', verifyAuth, layoutMeta);
router.get('/floor-plans/:id/versions', verifyAuth, listVersions);
router.post('/floor-plans/:id/publish', ...manager, publishPlan);
router.post('/floor-plans/:id/versions/:versionId/restore', ...manager, restoreVersion);
router.get('/floor-plans/:id/history', ...manager, listStorageHistory);

export default router;

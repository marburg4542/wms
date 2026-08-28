import db, { logAudit } from '../db.js';
import { applyLayerOrder, StorageValidationError } from '../utils/storageLayout.js';
import { touchPlan } from '../utils/storageWorkflow.js';

export const reorderLayers = (req, res) => {
  try {
    const layers = applyLayerOrder(db, req.body?.scope, req.body?.order);
    const planId = req.body?.scope?.planId || db.prepare('SELECT plan_id FROM rooms WHERE id = ?').get(req.body?.scope?.roomId)?.plan_id;
    touchPlan(db, planId);
    logAudit(req.user?.username, 'storage.layers_reorder', 'storage_map', null, {
      scope: req.body?.scope, planId,
      count: layers.length
    });
    return res.json({ success: true, layers });
  } catch (err) {
    const status = err instanceof StorageValidationError ? err.statusCode : 500;
    if (status === 500) console.error('reorderLayers error:', err);
    return res.status(status).json({
      success: false,
      code: err.code || 'STORAGE_LAYOUT_ERROR',
      message: status === 500 ? 'Database error' : err.message
    });
  }
};

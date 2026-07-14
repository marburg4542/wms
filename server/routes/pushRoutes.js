import express from 'express';
import { verifyAuth } from '../middleware/authMiddleware.js';
import { getPublicKey, saveSubscription, isPushEnabled } from '../push.js';

const router = express.Router();

// ให้ frontend ดึง VAPID public key ไปสมัคร push
router.get('/push/public-key', verifyAuth, (req, res) => {
  res.json({ success: true, enabled: isPushEnabled(), publicKey: getPublicKey() });
});

// รับ subscription จากเบราว์เซอร์มาเก็บ (ผูกกับผู้ใช้ที่ login)
router.post('/push/subscribe', verifyAuth, (req, res) => {
  try {
    saveSubscription(req.user.username, req.body.subscription);
    res.json({ success: true });
  } catch (err) {
    console.error('push subscribe error:', err);
    res.status(500).json({ success: false });
  }
});

export default router;

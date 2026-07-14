import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authorizeRoles, verifyAuth } from './middleware/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, filename);
  }
});

// อนุญาตเฉพาะไฟล์รูปภาพเท่านั้น
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, and WEBP images are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // จำกัดขนาดไฟล์สูงสุดที่ 5MB
  }
});

// รับไฟล์จาก field ที่กำหนด แล้วตอบกลับเป็น URL ของไฟล์ที่อัปโหลด
const handleUpload = (fieldName) => (req, res) => {
  upload.single(fieldName)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'ขนาดไฟล์ใหญ่เกินไป (ต้องไม่เกิน 5MB)' });
      }
      return res.status(400).json({ success: false, message: err.message });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'ไม่มีไฟล์ถูกอัปโหลด' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    return res.json({ success: true, fileUrl });
  });
};

// POST /api/upload-avatar — รูปโปรไฟล์ผู้ใช้
router.post('/upload-avatar', verifyAuth, handleUpload('avatar'));

// POST /api/upload-product-image — รูปสินค้า (เฉพาะผู้มีสิทธิ์จัดการสินค้า)
router.post('/upload-product-image', verifyAuth, authorizeRoles('Admin', 'Manager'), handleUpload('image'));

export default router;

import { Router } from 'express';
import { createRateLimiter } from '../lib/rateLimit.js';
import { createImageUploadSignature } from '../lib/imageUploads.js';

const router = Router();
const imageSignatureRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 24 });

router.get('/image-signature', imageSignatureRateLimiter, (req, res) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(503).json({ message: '尚未設定 Cloudinary 圖片上傳服務' });
  }

  return res.json(createImageUploadSignature({ cloudName, apiKey, apiSecret }));
});

export default router;

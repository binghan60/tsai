import { Router } from 'express';
import crypto from 'node:crypto';

const router = Router();
const IMAGE_FOLDER = 'tsai-medical-records';

router.get('/image-signature', (req, res) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(503).json({ message: '尚未設定 Cloudinary 圖片上傳服務' });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash('sha1')
    .update(`folder=${IMAGE_FOLDER}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex');
  return res.json({ cloudName, apiKey, timestamp, folder: IMAGE_FOLDER, signature });
});

export default router;

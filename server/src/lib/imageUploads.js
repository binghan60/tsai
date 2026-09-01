import crypto from 'node:crypto';

export const IMAGE_FOLDER = 'tsai-medical-records';
export const MAX_IMAGES_PER_FIELD = 12;
export const IMAGE_FORMATS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];

function signatureFor(params, apiSecret) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return crypto.createHash('sha1').update(`${serialized}${apiSecret}`).digest('hex');
}

export function createImageUploadSignature({ cloudName, apiKey, apiSecret }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `image-${crypto.randomUUID()}`;
  const params = {
    allowed_formats: IMAGE_FORMATS.join(','),
    folder: IMAGE_FOLDER,
    overwrite: false,
    public_id: publicId,
    timestamp,
  };
  return { cloudName, apiKey, ...params, signature: signatureFor(params, apiSecret) };
}

function invalidImage(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

function imageUrlIsAllowed(value, cloudName) {
  try {
    const url = new URL(value);
    const prefix = `/${cloudName}/image/upload/${IMAGE_FOLDER}/`;
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' && url.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

export function sanitizeImageValue(value, { cloudName = process.env.CLOUDINARY_CLOUD_NAME } = {}) {
  if (!Array.isArray(value) || value.length > MAX_IMAGES_PER_FIELD) {
    throw invalidImage(`圖片欄位最多只能有 ${MAX_IMAGES_PER_FIELD} 張圖片`);
  }
  if (!cloudName) throw invalidImage('尚未設定 Cloudinary 圖片上傳服務');

  return value.map((image) => {
    if (!image || typeof image !== 'object' || !imageUrlIsAllowed(image.url, cloudName)) {
      throw invalidImage('圖片來源不合法');
    }
    const publicId = String(image.publicId ?? '');
    if (!publicId.startsWith(`${IMAGE_FOLDER}/image-`)) throw invalidImage('圖片識別碼不合法');
    const span = Number(image.span);
    return {
      url: image.url,
      publicId,
      width: Number.isInteger(image.width) && image.width > 0 ? image.width : undefined,
      height: Number.isInteger(image.height) && image.height > 0 ? image.height : undefined,
      format: IMAGE_FORMATS.includes(String(image.format).toLowerCase()) ? String(image.format).toLowerCase() : undefined,
      span: [4, 6, 12].includes(span) ? span : 12,
    };
  });
}

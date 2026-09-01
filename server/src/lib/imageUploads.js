import crypto from 'node:crypto';

export const DEFAULT_IMAGE_FOLDER = 'tsai-medical-records';
export const MAX_IMAGES_PER_FIELD = 12;
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const IMAGE_FORMATS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];

export function configuredImageFolder(value = process.env.CLOUDINARY_IMAGE_FOLDER) {
  const folder = String(value ?? '').trim() || DEFAULT_IMAGE_FOLDER;
  if (!/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(folder)) {
    throw new Error('CLOUDINARY_IMAGE_FOLDER 格式不合法');
  }
  return folder;
}

function signatureFor(params, apiSecret) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return crypto.createHash('sha1').update(`${serialized}${apiSecret}`).digest('hex');
}

export function createImageUploadSignature({ cloudName, apiKey, apiSecret, uploadPreset, folder = configuredImageFolder() }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `image-${crypto.randomUUID()}`;
  // Cloudinary 不會把 max_file_size 納入 upload API 的簽章字串；把它放進去會造成
  // 前端送出的簽章與 Cloudinary 重算結果不同。大小限制由前端及 upload preset 強制。
  const params = {
    allowed_formats: IMAGE_FORMATS.join(','),
    folder,
    overwrite: false,
    public_id: publicId,
    timestamp,
    upload_preset: uploadPreset,
  };
  return {
    cloudName,
    apiKey,
    ...params,
    max_file_size: MAX_IMAGE_UPLOAD_BYTES,
    signature: signatureFor(params, apiSecret),
  };
}

function invalidImage(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

function imageUrlIsAllowed(value, cloudName, publicId) {
  try {
    const url = new URL(value);
    const escapedCloudName = encodeURIComponent(cloudName);
    const escapedPublicId = publicId.split('/').map(encodeURIComponent).join('/');
    // Cloudinary 的 secure_url 預設會帶資產版本（/v123/...）；舊資料可能沒有版本，
    // 所以兩種格式都接受，但 URL 必須剛好指向回傳的 public_id。
    const prefix = `/${escapedCloudName}/image/upload/`;
    if (!url.pathname.startsWith(prefix)) return false;
    const assetPath = url.pathname.slice(prefix.length).replace(/^v\d+\//, '');
    const extensionAt = assetPath.lastIndexOf('.');
    return url.protocol === 'https:'
      && url.hostname === 'res.cloudinary.com'
      && !url.search
      && !url.hash
      && extensionAt > 0
      && assetPath.slice(0, extensionAt) === escapedPublicId
      && /^[a-z0-9]+$/i.test(assetPath.slice(extensionAt + 1));
  } catch {
    return false;
  }
}

export function sanitizeImageValue(value, {
  cloudName = process.env.CLOUDINARY_CLOUD_NAME,
  folder = configuredImageFolder(),
} = {}) {
  if (!Array.isArray(value) || value.length > MAX_IMAGES_PER_FIELD) {
    throw invalidImage(`圖片欄位最多只能有 ${MAX_IMAGES_PER_FIELD} 張圖片`);
  }
  if (!cloudName) throw invalidImage('尚未設定 Cloudinary 圖片上傳服務');

  return value.map((image) => {
    if (!image || typeof image !== 'object') throw invalidImage('圖片來源不合法');
    const publicId = String(image.publicId ?? '');
    if (!publicId.startsWith(`${folder}/image-`) || !/^image-[0-9a-f-]{36}$/i.test(publicId.slice(folder.length + 1))) {
      throw invalidImage('圖片識別碼不合法');
    }
    if (!imageUrlIsAllowed(image.url, cloudName, publicId)) throw invalidImage('圖片來源不合法');
    const span = Number(image.span);
    const caption = typeof image.caption === 'string' ? image.caption.trim().slice(0, 500) : '';
    return {
      url: image.url,
      publicId,
      width: Number.isInteger(image.width) && image.width > 0 ? image.width : undefined,
      height: Number.isInteger(image.height) && image.height > 0 ? image.height : undefined,
      format: IMAGE_FORMATS.includes(String(image.format).toLowerCase()) ? String(image.format).toLowerCase() : undefined,
      span: [4, 6, 12].includes(span) ? span : 12,
      ...(caption ? { caption } : {}),
    };
  });
}

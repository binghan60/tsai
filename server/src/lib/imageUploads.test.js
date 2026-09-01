import assert from 'node:assert/strict';
import test from 'node:test';
import { createImageUploadSignature, sanitizeImageValue } from './imageUploads.js';

const cloudName = 'clinic';
const validImage = {
  url: 'https://res.cloudinary.com/clinic/image/upload/tsai-medical-records/image-123.webp',
  publicId: 'tsai-medical-records/image-123',
  width: 800,
  height: 600,
  format: 'webp',
  span: 6,
};

test('image upload signature binds a unique public ID and allowed formats', () => {
  const signature = createImageUploadSignature({ cloudName, apiKey: 'key', apiSecret: 'secret' });
  assert.match(signature.public_id, /^image-[0-9a-f-]{36}$/);
  assert.equal(signature.folder, 'tsai-medical-records');
  assert.equal(signature.overwrite, false);
  assert.equal(signature.allowed_formats, 'webp,png,jpg,jpeg,gif');
  assert.match(signature.signature, /^[0-9a-f]{40}$/);
});

test('sanitizeImageValue only accepts the configured Cloudinary image folder', () => {
  assert.deepEqual(sanitizeImageValue([validImage], { cloudName }), [validImage]);
  assert.throws(
    () => sanitizeImageValue([{ ...validImage, url: 'http://127.0.0.1:3000/private' }], { cloudName }),
    { message: '圖片來源不合法', status: 422 }
  );
  assert.throws(
    () => sanitizeImageValue(Array.from({ length: 13 }, () => validImage), { cloudName }),
    { message: '圖片欄位最多只能有 12 張圖片', status: 422 }
  );
});

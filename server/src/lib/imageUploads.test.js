import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredImageFolder, createImageUploadSignature, sanitizeImageValue } from './imageUploads.js';

const cloudName = 'clinic';
const uploadPreset = 'tsai-medical-record-images';
const validImage = {
  url: 'https://res.cloudinary.com/clinic/image/upload/v123/tsai-medical-records/image-12345678-1234-1234-1234-1234567890ab.webp',
  publicId: 'tsai-medical-records/image-12345678-1234-1234-1234-1234567890ab',
  width: 800,
  height: 600,
  format: 'webp',
  span: 6,
};

test('image upload signature binds a unique public ID, upload preset and allowed formats', () => {
  const signature = createImageUploadSignature({ cloudName, apiKey: 'key', apiSecret: 'secret', uploadPreset });
  assert.match(signature.public_id, /^image-[0-9a-f-]{36}$/);
  assert.equal(signature.folder, 'tsai-medical-records');
  assert.equal(signature.overwrite, false);
  assert.equal(signature.allowed_formats, 'webp,png,jpg,jpeg,gif');
  assert.equal(signature.max_file_size, 10 * 1024 * 1024);
  assert.equal(signature.upload_preset, uploadPreset);
  assert.match(signature.signature, /^[0-9a-f]{40}$/);
});

test('image folder defaults safely and supports an environment-specific folder', () => {
  assert.equal(configuredImageFolder(''), 'tsai-medical-records');
  assert.equal(configuredImageFolder('tsai-medical-records-test'), 'tsai-medical-records-test');
  assert.throws(() => configuredImageFolder('../private'), { message: 'CLOUDINARY_IMAGE_FOLDER 格式不合法' });
});

test('sanitizeImageValue only accepts the configured Cloudinary image folder', () => {
  assert.deepEqual(sanitizeImageValue([validImage], { cloudName }), [validImage]);
  assert.deepEqual(sanitizeImageValue([{ ...validImage, url: validImage.url.replace('/v123', '') }], { cloudName }), [{ ...validImage, url: validImage.url.replace('/v123', '') }]);
  assert.throws(
    () => sanitizeImageValue([{ ...validImage, url: 'http://127.0.0.1:3000/private' }], { cloudName }),
    { message: '圖片來源不合法', status: 422 }
  );
  const testFolder = 'tsai-medical-records-test';
  const testImage = {
    ...validImage,
    url: validImage.url.replaceAll('tsai-medical-records', testFolder),
    publicId: validImage.publicId.replace('tsai-medical-records', testFolder),
  };
  assert.deepEqual(sanitizeImageValue([testImage], { cloudName, folder: testFolder }), [testImage]);
  assert.throws(
    () => sanitizeImageValue([{ ...validImage, url: validImage.url.replace('12345678-1234-1234-1234-1234567890ab', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') }], { cloudName }),
    { message: '圖片來源不合法', status: 422 }
  );
  assert.throws(
    () => sanitizeImageValue(Array.from({ length: 13 }, () => validImage), { cloudName }),
    { message: '圖片欄位最多只能有 12 張圖片', status: 422 }
  );
});

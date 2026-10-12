import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gzipSync } from 'node:zlib';
import express from 'express';
import { precompressedAssets } from './precompressedAssets.js';

describe('precompressedAssets', () => {
  const source = 'console.log("健檢報告");'.repeat(200);
  let dir;
  let server;
  let origin;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precompressed-'));
    fs.writeFileSync(path.join(dir, 'app-abc.js'), source);
    fs.writeFileSync(path.join(dir, 'app-abc.js.br'), brotliCompressSync(source));
    fs.writeFileSync(path.join(dir, 'app-abc.js.gz'), gzipSync(source));
    fs.writeFileSync(path.join(dir, 'font.woff2'), 'woff2');
    const app = express();
    app.use('/assets', precompressedAssets(dir), express.static(dir));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // fetch 會自動解壓縮；用 node:http 才看得到原始回應。
  async function rawGet(pathname, acceptEncoding) {
    const { request } = await import('node:http');
    return new Promise((resolve, reject) => {
      const req = request(`${origin}${pathname}`, { headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {} }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('瀏覽器收得了 Brotli 就送 .br，內容類型照原檔、長期快取', async () => {
    const res = await rawGet('/assets/app-abc.js', 'gzip, deflate, br');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'br');
    assert.match(res.headers['content-type'], /javascript/);
    assert.match(res.headers['cache-control'], /immutable/);
    assert.match(res.headers.vary, /Accept-Encoding/);
    assert.equal(brotliDecompressSync(res.body).toString(), source);
  });

  it('只收 gzip 就送 .gz，都不收就送原檔', async () => {
    assert.equal((await rawGet('/assets/app-abc.js', 'gzip')).headers['content-encoding'], 'gzip');
    const plain = await rawGet('/assets/app-abc.js', '');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), source);
  });

  it('沒有壓好的檔（字型）、跑出資料夾的路徑都交給後面處理', async () => {
    const font = await rawGet('/assets/font.woff2', 'br');
    assert.equal(font.status, 200);
    assert.equal(font.headers['content-encoding'], undefined);
    const escaped = await rawGet('/assets/..%2F..%2Fetc%2Fpasswd', 'br');
    assert.notEqual(escaped.headers['content-encoding'], 'br');
  });
});

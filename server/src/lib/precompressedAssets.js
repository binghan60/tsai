import fs from 'node:fs';
import path from 'node:path';

// 前端 build 時已經把 /assets 裡的 JS／CSS 壓成 .br 與 .gz（client/scripts/precompress.mjs）。
// 瀏覽器說它收得了就送壓好的那份，收不了或沒有壓好的檔就交給後面的 express.static 送原檔。
// 正式機只有 1 CPU、Zeabur 前面也不壓縮，所以不在請求當下壓：檔名帶 hash、內容不會變，build 時壓一次就好。
const ENCODINGS = [['br', '.br'], ['gzip', '.gz']];

export function precompressedAssets(assetsDir) {
  const root = path.resolve(assetsDir);
  // 同一次部署裡檔案不會變，查過有沒有壓好的檔就記住，不必每個請求都去碰檔案系統。
  const known = new Map();
  const exists = (file) => {
    if (!known.has(file)) known.set(file, fs.existsSync(file));
    return known.get(file);
  };

  return function servePrecompressed(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let relative;
    try {
      relative = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    const file = path.join(root, relative);
    // 擋掉 ../ 之類跑出資料夾的路徑。
    if (!file.startsWith(root + path.sep)) return next();
    const variants = ENCODINGS.filter(([, ext]) => exists(file + ext));
    if (!variants.length) return next();

    // 同一個網址會依 Accept-Encoding 回不同內容，快取要分開存。
    res.vary('Accept-Encoding');
    // 照我們的順序挑（Brotli 比 gzip 小）：瀏覽器的 Accept-Encoding 通常是「gzip, deflate, br」，
    // 一起問 acceptsEncodings 會照瀏覽器列的順序回 gzip，Brotli 永遠用不到。
    const match = variants.find(([name]) => req.acceptsEncodings(name) === name);
    if (!match) return next();

    // Content-Type 照原檔的副檔名（不然 .br 會被當成二進位檔下載）；sendFile 看到已經設了就不會改。
    res.type(path.extname(file));
    res.set('Content-Encoding', match[0]);
    res.sendFile(file + match[1], { maxAge: '1y', immutable: true }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  };
}

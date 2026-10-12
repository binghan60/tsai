// build 完之後把 dist/assets 裡的 JS／CSS／SVG 先壓好（.br 與 .gz），伺服器直接送壓好的檔（server/src/app.js）。
// 為什麼不在伺服器上即時壓縮：正式機只有 1 CPU，每次請求都壓一次要搶 CPU；這些檔名帶 hash、內容不會變，
// build 時壓一次就好，還能用 Brotli 最高等級（即時壓縮用不起）。Zeabur 前面不會幫忙壓縮。
// 字型（woff2）、圖片本身已經壓過，不處理。只用 Node 內建的 zlib，不多裝套件。
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const assetsDir = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const COMPRESSIBLE = /\.(js|css|svg|json)$/;
// 太小的檔壓了也省不了幾個位元組，多一個檔反而麻煩。
const MIN_BYTES = 1024;

let original = 0;
let brotli = 0;
let count = 0;
for (const name of await readdir(assetsDir)) {
  if (!COMPRESSIBLE.test(name)) continue;
  const file = join(assetsDir, name);
  const source = await readFile(file);
  if (source.length < MIN_BYTES) continue;
  const br = brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    },
  });
  const gz = gzipSync(source, { level: 9 });
  await writeFile(`${file}.br`, br);
  await writeFile(`${file}.gz`, gz);
  original += source.length;
  brotli += br.length;
  count += 1;
}
console.log(`precompress: ${count} 個檔，${(original / 1024).toFixed(0)} KB → Brotli ${(brotli / 1024).toFixed(0)} KB`);

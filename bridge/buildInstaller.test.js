import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FILES_PLACEHOLDER, INSTALLED_FILES, buildInstaller, normalizePreset } from './buildInstaller.mjs';

const MARKER = '#__PS_' + 'BEGIN__';
const template = readFileSync(new URL('./setupTemplate.ps1', import.meta.url), 'utf8');
const files = Object.fromEntries(INSTALLED_FILES.map((name) => [name, readFileSync(new URL(`./${name}`, import.meta.url))]));
const installer = buildInstaller(template, files);

describe('buildInstaller：單一安裝檔', () => {
  it('開頭那段 cmd 只有 ASCII、沒有 BOM——cmd 用系統字碼頁讀檔，中文或 BOM 都會讓第一行壞掉', () => {
    assert.ok(installer.startsWith('@echo off\r\n'));
    const header = installer.slice(0, installer.indexOf(MARKER));
    assert.match(header, /^[\x00-\x7f]+$/);
  });

  it('PowerShell 的起點標記只出現一次：開頭那行 cmd 靠它找到要執行的部分', () => {
    assert.equal(installer.split(MARKER).length, 2);
  });

  it('程式檔案原封不動包在裡面（.ps1 的 BOM 也要留著，PowerShell 5.1 才讀得懂中文）', () => {
    for (const name of INSTALLED_FILES) {
      const encoded = new RegExp(`'${name.replace('.', '\\.')}' = '([A-Za-z0-9+/=]+)'`).exec(installer)?.[1];
      assert.ok(encoded, `${name} 沒有包進去`);
      assert.deepEqual(Buffer.from(encoded, 'base64'), files[name]);
    }
    assert.equal(files['install.ps1'][0], 0xef, 'install.ps1 要存成 UTF-8 with BOM');
  });

  it('不包含設定檔與密鑰：密鑰是安裝時在診所電腦上輸入的', () => {
    assert.equal(INSTALLED_FILES.includes('idexx-bridge.config.json'), false);
    assert.equal(installer.includes(FILES_PLACEHOLDER), false);
  });

  it('範本少了放檔案的位置就報錯，不產生壞掉的安裝檔', () => {
    assert.throws(() => buildInstaller('Write-Host hi', files), /#__FILES__/);
  });

  it('沒有預設值時 $preset 是空的，安裝時改用問的', () => {
    assert.match(installer, /\$preset = @\{\r\n\r\n\}/);
  });

  it('預設值放進安裝檔；單引號與 $ 都照字面保留，不會被當成程式', () => {
    const token = "ab'c$&d".padEnd(32, 'x');
    const withPreset = buildInstaller(template, files, normalizePreset({ serverUrl: 'https://clinic.example/', token }));
    assert.ok(withPreset.includes("serverUrl = 'https://clinic.example'"));
    assert.ok(withPreset.includes(`token = 'ab''c$&d${'x'.repeat(25)}'`));
  });

  it('預設值檔案寫錯在打包時就擋下', () => {
    assert.throws(() => normalizePreset({ url: 'https://x' }), /不認得的欄位：url/);
    assert.throws(() => normalizePreset({ serverUrl: 'clinic.example' }), /http/);
    assert.throws(() => normalizePreset({ token: 'short' }), /32/);
    assert.deepEqual(normalizePreset({ serverUrl: ' https://x/ ', name: '' }), { serverUrl: 'https://x' });
  });
});

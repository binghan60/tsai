// 產生單一安裝檔 dist/IDEXX-Bridge-Setup.cmd：把抓檔程式、install.ps1 等檔案（base64）連同安裝流程
// （setupTemplate.ps1）合成一個檔案，傳到診所電腦點兩下就設定完成，不用手動複製資料夾、建設定檔、開管理員視窗。
//
// 用法：npm run build:installer。改了 bridge 裡的任何程式都要重新產生。
// 產出的檔案不含密鑰（密鑰是安裝時在診所電腦上輸入的），dist/ 不進版控。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 安裝到診所電腦的檔案。設定檔不在裡面——安裝時依輸入的內容產生。
// uninstall.cmd／status.cmd 是給人點兩下用的（自己要求管理員權限、跑完停住），只能有 ASCII。
export const INSTALLED_FILES = ['idexxBridge.js', 'package.json', 'install.ps1', 'uninstall.ps1', 'uninstall.cmd', 'status.ps1', 'status.cmd'];
export const FILES_PLACEHOLDER = '$files = @{} #__FILES__';
// 寫成兩段：開頭那行 cmd 要用這個標記找到 PowerShell 的起點，標記本身不能先出現在那行裡。
const MARKER = '#__PS_' + 'BEGIN__';

// 開頭這段是 cmd：只能有 ASCII（cmd 用系統字碼頁讀檔，中文會壞），檔案也不能有 BOM。
// 它把自己用 UTF-8 讀進來、從標記之後當成 PowerShell 執行；離開碼 99＝已經另開管理員視窗，這個視窗直接關。
const CMD_HEADER = [
  '@echo off',
  'chcp 65001 >nul',
  'title IDEXX Bridge Setup',
  `powershell -NoProfile -ExecutionPolicy Bypass -Command "$setupFile='%~f0'; $s=[IO.File]::ReadAllText($setupFile,[Text.Encoding]::UTF8); Invoke-Expression $s.Substring($s.IndexOf('#__PS_'+'BEGIN__'))"`,
  'if %errorlevel%==99 exit /b',
  'echo.',
  'pause',
  'exit /b',
  '',
].join('\r\n');

export const PRESET_PLACEHOLDER = '$preset = @{} #__PRESET__';
// 可以預先放進安裝檔的設定。有 serverUrl 與 token 時安裝檔就全自動、不問任何問題。
const PRESET_KEYS = ['serverUrl', 'token', 'resultsDir', 'name'];

// 預設值檔案（installer.preset.json）的檢查：打錯欄位名、密鑰太短都在打包時就擋下，不要等到診所才發現。
export function normalizePreset(raw) {
  const preset = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!PRESET_KEYS.includes(key)) throw new Error(`installer.preset.json 有不認得的欄位：${key}（可用：${PRESET_KEYS.join('、')}）`);
    const text = String(value ?? '').trim();
    if (text) preset[key] = key === 'serverUrl' ? text.replace(/\/+$/, '') : text;
  }
  if (preset.serverUrl && !/^https?:\/\//.test(preset.serverUrl)) throw new Error('installer.preset.json 的 serverUrl 要以 http:// 或 https:// 開頭');
  if (preset.token && preset.token.length < 32) throw new Error('installer.preset.json 的 token 至少 32 個字元');
  return preset;
}

// PowerShell 單引號字串：裡面的單引號要寫成兩個。
const psString = (value) => `'${String(value).replace(/'/g, "''")}'`;

export function buildInstaller(template, files, preset = {}) {
  if (!template.includes(FILES_PLACEHOLDER)) throw new Error('setupTemplate.ps1 少了放檔案的位置（#__FILES__）');
  if (!template.includes(PRESET_PLACEHOLDER)) throw new Error('setupTemplate.ps1 少了放預設值的位置（#__PRESET__）');
  const entries = Object.entries(files).map(([name, bytes]) => `  '${name}' = '${Buffer.from(bytes).toString('base64')}'`);
  const presetEntries = Object.entries(preset).map(([key, value]) => `  ${key} = ${psString(value)}`);
  // 用函式當 replace 的第二個參數：字串形式會把密鑰裡的 $& 之類當成特殊符號。
  const body = template
    .replace(/^﻿/, '')
    .replace(FILES_PLACEHOLDER, () => `$files = @{\n${entries.join('\n')}\n}`)
    .replace(PRESET_PLACEHOLDER, () => `$preset = @{\n${presetEntries.join('\n')}\n}`);
  return `${CMD_HEADER}${MARKER}\r\n${body.replace(/\r?\n/g, '\r\n')}`;
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = {};
  for (const name of INSTALLED_FILES) files[name] = await readFile(path.join(here, name));
  const template = await readFile(path.join(here, 'setupTemplate.ps1'), 'utf8');
  // installer.preset.json（不進版控）：預先放好網址與密鑰，診所點兩下就裝完、不用輸入任何東西。
  let preset = {};
  try {
    preset = normalizePreset(JSON.parse((await readFile(path.join(here, 'installer.preset.json'), 'utf8')).replace(/^﻿/, '')));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const outDir = path.join(here, 'dist');
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'IDEXX-Bridge-Setup.cmd');
  // 不能有 BOM：cmd 會把 BOM 當成第一行的一部分，@echo off 就壞了。
  await writeFile(outFile, buildInstaller(template, files, preset), 'utf8');
  console.log(`已產生 ${outFile}`);
  if (preset.serverUrl && preset.token) {
    console.log(`全自動安裝：上傳到 ${preset.serverUrl}，診所點兩下、按一次權限視窗的「是」就裝完。`);
    console.log('⚠ 這個安裝檔裡有密鑰：只傳給診所那台電腦，裝完就刪掉，不要放在群組或雲端硬碟。');
    console.log('  萬一外流：換一組 IDEXX_BRIDGE_TOKEN、改 installer.preset.json、重新產生再裝一次。');
  } else {
    console.log('沒有 installer.preset.json（或缺網址／密鑰）：安裝時會詢問設定。要全自動請照 installer.preset.example.json 建一份。');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

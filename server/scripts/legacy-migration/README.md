# 舊系統資料遷移

只遷移 `Data/RegData.mdb::RecordData`（飼主/寵物主檔 + 逐年累加的病歷全文）。其餘舊系統資料庫（收費、庫存、藥局、診斷字典、疫苗提醒等）盤點後確認沒有實際使用紀錄，不遷移。

## 階段 A：抽取（PowerShell，一次性，僅限這台開發機）

這台機器只裝了 32-bit 的 Jet ODBC 驅動（`Microsoft Access Driver (*.mdb)`），Node.js 是 64-bit 讀不到，所以要用系統內建的 32-bit PowerShell 執行：

```
& 'C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe' -NonInteractive -ExecutionPolicy Bypass -File extract-recorddata.ps1
```

輸出 `legacy-recorddata-export.jsonl`（含真實個資，已在 `.gitignore` 排除，不會進 git）。

## 階段 B：匯入（Node）

先跑 `--dry-run` 看統計數字（不會寫入任何資料）：

```
node scripts/legacy-migration/import-legacy-pets.js --dry-run legacy-recorddata-export.jsonl
```

確認數字合理後，正式匯入：

```
node scripts/legacy-migration/import-legacy-pets.js legacy-recorddata-export.jsonl
```

（也可以用 `npm run migrate:legacy-pets -- --dry-run legacy-recorddata-export.jsonl`。）

- 用 `legacyMedicalRecordNumber` 判斷是否已匯入，可安全重跑。
- 飼主用電話去重（正規化成純數字後比對，容忍破折號/空白等格式差異，但不處理缺區碼這類語意層級判斷）；沒有電話的整筆跳過（記錄到 `<檔名>.skipped-rows.log`），不生造假電話。
- 每隻寵物的病歷全文（若非空）匯入為一筆 `source: 'legacy_import'` 的病歷日誌記事，不逐筆拆分日期——舊資料格式十幾年不一致，拆分風險高於價值。
- 單筆失敗記錄到 `<檔名>.errors.log` 並繼續，不中斷整體匯入。

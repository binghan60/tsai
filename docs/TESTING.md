# 測試

日常驗證不需要外部服務：

```powershell
Set-Location server
npm test
npm run lint

Set-Location ..\client
npm test
npm run build
```

## MongoDB transaction／回收站整合測試

`TEST_MONGODB_URI` 必須指向 MongoDB replica set，且資料庫名稱必須包含 `test`。測試只會清除自己建立的文件。

```powershell
$env:TEST_MONGODB_URI = 'mongodb://localhost:27017/tsai_test?replicaSet=rs0'
Set-Location server
npm run test:integration
```

## 真實 PDF 與 SMTP

這兩項預設跳過。只有明確設定開關才會執行；SMTP 測試會真的寄出一封信。

```powershell
$env:RUN_PDF_E2E = '1'
$env:TEST_PUBLIC_REPORT_TOKEN = '<可開啟的報告 token>'
$env:PDF_RENDER_BASE_URL = 'http://127.0.0.1:5173'

$env:RUN_SMTP_E2E = '1'
$env:TEST_SMTP_TO = 'test-recipient@example.com'
# 同時設定正式使用的 SMTP_* / SMTP_EMAIL 環境變數

Set-Location server
npm run test:integration
```

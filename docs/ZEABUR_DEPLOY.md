# 部署（Zeabur／Docker）

單一容器：Vite 建置 Vue 前端，Express 在 production 同時提供 `/api/*`、前端靜態檔與 Vue Router fallback。PDF 由容器內的 Chromium 產生（`Dockerfile` 已裝好 Chromium 與中文字型，設定 `PUPPETEER_EXECUTABLE_PATH`、`PUPPETEER_NO_SANDBOX`）。

MongoDB 必須支援 transaction（Atlas 預設支援；自架要用 replica set）。

## 1. 建立服務

1. 專案推送到 GitHub。
2. Zeabur 建立 Project → `Add Service` → `GitHub`，選這個 Repository，Root Directory 保持根目錄；Zeabur 會偵測根目錄的 `Dockerfile`。
3. 建置完成後在 `Networking`／`Domains` 產生 `*.zeabur.app` 網址或綁定自訂網域。

`PORT` 由 Zeabur 注入；公開網址可用 `${ZEABUR_WEB_URL}` 取得。Zeabur 不支援直接從 Docker Compose 部署，正式部署來源就是根目錄的 `Dockerfile`。

## 2. 環境變數

完整清單與說明在 `server/.env.example`。正式環境在服務的 Variables 頁面設定：

```dotenv
NODE_ENV=production
MONGODB_URI=<MongoDB 連線字串>
PUBLIC_APP_URL=${ZEABUR_WEB_URL}
CLIENT_ORIGIN=${ZEABUR_WEB_URL}
PDF_RENDER_SECRET=${PASSWORD}
SHARE_LINK_DAYS=30
JWT_SECRET=<至少 32 字元的隨機字串>
AUTH_USERNAME=<診所共用帳號>
AUTH_PASSWORD_HASH=<npm run auth:hash-password -- <密碼> 的輸出>

SMTP_EMAIL=<寄件 Gmail>
SMTP_PASSWORD=<Google 應用程式密碼>
MAIL_FROM_NAME=謙華動物醫院
MAIL_REPLY_TO=

CLOUDINARY_CLOUD_NAME=<cloud name>
CLOUDINARY_API_KEY=<API key>
CLOUDINARY_API_SECRET=<API secret>
CLOUDINARY_IMAGE_UPLOAD_PRESET=tsai-medical-record-images
CLOUDINARY_IMAGE_FOLDER=tsai-medical-records

# IDEXX（見 docs/IDEXX_INTERLINK.md）
IDEXX_BRIDGE_TOKEN=<至少 32 字元的隨機字串，跟診所抓檔程式的設定相同；留空＝不接收>
IDEXX_CENSUS_MODE=off
```

說明：

- 本機的 `server/.env` 不進 Git、不寫進 Dockerfile；正式環境的祕密只放在 Zeabur Variables。
- MongoDB 用 Zeabur 的 MongoDB Template 時，填 Connections 頁面的 Internal／Private URI。
- **`PUBLIC_APP_URL` 正式環境必填**：分享連結與寄給飼主的 Email 都用它。沒設定（`CLIENT_ORIGIN`、`ZEABUR_WEB_URL` 也都空著）時容器直接啟動失敗——退而用請求的 `Host` 推斷，等於讓呼叫端決定信裡出現哪個網域。
- 分享連結預設 30 天到期（`SHARE_LINK_DAYS`，1–365），院方可以提前撤銷。
- PDF 從容器內部的 `127.0.0.1` 讀報告頁，不必設定 `PDF_RENDER_BASE_URL`。
- **帳號**：`AUTH_USERNAME`／`AUTH_PASSWORD_HASH` 只在資料庫還沒有任何帳號時、第一次啟動才生效。先在本機執行 `npm --prefix server run auth:hash-password -- <密碼>`，只把輸出值存進 Variables。之後換密碼或懷疑帳密外洩，連正式的 `MONGODB_URI` 執行 `npm --prefix server run auth:set-password -- <帳號> <新密碼>` 或 `auth:revoke-sessions -- <帳號>`，不必重新部署。登入 cookie 30 天到期。
- **Email**：寄信用 Gmail SMTP（應用程式密碼）。同一組帳密也用 IMAP 讀寄件信箱裡的退信通知，把投不到的寄送改成失敗（`MAIL_BOUNCE_CHECK=off` 關掉；`IMAP_HOST`／`IMAP_PORT` 可改主機）。

剛建立服務還沒有公開網址時，先部署、產生 Domain，確認 `PUBLIC_APP_URL` 與 `CLIENT_ORIGIN` 解析成完整的 `https://...` 後重新部署。

### Cloudinary 圖片上傳

建立名稱與 `CLOUDINARY_IMAGE_UPLOAD_PRESET` 相同的 **signed Upload Preset**：允許 `webp,png,jpg,jpeg,gif`、資料夾同 `CLOUDINARY_IMAGE_FOLDER`、incoming transformation `c_limit,w_2048,h_2048`。10 MB 上限由服務簽發的參數強制帶入；沒設定 preset 時不簽發上傳。測試機與正式機共用帳號時用不同的 `CLOUDINARY_IMAGE_FOLDER` 分流（例如 `tsai-medical-records-test`）。

## 3. 驗證部署

```text
https://你的網域/api/health
```

應回傳 `{"status":"ok","database":"connected","transactions":"supported"}`（`/api/health/live` 只檢查程序活著）。接著：

1. 首頁與重新整理後的子頁都能開。
2. 建立一筆草稿並重新整理，確認寫入正常。
3. 結案並下載 PDF，確認 Chromium 與中文字型正常。
4. 寄一封測試 Email 到自己的信箱，確認附件、分享連結與到期日。

## 4. 本機 Docker 測試

```bash
docker build -t pet-health .
docker run --rm -p 8080:8080 --env-file server/.env -e PORT=8080 -e CLIENT_ORIGIN=http://localhost:8080 -e PUBLIC_APP_URL=http://localhost:8080 pet-health
```

開啟 `http://localhost:8080`，健康檢查 `http://localhost:8080/api/health`。

## Zeabur 官方文件

- [使用 Dockerfile 部署](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)
- [設定環境變數](https://zeabur.com/docs/en-US/deploy/config/environment-variables)
- [公開網路與網域](https://zeabur.com/docs/en-US/deploy/networking/public-networking)
- [MongoDB 部署指南](https://zeabur.com/en-US/templates/KXL04P)

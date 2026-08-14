# 使用 Docker 部署到 Zeabur

專案採用單一容器：Vite 先建置 Vue 前端，Express 在 production 同時提供 `/api/*`、前端靜態檔與 Vue Router fallback。PDF 由容器內的 Chromium 產生。

## 1. 部署服務

1. 將專案推送至 GitHub。
2. 在 Zeabur 建立 Project，選擇 `Add Service` → `GitHub`。
3. 選擇這個 Repository，Root Directory 保持 Repository 根目錄。
4. Zeabur 會自動偵測根目錄的 `Dockerfile`。
5. 建置完成後，在服務的 `Networking`／`Domains` 產生 `*.zeabur.app` 網址或綁定自訂網域。

Zeabur 會自動注入 `PORT`，不需要手動設定。Git Repository 服務預設使用 `web` 作為 Port 名稱，因此可使用 `${ZEABUR_WEB_URL}` 取得公開網址。

## 2. 設定環境變數

在服務的 Variables 頁面加入：

```dotenv
NODE_ENV=production
MONGODB_URI=<MongoDB 連線字串>
PUBLIC_APP_URL=${ZEABUR_WEB_URL}
CLIENT_ORIGIN=${ZEABUR_WEB_URL}
PDF_RENDER_SECRET=${PASSWORD}

SMTP_EMAIL=<寄件 Gmail>
SMTP_PASSWORD=<Google 應用程式密碼>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
MAIL_FROM_NAME=寵物健康管理系統
MAIL_FROM=
MAIL_REPLY_TO=
```

注意事項：

- 不要把本機 `server/.env` 上傳到 Git 或貼進 Dockerfile；Zeabur Variables 才是正式環境的祕密來源。
- 若使用既有 MongoDB Atlas，將正式連線字串填入 `MONGODB_URI`。
- 若在 Zeabur 加入 MongoDB Template，應使用 MongoDB Connections 頁面的 Internal／Private URI，速度較快且不耗用公開流量。
- `PUBLIC_APP_URL` 用於永久分享連結與 Email；分享連結仍維持無到期日，只有院方手動撤銷才失效。
- PDF 預設從容器內部的 `127.0.0.1` 讀取報告，不必公開 `PDF_RENDER_BASE_URL`。

若剛建立服務時還沒有公開網址，可先部署、產生 Domain，再確認 `PUBLIC_APP_URL` 與 `CLIENT_ORIGIN` 已解析為完整的 `https://...` 網址並重新部署。

## 3. 驗證部署

部署完成後檢查：

```text
https://你的網域/api/health
```

應回傳：

```json
{"status":"ok"}
```

接著依序測試：

1. 首頁與重新整理後的子頁路由能正常開啟。
2. 建立一筆草稿並重新整理，確認 MongoDB 寫入正常。
3. 將報告結案並下載 PDF，確認 Chromium 與中文字型正常。
4. 寄送測試 Email，確認附件與永久分享網址使用正式網域。

## 4. 本機 Docker 測試

```bash
docker build -t pet-health .
docker run --rm -p 8080:8080 --env-file server/.env -e PORT=8080 -e CLIENT_ORIGIN=http://localhost:8080 -e PUBLIC_APP_URL=http://localhost:8080 pet-health
```

開啟 `http://localhost:8080`，健康檢查為 `http://localhost:8080/api/health`。

## Zeabur 官方文件

- [使用 Dockerfile 部署](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)
- [設定環境變數](https://zeabur.com/docs/en-US/deploy/config/environment-variables)
- [公開網路與網域](https://zeabur.com/docs/en-US/deploy/networking/public-networking)
- [MongoDB 部署指南](https://zeabur.com/en-US/templates/KXL04P)

Zeabur 目前不支援直接從 Docker Compose YAML 部署，因此本專案以根目錄單一 `Dockerfile` 為正式部署來源。

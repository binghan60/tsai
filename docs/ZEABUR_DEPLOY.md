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
SHARE_LINK_DAYS=30
ADMIN_PASSWORD=<後台登入密碼>

SMTP_EMAIL=<寄件 Gmail>
SMTP_PASSWORD=<Google 應用程式密碼>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
MAIL_FROM_NAME=謙華動物醫院
MAIL_FROM=
MAIL_REPLY_TO=
```

注意事項：

- 不要把本機 `server/.env` 上傳到 Git 或貼進 Dockerfile；Zeabur Variables 才是正式環境的祕密來源。
- 若使用既有 MongoDB Atlas，將正式連線字串填入 `MONGODB_URI`。
- 若在 Zeabur 加入 MongoDB Template，應使用 MongoDB Connections 頁面的 Internal／Private URI，速度較快且不耗用公開流量。
- `ADMIN_PASSWORD` **在正式環境是必填**，它是進後台唯一的一道門。沒設定（或只填空白）時容器會直接啟動失敗，log 印出 `[startup] 正式環境必須設定 ADMIN_PASSWORD`。這是刻意的——漏設卻照常運作，等於整個後台不設防而且沒人會發現。
  - **第一次加上登入功能的那次部署，要先在 Variables 填好這個變數再推程式**，否則新版起不來。
  - 請用夠長、別處沒用過的密碼。同一個 IP 在 15 分鐘內輸錯 10 次會被暫時擋下，但那只是輔助，擋不住好猜的密碼。
  - 要改密碼就改這個變數後重新部署。改了之後所有裝置上的登入都會失效，需要重新登入——懷疑登入狀態外流時，這也是讓它全部作廢的方法。
  - 登入一次保持 30 天，有在使用就會自動延長；重新部署不會把人登出。
- `PUBLIC_APP_URL` **在正式環境是必填**：沒設定（且 `CLIENT_ORIGIN`、`ZEABUR_WEB_URL` 也都空著）時容器會直接啟動失敗，log 印出 `[startup] 正式環境必須設定 PUBLIC_APP_URL`。這是刻意的——退而用請求的 `Host` 推斷，等於讓呼叫端決定寄給飼主的信裡出現哪個網域。
  - 登入 cookie 是否標記為只走 HTTPS 也看這個網址的協定，所以它必須是 `https://` 開頭的正式網址。
- `PUBLIC_APP_URL` 用於分享連結與 Email；分享連結預設 30 天到期，可用 `SHARE_LINK_DAYS` 設為 1–365 天，院方也能提前撤銷。
- 舊版建立、沒有到期日的分享連結會在部署後失效；院方重新按下分享即可產生帶期限的新連結。
- PDF 預設從容器內部的 `127.0.0.1` 讀取報告，不必公開 `PDF_RENDER_BASE_URL`。

若剛建立服務時還沒有公開網址，可先部署、產生 Domain，再確認 `PUBLIC_APP_URL` 與 `CLIENT_ORIGIN` 已解析為完整的 `https://...` 網址並重新部署。

## 3. 驗證部署

部署完成後檢查：

```text
https://你的網域/api/health
```

應回傳：

```json
{"status":"ok","database":"connected","transactions":"supported"}
```

接著依序測試：

1. 開首頁會被導到登入頁；輸入 `ADMIN_PASSWORD` 後進到工作台，重新整理後的子頁路由能正常開啟。
2. 用無痕視窗（沒有登入狀態）直接開 `https://你的網域/api/owners`，應回傳 `{"message":"請先登入","code":"AUTH_REQUIRED"}`。
3. 建立一筆草稿並重新整理，確認 MongoDB 寫入正常。
4. 將報告結案並下載 PDF，確認 Chromium 與中文字型正常。
5. 建立分享連結，用無痕視窗開啟，確認飼主不需要登入就能看到報告。
6. 寄送測試 Email，確認附件、限時分享網址與到期日使用正式設定。

## 4. 本機 Docker 測試

```bash
docker build -t pet-health .
docker run --rm -p 8080:8080 --env-file server/.env -e PORT=8080 -e CLIENT_ORIGIN=http://localhost:8080 -e PUBLIC_APP_URL=http://localhost:8080 -e ADMIN_PASSWORD=local-test pet-health
```

開啟 `http://localhost:8080`，用上面指定的 `ADMIN_PASSWORD` 登入；健康檢查為 `http://localhost:8080/api/health`。

## Zeabur 官方文件

- [使用 Dockerfile 部署](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)
- [設定環境變數](https://zeabur.com/docs/en-US/deploy/config/environment-variables)
- [公開網路與網域](https://zeabur.com/docs/en-US/deploy/networking/public-networking)
- [MongoDB 部署指南](https://zeabur.com/en-US/templates/KXL04P)

Zeabur 目前不支援直接從 Docker Compose YAML 部署，因此本專案以根目錄單一 `Dockerfile` 為正式部署來源。

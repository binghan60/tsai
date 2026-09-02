# 寵物診所報告系統 — 專案指南

> **回答一律使用繁體中文**（不用簡體字、不用英文），無論使用者用中文或英文提問都一樣。程式碼、變數名稱、commit message 等技術內容維持原樣即可，不必刻意翻譯。

> **這份文件要跟著程式碼一起改。** 動到資料模型、API 路由、頁面路由、狀態機或技術選型時，同一次改動就更新這裡對應的段落——這份文件每個 session 開場會自動載入，寫錯的描述比沒有描述更糟，會讓後續判斷建立在錯的前提上。維護方式見最後一節。

## 一、專案定位

單人使用的健檢報告產生 + 分發系統（不是看診紀錄／排班系統）。核心流程：

系統另外提供一份輕量的掛號與候診時間軸；它負責電話掛號、報到順序與完成看診，不做跨日排班或診間容量管理。一次看一天（頁面上有日期面板），掛號可以指定日期——電話裡客人說「我明天帶來」是常態；但候診佇列與時間軸都以那一天為界，不跨日。

```
選健檢表單 → 填寫報告 → 結案（產生 PDF 快照並鎖定）→ 寄送 Email／分享連結給飼主
                              ↓
                        需要更正時建立修訂版
```

兩個關鍵性質：

- **報告結案後鎖定不可改。** 要更正得建立修訂版（新的一份，舊版保留並標記 `supersededBy`）。病歷必須永遠呈現當時的樣子。
- **表單結構是使用者自訂的。** 有哪些區塊、每個區塊有哪些項目，都由 FormTemplate 決定，不是寫死的。報告結案時把當下的表單結構與作答一起存成 `sections` 快照，之後改範本不會回頭改動已結案的報告。

## 二、資料模型（MongoDB collections）

### owners 飼主
`name`、`phone`、`email`。一位飼主可養多隻寵物。

### pets 寵物
`name`、`ownerId`、`medicalRecordNumber`（自動產生 `PET-XXXXXXXX`）、`species`、`breed`、`sex`、`neutered`、`birthDate`、`weightKg`、`allergies`、`chronicConditions`、`currentMedications`、`notes`。`legacyMedicalRecordNumber`（選填，unique+sparse）是舊系統匯入時保留的舊病歷號，供追溯與匯入腳本判斷是否已匯過，非匯入資料一律是 `null`。

### medicalRecords 健檢報告
欄位分成幾組：

| 組別 | 欄位 |
|---|---|
| 基本 | `petId`、`reportNumber`（`HC-YYYY-XXXXXXXX`）、`vet`、`visitDate`、`followUpDate`、`examType` |
| **範本快照** | `templateId`、`templateVersion`、`sections`（結案時凍結的完整表單結構＋作答） |
| 具名臨床欄位 | `weightKg`、`temperatureC`、`heartRate`、`chiefComplaint`、`diagnosis`、`conclusion`、`other`、`customValues` 等 |
| 分享 | `shareToken`（uuid，unique）、`shareEnabled`、`sharedAt` |
| 生命週期 | `status`：`draft` / `finalized`、`finalizedAt`、`pdfGeneratedAt` |
| 修訂 | `reportVersion`、`revisionOf`、`revisionRootId`、`revisionReason`、`supersededBy` |
| 寄送 | `deliveryStatus`：`not_sent` / `sending` / `sent` / `failed`、`deliveryError`、`lastDeliveryAttemptAt`、`sentAt`、`sentTo`、`emailMessageId` |

**`status` 與 `deliveryStatus` 是兩個獨立的維度**，不要混成一個。報告結案與否是臨床流程，寄不寄得出去是通訊結果——寄送失敗不該讓報告退回草稿。

已結案報告的內容一律讀 `sections` 快照，報告檢視頁不再讀具名欄位。

索引：`petId`、`reportNumber`(unique)、`shareToken`(unique)、`{supersededBy, updatedAt}`、`{status, deliveryStatus}`。後兩個是給跨寵物清單查詢用的——沒有它們那支查詢是全表掃描加記憶體排序，而記憶體排序有 32MB 硬上限，超過會直接失敗。**新增查詢模式時要一併確認索引接得上。**

### formTemplates 健檢表單範本
`name`、`description`、`species`、`enabled`、`order`、`version`，底下是 `sections[]`，每個 section 有 `items[]`。使用者可自由增刪區塊與項目。詳見 [docs/FORM_BUILDER.md](docs/FORM_BUILDER.md)。

### textTemplates 文字模板
`name`、`content`、`availableForAllFields`、`applicableItemKeys`、`enabled`、`usageCount`。填表時可插入文字欄位的長篇內容，取代了早期的 quickPhrases 常用語（該 collection 與其路由已移除）。

### clinicalNotes 病歷日誌
`petId`、`entryDate`、`content`、`source`（`manual` / `legacy_import`）。醫師看診或拿藥時隨手記的自由文字記事，不用填表、不用結案，跟 `medicalRecords`（結案才鎖定的正式健檢報告）是兩條平行的軌道——日誌給日常記事用，健檢報告給需要 PDF／分享的正式場合用。`source: 'legacy_import'` 的記事來自舊系統資料遷移（見 `server/scripts/legacy-migration/`），內容是舊系統逐年累加的病歷全文，整段當一筆記事匯入，不逐筆拆分（舊資料格式不一致，拆分風險高於價值）；匯入記事跟一般記事一樣可編輯/刪除，沒有唯讀鎖定。索引 `{petId, entryDate, _id}`。刪除寵物前會檢查 `ClinicalNote.exists({petId})`，跟 `medicalRecords` 一樣擋刪除。

### deliveryLogs 寄送流水帳
append-only，每次寄送嘗試寫一筆：`recordId`、`reportNumber`、`petName`、`ownerName`、`event`（`queued`/`sent`/`failed`）、`recipient`、`messageId`、`error`、`createdAt`。

**刻意不設 `ref`、改冗餘存報告編號與姓名**——報告可以被刪除，而這筆紀錄的價值正是在報告消失後還查得到寄給了誰。同理它是獨立 collection 而不是內嵌陣列。medicalRecords 上的 `sentTo`/`sentAt` 只留得住最後一次，重寄就覆蓋。

### users 帳號
`username`（unique）、`passwordHash`（`scrypt$<salt>$<hash>`，`select: false`）、`active`、`tokenVersion`。單人診所共用一組帳號，不是多使用者系統。

第一次啟動時若這個 collection 是空的，會用環境變數 `AUTH_USERNAME`／`AUTH_PASSWORD_HASH` 自動建立一筆（`config/auth.js` 的 `ensureBootstrapUser`）；建立後這兩個環境變數就不會再被讀取。之後要換密碼或撤銷登入用 `npm run auth:set-password -- <帳號> <新密碼>` / `npm run auth:revoke-sessions -- <帳號>`（見 `server/scripts/`），不是改環境變數重開機。

**登入用的 JWT 是無狀態的，`tokenVersion` 是唯一的撤銷手段**：token 簽章與過期時間本身沒辦法中途作廢，所以每次請求都會多查一次這筆帳號文件，比對 `tokenVersion` 是否跟簽發當下相同、`active` 是否仍為真。改密碼／執行 revoke-sessions／停用帳號都會讓 `tokenVersion` +1，現有 cookie 立刻失效，不用等 30 天自然過期。

### appointments 掛號與候診
只服務當日門診時間軸。`date`／`time` 是登記來源（`date` 由掛號時指定，預設今天），`scheduledAt` 供排序；既有病患帶 `ownerId`／`petId`，初診可先留空，但兩種情況都保存 `ownerName`／`ownerPhone`／`petName`／`species` 快照。**`ownerName` 在掛號階段是選填**——接電話時常常只問得到寵物名跟電話；`petName` 才是必填，一筆掛號至少要指得出是誰要來。到 `POST /:id/check-in` 才必填飼主姓名與電話，因為那一步要真的建立 `Owner` 文件，而 `Owner.name` 是必要欄位。

`status` 為 `scheduled`／`arrived`／`completed`／`cancelled`／`no_show`。候診中可填 `weightKg`、`temperatureC`、會顯示在飼主報告上的 `followUpDate`，以及內部用 `visitNote`。完成看診後會建立健檢報告草稿並帶入這些資料；已完成掛號後續修改時，只同步尚未結案的草稿。

**`checkinNumber` 是候診佇列裡的位置，不是報到時發的票號，而且完全自動——沒有手動指定的入口。** 同一天所有 `arrived` 的掛號，號碼是連續的 1..N；報到接到隊尾，離開佇列（完成／取消／未到／取消報到）就清成 null 並讓後面的人遞補。因此「這個號碼已經被用掉」在結構上不存在，不需要靠衝突檢查去擋——檢查本來也擋不住併發。代價是排在後面的人號碼會隨著前面的人看完而變小，那正是即時位置該有的行為。排序與編號規則在 `lib/appointmentQueue.js`（純邏輯，可測）。

索引 `{scheduledAt: 1}` 與 `{status: 1, scheduledAt: 1}` 對應時間軸排序、狀態分組與讀取當日佇列。另有 partial unique index `{date, checkinNumber}`（限 `status: 'arrived'` 且號碼為數字）：重排是在 transaction 裡整批改寫佇列的，併發重排會因為改到同一批文件而互相衝突，唯一擋不住的是「兩個人同時報到各自算出同一個隊尾號碼」——那由這個索引接住，路由收到 E11000 後自行重試。**寫回號碼一定要兩階段**（先整批挪到負數再寫回正式號碼）：唯一索引是逐筆檢查的，直接把 B 寫成 1 會撞到還沒讓位的 A。

## 三、技術棧

| 層級 | 選擇 | 備註 |
|---|---|---|
| 前端 | Vue 3 + Vite | Composition API、`<script setup>` |
| UI 元件 | reka-ui + shadcn-vue 風格 | 元件在 `client/src/components/ui/`，可直接改 |
| CSS | Tailwind CSS v4 | `@tailwindcss/vite`，設定寫在 `client/src/style.css` 的 `@theme`（CSS-first，無 `tailwind.config.js`） |
| 圖示 | `@lucide/vue` | **不是** `lucide-vue-next`（已棄用） |
| 字體 | `@fontsource-variable/noto-sans-tc` | 自架不走 CDN，理由見第七節 |
| 表單驗證 | vee-validate | |
| 後端 | Node.js + Express | 單人使用，不需要 Nest.js 的架構開銷 |
| 資料庫 | MongoDB + Mongoose | |
| 登入 | `jsonwebtoken` + Node 內建 `crypto.scrypt` | JWT 放在 HttpOnly cookie；密碼雜湊用內建 scrypt，不另外裝 bcrypt |
| PDF | Puppeteer | 見下節 |
| Email | Nodemailer | SMTP（Gmail 應用程式密碼） |
| 測試 | Node 內建 `node --test` | 不裝額外框架 |

## 四、PDF 產生方式（關鍵架構決策）

**不在後端另外維護一份 PDF 版型。** 做法是：

1. 前端的報告檢視頁 `/report/:token` 同時扮演兩個角色：給飼主直接看（不需登入），以及當 PDF 的來源
2. 後端用 Puppeteer 開無頭瀏覽器連到這個頁面，把渲染結果截成 PDF
3. 前端寫 `@media print` CSS 隱藏操作型 UI

好處：排版只寫一次，前端改樣式 PDF 自動跟著變。

`server/src/lib/pdf.js` 的兩個要點：

- **Chromium 實例重用。** 每次重開瀏覽器光啟動就要一到三秒，而結案／下載／寄送三支端點都是同步等它跑完。實例留著重用、閒置五分鐘才關；快取的是 launch 的 promise 而不是實例，同時進來的請求才會共用同一次啟動。
- **渲染排隊，一次只跑一個。** 並行渲染會讓多個分頁搶著載入報告頁，`networkidle0` 永遠不滿足而全部逾時。另外 page 要 `setCacheEnabled(false)`——共用實例也共用 HTTP 快取，第二次載入同一份報告會拿到 304，而 `response.ok()` 只認 200–299。

## 五、API 設計

```
帳號（唯一免登入的 /api/* 路由，連同 /api/public/reports/:token 與 GET /api/health）
GET    /api/auth/me                     查詢目前登入狀態
POST   /api/auth/login                  登入，成功後回 HttpOnly JWT cookie（30 天到期，有限流）
POST   /api/auth/logout                 登出，清除 cookie

飼主
GET    /api/owners                      列表（?q= 搜尋姓名/電話）
POST   /api/owners
GET    /api/owners/:id                  詳情（含旗下寵物）
PUT    /api/owners/:id
DELETE /api/owners/:id

寵物
GET    /api/owners/:ownerId/pets        該飼主的寵物
POST   /api/owners/:ownerId/pets
GET    /api/pets                        列表（?q= 搜尋）
GET    /api/pets/:id                    詳情（含報告列表、病歷日誌列表）
PUT    /api/pets/:id
DELETE /api/pets/:id                    刪除（寵物仍有報告或病歷日誌時擋刪）

病歷日誌
GET    /api/pets/:petId/clinical-notes  該寵物的日誌列表（分頁）
POST   /api/pets/:petId/clinical-notes  新增一則日誌
PUT    /api/clinical-notes/:id          編輯日誌內容／日期
DELETE /api/clinical-notes/:id          刪除日誌

報告
GET    /api/pets/:petId/records         該寵物的報告
GET    /api/pets/:petId/records/previous-values   填表時的「上次數值」對照
POST   /api/pets/:petId/records         新增
GET    /api/records                     跨寵物清單（?view= 工作佇列 / ?q= / 分頁）
GET    /api/records/:id
PUT    /api/records/:id
POST   /api/records/:id/finalize        結案：驗證 → 凍結 sections → 產 PDF → 鎖定
GET    /api/records/:id/pdf             下載 PDF
POST   /api/records/:id/revisions       建立修訂版
DELETE /api/records/:id                 刪除（已結案報告需帶 confirmText＝寵物名稱；草稿不需要）
POST   /api/records/:id/share           建立分享連結
POST   /api/records/:id/revoke-share    撤銷分享
POST   /api/records/:id/send-email      寄送 PDF + 連結給飼主

掛號與候診
GET    /api/appointments                當日掛號時間軸（?date=YYYY-MM-DD，預設今天）
GET    /api/appointments/summary        週檢視用的日期範圍內每日掛號數（?start=&end=，最多 31 天）
POST   /api/appointments                新增掛號（body 可帶 date，省略＝今天）
GET    /api/appointments/:id
PUT    /api/appointments/:id            更新掛號資料（時段／來院原因／身分快照）
POST   /api/appointments/:id/check-in   報到；初診同時建立飼主與寵物（自動接到候診佇列尾端）
POST   /api/appointments/:id/complete   完成看診並保存候診量測
POST   /api/appointments/:id/cancel     取消掛號
POST   /api/appointments/:id/no-show    標記未到診
POST   /api/appointments/:id/restore    恢復已取消或未到診的掛號
DELETE /api/appointments/:id            永久刪除（僅限已取消或未到）

寄送紀錄
GET    /api/delivery-logs               流水帳（?recordId= / ?event= / 分頁）

健檢表單設定
GET    /api/settings/form-templates
POST   /api/settings/form-templates
GET    /api/settings/form-templates/:id
PUT    /api/settings/form-templates/:id
DELETE /api/settings/form-templates/:id

文字模板
GET    /api/text-templates              列表（?includeDisabled= / ?q=）
GET    /api/text-templates/fields       可套用模板的欄位清單（掃描所有健檢範本）
POST   /api/text-templates
PUT    /api/text-templates/:id
POST   /api/text-templates/:id/use      累計使用次數
DELETE /api/text-templates/:id

其他
GET    /api/search                      全站搜尋（飼主 + 寵物）
GET    /api/dashboard                   儀表板彙總：報告狀態分佈（statusBreakdown / draftCount / finalizedPendingCount / failedCount）、近 6 週健檢量（weeklyTrend）、本月與累計的飼主／寵物數、待辦與最近報告
GET    /api/public/reports/:token        公開，飼主查看報告用
GET    /api/health
```

`AUTH_ENABLED=true`（或 `NODE_ENV=production`）時，除了上面標注的三支免登入路由，其餘 `/api/*` 都會被 `requireAuthentication` 擋下（見 `app.js` 掛載順序），未登入回 401。本機開發預設不設 `AUTH_ENABLED`，這道關卡整個略過。

`GET /api/records` 的 `view` 是預設工作佇列：`todo`（預設）/ `drafts` / `pending` / `failed` / `sent` / `all`。回傳帶 `counts` 給前端佇列徽章。**儀錶板卡片的數字必須跟對應佇列的筆數對得起來**——卡片可以點進清單，兩邊算法不同會直接讓人困惑。

刪除限制：`deliveryStatus` 為 `sent` 或 `sending` 的報告不給刪。

刪除確認：**只有已結案報告要打字確認**（`confirmText` 必須等於寵物名稱），草稿直接刪。打字確認防的是誤刪正式報告——它產過 PDF、可能已經給過飼主連結；草稿是工作中狀態，多一道抄名字只會訓練使用者無視確認。前端也照這個判準分流：草稿走 `ConfirmDialog`，已結案走 `DeleteRecordDialog`。

## 六、頁面規劃

| 路由 | 頁面 | 說明 |
|---|---|---|
| `/` | 工作台 | 全站綜覽儀表板，由粗到細三層：**現在**（寄送異常橫幅）→ **分佈與趨勢**（報告流程四格、近 6 週健檢量長條、本月與累計數字）→ **明細**（待辦清單、最近完成）。**同一個數字只在其中一層出現一次**——之前草稿數同時出現在優先處理卡、workStage 卡、待辦清單與狀態長條四個地方，那是這頁最主要的雜訊來源。每一格數字都要能點進對應清單 |
| `/appointments` | 掛號與候診 | **兩個區塊，因為這頁上有兩種順序**：上方「候診中」依看診序號排，由上而下就是看診順序；下方「看診時間軸」只放尚未報到的人，軸就純粹是時間。報到＝從時間軸移到佇列。頁面最上方是日期面板，支援「單日／本週」Tab 切換。單日檢視有前後一天／日曆、快捷跳轉按鈕（明天／後天／上下一個相同星期幾），以及當日掛號統計摘要（總掛號數／候診中／已完成）；本週檢視是一排 7 天格子（週一到週日），點格子切換回單日並帶那天的資料。選的日期同步進網址 `?date=`，兩個區塊都跟著它走；只有今天才畫「現在」指示線、才自動重新整理。號碼是唯讀的，看診順序完全由報到先後決定，沒有手動調整的入口 |
| `/owners`、`/owners/:id` | 飼主列表／詳情 | |
| `/pets`、`/pets/:id` | 寵物列表／詳情 | 詳情含病歷日誌（隨手記事，見第二節 `clinicalNotes`）與歷次報告 |
| `/records` | 就診紀錄清單 | 跨寵物，佇列切換 |
| `/records/deliveries` | 寄送紀錄 | 流水帳，含已刪除報告的紀錄 |
| `/pets/:petId/records/new`、`/records/:id/edit` | 報告填寫表單 | 自動存草稿、離開前攔截未儲存變更 |
| `/records/:id/preview` | 報告預覽 | `meta.bare`，後台用，有結案／寄送／分享操作 |
| `/report/:token` | 報告檢視頁 | `meta.bare`，**公開**，飼主查看用 + PDF 截圖來源 |
| `/settings/forms`、`/settings/forms/:id` | 健檢表單管理／設計 | |

導覽與返回的幾個約定（`client/src/App.vue`、`router/index.js`）：

- 側邊欄 active 判斷用網址前綴，不用 `router-link` 內建的（那個比對路由記錄，抓不到獨立註冊的深層路由）。路由可以用 `meta.nav` 自己指定歸屬，網址前綴猜錯時以它為準。
- 各頁的返回連結走 `useBackTarget`，回到使用者真正的出發點（router 在 `afterEach` 記進 `history.state`），不是寫死的上層網址。標了 `meta.transient` 的路由不列入來源。
- 列表頁的搜尋／佇列／頁碼用 `useSearchQueryParam` 同步進網址，配合 router 的 `scrollBehavior` 讓返回時狀態與捲動位置都還在。
- 全站搜尋是蓋在當前頁面上的命令面板（`Ctrl/Cmd+K`），**不換路由**。

## 七、UI／視覺設計規範

- **明暗主題**：後台管理頁面支援明暗切換，側邊欄最下方有切換鈕，狀態存 `localStorage`、預設跟隨系統。共用邏輯在 `client/src/composables/useTheme.js`，深淺色用 Tailwind 的 `dark:` variant（`@custom-variant dark` 定義在 `style.css`，對應 `<html class="dark">`）。
  - **主色 = 深青藍 `petrol`(50–900)**，明暗兩態同一個色相、只換明度：淺色 `petrol-600` 配白字，深色 `petrol-400` 配深墨字（亮階當底、`on-primary` 當字）。主色刻意不放在紅色區——紅色完整讓給 destructive 與 failed，金色 `brand` 只留給側邊欄 active 與 Logo，三者各佔一塊色相互不重疊。
  - **表面 = 暖中性 `paper`(0–900)**：淺色頁面底 `paper-100`、卡片純白，卡片靠 1.12 的明度差加一條細邊框浮起來。舊版是象牙卡片疊在米黃底上（對比 1.22），卡片是不是獨立物件全靠深卡其邊框硬切，整片畫面因此又黃又髒。**頁面底不要再疊漸層**：層數越多卡片越浮不起來。
  - **深色維持科技感深藍黑**：`#0b1218` 頁面底 / `#121b22` 卡片 / `#2c3a44` 邊框，文字是中性偏冷的白 `#e9eef1`（原本的暖米白疊在 petrol 上會發黃）。
  - `belle`／`cream`／`ink` 已經退位成報告紙面與側邊欄專用，**後台頁面不要再碰**。
- **一律用語意 token，不要在頁面手寫色票。** `bg-card`／`bg-field`／`text-foreground`／`text-muted-foreground`／`border-border`／`bg-muted`／`bg-accent` 這組已經自己處理明暗兩態，寫 `text-ink-900 dark:text-white` 這種雙寫只會製造出第二套色彩系統——兩套並行正是「配色沒問題但細節很髒」的來源。需要新的語意角色時，加 token 到 `style.css`，不要在使用端硬寫。
  - **狀態語意有四組 token**：`--success`／`--warning`／`--info`／`--danger`，每組各配一個 `-surface` 底色，使用端寫 `bg-success-surface text-success`。**不要用 Tailwind 的 `emerald-50`／`amber-50` 那類固定色階**——它們是冷調亮白，疊在卡片上對比只有 1.00–1.02，底色等於沒畫出來，狀態實際上只剩文字顏色在傳達。
  - `bg-field` 是「可以動的表面」：輸入框、狀態切換鈕、常用語籤、選取中的卡片。卡片改成純白之後這層不可能再更亮，所以淺色是往下凹一階；深色沒有更暗可用（會跟頁面底糊在一起），仍然往上浮。兩態方向相反、講的是同一件事。**不要為了這類表面寫 `bg-white`**——那在深色主題是白底配米白字，等於看不見。
  - 例外只有兩個：報告頁（固定淺色，見下）與側邊欄（兩個主題都是深底，用 `sidebar-*` 那組 token，**不要用 `text-muted-foreground`**——淺色主題下那是深灰字，會糊在深色側邊欄上）。
  - `/report/:token` 與 `/records/:id/preview` 報告頁**固定淺色，不受主題切換影響**──它同時是 Puppeteer 截圖產 PDF 的來源，深色底 + 淺色文字直接列印容易變成看不見字，獨立用 `stone`/`brand` 配色，**不套用 `dark:` variant**。在那兩頁加東西時不要共用後台的樣式常數（例如 `DELIVERY_EVENT_META`），要另外定義純淺色版本。
- **報告狀態色彩語意**（徽章、圓點與圖表遵循同一套對應，定義在 `lib/recordStatus.js`）：
  - `draft` 草稿 → 中性 `bg-muted text-foreground`（沒有人在等它）
  - `finalized` 已結案 → 主色淡面 `bg-accent text-accent-foreground`——它不是異常也不是完成，是流程走到主線上的下一步
  - `not_sent` 待寄送 → `warning`（在等你動手）；`sending` 寄送中 → `info`；`sent` 已寄送 → `success`；`failed` 寄送失敗 → `danger`
  - `uncertain` 結果待確認 → `border-danger/45 text-danger`，跟 failed 同色相但走外框而不是實心淡底：兩者都要人看一眼，但這個是不確定、不是已知失敗
  - **草稿與待寄送不可以同色**。之前兩者共用同一組 amber，畫面上分不出「還沒寫完」跟「寫完了還沒寄」
  - 徽章一律用 `<Badge variant="status" :class="META[...].class">`，形狀與留白由 variant 決定、顏色由 `lib/recordStatus.js` 的 meta 提供，不要在使用端再覆寫 padding 或圓角。
- **文字顏色**：預設 `text-foreground`，不可點的內容不上色。`text-primary` 只給三種東西：沒有按鈕外框的可點文字（清單項目名稱、純文字連結）、選取／啟用中的狀態、以及站在 `bg-accent` 上的前景（那種情況寫 `text-accent-foreground`）。**可點的東西靜止時就要看得出來**，不可以只寫 `group-hover:text-primary`。**必填星號用 `text-danger` 不是主色**——它是警示不是連結。詳見 [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md) 的「文字顏色」。
- **圖示**：統一用 `@lucide/vue`，**不要用 emoji**。線條粗細統一 `stroke-width="1.75"`，顏色預設跟隨 `currentColor`。
- **圖表**：照 `dataviz` skill 的方法做──先選圖表形式（part-to-whole 用堆疊長條，不用圓餅圖）、色彩最後決定且要跑該 skill 附的 `validate_palette.js` 驗證對比與色盲安全性，不要憑感覺挑色。會隨主題變色的圖表，色碼要放進 `computed()`（依 `isDark` 切換），不要寫死。
  - **圖表色走自己的 slot**：`--chart-1`（淺 `#068ba6` / 深 `#2fa3bf`），不要借 primary。primary 是 petrol-600/400，OKLab 彩度只有 0.073／0.086，過不了驗證器的 chroma floor（0.1）——那條檢查在講「這個顏色鋪成色塊會讀成灰的」。`--chart-1` 是同色相家族往飽和再走一階，明暗兩態都通過 lightness band、chroma floor 與 3:1 對比。要加第二個序列就往 `--chart-2` 擴，不要在使用端挑色。
  - 全站目前只有一張圖：工作台的「近 6 週健檢量」（`components/TrendBars.vue`）。單一序列的量值長條，所以沒有圖例（標題就說明了它是什麼）、沒有 y 軸刻度、沒有格線；直接標籤只給最新一根，其餘靠 tooltip；`sr-only` 清單提供完整數值。**數量為 0 的那一週仍保留 2px 高的底**——高度歸零會讓人以為那一根不存在，「這週是 0」跟「沒有這週」必須看得出差別。
  - 工作台原本還有一條報告狀態堆疊長條，已經拿掉：它把「已寄送」（完成、不用管）跟待處理狀態混在同一條上，長條變長只代表資料變多、不代表有事要做。那份資訊現在是四格可點的數字。要做這種「沿用狀態語意色」的圖時記得紅與琥珀在紅色覺缺陷下的模擬 ΔE 只有 5.2，段與段之間要留可見分隔線、圖例要帶標籤與數值——顏色不能是唯一線索。
- **字體**：`Noto Sans TC Variable`，自架（`@fontsource-variable/noto-sans-tc`，在 `main.js` 匯入）。**不要改成 CDN**——`/report/:token` 是 Puppeteer 產 PDF 的來源，字體連外會讓正式報告的排版取決於當下網路。用 Variable 版也是刻意的：系統中文字體只有 Regular/Bold 兩級，`font-medium`(500)／`font-semibold`(600) 在中文上會失效，介面靠字重建立的階層就整個不存在。
- **字體層級**（後台管理介面）：

  | 層級 | Class | 尺寸 | 字重 | 用途 |
  |---|---|---|---|---|
  | H1 頁面標題 | `text-xl` | 24px | `font-semibold` | 每頁最上方唯一標題 |
  | H2 區塊標題 | `text-base` | 18px | `font-semibold` | 頁面內的區塊／群組標題 |
  | H3 卡片標題 | `text-sm` | 16px | `font-semibold` | 密集網格內卡片自己的標題 |
  | Body 內文 | `text-sm` | 16px | 預設 | 一般文字、表格內容、清單項目 |
  | Control 控制項 | `text-sm` | 16px | `font-medium` | 按鈕、連結、輸入框文字 |
  | Label 表單標籤 | `text-xs` | 14px | `font-medium` | 表單欄位標籤 |
  | Caption 註記 | `text-xs` | 14px | 預設，搭配 muted 色 | 次要說明、時間戳記、狀態徽章文字 |

  尺寸與行高定義在 `style.css` 的 `@theme`（`--text-*`），**改字級改那裡就好，不必動使用端的 class**。行高刻意不吃 Tailwind 預設（那是為拉丁字母調的），中文設在 1.6–1.75。單行控制項（Button／Badge）要自己加 `leading-none`，否則會被全域行高撐爆。

  不要用任意值字級（如 `text-[11px]`），一律對應到上表其中一層。

  **報告頁走自己的尺度**：`.report-sheet` 在 `style.css` 裡把 `--text-*` 覆寫回 12/14/16px。它是 A4 列印文件，字級放大會直接改變分頁位置。動到 `@theme` 字級後，一定要開 `/records/:id/preview` 確認紙面分頁沒變。

- **元件慣例**（重複的東西一律走共用元件，不要在頁面各寫一份）：

  | 需求 | 用什麼 | 不要做的事 |
  |---|---|---|
  | 卡片 | `<Card>` | 不要再加 `border-*`／`bg-card`——Card 自己有 `border border-border bg-card` |
  | 空狀態 | `<EmptyState :icon :title :description>`，卡片內部加 `inset` | 不要手寫虛線框 |
  | 清單載入中 | `<ListSkeleton :rows>` | 不要用「載入中…」一行字（版面會塌陷再彈開） |
  | 錯誤訊息 | `<Alert variant="destructive"><AlertDescription>` | 不要手寫紅框 |
  | 對話框 | `<DialogContent size="sm|md|lg">` | 不要用 `class="sm:max-w-*"` 覆寫寬度 |
  | 狀態徽章 | `<Badge variant="status">` | 不要覆寫 padding／圓角 |
  | 刪除等危險操作確認 | `<ConfirmDialog>` | **禁止用瀏覽器原生 `confirm()`／`alert()`**——樣式跳出主題、行動裝置體驗差、也擋不住連點 |
  | 操作結果提示（成功／失敗） | `useToast()`（`success`／`error`） | 同上，不要用 `alert()` |
  | 清單分頁 | `<Pagination :page :total-pages>` | 不要手刻分頁列。頁碼七頁以內完整展開，更多頁時顯示第一頁、最後一頁、目前頁附近頁碼與省略號；目前頁使用實心主色並標記 `aria-current="page"`，兩側只保留上一頁／下一頁箭頭。分頁列永遠顯示（含只有一頁的情況），邊界按鈕用 disabled 表達到頭了。清單一筆資料都沒有時走 `EmptyState`，不會走到這裡。 |
  | 單選切換鈕（無描述文字、無計數） | `<SegmentedControl v-model :options :aria-label>` | 不要手刻——同一個「選取中」概念原本有四種顏色語彙（實心填色、白色浮動晶片、純色實心、淡色調底面）。選取態統一用 `bg-accent text-accent-foreground`（跟文字顏色規則的「選取／啟用中狀態」同一個記號）。要計數徽章、色點或橫向捲動時用 `FilterTabs`，不要塞進 `SegmentedControl`——那樣兩個元件遲早又會分裂成不同外觀。 |
  | 篩選面板（關鍵字，選配日期範圍） | `<FilterBar id label placeholder v-model with-date-range :date-from :date-to @submit>` | 不要再手刻「一張固定佔版面的表單」。收成一條搜尋膠囊：關鍵字輸入框＋（選配）「篩選日期」次要按鈕點了才展開日期範圍＋圓形送出鈕。全站搜尋一律走提交式（按 Enter／送出鈕／彈出層裡的套用才查），不做即時——邊打邊查在每個系統打字習慣不一樣的情況下容易誤觸，這是特地從即時搜尋改回來的決定；表單管理／文字模板頁的關鍵字雖然是純前端過濾（不打 API），還是統一走提交式，物種／狀態那類切換按鈕組才維持即時；這兩頁的分頁（`Pagination`）也是在前端切 10 筆一頁，不是後端 API 分頁，切換篩選或切換頁籤時要記得把頁碼重置回第一頁。 |
  | 清單頁的資料表格 | `<Card class="overflow-hidden p-0">` 搭配 `.desktop-data-header`／`.desktop-data-row`／`.desktop-data-cell`，在 Card 上用 `--data-columns` 定義欄寬 | 桌機表頭固定 44px、資料列固定 56px；內容維持單行並對長文字使用 `truncate`，只有使用者主動展開詳情時才套 `.desktop-data-row--expanded` 增高。不要用舊的 `<Table>`／`<TableCell>` 網格表格，也不要補空白列湊高度。身分欄用 36px 圓形圖示＋主色連結；狀態放 `Badge`；操作欄收斂成一個主要按鈕。 |

  按鈕拿掉厚重外框，靠實色／淡色填底分層級（`default` 實色、`outline`／`secondary` 淡色填底、`destructive` 淡紅底、`destructive-solid` 實心紅）；**所有按鈕在靜止狀態都必須有底色**，不能只在 hover 時才顯形。專案不提供透明按鈕變體，低層級的中性操作（編輯、展開、關閉等）統一使用 `secondary`。唯一還留危險色邊框的是 `destructive-outline`，用在比 `destructive-solid` 輕、又不想跟 `destructive` 混淆的場合（例如撤銷分享）。純圖示按鈕（`icon`／`icon-xs`／`icon-sm`／`icon-lg`）是圓形 `rounded-full`，跟一般按鈕的方形 `rounded-lg` 刻意做出區隔——圓形留給「只有一個動作、佔最小空間」的場合（分頁按鈕、篩選送出鈕）。按鈕高度由 `size` 決定（`xs` 36 / `sm` 40 / `default` 44 / `lg` 48），**不要用 `min-h-11` 覆寫**——那會讓高度與 padding 對不上。**危險操作（取消、刪除、捨棄草稿等）一律用 `variant="destructive"`**——它本身就是常駐可見的淡紅底＋紅字。整列可點卡片可沿用資料列本身的底色，純文字連結可維持文字樣式；除此之外，原生 `button` 也必須有自己的底色。**按鈕不要加漸層或光澤效果**——只有側邊欄本身保留那個手法，不要往按鈕上套。

  桌機表格與手機卡片的切換斷點統一是 `xl`(1280px)，跟 `max-w-7xl` 對齊。

  圓角三檔：控制項 `rounded-lg`（圖示按鈕例外，見上）、卡片 `rounded-xl`、對話框 `rounded-2xl`。

更完整的視覺規範見 [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md)。

## 八、開發與驗證

```bash
# 前端（client/）
npm run build          # 驗證改動用這個
npm test               # node --test，src/lib/*.test.js（純邏輯：日期、狀態、寄送彙整、表單驗證）
npm run dev            # 使用者自己開，不要主動啟動（會搶 port）

# 後端（server/）
npm test               # node --test
npm run lint           # eslint
npm run dev            # 使用者自己開
```

改完後的驗證順序：後端 `npm run lint` + `npm test`，前端 `npm run build` + `npm test`。**前端那個 `npm test` 很容易漏掉**——它只涵蓋 `src/lib` 底下的純邏輯，但改動色彩 token 或狀態語意時正是它會抓到問題（斷言綁的是語意 token 名，不是色階名）。dev server 通常已經在跑（3000 / 5173），可以直接 curl API 驗證。

幾件要注意的：

- **寄送 Email 會真的發信給飼主**，是不可逆的對外行為，不要為了驗證而擅自觸發。要驗證寄送路徑請先問過。
- 產 PDF（`GET /api/records/:id/pdf`）不對外，可以放心呼叫。
- 開發連的 MongoDB 是測試環境，寫入測試資料不必主動清除。
- 純邏輯要能被測到就別留在路由檔裡——測試若 import `routes/records.js` 會連帶載入 puppeteer 與 nodemailer。結案驗證已抽到 `server/src/lib/recordValidation.js`。
- 帳號密碼相關的維護動作一律走 `server/scripts/`（`auth:hash-password`／`auth:set-password`／`auth:revoke-sessions`），不要手動寫 MongoDB——這幾支腳本會同時處理密碼雜湊格式與 `tokenVersion` 撤銷，手動改容易漏掉其中一步。

## 九、現況與待辦

已完成：三個核心 collection 與 CRUD、健檢表單自訂、報告填寫與草稿自動存檔、結案與鎖定、修訂版、PDF 產生、Email 寄送與流水帳、分享連結、工作台、跨寵物報告清單、全站搜尋、當日掛號與候診流程、病歷日誌（隨手記事，見第二節 `clinicalNotes`），以及共用帳號登入（JWT HttpOnly cookie、`tokenVersion` 可撤銷 session、登入限流、`/api/auth/login` 密碼驗證用固定時間比對防帳號列舉、前端 401 自動導回登入頁）。

舊系統資料遷移：盤點過 `Data/` 底下的舊 Access 資料庫（全套動物醫院管理系統），確認實際有在用的只有 `RegData.mdb::RecordData`（飼主/寵物主檔＋逐年累加的病歷全文），其餘（收費、庫存、藥局、診斷字典、疫苗提醒等）用量證據薄弱，不遷移。遷移腳本在 `server/scripts/legacy-migration/`（PowerShell 抽取 + Node 匯入，兩階段，見該資料夾 README）。

待處理（依急迫性）：

1. `/owners`、`/pets` 的**搜尋**走不到索引 —— 目前使用不區分大小寫、未錨定開頭的正規表示式；資料量大後要改用 text index 或 collation。目前資料量仍可接受。

部署見 [docs/ZEABUR_DEPLOY.md](docs/ZEABUR_DEPLOY.md)。

## 十、維護這份文件

改動落地後，對照下表看有沒有需要同步的段落：

| 改了什麼 | 要更新 |
|---|---|
| Mongoose schema 欄位、索引 | 第二節 |
| 新增／改名／刪除 API 路由 | 第五節 |
| 新增前端頁面或路由 | 第六節 |
| 換套件、加開發指令 | 第三節、第八節 |
| 狀態機（`status`／`deliveryStatus`／`event`）語意 | 第二節、第七節色彩語意 |
| 做完待辦、發現新問題 | 第九節 |

只改實作細節（重構、修 bug、調樣式）而沒有動到上面這些面向時，不需要動這份文件。

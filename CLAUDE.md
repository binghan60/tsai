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
`name`、`phone`、`email`、`address`、`notes`（皆選填，僅 `name`／`phone` 必填）。一位飼主可養多隻寵物。

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
`petId`、`entryDate`、`content`、`source`（`manual` / `legacy_import` / `appointment`）。醫師看診或拿藥時隨手記的自由文字記事，不用填表、不用結案，跟 `medicalRecords`（結案才鎖定的正式健檢報告）是兩條平行的軌道——日誌給日常記事用，健檢報告給需要 PDF／分享的正式場合用。`source: 'legacy_import'` 的記事來自舊系統資料遷移（見 `server/scripts/legacy-migration/`），內容是舊系統逐年累加的病歷全文，整段當一筆記事匯入，不逐筆拆分（舊資料格式不一致，拆分風險高於價值）。

`source: 'appointment'` 的記事跟掛號的 `visitNote`（見第二節 appointments）是**同一份資料、雙向同步**：`POST /api/appointments/:id/workflow/clinical` 帶了 `visitNote`／`weightKg`／`temperatureC` 任一個而內容非空時，會建立（或更新）一筆用 `appointmentId` 連結的日誌（見 `routes/appointmentWorkflow.js`，內容由 `lib/appointmentWorkflow.js` 的 `appointmentJournalContent` 把量測值與紀錄併起來）；反過來，`PUT /api/clinical-notes/:id` 若這筆日誌的 `appointmentId` 有值且 body 帶了 `content`，會回頭把新內容寫回該筆掛號的 `visitNote`（見 `routes/clinicalNotes.js`）；`DELETE` 也會把對應掛號的 `visitNote` 清空，避免兩邊資料分岔。一筆掛號最多對應一筆日誌（`appointmentId` 唯一索引），`manual`／`legacy_import` 兩種來源沒有這個欄位、不受影響，一樣可自由編輯/刪除、沒有唯讀鎖定。索引 `{petId, entryDate, _id}`、`{appointmentId}`（partial unique）。刪除寵物前會檢查 `ClinicalNote.exists({petId})`，跟 `medicalRecords` 一樣擋刪除。

### chatMessages 全站內部聊天
`sender`（`vet` / `front_desk`）、`content`、`auto`（布林，預設 `false`）。醫生↔櫃台的全站即時聊天紀錄，跟任何掛號／病患都無關（例如「今天下午提早關診」），所以不像 `visitNote`／`clinicalNotes` 那樣掛在 `petId`／`appointmentId` 底下，也沒有雙向同步這回事——單純是一份不斷增長的訊息紀錄。前端用浮動視窗呈現（`GlobalChatWidget`，見第六節），身分是裝置固定的（`useStaffIdentity`，存在 `localStorage`），不是頁面固定或使用者帳號決定的。索引 `{createdAt: 1}`。**不是每一筆都是使用者手動打字送出的**：診療台與櫃台工作台（見第六節）每完成一個會改變掛號狀態或內容的動作，會自動用同一支 `POST /chat/messages` API 補一則描述動作內容的系統訊息（例如「「豆豆」已完成看診，交給櫃台處理」）。文案集中在 `lib/appointmentNotifications.js`，送出的共用進入點是 `composables/useAppointmentNotifier.js`，`sender` 一樣是操作當下那台裝置的固定身分，`auto` 標成 `true`。`auto` 純粹是顯示用的標記——聊天視窗靠它在訊息旁加一個「自動通知」小標籤，跟手動打字的訊息區分開來；也讓發出動作的那台裝置自己判斷要不要跳未讀紅點（見下）。

### deliveryLogs 寄送流水帳
append-only，每次寄送嘗試寫一筆：`recordId`、`reportNumber`、`petName`、`ownerName`、`event`（`queued`/`sent`/`failed`）、`recipient`、`messageId`、`error`、`createdAt`。

**刻意不設 `ref`、改冗餘存報告編號與姓名**——報告可以被刪除，而這筆紀錄的價值正是在報告消失後還查得到寄給了誰。同理它是獨立 collection 而不是內嵌陣列。medicalRecords 上的 `sentTo`/`sentAt` 只留得住最後一次，重寄就覆蓋。

### users 帳號
`username`（unique）、`passwordHash`（`scrypt$<salt>$<hash>`，`select: false`）、`active`、`tokenVersion`。單人診所共用一組帳號，不是多使用者系統。

第一次啟動時若這個 collection 是空的，會用環境變數 `AUTH_USERNAME`／`AUTH_PASSWORD_HASH` 自動建立一筆（`config/auth.js` 的 `ensureBootstrapUser`）；建立後這兩個環境變數就不會再被讀取。之後要換密碼或撤銷登入用 `npm run auth:set-password -- <帳號> <新密碼>` / `npm run auth:revoke-sessions -- <帳號>`（見 `server/scripts/`），不是改環境變數重開機。

**登入用的 JWT 是無狀態的，`tokenVersion` 是唯一的撤銷手段**：token 簽章與過期時間本身沒辦法中途作廢，所以每次請求都會多查一次這筆帳號文件，比對 `tokenVersion` 是否跟簽發當下相同、`active` 是否仍為真。改密碼／執行 revoke-sessions／停用帳號都會讓 `tokenVersion` +1，現有 cookie 立刻失效，不用等 30 天自然過期。

### appointments 掛號與候診
只服務當日門診時間軸。`date`／`time` 是登記來源（`date` 由掛號時指定，預設今天），`scheduledAt` 供排序；既有病患帶 `ownerId`／`petId`，初診可先留空，但兩種情況都保存 `ownerName`／`ownerPhone`／`petName`／`species` 快照。**`ownerName` 在掛號階段是選填**——接電話時常常只問得到寵物名跟電話；`petName` 才是必填，一筆掛號至少要指得出是誰要來。到 `POST /:id/check-in` 才必填飼主姓名與電話，因為那一步要真的建立 `Owner` 文件，而 `Owner.name` 是必要欄位。

**一條四步流水線：預約 → 候診 → 看診 → 櫃台完成。** 真相是三個里程碑時間戳記，`status` 由它們推導出來，不是另一個獨立的維度（推導在 `lib/appointmentWorkflow.js` 的 `applyWorkflowAction` 尾端）：

| 里程碑 | 寫入時機 | 對應 `status` |
|---|---|---|
| `visitStartedAt` | 醫師在診療台開啟工作區（`POST /workflow/start`）——開啟即視為開始看診，沒有另一顆「開始看診」按鈕 | `arrived` |
| `handoffAt` | 醫師「完成看診，送交櫃台」（`POST /workflow/handoff`） | `pending_checkout` |
| `deskCompletedAt` | 櫃台「完成處理」（`POST /workflow/complete`） | `completed` |

`status` 仍是 `scheduled`／`arrived`／`pending_checkout`／`completed`／`cancelled`／`no_show`（索引、號碼牌與排班邏輯都依賴它），只是 `pending_checkout` 現在讀作「醫師已交櫃台、櫃台還沒處理完」。刻意不留 `arrived → completed` 的直接路徑（`lib/appointmentStatus.js` 的 `ALLOWED_TRANSITIONS` 沒有這條邊），逼所有看診都經過一個明確的交接點。

**`POST /workflow/reclaim`（取回這筆）是唯一的回頭路**：`handoffAt` 清成 null，這筆退回 `arrived` 讓醫師補資料。**櫃台按下「完成處理」之後就不能再取回**（`deskCompletedAt` 有值時回 409）——那時號碼牌已歸還、就診已結案。這條回頭路是刻意保留的：舊版「批價完成就再也改不了」正是當時最卡的地方。

`workflowVersion` 標記這筆用的是哪一代流程：`2` ＝這條四步流水線，`1` 是舊的批價／收款版本，`0` 是更早只有 `status` 的版本。舊版欄位（`billingItems`／`billingSubtotal`／`checkoutTotal`／`paymentMethod`／`billingCompletedAt`／`paymentCompletedAt`／`billingRevision`／`pendingCheckoutAt`／`visitCompletedAt`／`handoffAcknowledgedAt`）**已經從 schema 移除、讀不回來**，所以 `shared/appointmentWorkflow.js` 的 legacy 分支改由 `status` 回推階段（`pending_checkout` ＝已交櫃台、`completed` ＝已完成），不做資料庫遷移——沒有人會再去操作已結案的舊掛號，回推只是要讓它們在清單上落在正確的那一格。第一次被新流程碰到時 `adoptWorkflow` 會補上里程碑並把 `workflowVersion` 設成 2。

**四個文字欄位，各有各的讀者**（早期版本把批價／開藥擠成結構化清單又拆成三個欄位，後來確認診所根本不用系統計價，整組退場改回純文字）：

- `visitNote` 本次簡易紀錄：醫師寫的病歷內容，跟 `clinicalNotes`（病歷日誌）**雙向同步**（見第二節 clinicalNotes）——`POST /workflow/clinical` 帶了 `visitNote`／`weightKg`／`temperatureC` 任一個就建立／更新／刪除對應日誌，反過來直接編輯那筆日誌也會回頭覆蓋這裡。飼主看不到，也不進健檢報告。
- `handoffNote` 給櫃台的交辦：收費項目、領藥、要開的證明都寫這裡，**取代了早期逐項計價的批價清單**。系統不解析內容、不計價、不加總，也不記任何金額——櫃台讀這段文字自行收費。
- `specialCareNote` 請轉告飼主：面向飼主的照護提醒（例如「傷口勿舔舐」）。跟 `handoffNote` 語意分開才能在櫃台端用警示樣式獨立呈現——那是最容易漏講的一件事。刻意不跟 `clinicalNotes` 同步，單一資料來源留在 `Appointment` 上。
- `followUpRecommendation` 回診建議：醫師寫期間與原因，櫃台跟飼主敲定實際時段後才真的掛下一次的號。

這四欄加上 `weightKg`／`temperatureC` 是同一支 `POST /workflow/clinical` 的可選欄位，前端自動存檔（1.2 秒 debounce）。**櫃台按下完成處理之後就整組鎖定**（回 409）。醫生↔櫃台真正想聊、跟哪個病患無關的內容（例如「今天下午提早關診」），走全站聊天浮動視窗，不是這些欄位——見第六節 `GlobalChatWidget` 與第二節 `chatMessages`。

`followUpDate`（`YYYY-MM-DD`）與 `followUpTime`（`HH:MM`）分開存，理由跟 `date`／`time` 一樣是避免日期因伺服器時區偏移。它們只由 `POST /workflow/followup` 寫入——那是櫃台跟飼主敲定時段的那一刻，會在同一個 transaction 裡建立（或就地改期）下一筆掛號（`visitType: 'return'`、身分快照與 `templateId` 都照抄這次掛號，`reason` 取 `followUpReason`，沒填則用「回診」墊底），新掛號的 `_id` 記在 `followUpAppointmentId` 上。回診時段有驗證（10:00–11:30、14:00–19:30，每 5 分鐘一格，且不得早於本次就診）；已經被現場另外處理過（不再是 `scheduled`）的下一筆掛號不回頭改期，改回 409 要求從那筆掛號本身處理。

**`checkinNumber` 是候診佇列裡的位置，不是報到時發的票號，而且完全自動——沒有手動指定的入口。** 同一天所有持有號碼牌的掛號（`arrived` 或 `pending_checkout`，統稱「人還在診所」，見 `lib/appointmentStatus.js` 的 `holdsCheckinNumber`），號碼是連續的 1..N；報到接到隊尾，離開佇列（完成／取消／未到／取消報到）就清成 null 並讓後面的人遞補。**送交櫃台轉入 `pending_checkout` 時不歸還號碼牌**——人還要去櫃台領藥付錢，號碼牌代表「現場還在」，不是「還沒看診」。因此「這個號碼已經被用掉」在結構上不存在，不需要靠衝突檢查去擋——檢查本來也擋不住併發。代價是排在後面的人號碼會隨著前面的人看完而變小，那正是即時位置該有的行為。排序與編號規則在 `lib/appointmentQueue.js`（純邏輯，可測）。



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
| 即時通訊 | Socket.IO | 兩種用途：掛號狀態即時同步（醫生↔櫃台，房間以「天」為單位 `appointments:<date>`）、全站內部聊天（不分房間，`io.emit` 廣播給所有連線）；伺服器掛在 Express 的 httpServer 上（`server/src/lib/realtime.js`），沿用既有的 cookie session 驗證連線 |
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

飼主（沒有對應的前端頁面——飼主不是獨立可瀏覽的實體，見第六節 `/pets`、`/pets/:id`）
GET    /api/owners                      列表（?q= 搜尋姓名/電話），供 `/pets/new` 搜尋既有飼主
POST   /api/owners                      供 `/pets/new` 新增飼主分頁與舊資料匯入使用
POST   /api/owners/with-pet             新飼主與其第一隻寵物一次建立，transaction 內完成，任一端失敗整筆回滾——`/pets/new` 選「新增飼主資料」時走這支
GET    /api/owners/:id                  詳情（含旗下寵物）——`/pets/new?ownerId=` 深連結用來自動鎖定飼主
PUT    /api/owners/:id                  供 PetDetailPage 就地編輯飼主資料使用
DELETE /api/owners/:id                  目前沒有 UI 入口會呼叫；不是死代碼，是刻意保留在後端的行政操作

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
PUT    /api/clinical-notes/:id          編輯日誌內容／日期；來自掛號同步的日誌（appointmentId 有值）改 content 會回寫掛號的 visitNote
DELETE /api/clinical-notes/:id          刪除日誌；來自掛號同步的日誌會一併清空掛號的 visitNote

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
PATCH  /api/appointments/:id/check-in-number  手動改發出去的實體號碼牌
POST   /api/appointments/:id/cancel     取消掛號
POST   /api/appointments/:id/no-show    標記未到診
POST   /api/appointments/:id/restore    恢復已取消或未到診的掛號，以及候診中的「取消報到」
DELETE /api/appointments/:id            永久刪除（僅限已取消或未到）

看診流水線（全部掛在 /api/appointments/:id/workflow/:action，見 routes/appointmentWorkflow.js）
每一支都必須帶 body.version＝目前的 __v，不符回 409；整支路由跑在同一個 transaction 裡，
掛號、病歷日誌、回診掛號與健檢報告草稿要嘛一起成功、要嘛一起回滾。
POST   .../workflow/clinical            存量測與四個文字欄位（weightKg/temperatureC/visitNote/handoffNote/
                                       specialCareNote/followUpRecommendation/followUpReason），前端自動
                                       存檔用；帶到 visitNote/量測時同步病歷日誌。櫃台完成後回 409
POST   .../workflow/start               開啟工作區＝開始看診，寫 visitStartedAt
POST   .../workflow/handoff             完成看診，送交櫃台：寫 handoffAt → pending_checkout，號碼牌不歸還
POST   .../workflow/reclaim             取回這筆：清 handoffAt → 退回 arrived；deskCompletedAt 已寫入時回 409
POST   .../workflow/complete            櫃台完成處理：寫 deskCompletedAt → completed，歸還號碼牌
POST   .../workflow/followup            櫃台敲定回診時段：寫 followUpDate/Time 並建立（或改期）下一筆掛號
POST   .../workflow/record              建立／取得本次就診綁定的健檢報告草稿（body.templateId）

內部聊天（全站，不綁掛號／病患）
GET    /api/chat/messages               最近訊息（?limit=，預設 100），依時間正序回傳
POST   /api/chat/messages               新增一則訊息，body { sender: 'vet'|'front_desk', content }，
                                       成功後透過 Socket.IO 廣播給所有連線

即時通訊（Socket.IO，掛在 httpServer 上，沿用既有 cookie session 驗證）
join-day / leave-day（client→server）  加入／離開 appointments:<date> 房間
appointment:updated（server→client）   掛號本身狀態／欄位變動時廣播完整掛號文件（報到、取消、標記未到、恢復、調整
                                       號碼牌，以及 workflow 的每一支動作都會觸發），讓開著 `/appointments`
                                       診療台與 `/reception` 櫃台台的其他電腦即時反映新狀態，不用等 30 秒輪詢
chat:new（server→client）              全站內部聊天新增一則訊息時廣播，不分房間、廣播給所有已連線的 socket

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
| `/appointments` | 醫師診療台 | **左欄常駐候診佇列＋右欄可同時開多筆的看診工作區**（`VetConsolePage` ＋ `VisitWorkspace`）。佇列分「候診中／看診中／已交櫃台」三段（＋今日已完成收合），點一筆就在右欄開一個分頁——**開啟工作區＝開始看診**，不必再按一次「開始看診」。**刻意不換頁也不用 Modal**：醫師手上常常同時有好幾隻動物在跑（等一隻的檢驗結果時先看下一隻），換頁與 Modal 一次都只能停在一筆上。分頁是各自獨立掛載的 `VisitWorkspace`（`v-show` 切換，不是換 props），切回來未儲存的輸入還在。工作區左欄是體重／體溫＋本次簡易紀錄＋歷次病歷日誌，右欄是給櫃台的交辦／請轉告飼主／回診建議＋建立正式表單；1.2 秒 debounce 自動存檔，別人同時改到同一欄才跳衝突提示讓使用者選版本。底部只有一顆主要按鈕「完成看診，送交櫃台」；已交出去的那筆改成「取回這筆」，佇列的「已交櫃台」段落每一列也有「取回」。 |
| `/reception` | 櫃台工作台 | **以「現在該做什麼」分匣**（`ReceptionPage`），時間軸退到右欄當參考。左欄由上而下就是櫃台的優先順序：**醫師已交辦·待處理**（人正站在櫃台前，用主色框起來）→ **待報到**（inline「報到」＋更多操作）→ **待安排回診** → **今日已完成**（收合）。點「處理」開右側 `HandoffSheet`，段落順序刻意是「請轉告飼主 → 醫師交辦 → 本次簡易紀錄（收起）→ 回診安排」——那就是櫃台當面講話的順序，轉告事項最容易漏掉所以放最上面並用警示底色。「完成處理」一顆按鈕收尾：還沒掛號的回診先掛上再結束這次就診。候診中的人不在左欄任何一個匣子裡，所以時間軸上還沒開始看診的那幾列帶了「修改掛號／取消報到」，那是他們唯一的行政出口。右欄是現場人數統計＋上午診/下午診時間軸（含「現在」線）。 |
| `/pets`、`/pets/:id` | 寵物列表／詳情 | **飼主不是獨立可瀏覽的實體**——沒有 `/owners` 或 `/owners/:id`，飼主資料一律以附帶資訊的形式跟著寵物出現。詳情頁把寵物資料與飼主資料合併在同一張卡片裡、中間用分隔線隔開（`pets.ownerId` populate 出 `name/phone/email/address/__v`），而不是兩張並排的卡片——報到時兩邊資料要一眼同時看到，兩張卡片在視覺上等於多切一刀。兩邊各自獨立「編輯」後直接就地變成輸入框、儲存/取消，不彈 Modal，互不影響彼此的編輯狀態。下方病歷日誌（隨手記事，見第二節 `clinicalNotes`）與歷次健檢報告用頁籤（`FilterTabs`）切換，不會同時整段展開——避免兩份可能很長的清單同時佔滿版面 |
| `/pets/new` | 新增寵物 | 飼主與寵物欄位合併成同一頁（不是 Modal）——欄位量（飼主搜尋/新增＋完整寵物資料）已經跟健檢表單一樣值得有自己的網址，塞進 Modal 只會逼出內部再捲動一層。飼主段用 `SegmentedControl` 切「選擇既有飼主」（搜尋清單）或「新增飼主資料」，跟寵物欄位一次送出；有離開頁面前的未儲存提示。送出成功導去新寵物的 `/pets/:id` |
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
- **全站即時聊天是右下角常駐的浮動視窗**（`GlobalChatWidget.vue`），不是側邊欄徽章也不是頁首鈴鐺——早期版本做過側邊欄「看診」「櫃台」未讀徽章＋卡片紅點（把留言綁在單一掛號上），後來發現醫生／櫃台真正想聊的內容常常跟哪個病患無關（例如「今天下午提早關診」），逼著使用者為了聊天去點開一筆掛號，體驗本末倒置，所以拆成獨立、不綁任何掛號／病患的全站聊天，任何頁面都叫得出來（`route.meta.bare` 的公開頁除外，例如 `/report/:token`、登入頁）。訊息存在 Pinia store（`stores/chat.js`），只在記憶體裡、不持久化（歷史紀錄本身在後端 `chatMessages` collection）：`unreadCount` 給浮動泡泡顯示未讀數字，`isOpen` 放在 store 裡讓 `addMessage` 自己判斷要不要計未讀，視窗打開時呼叫 `store.open()` 直接歸零。**身分是裝置固定的**（`useStaffIdentity`，存在 `localStorage`）——這台電腦第一次用聊天室時選一次「醫生」或「櫃台」，之後記住；因為聊天不像掛號頁那樣有「目前在哪一頁」可以借來推斷身分。連線生命週期跟頁面內容脫鉤：`useGlobalChat`（`App.vue` 掛載時呼叫一次，取代舊版 `useGlobalAppointmentNotifications` 的角色）負責整個 App 存活期間的 Socket.IO 連線（登入才連、登出就斷並清空）；掛號頁面自己的 `useAppointmentRealtime` 只負責依使用者選的日期 join/leave 房間與訂閱 `appointment:updated`，**不再自己開關連線**——如果頁面卸載時呼叫 `disconnect()`，會把聊天視窗仍在用的同一條連線切斷。發送訊息不需要判斷「是不是自己發的」來排除自我通知——伺服器的 `chat:new` 廣播會送回發話者自己的裝置，`addMessage` 只看 `isOpen` 狀態決定要不要計未讀，跟身分無關，比舊版 `sentMessageTracker` 那套「送出前佔位、避免 socket 廣播搶先於 HTTP 回應」的機制單純很多。

## 七、UI／視覺設計規範

- **明暗主題**：後台管理頁面支援明暗切換，側邊欄最下方有切換鈕，狀態存 `localStorage`、預設跟隨系統。共用邏輯在 `client/src/composables/useTheme.js`，深淺色用 Tailwind 的 `dark:` variant（`@custom-variant dark` 定義在 `style.css`，對應 `<html class="dark">`）。
  - **主色 = 深青藍 `petrol`(50–900)**，明暗兩態同一個色相、只換明度：淺色 `petrol-600` 配白字，深色 `petrol-400` 配深墨字（亮階當底、`on-primary` 當字）。主色刻意不放在紅色區——紅色完整讓給 destructive 與 failed，金色 `brand` 只留給側邊欄 active 與 Logo，三者各佔一塊色相互不重疊。
  - **表面 = 冷中性 `paper`(0–900)**：整條色階在 OKLCH 上算出來，色相固定 220（與 petrol 深端同家族）、明度階距是排過的、彩度隨明度緩升 0→0.026。淺色頁面底 `paper-100`、卡片純白，卡片靠 1.10 的明度差加一條細邊框浮起來（邊框 `paper-300` 對卡片 1.46——舊值只有 1.38，而這個設計裡邊框是承重的）。舊版是象牙卡片疊在米黃底上（對比 1.22），卡片是不是獨立物件全靠深卡其邊框硬切，整片畫面因此又黃又髒。**頁面底不要再疊漸層**：層數越多卡片越浮不起來。
  - **深色維持科技感深藍黑**：`#061014` 頁面底 / `#0b1a1e` 卡片 / `#32464d` 邊框，文字是中性偏冷的白 `#e3eef0`（原本的暖米白疊在 petrol 上會發黃）。
  - **深色的表面明度是一條排過的梯子**，不要隨手插新的一層：頁面底 16.5 → 卡片 20.5 → `field` 22.8 → `popover` 24.6 → `accent` 26.7 → 狀態底 29 → `muted` 31 → `secondary` 35 → 邊框 38。梯子的頂端由主色反推：`petrol-400` 是固定的，主色文字站在任何表面上都要有 4.5，因此**會承載 `text-primary` 的表面不能亮過 L24.6**（`field`、`popover` 都受這條限制）。舊版 accent/field/destructive-surface/muted 四層全擠在 3 個明度點內，畫面上就是同一塊「比卡片亮一點的東西」。
  - `belle`／`cream`／`ink` 已經退位成報告紙面與側邊欄專用，**後台頁面不要再碰**。
- **一律用語意 token，不要在頁面手寫色票。** `bg-card`／`bg-field`／`text-foreground`／`text-muted-foreground`／`border-border`／`bg-muted`／`bg-accent` 這組已經自己處理明暗兩態，寫 `text-ink-900 dark:text-white` 這種雙寫只會製造出第二套色彩系統——兩套並行正是「配色沒問題但細節很髒」的來源。需要新的語意角色時，加 token 到 `style.css`，不要在使用端硬寫。
  - **狀態語意有四組 token**：`--success`／`--warning`／`--info`／`--danger`，每組各配一個 `-surface` 底色，使用端寫 `bg-success-surface text-success`。**不要用 Tailwind 的 `emerald-50`／`amber-50` 那類固定色階**——它們是冷調亮白，疊在卡片上對比只有 1.00–1.02，底色等於沒畫出來，狀態實際上只剩文字顏色在傳達。
  - **四個狀態色的明度是刻意錯開的，看起來不整齊是對的，不要「順手對齊」。** 紅綠色盲（約占男性 8%）下紅與綠會塌到同一色相上，唯一還留著的線索就是明度差。舊版四個狀態色明度全擠在 L47–52，模擬紅綠色盲後「已寄送」與「寄送失敗」的 ΔE 只有 1.6，等於同一個顏色；現在三個暖／綠色相在可用區間內拉開（淺色 danger L38 / warning L44 / success L50，深色方向相反 danger L84 / warning L77 / success L70），最小 ΔE 6.2。**兩個主題共通的原則是：四個狀態色裡，危險永遠是對比最高的那一個。**
  - 狀態色的明度上限由「徽章文字站在自己的 `-surface` 上要有 5:1」決定，淺色約 L50 就到頂。注意 **WCAG 亮度對綠色加權特別高**，同樣的 OKLCH 明度下綠色實際對比會比琥珀色低一截，`--success` 因此不能再往上抬。
  - `--info` 是 H266 而不是更接近主色的藍：舊值 H237 跟 petrol 主色（H218）只差 19°，「寄送中」的徽章和主色連結在畫面上是同一種藍，違反「狀態不會被誤讀成主色」。**新增狀態色時要跟主色留 40° 以上的色相距離。**
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
  - **圖表色走自己的 slot**：`--chart-1`（淺 `#007f98` / 深 `#16a2c1`），不要借 primary。primary 是 petrol-600/400，OKLab 彩度只有 0.073／0.086，過不了驗證器的 chroma floor（0.1）——那條檢查在講「這個顏色鋪成色塊會讀成灰的」。`--chart-1` 是同色相家族往飽和再走一階，明暗兩態都通過 lightness band、chroma floor 與 3:1 對比。要加第二個序列就往 `--chart-2` 擴，不要在使用端挑色。
  - 全站目前只有一張圖：工作台的「近 6 週健檢量」（`components/TrendBars.vue`）。單一序列的量值長條，所以沒有圖例（標題就說明了它是什麼）、沒有 y 軸刻度、沒有格線；直接標籤只給最新一根，其餘靠 tooltip；`sr-only` 清單提供完整數值。**數量為 0 的那一週仍保留 2px 高的底**——高度歸零會讓人以為那一根不存在，「這週是 0」跟「沒有這週」必須看得出差別。
  - 工作台原本還有一條報告狀態堆疊長條，已經拿掉：它把「已寄送」（完成、不用管）跟待處理狀態混在同一條上，長條變長只代表資料變多、不代表有事要做。那份資訊現在是四格可點的數字。要做這種「沿用狀態語意色」的圖時記得狀態色兩兩之間在紅綠色盲下的模擬 ΔE 最低只有 6.2，段與段之間要留可見分隔線、圖例要帶標籤與數值——顏色不能是唯一線索。
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

  按鈕拿掉厚重外框，靠實色／淡色填底分層級（`default` 實色、`outline`／`secondary` 淡色填底、`destructive` 淡紅底、`destructive-solid` 實心紅）；**所有按鈕在靜止狀態都必須有底色**，不能只在 hover 時才顯形。專案不提供透明按鈕變體，**也不提供任何邊框型按鈕變體**——沒有一個 variant 會在靜止狀態畫邊框（`border` 只留在 base class 裡給 `aria-invalid` 焦點圈用，平常是 `border-transparent`）。原本的 `destructive-outline`（描邊＋卡片底色，用在比 `destructive-solid` 輕的危險操作）已經拿掉，統一改用 `destructive` 的淡紅底——危險操作只分兩級：`destructive` 淡紅底（尚未進入最終確認）與 `destructive-solid` 實心紅（確認視窗內的最終動作），中間不再有第三種靠邊框區分的變體。低層級的中性操作（編輯、展開、關閉等）統一使用 `secondary`。純圖示按鈕（`icon`／`icon-xs`／`icon-sm`／`icon-lg`）是圓形 `rounded-full`，跟一般按鈕的方形 `rounded-lg` 刻意做出區隔——圓形留給「只有一個動作、佔最小空間」的場合（分頁按鈕、篩選送出鈕）。按鈕高度由 `size` 決定（`xs` 36 / `sm` 40 / `default` 44 / `lg` 48），**不要用 `min-h-11` 覆寫**——那會讓高度與 padding 對不上。**危險操作（取消、刪除、捨棄草稿等）一律用 `variant="destructive"`**——它本身就是常駐可見的淡紅底＋紅字。整列可點卡片可沿用資料列本身的底色，純文字連結可維持文字樣式；除此之外，原生 `button` 也必須有自己的底色。**按鈕不要加漸層或光澤效果**——只有側邊欄本身保留那個手法，不要往按鈕上套。

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

已完成：三個核心 collection 與 CRUD、健檢表單自訂、報告填寫與草稿自動存檔、結案與鎖定、修訂版、PDF 產生、Email 寄送與流水帳、分享連結、工作台、跨寵物報告清單、全站搜尋、病歷日誌（隨手記事，見第二節 `clinicalNotes`），以及共用帳號登入（JWT HttpOnly cookie、`tokenVersion` 可撤銷 session、登入限流、`/api/auth/login` 密碼驗證用固定時間比對防帳號列舉、前端 401 自動導回登入頁）。

診務流程目前是**兩頁一條線**：`/appointments` 醫師診療台、`/reception` 櫃台工作台，共用 `shared/appointmentWorkflow.js` 定義的四步流水線（預約 → 候診 → 看診 → 櫃台完成）。這是一路演化來的，中間走過的路都留在下面，因為每一條都是被實際使用回饋否定掉的：

1. **一開始拆成醫生頁／櫃台頁兩頁，各自固定發言身分**——結果權責混亂（該由誰報到、誰填量測、留言又該綁在哪一頁），而且留言綁在單一掛號上，跟哪個病患無關的內部溝通（例如「今天下午提早關診」）無處安放。
2. **於是合回單一頁 `/appointments`**，留言拆成獨立的全站聊天浮動視窗（`GlobalChatWidget`，身分裝置固定，見 `useStaffIdentity`）。這個決定至今有效——聊天確實不該綁在掛號上。
3. **接著在同一頁上長出「醫生↔櫃台交接」的工作流**：`pending_checkout` 狀態、結構化的批價／開藥清單（`billingItems`）、結算總額與收款。批價欄位越加越多，候診卡片塞不下，又拿 `sectionOpen` 收合行政操作來救。
4. **最後使用者確認診所根本不用系統計價**：批價、開藥、要開的證明全部併回一段給櫃台看的純文字（`handoffNote`），金額完全不記也不統計。這一刀把 `billingItems`／`billingSubtotal`／`checkoutTotal`／`paymentMethod`／`billingRevision`／付款方式／折讓原因／當日營收統計、以及「待批價」「待收款」兩個狀態全部移除，狀態機從五步收成四步。同一次也修掉三個一直卡著的問題：醫師端本來就沒有批價輸入介面（`AppointmentBillingEditor` 是孤兒元件）、批完價無法反悔、各分頁數字加總對不上當日總數。

第 4 步同時重做了版面，這次**是重新拆成兩頁，但拆的方式跟第 1 步不同**：不是用路由鎖身分（那正是第 1 步失敗的原因），而是兩頁看同一份資料的不同切片，任何裝置都能開任何一頁、按任何按鈕。醫師頁解掉的是「一次只能停在一筆病患上」——舊版點一筆會整頁跳到 `/appointments/:id/visit`，比更早的 Modal 版更封閉；現在右欄是可以同時開多筆的工作區（各自獨立掛載、`v-show` 切換，未儲存的輸入不會因為切分頁而消失）。櫃台頁解掉的是「要自己在時間軸上掃描誰該處理」——改成三個依優先順序排列的待辦匣，時間軸降為右欄參考。醫師「送交櫃台」之後仍可**取回這筆**（`POST /workflow/reclaim`），直到櫃台按下「完成處理」為止，這是刻意補上的回頭路。

一併清掉的死代碼：`AppointmentsPage.vue`（1880 行，早已無路由引用，但 `appointmentNotifications.test.js` 還在讀它的原始碼當斷言來源，等於測試在測一個下線的頁面）、`AppointmentWorkspacePage.vue`、`AppointmentVisitPage.vue`、`AppointmentDeskPanel.vue`、`AppointmentListRow.vue`、`AppointmentRowActions.vue`、`AppointmentQueueCardItem.vue`、`AppointmentBillingEditor.vue`、`lib/appointmentBilling.js`，以及 `routes/appointments.js` 裡的 `/send-to-checkout`、`/reopen-visit`、`/complete`、`/visit-data` 四支舊端點與 `syncFollowUpAppointment`（回診掛號改由 `POST /workflow/followup` 在 transaction 內處理）。

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

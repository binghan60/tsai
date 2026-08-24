# 寵物診所報告系統 — 專案指南

> **回答一律使用繁體中文**（不用簡體字、不用英文），無論使用者用中文或英文提問都一樣。程式碼、變數名稱、commit message 等技術內容維持原樣即可，不必刻意翻譯。

> **這份文件要跟著程式碼一起改。** 動到資料模型、API 路由、頁面路由、狀態機或技術選型時，同一次改動就更新這裡對應的段落——這份文件每個 session 開場會自動載入，寫錯的描述比沒有描述更糟，會讓後續判斷建立在錯的前提上。維護方式見最後一節。

## 一、專案定位

單人使用的健檢報告產生 + 分發系統（不是看診紀錄／排班系統）。核心流程：

（例外：系統另外有一份輕量的電話預約每日看診列表，見第二節 `appointments`，純粹是「接電話登記、按日期看清單」，不做時段衝突／診間容量檢查，不構成完整排班系統。）

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
`name`、`ownerId`、`medicalRecordNumber`（自動產生 `PET-XXXXXXXX`）、`species`、`breed`、`sex`、`neutered`、`birthDate`、`weightKg`、`allergies`、`chronicConditions`、`currentMedications`、`notes`。

### medicalRecords 健檢報告
欄位分成幾組：

| 組別 | 欄位 |
|---|---|
| 基本 | `petId`、`reportNumber`（`HC-YYYY-XXXXXXXX`）、`vet`、`visitDate`、`examType` |
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

### deliveryLogs 寄送流水帳
append-only，每次寄送嘗試寫一筆：`recordId`、`reportNumber`、`petName`、`ownerName`、`event`（`queued`/`sent`/`failed`）、`recipient`、`messageId`、`error`、`createdAt`。

**刻意不設 `ref`、改冗餘存報告編號與姓名**——報告可以被刪除，而這筆紀錄的價值正是在報告消失後還查得到寄給了誰。同理它是獨立 collection 而不是內嵌陣列。medicalRecords 上的 `sentTo`/`sentAt` 只留得住最後一次，重寄就覆蓋。

### deletedMedicalRecords 刪除稽核快照
報告刪除時存一份完整快照。**目前只寫不讀**，沒有查詢介面，需要回溯時直接查這張表。

### appointments 電話預約
電話接洽時登記的每日看診列表。`date`（`YYYY-MM-DD`）／`time`（`HH:mm`，可留白）是使用者填的來源真相，`scheduledAt` 是兩者換算出的實際時刻，只服務排序與範圍查詢，由 `pre('validate')` 自動算好。

`ownerId`／`petId` 有值代表連結既有病患，為 `null` 代表初診尚未建檔；不管哪種情況都存 `ownerName`／`ownerPhone`／`petName`／`species` 快照（跟 `deliveryLogs` 一樣，理由是列表要能不 populate 就顯示，且飼主之後改名不該讓「當初電話登記的名字」跟著變）。`status`：`scheduled` / `arrived` / `completed` / `cancelled` / `no_show`，轉換規則見 `server/src/lib/appointmentStatus.js`（`completed` 是終態）。`convertedRecordId` 只是「有沒有轉出過報告」的旁證欄位，不驅動任何邏輯。

刻意不用 `optimisticConcurrency`／`relationVersion`：寫入幾乎都是單一狀態切換的按鈕操作，單人使用衝突機率低；也沒有子集合掛在底下，不會有 Owner/Pet 那種刪除競態。

索引只開 `{scheduledAt: 1}` 與 `{status: 1, scheduledAt: 1}`，對應清單排序與狀態篩選；沒有 `petId`/`ownerId` 索引，因為目前沒有「看這隻寵物過去預約紀錄」的查詢，等真的需要再補。

初診到診後透過 `POST /api/appointments/:id/create-patient` 在 transaction 中建立 Owner+Pet、回填 `ownerId`/`petId`，銜接進既有的 `/pets/:petId/records/new` 健檢報告流程——這支端點本身不建立 MedicalRecord。

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
GET    /api/pets/:id                    詳情（含報告列表）
PUT    /api/pets/:id
DELETE /api/pets/:id

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

預約
GET    /api/appointments                跨日清單（?q= 關鍵字搜尋寵物／飼主／電話／原因 / ?from=&to=YYYY-MM-DD 日期區間 / ?status= / ?page=，回傳帶 counts 給狀態徽章）
POST   /api/appointments                建立（帶 petId＝既有病患，不帶＝初診自由文字）
GET    /api/appointments/:id
PUT    /api/appointments/:id            只能改 date/time/reason/notes/petName/species/ownerPhone
PATCH  /api/appointments/:id/status     狀態轉換，非法轉換回 422
POST   /api/appointments/:id/create-patient   初診到診後補建 Owner+Pet，回傳 {ownerId, petId}
DELETE /api/appointments/:id            已完成的預約不給刪

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
GET    /api/dashboard                   彙總數字（含 todayAppointmentCount）+ 最近報告
GET    /api/public/reports/:token        公開，飼主查看報告用
GET    /api/health
```

`GET /api/records` 的 `view` 是預設工作佇列：`todo`（預設）/ `drafts` / `pending` / `failed` / `sent` / `all`。回傳帶 `counts` 給前端佇列徽章。**儀錶板卡片的數字必須跟對應佇列的筆數對得起來**——卡片可以點進清單，兩邊算法不同會直接讓人困惑。

刪除限制：`deliveryStatus` 為 `sent` 或 `sending` 的報告不給刪。

刪除確認：**只有已結案報告要打字確認**（`confirmText` 必須等於寵物名稱），草稿直接刪。打字確認防的是誤刪正式報告——它產過 PDF、可能已經給過飼主連結；草稿是工作中狀態，多一道抄名字只會訓練使用者無視確認。前端也照這個判準分流：草稿走 `ConfirmDialog`，已結案走 `DeleteRecordDialog`。

## 六、頁面規劃

| 路由 | 頁面 | 說明 |
|---|---|---|
| `/` | 工作台 | 統計卡片（可點進對應佇列）、草稿與最近報告、報告狀態圖表、寄送失敗橫幅 |
| `/appointments` | 電話預約 | 跨日清單，篩選面板（關鍵字＋起始／結束日期＋搜尋／清除）與分頁比照健檢紀錄／寄送歷程，可切換狀態，到診後可轉建健檢報告 |
| `/owners`、`/owners/:id` | 飼主列表／詳情 | |
| `/pets`、`/pets/:id` | 寵物列表／詳情 | 詳情含歷次報告 |
| `/records` | 健檢紀錄清單 | 跨寵物，佇列切換 |
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
  - **淺色 = 法國美好年代（Belle Époque）風格**：酒紅主色 `belle`(50–800)、象牙／羊皮紙底色 `cream`(50–300)、暖棕黑文字 `ink`(400–900)，定義在 `style.css`。
  - **深色 = 科技感風格**：近黑底色是帶藍的 ink 系（`#0b1218` 頁面底 / `#121b22` 卡片 / `#30434c` 邊框，定義在 `style.css` 的 `.dark`），主色是琥珀橘 `brand`(50–900)。
- **一律用語意 token，不要在頁面手寫色票。** `bg-card`／`bg-field`／`text-foreground`／`text-muted-foreground`／`border-border`／`bg-muted`／`bg-accent` 這組已經自己處理明暗兩態，寫 `text-ink-900 dark:text-white` 這種雙寫只會製造出第二套色彩系統——兩套並行正是「配色沒問題但細節很髒」的來源。需要新的語意角色時，加 token 到 `style.css`，不要在使用端硬寫。
  - `bg-field` 是「浮在卡片上的可點表面」：輸入框、狀態切換鈕、常用語籤、選取中的卡片。淺色是純白（比象牙白的卡片再亮一階），深色是比卡片略淺的凹陷面。**不要為了這類表面寫 `bg-white`**——那在深色主題是白底配米白字，等於看不見。
  - 例外只有兩個：報告頁（固定淺色，見下）與側邊欄（兩個主題都是深底，用 `sidebar-*` 那組 token，**不要用 `text-muted-foreground`**——淺色主題下那是深灰字，會糊在深色側邊欄上）。
  - `/report/:token` 與 `/records/:id/preview` 報告頁**固定淺色，不受主題切換影響**──它同時是 Puppeteer 截圖產 PDF 的來源，深色底 + 淺色文字直接列印容易變成看不見字，獨立用 `stone`/`brand` 配色，**不套用 `dark:` variant**。在那兩頁加東西時不要共用後台的樣式常數（例如 `DELIVERY_EVENT_META`），要另外定義純淺色版本。
- **報告狀態色彩語意**（徽章與圖表都要遵循同一套對應）：
  - `draft` 草稿 → 中性（徽章用 `bg-muted/60 text-foreground`；圖表用 zinc-500）
  - `finalized` 已結案 → 品牌色階 `brand`（淺色 `brand-50/700`、深色 `brand-500/10` + `brand-300`）
  - `sent` 已寄送 → 綠（emerald-600）；`failed` 寄送失敗 → 紅；`sending` 寄送中 → 天藍
  - 徽章一律用 `<Badge variant="status" :class="META[...].class">`，形狀與留白由 variant 決定、顏色由 `lib/recordStatus.js` 的 meta 提供，不要在使用端再覆寫 padding 或圓角。
- **圖示**：統一用 `@lucide/vue`，**不要用 emoji**。線條粗細統一 `stroke-width="1.75"`，顏色預設跟隨 `currentColor`。
- **圖表**：照 `dataviz` skill 的方法做──先選圖表形式（part-to-whole 用堆疊長條，不用圓餅圖）、色彩最後決定且要跑該 skill 附的 `validate_palette.js` 驗證對比與色盲安全性，不要憑感覺挑色。深色卡片（`#121b22` 底）上的分類色要比一般品牌色再深一階才過驗證。會隨主題變色的圖表，色碼要放進 `computed()`（依 `isDark` 切換），不要寫死。
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

  按鈕高度由 `size` 決定（`xs` 36 / `sm` 40 / `default` 44 / `lg` 48），**不要用 `min-h-11` 覆寫**——那會讓高度與 padding 對不上。`ghost` 平時完全透明、hover 才上色，只用在中性、低風險的操作（編輯、展開、關閉…）。**危險操作（取消、刪除、捨棄草稿等）一律用 `variant="destructive"`**——它本身就是常駐可見的淡紅底＋紅字，不需要 hover 才看得出來是危險操作。**禁止**用 `ghost` 再手刻 `class="text-destructive hover:bg-destructive/10"` 這種只有滑鼠移過去才現形的寫法：危險操作被做成視覺上跟中性操作沒有分別，使用者掃過列表時完全看不出哪個會出事。

  表格的 padding、表頭底色、sticky、hover 都在 `ui/table/*` 裡，頁面只放內容。桌機表格與手機卡片的切換斷點統一是 `xl`(1280px)，跟 `max-w-7xl` 對齊。

  圓角三檔：控制項 `rounded-lg`、卡片 `rounded-xl`、對話框 `rounded-2xl`。

更完整的視覺規範見 [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md)。

## 八、開發與驗證

```bash
# 前端（client/）
npm run build          # 驗證改動用這個
npm run dev            # 使用者自己開，不要主動啟動（會搶 port）

# 後端（server/）
npm test               # node --test
npm run lint           # eslint
npm run dev            # 使用者自己開
```

改完後的驗證順序：後端 `npm run lint` + `npm test`，前端 `npm run build`。dev server 通常已經在跑（3000 / 5173），可以直接 curl API 驗證。

幾件要注意的：

- **寄送 Email 會真的發信給飼主**，是不可逆的對外行為，不要為了驗證而擅自觸發。要驗證寄送路徑請先問過。
- 產 PDF（`GET /api/records/:id/pdf`）不對外，可以放心呼叫。
- 開發連的 MongoDB 是測試環境，寫入測試資料不必主動清除。
- 純邏輯要能被測到就別留在路由檔裡——測試若 import `routes/records.js` 會連帶載入 puppeteer 與 nodemailer。結案驗證已抽到 `server/src/lib/recordValidation.js`。

## 九、現況與待辦

已完成：三個核心 collection 與 CRUD、健檢表單自訂、報告填寫與草稿自動存檔、結案與鎖定、修訂版、PDF 產生、Email 寄送與流水帳、分享連結、工作台、跨寵物報告清單、全站搜尋、電話預約每日看診列表（含初診轉建檔）。

待處理（依急迫性）：

1. **認證機制** — 目前 `/api/*` 完全沒有保護，`/api/appointments/*` 同樣涵蓋在內。部署後任何人都能讀寫全部資料，並用 `POST /api/records/:id/send-email` 借你的 Gmail 發信（被濫用時 Google 封的是帳號本身）。單人使用不需要 JWT，一組環境變數密碼 + signed cookie 即可，但要放行 `/api/public/reports/:token` 與 PDF 存取。同時值得替寄信單獨加頻率限制。
   （已處理一半：對外連結的網域改由 `config/publicUrl.js` 決定，正式環境必須設定 `PUBLIC_APP_URL`，否則啟動失敗。濫用寄信至少不會再寄出指向他人網域的連結，但寄信本身仍然沒有任何門檻。）
2. **前端 `validateForPreview()` 沒有測試** — `RecordFormPage.vue` 裡與後端 `validateFinalRecord` 對應的那份判準是各寫一份的，後端已經釘住，前端改動會單方面漂移。
3. **`deletedMedicalRecords` 沒有查詢介面** — 只寫不讀。
4. **寄送失敗（`failed`）的報告仍可刪除** — 只擋了 `sent` 與 `sending`。
5. `/owners`、`/pets` 列表沒有分頁；搜尋是全表 regex 掃描，走不到索引。目前資料量還撐得住。
6. `appointments` 沒有「依寵物查詢歷史預約」的索引與查詢介面——v1 沒有這個查詢模式，等真的需要再補。

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

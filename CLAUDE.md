# 寵物診所報告系統 — 專案規劃

> **回答一律使用繁體中文**(不用簡體字、不用英文),無論使用者用中文或英文提問都一樣。程式碼、變數名稱、commit message 等技術內容維持原樣即可,不必刻意翻譯。

## 一、專案定位

單人使用的報告產生 + 分發系統(不是看診紀錄/排班系統)。核心流程:

```
填寫報告 → 產出 PDF → 產生分享連結 → Email 通知飼主
```

## 二、資料模型（MongoDB collections）

**飼主 owners**
- 姓名、電話、Email
- 一位飼主可養多隻貓（pets 用 `ownerId` 參照回 owner）

**貓咪 pets**
- 名字
- `ownerId`（參照 owners，`ObjectId`）
- 一隻貓可有多筆報告（medicalRecords 用 `petId` 參照回 pet）

**報告 medicalRecords**
- `petId`（參照 pets，`ObjectId`）、看診醫生、看診日期
- 主訴、病史、診斷、結論、治療計畫、其他
- `shareToken`:分享用的唯一識別碼(uuid),組成 `/report/:token` 連結
- `status`:草稿 / 已產出 PDF / 已寄送
- `sentAt`:寄送時間

## 三、技術棧

| 層級 | 選擇 | 理由 |
|---|---|---|
| 前端 | Vue 3 + Vite | |
| 後端 | Node.js + Express | 專案規模小、單人使用,不需要 Nest.js 的架構開銷 |
| 資料庫 | MongoDB | |
| ODM | Mongoose | 定義 schema、關聯用 `.populate()` 處理,體驗接近傳統 ORM |
| PDF | Puppeteer | 見下方「PDF 產生方式」 |
| Email | Nodemailer | SMTP 寄信(Gmail 應用程式密碼 / Resend 皆可) |

## 四、PDF 產生方式(關鍵架構決策)

**不在後端另外維護一份 PDF 版型。** 做法是:

1. 前端做一個「報告檢視頁」`/report/:token`,資料存 DB、前端 fetch API 後自己切版渲染
2. 這個頁面同時扮演兩個角色:
   - **給飼主看**:飼主直接打開這個連結,不需要登入
   - **PDF 來源**:後端用 Puppeteer 開無頭瀏覽器連到這個公開頁面,把渲染結果截成 PDF
3. 前端另外寫一份 `@media print` CSS,隱藏操作型 UI(導覽列、按鈕),只留報告內容

好處:排版只寫一次,前端改樣式,PDF 自動跟著變,不會有兩邊排版不一致的問題。

## 五、API 設計

```
飼主
GET    /api/owners                     列表（可搜尋姓名/電話）
POST   /api/owners                     新增
GET    /api/owners/:id                 詳情（含旗下貓咪）
PUT    /api/owners/:id                 編輯
DELETE /api/owners/:id                 刪除

貓咪
GET    /api/owners/:ownerId/pets       該飼主的貓咪列表
POST   /api/owners/:ownerId/pets       新增貓咪
GET    /api/pets/:id                   詳情（含病歷列表）
PUT    /api/pets/:id
DELETE /api/pets/:id

報告
GET    /api/pets/:petId/records        該貓咪報告列表
POST   /api/pets/:petId/records        新增報告
GET    /api/records/:id                單筆詳情
PUT    /api/records/:id                編輯
DELETE /api/records/:id
POST   /api/records/:id/generate-pdf   產生 PDF（回傳檔案）
POST   /api/records/:id/send-email     產生 PDF + 寄送給飼主

公開路由（無需登入）
GET    /api/public/reports/:token      飼主用連結查看報告，只回傳報告需要的欄位

儀錶板
GET    /api/dashboard                  彙總數字 + 最近報告
```

## 六、頁面規劃

- **儀錶板**(給老闆/醫生看全局)
  - 關鍵數字卡片:累計飼主數、累計貓咪數、本月報告數、待處理(草稿)數
  - 最近報告列表(狀態:草稿 / 已產出 PDF / 已寄送)
  - 快速新增報告按鈕
- **飼主列表**:搜尋(姓名/電話)+ 新增
- **飼主詳情**:基本資料 + 旗下貓咪列表 + 新增貓咪
- **貓咪詳情**:基本資料 + 歷次報告列表 + 各報告的「編輯 / 下載 PDF / 寄送給飼主」操作
- **報告填寫表單**:
  - 頂部常駐貓咪 + 飼主資訊(唯讀 context bar)
  - 欄位分兩組:「病人陳述」(主訴、病史)/「醫生判斷」(診斷、治療計畫、結論、其他),用分隔線區隔
  - 主訴/病史/結論/其他用較小 textarea,診斷/治療計畫給較大空間
- **報告檢視頁**(`/report/:token`,公開,無登入、無後台導覽列):飼主查看用,也是 PDF 截圖來源

## 七、UI／視覺設計規範

- **CSS 框架**:Tailwind CSS v4,用 `@tailwindcss/vite` 掛進 `vite.config.js`,設定寫在 `client/src/style.css` 的 `@theme`(CSS-first config,不用 `tailwind.config.js`)。
- **明暗主題**:後台管理頁面(儀錶板／飼主／貓咪／報告表單)支援明暗切換,側邊欄最下方有切換鈕,狀態存 `localStorage`、預設跟隨系統。共用邏輯在 `client/src/composables/useTheme.js`,深淺色用 Tailwind 的 `dark:` variant(`@custom-variant dark` 定義在 `style.css`,對應 `<html class="dark">`)。
  - **淺色 = 法國美好年代(Belle Époque)風格**:酒紅主色 `belle`(50–800)、象牙／羊皮紙底色 `cream`(50–300)、暖棕黑文字 `ink`(400–900),定義在 `style.css`。
  - **深色 = 科技感風格**:近黑底色維持 Tailwind `zinc`(950 頁面底 / 900 卡片 / 800 邊框),主色是琥珀橘 `brand`(50–900),重點元素(logo、主要按鈕)加微光陰影(`shadow-[0_0_...]`)。
  - `/report/:token` 報告檢視頁**固定淺色,不受主題切換影響**──它同時是 Puppeteer 截圖產 PDF 的來源,深色底 + 淺色文字直接列印容易變成看不見字,獨立用 `stone`/`brand` 配色,不套用 `dark:` variant。
- **報告狀態色彩語意**(`medicalRecords.status`,徽章與圖表都要遵循同一套對應,不要各用各的顏色):
  - `draft` 草稿 → 中性灰(zinc-500 `#71717a`,深淺主題共用)
  - `generated` 已產出 PDF → 深色用品牌橘(brand-600 `#ea580c`)、淺色用古董金(amber-800 `#92400e`)
  - `sent` 已寄送 → 綠(emerald-600 `#059669`,深淺主題共用)
- **圖示**:統一用 `@lucide/vue`(非 `lucide-vue-next`,已棄用),**不要用 emoji**。線條粗細統一 `stroke-width="1.75"`,顏色預設跟隨 `currentColor`。
- **圖表**:儀錶板上的圖表照 `dataviz` skill 的方法做──先選圖表形式(part-to-whole 用堆疊長條,不用圓餅圖)、色彩最後決定且要跑 `scripts/validate_palette.js` 驗證對比與色盲安全性,不要憑感覺挑色。深色卡片(`zinc-900` 底)上的分類色要比一般品牌色再深一階才過驗證(例如 `brand-500` 太亮,要用 `brand-600`)。折線圖等會隨主題變色的圖表,色碼要放進 `computed()`(依 `isDark` 切換),不要寫死。
- **字體層級**(後台管理介面,Tailwind 字級 class):

  | 層級 | Class | 字重 | 用途 |
  |---|---|---|---|
  | H1 頁面標題 | `text-xl` | `font-semibold` | 每頁最上方唯一標題(例:「飼主列表」「診所報告總覽」) |
  | H2 區塊標題 | `text-base` | `font-semibold` | 頁面內的區塊/群組標題(例:「貓咪」「歷次報告」「病人陳述」) |
  | H3 卡片標題 | `text-sm` | `font-semibold` | 密集網格內卡片自己的標題(例:儀錶板圖表卡片、「最近報告」面板) |
  | Body 內文 | `text-sm` | 預設(不加粗) | 一般文字、表格內容、清單項目 |
  | Control 控制項 | `text-sm` | `font-medium` | 按鈕、連結、輸入框文字 |
  | Label 表單標籤 | `text-xs` | `font-medium` | 表單欄位標籤 |
  | Caption 註記 | `text-xs` | 預設,搭配 muted 色(`text-ink-400/500` 或 `dark:text-zinc-500/600`) | 次要說明、時間戳記、狀態徽章文字 |

  不要用任意值字級(如 `text-[11px]`),一律對應到上表其中一層,維持全站字級一致。`/report/:token` 報告檢視頁是獨立的列印文件排版,不套用這份後台字級表(它的標題/內文尺寸見該頁面元件本身)。

## 八、開發順序建議

1. 資料庫 schema 定義(owners / pets / medicalRecords 三個 collection,用 Mongoose schema)
2. 後端 CRUD API(先飼主、貓咪,再報告)
3. 前端頁面:飼主列表 → 貓咪列表 → 報告填寫表單
4. 報告檢視頁(`/report/:token`)+ `@media print` 樣式
5. Puppeteer PDF 產生串接
6. Nodemailer 寄信串接
7. 儀錶板彙總 API + 頁面

## 九、尚待決定/確認的事項

- SMTP 寄信服務選擇(Gmail 應用程式密碼 / Resend 等)
- 正式部署的網域/主機(Puppeteer 需要連到已部署的前端網址才能截圖)
- MongoDB 主機選擇(本機 / MongoDB Atlas 免費層)
- 開發階段用 localStorage 兜的飼主/貓咪 CRUD 頁面,之後要換成打真正的 API;報告分享連結、PDF、Email 這條線建議一開始就接真的後端，不用 localStorage 過渡
- 是否需要登入/權限機制(目前規劃是單人使用,先跳過)
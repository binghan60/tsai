# 視覺規範

設計稿：https://claude.ai/artifact/Ev85Kihq8eDuUQLzsYbtBG（「第二輪 定稿規格」頁是規格，第一輪只是比較用的歷史）。
所有色值與尺度只寫在 `client/src/style.css`；頁面與元件一律用語意 token。`npm run build` 會先跑 `scripts/audit-colors.mjs`，頁面裡出現色碼或 Tailwind 固定色階（`red-500`、`slate-100`…）就直接失敗。

## 1. 兩套主題，同一套形狀

| | 淺色：清爽臨床 | 深色：深色專業 |
|---|---|---|
| 頁面底 `background` | `#f4f6f8` | `#07090c` |
| 卡片 `card` | `#ffffff` | `#0e1217`，頂端一條內側高光（`shadow-card`） |
| 下凹 `sunken` | `#f1f4f6` | `#0a0d11` |
| 滑過 `hover` | `#eef2f4` | `#141a21` |
| 邊框 `border`／`border-strong` | `#e2e8ec`／`#cbd4da` | `#1c232c`／`#2a3440` |
| 文字 三階 | `#0e1a21`／`#4b5a64`／`#5f6c76` | `#e8edf3`／`#8f9bab`／`#7d8999` |
| 主色 `primary` | `#007a7e`（白字） | `#37d2f2`（深字），主要按鈕與看診中號碼牌有光暈（`shadow-glow`） |
| 主色淡面 `accent` | `#e2f2f2`／字 `#00595c` | `#0a2630`／字 `#7fe3f7` |

主題切換存 `localStorage`、預設跟隨系統（`composables/useTheme.js`，開機時由 `index.html` 的內嵌腳本先定好 class，不會閃）。

### 表面的用法

- `bg-background` 頁面底；`bg-card` 卡片、面板、對話框；`bg-popover` 選單與浮層。
- `bg-sunken` 下凹：分段切換的軌道、次要按鈕、唯讀的內容區塊、表頭。
- `bg-hover` 滑過；`bg-field` 可以輸入的表面（淺色是白、深色往下凹一階）。
- 不要寫 `bg-white`：深色主題下就是白底配白字。

### 文字三階

`text-foreground` 主要內容；`text-muted-foreground` 次要文字、表單標籤；`text-subtle-foreground` 小標題、時間戳記、單位。可點的文字用 `text-primary`，靜止時就要看得出來，不要只寫 hover 才變色。

## 2. 狀態色

| token | 淺色 前景／底 | 深色 前景／底 | 用途 |
|---|---|---|---|
| `danger` | `#880d0d`／`#ffede9` | `#ffbeb3`／`#41211d` | 失敗、刪除、遲到、藥物過敏、檢驗偏高偏低 |
| `warning` | `#874c00`／`#fff0e0` | `#f8b05d`／`#3c260d` | 待你動手、請轉告飼主、備註提醒 |
| `success` | `#2d7f3f`／`#e8f9e9` | `#4eab60`／`#19321d` | 已寄送、已完成、其餘正常 |
| `info` | `#4260c4`／`#ebf3ff` | `#82a1f6`／`#212a44` | 寄送中、初診、待審初診表 |
| `surgery` | `#7238a5`／`#f8efff` | `#d3adff`／`#31253f` | **只給手術標記** |
| `badge` | `#c62828`／白字 | `#ff8a80`／深字 | 工具欄的紅色數字徽章 |

- 使用端寫 `bg-warning-surface text-warning`，徽章用 `<Badge variant="status" :class="…">`，顏色由 `lib/recordStatus.js` 那類 meta 提供。
- **明度是刻意錯開的**：紅綠色盲下只剩明度可辨。淺色 danger 最深、深色 danger 最亮——危險永遠是對比最高的那一個。不要「順手對齊」。
- 新增狀態色要跟主色留 40° 以上的色相距離，並用 dataviz 的 `validate_palette.js` 驗證。
- 顏色不能是唯一線索：徽章一律帶文字；牙齒圖的狀況另有形狀記號。

## 3. 字

- 中文 `Noto Sans TC Variable`、數字 `IBM Plex Mono`，都自架（`main.js` 匯入）。不要改成 CDN：報告頁是 Puppeteer 產 PDF 的來源。
- 數字（號碼牌、時間、體重、檢驗值、電話）加 `num`：等寬＋tabular-nums，上下才對得齊。

| class | 尺寸 | 用途 |
|---|---|---|
| `text-xl` | 28 | 頁面標題（每頁一個 H1） |
| `text-lg` | 22 | 區塊標題、對話框與面板標題、卡片標題 |
| `text-base` | 18 | 內文、輸入框（body 預設） |
| `text-sm` | 16 | 按鈕、表單標籤、次要文字 |
| `text-xs` | 15 | 註記、徽章、時間戳記 |
| `text-2xs` | 14 | 規格欄小標題（`spec-label`），最小字級 |

尺寸與行高都在 `@theme`，改字級改那裡。不要寫 `text-[13px]` 這種任意值。報告紙面 `.report-sheet` 走自己的 A4 尺度，改 `@theme` 後要開預覽頁確認分頁沒變。

## 4. 形狀與尺寸

- 圓角：格子與小標記 6（`rounded-md`）、控制項 8（`rounded-lg`）、卡片與面板內區塊 12（`rounded-xl`）、對話框 16（`rounded-2xl`）、膠囊 `rounded-full`。
- 控制項高度 36／40／44／48，預設 40。按鈕的 `size`：`xs`／`sm` 36、`default` 40、`lg` 48；圖示按鈕 `icon-xs` 32、`icon-sm` 36、`icon` 40、`icon-lg` 44，跟一般按鈕同圓角。
- 清單列：表頭 44、資料列 64（`.desktop-data-header`／`.desktop-data-row`，欄寬由 `--data-columns` 決定）。
- 目標螢幕 1920×1080；手機寬度仍要能用（導覽換成漢堡選單、面板滿版）。

## 5. 元件

| 需求 | 用什麼 | 注意 |
|---|---|---|
| 按鈕 | `<Button variant>`：`default` 實色、`secondary` 下凹底＋細邊、`soft` 主色淡面、`ghost` 只在滑過時出底色、`destructive` 淡紅底、`destructive-solid` 實心紅 | 實心紅只給確認視窗裡的最終動作；編輯鈕用 `secondary`、刪除鈕用 `destructive` 系列（audit 會檢查） |
| 卡片 | `<Card>` | 自帶邊框、底色、陰影，使用端不要再加 |
| 對話框 | `<DialogContent size>`＋`DialogHeader`／`DialogFooter` | 只有一種標頭與頁尾；不要覆寫寬度 |
| 側滑面板 | `panels/SidePanel.vue`（標頭：返回／標題／動作／關閉） | 開在工具欄旁，不遮擋背景；見 CLAUDE.md 第六節 |
| 下拉選單 | `ui/dropdown-menu`；清單列的次要操作用 `RowActions` | 危險項放最後、前面一條線、靜止就是紅字 |
| 頁籤／分段 | `FilterTabs`（可帶計數）、`SegmentedControl` | 兩者外觀相同（`segment-track`／`segment-active`） |
| 規格欄 | `SpecGrid`＋`SpecCell label` | 身分資訊一律用它，不用「·」串成一行 |
| 貓咪一行 | `PetLine`（品種＋♂♀）、`PetSex` | 初診才出徽章，回診不出 |
| 去處標記 | `DestTag to="journal|report|internal"` | 診療台欄位旁：寫完會去哪裡 |
| 號碼牌 | `CheckinNumber size` | 候診灰、看診中主色實心＋光暈、待櫃台淡面、已完成淡灰 |
| 手術／遲到 | `SurgeryBadge`、`LatenessBadge` | 紫與紅，並排時順序「手術 → 遲到」 |
| 格式文字 | 編輯 `RichTextEditor`、顯示 `RichText` | 不用 `v-html` |
| 空狀態／載入 | `EmptyState`、`ListSkeleton` | 不要只寫「載入中…」 |
| 錯誤 | `<Alert variant="destructive">` | |
| 確認／提示 | `ConfirmDialog`、`useToast()` | 禁止 `confirm()`／`alert()` |
| 分頁 | `Pagination` | |
| 篩選 | `FilterBar` | 一律提交式（按 Enter 或送出鈕才查） |

圖示統一 `@lucide/vue`、`stroke-width="1.75"`，不用 emoji；頭像一律貓圖示。

## 6. 用語

員工畫面：貓咪、飼主、櫃台、醫師、健檢報告、健檢表單。「藥單」是物件，「領藥」只指交付那一步。報告佇列的預設篩選叫「待處理」。公開初診頁（飼主看的）維持「貓孩兒／家長」。

## 7. 報告紙面

`/report/:token` 與 `/records/:id/preview` 固定淺色（它們是 PDF 的來源），用 `report-*` token，不跟主題切換；在那兩頁加東西不要借用後台的樣式常數。

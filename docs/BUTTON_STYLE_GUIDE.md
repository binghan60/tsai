# Button Style Guide

本文件定義診所系統所有「會觸發動作」控制項的顏色、尺寸與圖示規則。新功能應優先使用 `client/src/components/ui/button` 的 `Button`，不要自行拼湊按鈕顏色。

## 盤點摘要（2026-09）

- 共用 `<Button>`：163 處。
- 原生 `<button>`：59 處；主要用於列表列、分段控制、日期／時間選擇器、可展開內容與複合選項。
- 共用 `Button` 提供 `default`、`secondary`、`destructive`、`destructive-solid`、`link` 五種語意樣式，以及文字／圖示按鈕尺寸。

原生按鈕不是一般表單操作的替代品。若它不是「整列可點選」、「切換器」、「選項卡」或元件內部控制，應改用共用 `Button`。

## 顏色與使用時機

| Variant | 視覺語意 | 使用時機 | 每個操作群組上限 |
| --- | --- | --- | --- |
| `default` | 實心主色 | 最重要、完成後會推進流程的動作：儲存、送出、開始看診、完成處理 | 1 個 |
| `secondary` | 霧青實底 | 工具動作：編輯、重試、安排、前後切換、一般輔助操作 | 視空間而定 |
| `destructive` | 淡紅警示 | 需要使用者注意的刪除／捨棄操作；通常搭配確認對話框 | 1 個 |
| `destructive-solid` | 實心危險色 | 最終且不可逆的刪除確認 | 對話框內 1 個 |
| `link` | 文字連結 | 內文脈絡中的次要跳轉，不作為主要操作 | 視內容而定 |

禁止直接使用 Tailwind 色票（例如 `bg-red-500`、`bg-blue-600`）製作一般按鈕。顏色一律透過 Button variant 與設計 token 表達。系統不使用空心按鈕；次要操作使用有底色的 `secondary`。

### 色彩計算基準

保留 Petrol 主色後，次要按鈕使用同色相的低飽和霧青；危險色使用約 351° 的玫瑰磚紅，與 Petrol 約 192° 形成清楚的近互補關係。所有文字／底色組合都以 WCAG 相對亮度計算，主要按鈕色組合如下：

| 組合 | 對比值 |
| --- | --- |
| Light secondary（霧青底／深青字） | 7.51:1 |
| Light destructive solid（玫瑰磚紅底／白字） | 6.07:1 |
| Dark secondary（深霧青底／淺青字） | 9.70:1 |
| Dark destructive solid（玫瑰磚紅底／白字） | 4.74:1 |

## 圖示規範

圖示是輔助辨識，不是裝飾性的一致化要求；文字已足夠清楚時，可以不用圖示。

| 情境 | 圖示規則 | 範例 |
| --- | --- | --- |
| 主要流程動作 | 可加，建議用於可快速辨識的動作 | `<Check /> 完成處理`、`<Plus /> 新增預約` |
| 編輯、複製、刪除、下載、列印、重新整理 | 有文字時建議加圖示；密集列表可使用純圖示 | `<Pencil /> 編輯`、`<Trash2 /> 刪除` |
| 純圖示按鈕 | 必須使用 `size="icon*"`，並提供描述動作的 `aria-label` | `aria-label="刪除病歷"` |
| 文字型提交／確認 | 不強制圖示，避免讓確認列過度雜亂 | `儲存`、`取消`、`送出申請` |
| 導覽或返回 | 圖示可放文字左側；前進方向可放右側 | `<ArrowLeft /> 返回`、`下一步 <ArrowRight />` |
| 展開／收合 | 使用 `ChevronDown`，旋轉反映狀態；不得改用無關圖示 | `aria-expanded` 必填 |

圖示尺寸統一使用 `h-4 w-4`；極密集列可使用 `h-3.5 w-3.5`。文字按鈕的圖示預設置於左側，只有「下一步／外連」等方向性動作可放右側。

## 尺寸規範

| Size | 高度 | 使用時機 |
| --- | --- | --- |
| 預設 | 44px | 表單送出、對話框主要操作、觸控優先介面 |
| `sm` | 40px | 工具列、卡片操作、一般次要動作 |
| `xs` | 36px | 資料列的低密度輔助動作 |
| `icon` / `icon-sm` / `icon-xs` | 44px / 40px / 36px | 只有在圖示本身足以辨識動作時使用 |

不要以額外的 `h-*`、`min-h-*` 覆寫 Button 的尺寸；需要新的規模時，先擴充共用元件。

## 組合與排列

- 同一區塊應有且只有一個 `default` 主操作。
- 取消、返回放在主要操作左側；危險操作應與一般操作保留間距，或放入次一層確認對話框。
- 資料表／卡片的列內操作優先使用 `secondary` 圖示按鈕；刪除使用 `destructive` 圖示按鈕。
- 同一列中，若一個操作有圖示，其他同層級文字操作不必為了對齊而硬加圖示。
- 非按鈕的可點擊整列、選項卡或收合標題，必須有 hover、focus-visible 與 `aria-*` 狀態；它們不套用 Button variant。

## 可及性與狀態

- 純圖示按鈕一律提供精確 `aria-label`，例如「編輯王小明的預約」，不要只寫「編輯」。
- Disabled 只用在目前確實不可執行的動作；保留原因文字或相鄰說明，不能只依賴灰色。
- 非同步送出期間，按鈕應 disabled，文字改為「儲存中…」等狀態；避免重複提交。
- 不使用原生 `title` 作為唯一操作說明。需要額外解釋時使用 Tooltip 或可見輔助文字。
- 所有按鈕保留共用元件的 focus ring，不得以 `outline-none` 移除後不補焦點樣式。

## 建議範例

```vue
<!-- 單一主要動作：可加清楚的圖示 -->
<Button @click="save"><Save class="h-4 w-4" />儲存</Button>

<!-- 次要操作：可有或沒有圖示 -->
<Button variant="secondary" @click="edit"><Pencil class="h-4 w-4" />編輯資料</Button>
<Button variant="secondary" @click="cancel">取消</Button>

<!-- 密集資料列的純圖示操作 -->
<Button variant="secondary" size="icon-sm" aria-label="編輯預約" @click="edit">
  <Pencil class="h-4 w-4" />
</Button>

<!-- 危險操作 -->
<Button variant="destructive" size="icon-sm" aria-label="刪除預約" @click="openDeleteDialog">
  <Trash2 class="h-4 w-4" />
</Button>
```

## 審查清單

- 是否優先使用共用 `Button`？
- 這個動作是否真的需要主色或危險色？
- 同一操作群組是否只有一個主操作？
- 圖示是否增加辨識，而非只是為了和別人一致？
- 純圖示按鈕是否有可理解的 `aria-label`？
- 尺寸、disabled、focus、loading 狀態是否符合本規範？

# 寵物健康管理系統 UI Style Guide

這份文件是介面視覺與互動的共同規範。實際色票以 `client/src/style.css` 為準，按鈕樣式以 `client/src/components/ui/button/index.js` 為準。

## 設計原則

1. 操作在靜止狀態就必須能被辨識，不能只靠 hover 顯示背景或邊界。
2. 每個操作區原則上只放一個主要按鈕；其他操作依重要性降為次要、輔助或危險操作。
3. 顏色用來表達層級與狀態，不以不同顏色裝飾同類操作。
4. 結案、刪除、撤銷等不可逆或高風險操作必須有確認步驟。
5. 手機可點擊區域以 44 × 44 px 為基準；密集資料列最低不得小於 40 px。

## 核心色彩

| 用途 | Light | Dark | 使用方式 |
| --- | --- | --- | --- |
| Primary action | `#81333A` | `#8D541D` | 儲存、預覽、結案、下載等主要操作 |
| Brand accent | `#C99A35` | `#C99A35` | Logo、焦點、進度亮點；不作一般按鈕底色 |
| Page background | `#EFE2C1` | `#0B1218` | 頁面背景 |
| Card surface | `#FFF8EA` | `#121B22` | 卡片、彈窗、次要按鈕表面 |
| Main text | `#101923` | `#F4EAD0` | 標題與主要內容 |
| Secondary text | `#50554F` | `#B9AE96` | 輔助說明，仍需維持可讀性 |
| Destructive | `#B42332` | `#FF8A80` | 刪除、撤銷與錯誤 |

主要按鈕文字對比：Light 8.18:1、Dark 5.90:1，均符合 WCAG AA。

狀態色只使用以下語意：

- 綠色：正常、成功、已寄送。
- 黃色：提醒、草稿、需要留意。
- 藍色：處理中、一般資訊。
- 紅色：異常、失敗、危險操作。

## 按鈕層級

統一使用共用 `Button`，導頁按鈕使用 `as-child` 包住 `router-link`。

```vue
<Button>主要操作</Button>
<Button variant="outline">次要操作</Button>
<Button variant="secondary">輔助操作</Button>
<Button variant="destructive">低強度危險操作</Button>
<Button variant="destructive-solid">確認刪除</Button>

<Button as-child variant="outline">
  <router-link to="/pets">回寵物列表</router-link>
</Button>
```

| Variant | 用途 | 常見範例 |
| --- | --- | --- |
| `default` | 當下最重要且安全的下一步 | 新增健檢、預覽、下載 PDF |
| `outline` | 返回、編輯、儲存草稿等次要操作 | 編輯資料、回上一頁 |
| `secondary` | 可重複執行的支援操作 | 分享、複製連結、批次標示 |
| `destructive` | 尚未進入最終確認的危險操作 | 刪除、捨棄、撤銷入口 |
| `destructive-solid` | 確認視窗內的最終危險操作 | 確認刪除、確認撤銷 |
| `link` | 段落文字內的超連結，不作工具列按鈕 | 前往補填資料 |

禁止事項：

- 不可讓按鈕在常態時完全透明，僅在 hover 才出現底色。
- 不可在頁面手寫新的主要操作色；應使用語意 variant。
- 不可用紅、綠、黃表示一般操作，避免與醫療狀態混淆。
- 同一操作區不可出現兩個以上同等視覺重量的主要按鈕。

## 特殊控制

分段選擇器、頁籤與側邊導覽可以使用原生 `button` 或 `router-link`，但必須同時符合：

- 未選取狀態已有可見背景或邊界。
- 選取狀態同時透過底色、文字或邊界區分，不能只靠顏色細微差異。
- 鍵盤焦點清楚可見，並提供 `aria-current` 或對應的 ARIA 狀態。
- 純圖示按鈕必須提供中文 `aria-label`。

## 圓角、尺寸與間距

- 一般按鈕：高度 44 px、圓角 12 px。
- 小型按鈕：高度 40 px、圓角 8 px；只用於密集資料列。
- 大型主要操作：高度 48 px。
- 圖示與文字間距：8 px。
- 同組按鈕間距：8 px。
- 卡片圓角：16 px；欄位與按鈕圓角不得大於卡片。

## 互動狀態

每個操作元件都必須具備：

- Default：常態已有底色或邊界。
- Hover：提高背景或邊界對比，不改變按鈕用途色。
- Focus visible：顯示 2–3 px 品牌金色焦點環。
- Active：輕微向下位移，提供按壓回饋。
- Disabled：降低透明度、移除陰影並禁止點擊。
- Loading：保留原尺寸並以文字說明，例如「儲存中…」。

## 新頁面檢查表

- 是否使用共用 `Button`，而非複製一串 Tailwind 按鈕 class？
- 不使用滑鼠 hover 時，是否仍看得出所有可操作項目？
- 主要操作是否只有一個，且位置符合使用流程？
- 危險操作是否為紅色並有確認視窗？
- 狀態色是否只用於狀態？
- 鍵盤、手機與深色模式是否都能辨識？
- 文字與背景對比是否至少達 WCAG AA？

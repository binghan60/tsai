# 健檢表單客製化 — 架構規劃

目標：讓使用者自行編輯整份健檢表單 —— **區塊本身**與**區塊底下的項目**都可以新增、刪除、改名、排序、停用。

現有的「基本資料／量測／理學檢查／檢驗／結論」五個區塊**只是預設種子資料**，不是系統假設。使用者可以刪掉其中幾個、也可以自己開新的區塊（例如「疫苗紀錄」「影像檢查」「回診追蹤」），數量不限。

---

## 一、核心設計：Template + Snapshot + Role

三個概念缺一不可，先講清楚為什麼。

### 1. Template（表單範本，可編輯）

表單長什麼樣子存在 DB，不再寫死在程式碼裡。現有的硬編碼定義全部降級成**種子資料**，只在初始化時寫進 DB：

- [`client/src/lib/labTests.js`](../client/src/lib/labTests.js)、[`server/src/config/labTests.js`](../server/src/config/labTests.js) —— 量測與檢驗項目
- `RecordFormPage.vue` 的 `EXAMINATION_ITEMS` —— 理學檢查項目
- `RecordFormPage.vue` 的 `FORM_SECTIONS`（[第 17 行](../client/src/pages/RecordFormPage.vue#L17)）—— **區塊清單本身**

> 順帶解決一個既有問題：`labTests.js` 目前前後端各一份幾乎相同的清單，遲早會漂移。改成 DB 驅動後後端是唯一來源。

### 2. Snapshot（報告快照）

**每筆報告存下自己當時用的表單結構**，包含區塊標題與項目名稱。

這點你現在的資料模型**已經做對了** —— [`MedicalRecord.js`](../server/src/models/MedicalRecord.js) 的 `examinationFindings` / `labFindings` 就是把 `key`、`label`、`group`、`unit` 一起寫進每筆報告。要延伸到全部區塊，沿用同一套思路即可。

為什麼必要：病歷不能因為之後改了範本就回頭變樣。三年前的報告必須永遠顯示三年前的項目名稱與版面。

### 3. Role（語意角色）— 這是關鍵

如果所有欄位都變成無型別的 `value`，後端就沒辦法再理解「哪個是體重」「哪個是看診日期」，以下功能會直接壞掉：

- 結案時把體重同步回 Pet（[`records.js:262`](../server/src/routes/records.js#L262)）
- 報告列表依看診日期排序、顯示看診醫師
- 結案前的完整性驗證（`validateFinalRecord`）

解法：少數欄位可標記 `role`，系統靠 `role` 而不是靠欄位名稱找資料。

```js
{ key: 'weightKg',  label: '體重',     type: 'measurement', role: 'weight' }
{ key: 'visitDate', label: '看診日期', type: 'date',        role: 'visitDate' }
{ key: 'vet',       label: '看診醫師', type: 'text',        role: 'vet' }
{ key: 'diagnosis', label: '診斷',     type: 'textarea',    role: 'diagnosis' }
```

使用者仍可自由改這些欄位的**標籤、順序、所屬區塊**，甚至停用它；系統只是失去對應的附加功能（例如停用 `role: 'weight'` 就不再同步體重），而不會壞掉。這讓「完全客製化」與「系統仍理解資料」並存。

**帶 role 的欄位可停用，但不可刪除**，避免使用者誤刪後功能靜默消失。

---

## 二、資料模型

### 新增 `FormTemplate`

```js
{
  name: '標準健檢表單',
  isActive: true,
  version: 3,                    // 每次儲存 +1，報告記錄用的是哪一版
  sections: [                    // 長度不限，順序與內容全由使用者決定
    {
      key: 'measurements',       // 穩定識別碼，後端產生，建立後不可改
      title: '基本量測',          // 使用者可改
      description: '',           // 選填，顯示在區塊標題下
      order: 1,
      enabled: true,
      presentation: 'grid',      // 決定報告頁版式，見第四節
      items: [                   // 長度不限，可為空
        {
          key, label, type, role,
          unit, group,           // group 用於區塊內的次分組（如檢驗的「電解質」）
          order, enabled, required,
          placeholder, options,  // options 供 select 用
          min, max, step, numeric,
        },
      ],
    },
  ],
}
```

### 建立與刪除區塊的規則

- **新增區塊**：使用者填標題、選一種 `presentation`，然後往裡面加項目。`key` 由後端產生（`custom_` + 亂數），不讓使用者手填。
- **刪除區塊**：可以真的刪除。因為每筆報告都存了自己的快照，刪掉範本裡的區塊**不會影響任何既有報告**。
- **唯一的例外**：若該區塊內含帶 `role` 的項目（看診日期、體重等），刪除前要提示使用者「這會讓 X 功能失效」，並提供「把這些項目移到其他區塊」的選項，而不是靜默刪掉。
- 區塊可以是空的（沒有任何項目），此時表單與報告都直接略過不顯示。

### 項目型別 `type`

| type | 表單控制項 | 現況對應 |
|---|---|---|
| `text` | 單行文字 | 看診醫師、健檢類型 |
| `textarea` | 多行文字 | 主訴、病史、診斷、治療計畫、結論、其他 |
| `date` | 日期 | 看診日期 |
| `number` | 數字 | — |
| `select` | 下拉選單 | — |
| `measurement` | 數字 + 單位 + 自動判讀 | 體重、體溫、心率、呼吸率、體態評分 |
| `finding` | 三態（未檢查／正常／異常）+ 備註 | 理學檢查 13 項 |
| `lab` | 三態 + 數值 + 單位 + 參考值 + 備註 | 檢驗 20 項 |

`measurement` 與 `lab` 會去對照 `LabReferenceRange` 做自動判讀，維持現有行為。

### `MedicalRecord` 改動

新增：

```js
templateId, templateVersion,
sections: [                      // 完整快照
  { key, title, presentation, order,
    items: [{ key, label, type, role, unit, group,
              value, status, statusSource, note, referenceMin, referenceMax }] }
]
```

**既有的 typed 欄位（`weightKg`、`diagnosis` 等）先保留不刪**，理由見第五節的遷移策略。

---

## 三、受影響的既有程式碼

盤點過的完整清單，比預期少：

| 位置 | 現況 | 要改成 |
|---|---|---|
| [`records.js:10`](../server/src/routes/records.js#L10) `RECORD_FIELDS` | 白名單逐一列欄位 | 改成接受 `sections` 快照 |
| [`records.js:71`](../server/src/routes/records.js#L71) `hasClinicalContent` | 檢查固定欄位 | 走訪 `sections` 判斷有無填寫 |
| `records.js` `validateFinalRecord` | 檢查 diagnosis/conclusion 等 | 改用 `role` + `required` 旗標 |
| [`records.js:106`](../server/src/routes/records.js#L106) `reportPayload` | 逐欄位列舉 | 回傳 `sections` + 系統欄位 |
| [`records.js:262`](../server/src/routes/records.js#L262) 體重同步 | 讀 `record.weightKg` | 找 `role === 'weight'` |
| [`settings.js:16`](../server/src/routes/settings.js#L16) `serializeRanges` | 走訪硬編碼 `REFERENCE_METRIC_DEFINITIONS` | 走訪範本中 `type` 為 `measurement`/`lab` 的項目 |
| `RecordFormPage.vue` | 五個區塊各自手刻版面 | 泛型渲染器（見下節） |
| `ReportViewPage.vue` | 量測與文字區塊手刻、檢驗已泛型 | 泛型渲染器 |

### 表單頁裡「寫死就是五個區塊」的機制

區塊要能自由增刪，以下四處都得改成由範本驅動 —— 這是這次範圍擴大後新增的工作：

| 位置 | 現況 | 問題 |
|---|---|---|
| [`FORM_SECTIONS`](../client/src/pages/RecordFormPage.vue#L17) | 五個區塊的導覽清單常數 | 直接換成範本的 `sections` |
| [`activeSectionIndex`](../client/src/pages/RecordFormPage.vue#L25) | 依常數陣列找索引 | 改走訪動態清單 |
| [`completionSections`](../client/src/pages/RecordFormPage.vue#L93) | 五個寫死的布林判斷 | 改成每區塊算一個「是否已填」 |
| `completionPercent` | `completedCount * 20`（寫死 1/5） | 改成 `completedCount / sections.length` |
| [`sectionIdForTarget`](../client/src/pages/RecordFormPage.vue#L149) | 用 `record-exam-` 等前綴硬對應區塊 | 改成從項目反查所屬區塊 `key` |

**不受影響**（已確認）：

- [`dashboard.js`](../server/src/routes/dashboard.js) —— 只彙總 `status`／`deliveryStatus`／`createdAt`，完全沒碰臨床欄位。
- PDF 產生流程 —— Puppeteer 截的是報告檢視頁，頁面改好 PDF 自動跟著改。
- 分享連結、Email、報告版次等系統欄位。

---

## 四、渲染策略（最需要留意的一塊）

### 表單頁

拆成 `FormSectionRenderer` → 依 `type` 派發到各欄位元件（`FindingField`、`LabField`、`MeasurementField`、`TextareaField`…）。現有的自動儲存、完成度計算、驗證錨點都要改成走訪 `sections` 而不是寫死的五個判斷。

### 報告檢視頁 —— 別讓它變成醜清單

這是**最大的美感風險**。目前 `/report/:token` 是精心排版的列印文件（也是 PDF 來源）；如果改成無腦的「標籤：值」泛型清單，報告品質會明顯掉下來。

解法：**使用者選版式，不自由排版**。每個區塊設定 `presentation`：

| presentation | 版面 | 適用 |
|---|---|---|
| `keyValue` | 兩欄式定義清單 | 基本資料 |
| `grid` | 格狀數值卡片 | 量測 |
| `findings` | 正常／異常條列 + 異常摘要 | 理學檢查 |
| `table` | 分組表格（含參考值） | 檢驗 |
| `prose` | 標題 + 段落 | 結論、治療計畫 |

這五種版式由我們維護、確保列印效果，使用者只挑用哪一種。既達成客製化，又保住報告品質與 `@media print` 行為。

**新增區塊時，使用者選的就是這個 `presentation`** —— 例如新開一個「疫苗紀錄」區塊選 `table`、「回診追蹤」選 `prose`。版式是有限集合，所以不管使用者開幾個區塊，報告永遠是排版過的文件，不會退化成流水帳。

因為區塊數量不固定，報告頁還要處理：

- **列印分頁**：每個區塊套 `break-inside-avoid`，區塊多時自動分頁而不是攔腰切斷。
- **空區塊略過**：整個區塊都沒填的話不要印出一個空標題。
- **順序**：完全依 `order`，不再有「量測一定在理學檢查前面」這種隱含假設。

---

## 五、遷移策略

1. **建立預設範本**：把現有硬編碼的五個區塊與所有項目寫成 seed，`key` 一律沿用現值（`weightKg`、`rbc`、`auscultation`…），確保歷史報告對得上。
2. **既有報告不動**：`sections` 為空的舊報告，走 legacy 渲染路徑（沿用現有版面）。已結案的報告**絕對不能**因為遷移而改變呈現內容。
3. **新報告走新路徑**：建立時複製當下的 active template 成快照。
4. typed 欄位保留一段時間雙寫，確認穩定後再考慮清掉。

---

## 六、實作順序建議

分階段上線，每階段都能單獨驗證，不要一次全改：

| 階段 | 內容 | 規模 |
|---|---|---|
| 1 | `FormTemplate` 模型 + seed + 唯讀 API | 小 |
| 2 | 表單頁改讀 template（版面先不動，只是資料來源換掉） | 中 |
| 3 | 報告檢視頁泛型渲染 + 五種 presentation | 中大 |
| 4 | 後端 role-based 改造（驗證／體重同步／payload） | 中 |
| 5 | **範本編輯器 UI**（區塊增刪、項目增刪、拖曳排序、型別設定） | 大 —— 約佔整體一半 |
| 6 | 舊報告遷移與 legacy 路徑清理 | 中 |

先做 1–2 就能驗證整條資料流是否成立，風險最低。

---

## 七、關鍵規則（實作時務必遵守）

1. **`key` 建立後永不可改**，區塊與項目都一樣，且由後端產生（自訂的用 `custom_` 前綴 + 亂數），不讓使用者手填 —— 否則改 key 會讓歷史報告對不上。使用者改的是 `label` / `title`。
2. **已刪除的 `key` 永不重複使用**，避免新項目「繼承」到舊項目的歷史語意。
3. **區塊與項目都可以真的刪除** —— 報告有快照，刪除不影響歷史資料。唯一要攔的是帶 `role` 的項目：刪除前提示會失去對應功能，並提供搬到其他區塊的選項。若使用者想保留項目但暫時不出現在表單上，用 `enabled: false` 停用。
4. **已結案報告永遠不重新套用範本**。只有草稿會在載入時合併最新範本定義。
5. 現有的 [`mergeFindings`](../client/src/pages/RecordFormPage.vue#L110) 已經會保留「存檔有、定義沒有」的孤兒項目，這個容錯行為要延續到新架構 —— 使用者刪掉某項目後，正在編輯中的草稿不會突然掉資料。
6. 範本每次儲存 `version` +1，報告記錄用的是哪一版，方便日後追查。

# 健檢表單

健檢報告的結構不是寫死的：有哪些區塊、每個區塊有哪些項目，都由**表單範本**（`formTemplates`）決定，在 `/settings/forms` 設計。一份範本＝一種健檢類型（「例行健檢」「術前評估」…），建立報告時選定、之後不能換。

三個核心概念：

| 概念 | 是什麼 | 為什麼 |
|---|---|---|
| 範本（template） | 可編輯的表單結構 | 使用者自己決定要記錄什麼 |
| 快照（snapshot） | 報告結案時凍結的 `sections`（結構＋作答） | 病歷要永遠呈現當時的樣子，之後改範本不回頭改動已結案的報告 |
| 角色（role） | 少數項目的語意標記 | 系統不寫死欄位名稱也找得到「醫師」「健檢日期」「體重」 |

## 一、範本結構

```js
{
  name: '例行健檢',            // unique；就是健檢類型
  description, species,        // species：cat／dog／all，建立報告時只列適用的
  enabled, order,
  version: 3,                  // 結構每存一次 +1，報告記下用的是哪一版
  sections: [{
    key: 'measurements',       // 後端產生，永不修改
    title: '基本量測',
    reportTitle: '',           // 報告上的標題，留空沿用 title
    description: '',
    presentation: 'grid',      // 報告版式，見第三節
    order, enabled,
    items: [{
      key, label, type, role, group, unit, placeholder, defaultValue, options,
      span,                    // auto／wide（兩格）／full（整排）
      order, enabled, required,
      numeric, rows, min, max, step,
      referenceMin, referenceMax,   // 參考範圍，自動判讀用；屬於這份表單，改 A 不影響 B
      idexxCodes, idexxInstrument,  // 只有檢驗項目：IDEXX 自動填入的對照，見 IDEXX_INTERLINK.md
    }],
  }],
  presets: [...],              // 預填模板，見第五節
  retiredKeys: [...],          // 刪過的 key，不再重複使用
}
```

新的資料庫第一次啟動時建六份內容相同的種子範本（`server/src/config/formTemplateSeed.js`）：健檢資訊與健康背景、基本量測、理學檢查、血液與尿液檢查、結論與診斷。它們只是起點，可以任意改、刪、複製。

### key 的規則

1. **key 由後端產生、建立後永不修改**（區塊 `section_xxxxxx`、項目 `custom_xxxxxx`），使用者改的是 `title`／`label`。改 key 會讓歷史報告對不上。
2. **刪掉的 key 記進 `retiredKeys`，永不重複使用**，新項目才不會「繼承」舊項目的歷史資料。
3. 區塊與項目是兩個命名空間（種子裡「結論」既是區塊也是項目）。同一次送出的內容裡 key 重複就拒收。
4. 清洗規則在 `server/src/lib/formTemplate.js` 的 `sanitizeSections`：前端送什麼 key 都只能沿用目前範本裡已有的，數字欄位空白存成 `null`（不是 0），檢驗項目的 IDEXX 代號撞名直接擋下。

### 角色（role）

| role | 作用 |
|---|---|
| `vet` | 印在報告頁首 |
| `visitDate` | 印在報告頁首；貓咪的報告清單依它排序；新報告預設今天 |
| `weight` | 結案時把數值寫回貓咪的最近體重 |

帶 role 的項目可以改名、搬到別的區塊、停用；但停用或刪除後對應功能就失效，所以存檔時若有 role 消失，後端回 409 要使用者確認（`missingRoles`）。

### 刪除與停用

- **區塊與項目都可以真的刪除**——報告有快照，已結案的不受影響；草稿上已經記錄過、但範本裡已刪除的理學檢查與檢驗項目會保留下來（`lib/reportSections.js` 的 `appendOrphans`，接在同型別區塊尾端，找不到就另開「其他紀錄」區塊），病歷不會憑空少資料。
- 想暫時不出現在表單上就停用（`enabled: false`）。
- **被報告引用的範本不能刪，只能停用**（修訂草稿會沿用 `templateId`）；掛號的預設表單不能停用或刪除；至少保留一份。

## 二、項目型別與作答存放

| type | 填寫控制項 | 作答存在報告的 |
|---|---|---|
| `text` | 單行文字 | 具名欄位或 `customValues` |
| `textarea` | 多行文字，可加粗與上色（格式標記字串） | 同上 |
| `number` | 數字 | 同上 |
| `date` | 日期選擇器 | 同上 |
| `select`／`radio` | 下拉選單／單選 | 同上 |
| `checkbox` | 複選（字串陣列） | `customValues` |
| `measurement` | 數值卡片，依參考範圍自動判讀 | 具名欄位（體重、體溫…）＋`measurementAssessments` |
| `finding` | 未檢查／正常／異常＋備註 | `examinationFindings` |
| `lab` | 狀態＋數值＋單位＋參考範圍＋備註 | `labFindings` |
| `image` | 多張圖片（直傳 Cloudinary） | `customValues` |
| `dentalChart` | 牙齒圖（`DentalChart.vue`） | `customValues` |

**作答存在哪裡由後端判定**（`storageFor`，隨範本回傳 `storage` 給前端）：`finding`／`lab` 有各自的陣列；其他型別如果 key 剛好是 `MedicalRecord` 的具名欄位、而且型別相容就存具名欄位，否則一律收進 `customValues`。範本可以自由改型別（例如把體溫改成文字填「微燒」），型別對不上時不硬塞進 schema 欄位。讀取（`composeReportSections`）用同一套判斷。

連著看診的草稿，體重、體溫、回診日期與檢驗數值不存在報告上，而是即時引用看診（見 CLAUDE.md 第三節 medicalRecords）。

## 三、版式（presentation）

報告頁（也是 PDF 來源）不能退化成「標籤：值」的流水帳，所以**使用者選版式、不自由排版**。版式是有限集合，列印效果由我們維護：

| presentation | 報告上 | 原生型別 |
|---|---|---|
| `keyValue` | 兩欄式定義清單 | — |
| `grid` | 數值卡片格 | `measurement` |
| `findings` | 正常／異常條列＋異常摘要 | `finding` |
| `table` | 依 `group` 分組的表格（含參考範圍） | `lab` |
| `prose` | 標題＋段落 | `textarea` |

任何型別都能放進任何區塊：原生型別走版式自己的排法，其他型別接在後面用一般欄位格（`FieldControl`／`ScalarField`）。`span` 只在網格排列時有意義（表格列與長文段落固定一列一個）。

填寫頁（`components/formfields/Form*.vue`）與報告頁（`components/report/Report*.vue`）各有一組對應版式的元件。報告頁的規則：區塊不攔腰切斷（`break-inside-avoid`）、整個沒填的區塊不印、順序完全依 `order`；`vet`／`visitDate` 提到頁首，不在區塊裡重複。

## 四、填寫、結案與快照

- **建立**：選健檢類型（只列啟用、物種相符的），可以選「從既有報告帶入」——任一份已結案報告的作答依 key（找不到再依型別＋名稱）帶進來；之後在填寫頁也能「重新帶入」。新報告套用項目的 `defaultValue`；報到時後端建立的草稿也一樣套用（`defaultRecordFields`）。
- **草稿**每次讀取都用**目前的範本**組合（`composeReportSections`），所以改範本會反映在草稿上；另附「上次數值」（最近 20 份已結案報告裡同一項目的值，只給 `lab`／`measurement`／`number`，`lib/historyValues.js`）。
- **結案**時：
  1. 用範本組出 `sections` 並驗證——`required` 的項目都要有作答（`lib/recordValidation.js`：`finding` 看有沒有標記、`lab` 標記或有數值都算、文字去掉格式標記後不能是空白）。
  2. 把 `sections`、`templateVersion` 凍結進報告。**已結案報告永遠只讀快照**，不再套用範本。
  3. 有 `role: 'weight'` 的值就寫回貓咪的體重。
  4. 排背景工作產 PDF。
- **修訂版**沿用同一個 `templateId`，以原報告的快照作答為起點，用目前範本重新組合。

## 五、預填模板（presets）

同一份表單常有幾種固定的填法（「預防針」「牙齒」），項目的 `defaultValue` 只能放一組。`presets[]` 讓每份表單另存多組預填值：

```js
presets: [{ key: 'preset_ab12cd', name: '預防針', order: 0, values: { chiefComplaint: '年度預防針', custom_xxx: ['三合一'] } }]
```

- **範圍**：只收 `text`／`textarea`／`number`／`select`／`radio`／`checkbox`，排除獸醫師（`role: 'vet'`）與日期——`date` 型別之外，名稱含「日期」的欄位也排除（自訂的回診日期常被建成文字欄位）。理學檢查、檢驗、量測、牙齒圖、圖片是每次實際看診的結果，不放進模板。規則在 `shared/formDefaults.js` 的 `presetEligible`／`normalizeTemplateValue`，前後端共用。每份表單最多 30 組。
- **跟預設值的關係**：預設值是底，新建報告時自動帶入；模板是醫師手動套上去的一層（填寫頁頁首「套用預填模板」），只覆寫自己有設定的欄位。切換模板時，上一組帶入而醫師沒動過的欄位退回預設值、動過的保留；套用後的提示可以「復原」（`client/src/lib/formPresets.js`）。報到自動建立的草稿只套預設值，不套模板。
- **不影響結構**：存檔不動 `version`、不進報告快照、報告不記套過哪一組。每次存檔都對著新的 sections 清洗（`sanitizePresets`），刪掉的項目、改掉的選項、停用的區塊，對應的值一起消失。複製表單時連預填模板一起複製。
- **編輯**：獨立的設定頁 `/settings/presets`（左邊選表單、右邊列模板，單組編輯在 `/settings/presets/:formId/:presetKey`，用填寫頁同一套控制項逐欄設定）。表單設計頁的存檔不送 `presets`，兩頁不會互相覆蓋。

## 六、相關程式

| 位置 | 內容 |
|---|---|
| `server/src/models/FormTemplate.js` | schema、型別、角色、版式 |
| `server/src/lib/formTemplate.js` | `storageFor`、`sanitizeSections`、`sanitizePresets`、`missingRoles`、序列化 |
| `server/src/lib/reportSections.js` | 範本＋作答 → 報告 `sections` |
| `server/src/lib/recordValidation.js` | 結案前的必填檢查 |
| `server/src/routes/settings.js` | 範本 CRUD |
| `shared/formDefaults.js` | 預設值與預填模板的值規則 |
| `client/src/pages/FormTemplateEditPage.vue` | 表單設計頁（區塊清單、工具箱、項目設定） |
| `client/src/pages/RecordFormPage.vue` | 健檢報告填寫 |
| `client/src/pages/ReportViewPage.vue` | 報告頁／PDF 來源 |

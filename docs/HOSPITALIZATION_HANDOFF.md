# 住院系統（第二期）交接：剩下的工作

> 給新 session 接手用。做完、合進 CLAUDE.md 之後就刪掉這份檔案。
> 設計稿（已跟使用者確認）：https://claude.ai/artifact/Q1jmPsFLCABDeh14ZqiMNM
> 已拍板的產品決定也記在 Claude 的記憶 `walkin-stray-hospital-plan.md`。

## 一、目前進度

- 第一期（現場＋流浪貓＋換飼主）：已完成、已 commit（`a0ed3cd`）。
- 第二期（住院）：**後端完成**，測試全過（`server` 的 `npm test` 539 個）；**前端做了一部分**，還沒 commit。

### 已拍板的規則（不要再問使用者）

- 一律從看診收住院：醫師**開始看診之後、櫃台完成處理之前**都能按「收住院」（看診到一半才決定很常見）。入院那次看診就是入院評估，住院專區引用，不複製。
- 收住院時，這次看診已經寫的藥單**搬到住院第一筆照護紀錄的「用藥」**，看診上清空，不開藥單；已送交櫃台開出去的那張待包藥一併取消。
- 收了住院的看診：不能取消看診（要先取消住院），送交櫃台時不開藥單，看診上也不能再寫藥單（伺服器擋）。
- 紙本的「Drug」欄在系統叫 **「用藥」**。
- 照護紀錄＝紙本一格：時間、食物放置、灌食、用藥、其他，另加選填的體溫。都是輸入框。用藥跟藥單同一個編輯器（`DrugSuggestEditor`：藥櫃建議＋「藥櫃」鈕）。
- **卡片同一排等高、每一列橫線對齊**（使用者明確要求，不能缺角）：每張卡片 `grid-row: span 6; display: grid; grid-template-rows: subgrid; row-gap: 0`，正在編輯的那張和「新增一筆」也一樣跨 6 列。欄數用 container query 依寬度決定（側滑面板會把工作區擠窄）。
- 每天一筆體重；體重算進貓咪的最近體重（已接上 `lib/latestWeight.js`，同一天住院體重優先）。
- 照護紀錄住院中與出院後都能改，刪除要先確認。
- 醫師、櫃台都會填，署名用裝置身分（`useStaffIdentity`），不加新身分。
- 出院：出院備註、出院時間、帶回家的藥。帶回家的藥直接開成一張**待包藥**的藥單（`hospitalizationId` 連回住院單，藥單畫面標「出院」，有自己的領藥日誌）。
- 取消住院：只有還沒記任何紀錄（體重、照護紀錄）時能取消；從看診搬來的那格用藥搬回看診的藥單；已送交櫃台的看診會重新開出待包藥。
- 病歷日誌：只記入院那次看診，最後多一列唯讀的「住院」（「10/13 起住院中　第 3 天」／「10/13–10/18　6 天」），點了到住院專區。住院內容不進日誌。
- 住院期間的 IDEXX：檢驗時間落在住院中就自動連到住院單（不填進任何看診）；住院專區也有「匯入檢驗結果」（跟診療台同一個視窗）。
- 不做：籠位、列印、提醒、給藥排程、出院通知飼主、住院中另外掛號。

## 二、已完成

### 後端（全部完成）

| 檔案 | 內容 |
|---|---|
| `models/Hospitalization.js`、`HospitalizationDay.js`、`HospitalizationEntry.js` | 住院單、每天體重、照護紀錄（欄位 `food`／`forceFeeding`／`medication`／`other`／`temperatureC`／`staff`／`fromVisit`，帶 `__v`） |
| `models/Appointment.js` | `hospitalizationId`（＋partial 索引） |
| `models/LabResult.js` | `hospitalizationId`（＋partial 索引） |
| `models/MedicationOrder.js` | `hospitalizationId`（出院帶回家的藥） |
| `lib/hospitalization.js`（＋test） | 住院第幾天、住院期間每一天、日誌那一列文字、照護紀錄欄位整理 |
| `routes/hospitalizations.js`（＋test） | 全部 API，見下表 |
| `lib/appointmentWorkflow.js`、`routes/appointmentWorkflow.js` | 收了住院：擋取消看診、擋寫藥單、送交不開藥單 |
| `lib/labResultApply.js`、`routes/labResults.js` | 住院期間自動連住院單；`GET ?hospitalizationId=`；`POST /:id/match` 收 `hospitalizationId` |
| `lib/clinicalNoteView.js` | 日誌的「住院」列（section `key: 'hospitalization'`，帶 `hospitalizationId`、`status`） |
| `lib/latestWeight.js` | 住院體重算進最近體重 |
| `lib/realtime.js` | `emitHospitalizationUpdate` → socket `hospitalization:updated`（帶 `{ _id, petId }`） |
| `routes/pets.js` | 有住院紀錄的貓不能刪 |
| `routes/dashboard.js` | `today.hospitalized`（住院中筆數） |

API（`/api/hospitalizations`）：

```
GET    /?status=admitted|discharged&petId=     清單；每列帶 pet { _id, name, isStray, ownerName }、dayNumber、todayWeightKg、lastEntryAt；回 counts { admitted, discharged }
GET    /:id                                    住院單＋pet（含 ownerId）＋admittingAppointment（date time reason weightKg temperatureC visitNote）＋dates（住院期間每一天）＋days＋entries（舊到新）
POST   /                                       收住院 { appointmentId, version（看診 __v）, reason, staff } → { hospitalization, appointment }
PUT    /:id                                    { version, reason, dischargeNote（已出院才收） }
POST   /:id/cancel                             { version } 取消住院（有紀錄回 409）
POST   /:id/discharge                          { version, dischargeNote, dischargedAt?, medication } → { hospitalization, medicationOrder }
PUT    /:id/days/:date                         { weightKg }（空白＝清掉；日期要在住院期間）
POST   /:id/entries                            { recordedAt?, food, forceFeeding, medication, other, temperatureC, staff }
PUT    /:id/entries/:entryId                   { version, ...欄位 }；版本不符回 409 { message, current }
DELETE /:id/entries/:entryId
GET    /api/lab-results?hospitalizationId=     連到這次住院的檢驗結果（舊到新）
```

### 前端（已做）

- `components/AdmitDialog.vue`：收住院視窗（住院原因、已寫的藥單預覽）。
- `components/VisitWorkspace.vue`：底部「收住院」鈕（開始看診後、櫃台完成前）；收住院前先存檔、用最新版本送出、收完用伺服器回來的看診當基準；收了住院後藏「藥單」區塊與「取消看診」，標頭出現「住院」連結到 `/hospital/:id`。
- `components/LabImportDialog.vue`：多一個 `hospitalizationId` prop；住院專區把 `appointment` 傳成 `{ petId, petName, date }`。
- `lib/labResults.js` 的 `fillMessage`：`status: 'hospitalization'` 的訊息。
- `components/MedicationWorkspace.vue`：出院的藥單標「出院」。
- `lib/clinicalNoteDisplay.js`、`components/ClinicalNoteRowValue.vue`：日誌的「住院」列（唯讀連結）。

## 三、剩下要做（前端＋文件）

1. **路由與導覽**
   - `router/index.js`：`/hospital`（`HospitalListPage`）、`/hospital/:id`（`HospitalDetailPage`），meta title「住院」、`nav: '/hospital'`。
   - `lib/navigation.js`：「看診」組加 `{ to: '/hospital', label: '住院', icon: BedDouble }`（放在藥單後面）。

2. **`pages/HospitalListPage.vue`**（設計稿第 2 張）
   - 清單頁模板：`PageHeader title="住院"` → `DataCard`（`#tabs` 一條 `FilterTabs`：住院中／已出院，數字用 `counts`）→ `.desktop-data-header`＋`.desktop-data-row`，1280px 以下改小卡。
   - 欄位：貓咪（名字＋`StrayBadge`＋住院原因）、飼主、入院（`shortDate`）、住院第 N 天、今天體重、最後一筆紀錄（時刻＋`elapsedLabel`）、列上主要動作「新增紀錄」（`soft`，到 `/hospital/:id?new=1`）。整列點了到詳情。
   - 已出院分頁（`ListFooter`）；頁籤記在 `?tab=`。
   - `useLiveReload` 聽 `hospitalization:updated`、`patients:updated`。

3. **`pages/HospitalDetailPage.vue`**（設計稿第 1 張，最重要）
   - 頁首：返回、貓名（`PatientLink`）、`StrayBadge`、「住院中　第 N 天」或「已出院」；右邊「匯入檢驗結果」（secondary）＋「出院」（default，住院中才有）；⋯ 裡「取消住院」（`ConfirmDialog`）與「修改住院原因」。
   - 規格欄（`SpecGrid`）：飼主、品種＋性別、入院時間、入院看診（連到 `/appointments?date=…`，那天的診療台）、住院原因；已出院多出院時間、出院備註。
   - 「入院評估」一條：入院看診的體重、體溫、本次簡易紀錄（`RichText one-line`）。
   - 日期頁籤（`dates`，「10/13　第 1 天」）＋右邊「當天體重」輸入（離開焦點就 `PUT days/:date`）。預設選今天（已出院選最後一天）。
   - **照護紀錄卡片格**：只列選中那天的紀錄（`recordedAt` 落在那天）。卡片做成元件 `HospitalEntryCard.vue`，6 列（時間｜食物放置｜灌食｜用藥｜其他｜體溫），規則見第一節。點卡片就地編輯：時間用 `ui/time-picker`、用藥用 `DrugSuggestEditor`、其他是多行；1.2 秒 debounce 自動存檔（`PUT` 帶 `version`，409 時用回傳的 `current` 當新基準、提示被別台改過）；卡片 ⋯ 裡「刪除」＋確認。最後一格「新增一筆」：`POST`（時間＝現在，看過去的日子時預設那天的 12:00），建好就進入編輯、游標在食物放置。`?new=1` 進來直接新增一筆。
   - **即時同步不能蓋掉正在打的字**：聽 `hospitalization:updated`（比對 `_id`）與 `lab-results:updated` 時重讀，**依 entry `_id` 合併**，正在編輯的那張保留本機草稿；它的 `__v` 變了就當成衝突（跟 `VisitWorkspace` 的做法一樣）。
   - 下面「檢驗結果」：`GET /lab-results?hospitalizationId=`，只列選中那天的，用 `VisitLabTable` 或 `LabResultGroups` 顯示。「匯入檢驗結果」開 `LabImportDialog`（`:appointment="{ petId, petName, date: 選中的日期 }" :hospitalization-id="id"`）。
   - 出院視窗 `DischargeDialog.vue`（設計稿第 4 張）：入院／住院天數／出院時間（可改，預設現在）、出院備註（Textarea）、帶回家的藥（`DrugSuggestEditor`＋「藥櫃」鈕）。送出後提示「已出院」，有開藥單就提示「帶回家的藥已開成待包藥」。

4. **貓咪頁**（設計稿第 5 張）
   - `PetDetailPage.vue` 頁籤多「住院」（數字＝筆數）：`GET /hospitalizations?petId=`，列期間、天數、原因、狀態（住院中徽章／已出院），點了到住院專區。
   - `PetDetailPage` 與 `panels/PetQuickView.vue` 的 `useLiveReload` 多聽 `hospitalization:updated`（比對 `petId`）——住院體重會改最近體重。

5. **卡片徽章**：掛號台（`ReceptionPage.vue`）與診療台（`VetConsolePage.vue`）的卡片，`item.hospitalizationId` 有值就加「住院」徽章（`bg-info-surface text-info`，可做成 `HospitalBadge.vue`）。

6. **總覽**：`DashboardPage.vue` 加「住院中」一格，數字 `today.hospitalized`，點了到 `/hospital`（兩邊口徑一致：`status: 'admitted'`）。

7. **文件**（同一次改完）
   - `CLAUDE.md` 第二節：流程裡加收住院；回頭路表加「取消住院」。
   - 第三節：新增 `hospitalizations`／`hospitalizationDays`／`hospitalizationEntries`；`appointments`、`labResults`、`medicationOrders` 的新欄位與規則；病歷日誌的「住院」列。
   - 第六節：上面的 API 與 socket `hospitalization:updated`。
   - 第七節：導覽、`/hospital`、`/hospital/:id` 兩頁、總覽的格子、貓咪頁住院頁籤。
   - `docs/STYLE_GUIDE.md`：照護紀錄卡片格（subgrid、同排等高）、住院徽章。
   - 做完刪掉這份交接檔。

## 四、驗證

```bash
cd server && npm run lint && npm test
cd client && npm run build && npm test && npm run test:workflow-browser
```

- `test:workflow-browser` 偶爾在截圖時出現 Puppeteer「Target closed」，重跑一次就過。
- **新畫面要請使用者自己開 `npm run dev` 走一遍**（不要主動啟動 dev server；不要寫測試資料進資料庫，除非使用者同意）。
- 回報時講清楚哪些新畫面沒人點過。

## 五、注意事項

- 很多檔案是 CRLF 換行：在 shell 裡用 node 字串替換時要先把 `\r\n` 轉成 `\n`、改完再轉回。用 Edit 工具最保險。
- 不要自己加欄位下方的說明文字、提示句、placeholder（使用者的偏好）。
- 畫面上的名稱：「現場」（不是「現場加看」）、「院內」、「用藥」。

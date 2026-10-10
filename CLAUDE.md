# 謙華動物醫院診所系統 — 專案說明書

> **回答一律使用繁體中文**（不用簡體字、不用英文），無論使用者用中文或英文提問都一樣。程式碼、變數名稱、commit message 等技術內容維持原樣即可。

> **這份文件描述「系統現在是什麼樣子」，要跟著程式碼一起改。** 動到資料模型、API、頁面、流程規則或技術選型時，同一次改動就更新對應段落；只寫現況與理由，不寫修改過程。每個 session 開場會自動載入，寫錯的描述比沒有描述更糟。對照表見最後一節。

## 一、系統概觀

一家只看貓的動物醫院的院內系統。單一共用帳號登入；每台裝置在設定裡選定身分（醫師／櫃台），聊天、待辦、自動通知以這個身分署名（`useStaffIdentity`，存在 `localStorage`）。任何裝置都能開任何一頁、按任何按鈕，頁面不鎖身分。

| 模組 | 做什麼 |
|---|---|
| 掛號與候診 | 掛號台（櫃台）＋診療台（醫師），一次看一天；電話掛號可指定日期 |
| 看診紀錄 | 每次看診的量測、紀錄、藥單、轉告事項；自動成為病歷日誌 |
| 健檢報告 | 依自訂表單填寫 → 結案（凍結、產 PDF）→ Email／分享連結給飼主；更正用修訂版 |
| 藥單 | 待醫師確認 → 待包藥 → 待領藥 → 已領藥 |
| IDEXX 檢驗 | 院內檢驗儀結果自動上傳、認貓、填進看診與報告；反方向把貓咪送到 IDEXX 主機 |
| 初診表 | 飼主在現場用手機填（公開頁），櫃台審核後建檔 |
| 院內協作 | 全站聊天、寵物暫存區、院內待辦 |

貫穿全系統的原則：

- **看診（掛號文件）是看診資料的唯一存放處。** 病歷日誌與連著看診的健檢報告草稿都不另存一份，而是讀取時即時引用看診；從日誌或報告改，就是寫回看診。
- **報告結案後鎖定不可改。** 要更正得建立修訂版（新的一份，舊版保留並標記 `supersededBy`）。結案時把當下的表單結構與作答存成 `sections` 快照，之後改範本不會回頭改動已結案的報告。
- **跨文件的寫入一律走 transaction**（`server/src/lib/transaction.js`，MongoDB 必須是 replica set），要嘛一起成功、要嘛一起回滾。會被多台裝置同時編輯的文件帶版本號（`__v`），送出時版本不符回 409，不默默覆蓋別人剛做的事。
- **即時同步靠 Socket.IO**，另有定時輪詢與重連補載當備援。
- **沒有值就留白**，畫面不替資料補「未填」「—」之類的字（見第七節）。

## 二、一次看診的流程

```
掛號 ─(初診)→ 飼主填初診表 → 櫃台審核：建立飼主與貓咪
  │
報到（只限今天；建立健檢報告草稿、配號碼牌）
  │
醫師開始看診 → 量測、本次簡易紀錄、藥單、請轉告飼主、回診建議（自動存檔，即時成為病歷日誌）
  │
送交櫃台（藥單這一刻進入「待包藥」）
  │
櫃台處理：轉告飼主、約回診、勾「上傳影像」 → 完成處理（歸還號碼牌）
```

回頭路（每一條都是刻意設計的）：

| 情況 | 怎麼做 |
|---|---|
| 按錯貓、看到一半飼主離開 | 醫師「取消看診」（`unstart`）退回候診，內容留著；之後櫃台才能取消報到或取消掛號 |
| 送交櫃台後要補資料 | 醫師「取回」（`reclaim`），直到櫃台完成處理為止 |
| 完成後要改 | 醫師「申請修改」→ 櫃台核准；或櫃台自己「退回處理中」。都回到待櫃台處理，醫師再取回 |
| 報到報錯 | 櫃台「取消報到」（還沒開始看診才行），或報到提示上的「復原」 |

離開流程（取消掛號、取消報到、標記未到）時：歸還號碼牌、作廢送 IDEXX、取消診療台開的還沒領走的藥單、收掉還沒完成的「上傳影像」待辦、病歷日誌拿掉（內容留在掛號上，重新報到後回來）、連到這次看診的檢驗結果回到待確認清單。開始看診之後（含已交櫃台、已完成）不接受取消報到／取消掛號／未到。

## 三、資料模型（MongoDB collections）

### 格式標記（粗體／四色）

本次簡易紀錄 `appointments.visitNote`、診療台藥單 `appointments.prescription`、藥單的 `condition`／`prescription`／`note`、待辦 `todos.content`、文字模板 `textTemplates.content`，以及**健檢報告所有多行文字項目**（`type: 'textarea'`）可以加粗與上色（紅／橙／綠／藍，對應 `danger`／`warning`／`success`／`info`）。欄位仍是一般字串，內容是 `shared/richText.js` 的極簡標記：粗體 `**字**`、顏色 `[red]字[/red]`，換行就是 `\n`、標記不跨行，`\` 跳脫 `\ * [`（不用 `#`，那是寵物標記）。前後端共用 `parseRichText`／`normalizeRichText`／`richTextToPlain`／`richTextLength`：

- **存之前一律 `normalizeRichText`**（編輯器送出的字串跟伺服器整理後的一致，自動存檔才不會一存就被判成「有修改」）；**字數上限與「不可空白」都看純文字**（schema 用 `lib/richTextSchema.js` 的 `richTextMaxLength`），只剩標記算空白。
- **顯示一律走 `RichText.vue`**（拆成片段、文字插值輸出，**永遠不用 `v-html`**）。清單上的一行摘要用 `RichText one-line`（換行以 `joiner` 接起來），多行截斷加 `line-clamp-*`——摘要也要畫出顏色。編輯用 `RichTextEditor.vue`（Tiptap）。
- 健檢報告的多行文字：填寫用 `formfields/RichTextField.vue`，報告頁與 PDF 用 `RichText palette="report"`（紙面固定淺色，顏色走 `report-*` token）。單行文字、理學檢查與檢驗的備註、圖片說明不支援格式。
- 當純文字用的地方一律 `richTextToPlain`：病歷日誌的 `content`、聊天快照、`aria-label`、滑過提示、搜尋比對、`#寵物` 比對。文字模板插進可上色欄位時格式一起帶入（`insertRichText`），插進純文字欄位只取文字；從純文字欄位「存成模板」時先 `escapeRichText`。

### owners 飼主

`name`、`phone`（必填）、`landline`、`email`、`address`、`notes`。一位飼主可養多隻貓。**`phone` 是手機**：09 開頭 10 碼，存之前整理成純數字（`shared/phone.js` 的 `checkMobilePhone`，前後端、公開初診頁、掛號的 `ownerPhone` 共用），市話放 `landline`。修改時沒動到的舊值照收（舊系統匯入的「電話」常是市話）。

### pets 寵物

`name`、`ownerId`、`species`、`breed`、`color`、`sex`、`neutered`、`birthDate`（`birthDateEstimated`＝由年齡回推）、`weightKg`、家中貓口／飲食／疫苗／病史／過敏／健檢等初診欄位、`notes`、`legacyMedicalRecordNumber`（舊系統病歷號，匯入資料才有；unique＋partial）。可寫入欄位集中在 `server/src/lib/petFields.js`。

- **`breed` 只能是 `shared/catBreeds.js` 清單上的品種**（IDEXX 主機支援的 55 種；`{ label 中文, idexx 英文, aliases 俗稱 }`）。**資料庫存 IDEXX 英文名稱**（舊系統匯入的資料本來就是這樣存，送 IDEXX 也不必轉），畫面一律經 `catBreedLabel`／`breedText` 顯示中文。存之前一律 `checkCatBreed` 整理成清單寫法；沒動到的清單外舊值照收（`checkCatBreed(value, previous)`），編輯時列「原本填寫：…」。輸入一律用 `BreedSelect.vue`。
- 寵物與報告沒有自己的編號，一律用 `_id`。報告 PDF 檔名是「貓咪名＿健檢報告＿健檢日期」（`shared/reportFilename.js`）。
- **刪除貓咪**：有健檢報告或病歷日誌時擋；有還在流程裡（待報到、在院、已完成）的掛號或沒取消的藥單時也擋。已取消／未到的掛號與已取消的藥單一起刪；認到這隻貓的檢驗結果回到待確認清單；暫存紀錄刪掉；待辦裡的 `#` 標記只把 `petId` 清成 null、名字快照留著。

### appointments 掛號與看診

**一筆掛號＝一次看診**，是看診資料的唯一存放處。

- 時間：`date`（`YYYY-MM-DD`，診所時區的那一天）、`time`（`HH:MM`，可留空）、`scheduledAt`（排序用的實際時刻）、`estimatedDurationMinutes`（15–240、15 的倍數，整段要落在同一診別內；跟別人重疊只提醒）。門診時段 10:00–11:45、14:00–19:30，15 分鐘一格（`lib/appointmentTime.js`，前端同一組數字），已過的時段照樣能選（現場補登）。
- 身分：既有病患帶 `ownerId`／`petId`；初診 `petId` 是空的，等初診表審核通過才補上。兩種都存 `ownerName`／`ownerPhone`／`petName`／`species` 快照。`petName` 必填、`ownerName` 選填（電話裡常只問得到貓名）；`ownerPhone` 填了就要是手機。`visitType`（`new`／`return`）由後端依有沒有連結貓咪決定。
- 初診驗證碼：`intakeVerificationCode`（4 位數）在預約時間後 24 小時失效（`intakeVerificationExpiresAt`，改掛號時間時跟著移）；飼主送出初診表後記 `intakeVerificationUsedAt` 與 `intakeSubmissionId`。
- `reason` 來院原因；`isSurgery`／`surgeryName` 手術標記（勾了名稱必填；**只是標記，沒有專屬時段**）。
- `templateId`：報到時用來建立健檢報告草稿的表單（沒指定就用設定的預設表單）；`recordId`：那份草稿。草稿建好之後不能換表單。
- `status`：`scheduled`／`arrived`／`pending_checkout`／`completed`／`cancelled`／`no_show`。

**看診流水線由三個里程碑決定**（`shared/appointmentWorkflow.js` 的 `workflowState`，規則在 `server/src/lib/appointmentWorkflow.js` 的 `applyWorkflowAction`）：

| 里程碑 | 寫入時機 | status |
|---|---|---|
| `visitStartedAt` | 醫師按「看診」／「開始看診」（點開工作區只是先看資料）；「取消看診」清成 null | `arrived` |
| `handoffAt` | 醫師「完成看診，送交櫃台」；「取回」清成 null | `pending_checkout` |
| `deskCompletedAt` | 櫃台「完成處理」；核准修改／退回處理中清成 null | `completed` |

`status` 由里程碑推導，不是獨立的維度；沒有 `arrived → completed` 的捷徑，每次看診都經過送交櫃台這個交接點。排班動作（報到、取消、未到、恢復）能走的狀態轉換在 `lib/appointmentStatus.js`。清單分段（候診／看診中／待櫃台處理／已完成…）依 `status` 分（`workflowFilter`），總覽的數字也是同一個口徑。`reopenRequest { reason, requestedAt, approvedAt }` 是醫師的修改申請。

**看診內容**（同一支 `POST /workflow/clinical` 自動存檔，1.2 秒 debounce）：

- `weightKg`、`temperatureC`；`labValues`（`[{ key, label, value, unit, referenceMin, referenceMax }]`，項目是掛號表單裡「檢驗」類型的項目，`shared/labValues.js` 的 `templateLabItems`；由 IDEXX 自動填入或在健檢報告填寫頁輸入，診療台不輸入）。
- `visitNote` 本次簡易紀錄：醫師寫的病歷內容（可格式化）。
- `prescription` 藥單（可格式化，≤10,000 字）：**送交櫃台的那一刻才在藥單建立一筆「待包藥」**（`lib/visitMedicationOrder.js`：醫師自己開的不必再審，`history` 記 `create`＋`approve`，帶 `appointmentId` 與 `fromVisit: true`，id 記在 `medicationOrderId`）。取回後改了內容再送交＝更新同一張（已包好的標 `needsRepack`）、清空＝取消那張；已領藥的不回頭改，內容不同才另開一張。藥單那邊修改或取消會寫回這個欄位（取消＝清空並解除關聯）。
- `internalNote` 內部備註：只給院內看，不進病歷日誌與健檢報告。
- `specialCareNote` 請轉告飼主：櫃台處理視窗最上面用警示樣式呈現。
- `followUpRecommendation` 回診建議：醫師寫期間與原因，櫃台約下一次時預設帶進來院原因。
- `imageUpload`（`null` 沒勾過／`true`／`false` 勾過又取消）：櫃台處理視窗的「上傳影像」。勾了同一個 transaction 新增一筆待辦「上傳影像 #貓咪名」（`lib/imageUploadTodo.js`，id 記在 `imageUploadTodoId`），取消勾選收掉還沒完成的那筆；待辦完成時把時間寫回 `imageUploadDoneAt`，日誌顯示「已完成　10/9 14:32」。

交給櫃台之後，櫃台還能改 `visitNote`、`internalNote`、`imageUpload`（`DESK_EDITABLE_FIELDS`），其餘要醫師取回；櫃台完成處理後整組鎖定（從病歷日誌更正不受這個限制）。

**號碼牌 `checkinNumber` 是發給飼主的實體牌，不是佇列位置**：報到時配一張「當天從未發出過」的號碼（`checkinNumberHistory` 記下每一張發過的），櫃台可以在報到時改成手上實際發出的號碼（同一天允許重複）。候診先後看 `checkedInAt`。送交櫃台不歸還（人還在診所），完成處理、取消、取消報到才歸還。

**回診**：`followUpDate`／`followUpTime` 只由 `POST /workflow/followup` 寫入——櫃台跟飼主敲定時段的那一刻，同一個 transaction 建立（或改期）下一筆掛號（`visitType: 'return'`、身分快照與表單照抄），新掛號 id 記在 `followUpAppointmentId`，新掛號的 `followUpOfId` 指回這次。規則跟新增掛號同一套（另加「不得早於本次就診」）。下一筆已經被處理過（不是待報到）就不回頭改期。回診掛號被取消或刪除時，這次看診回到「待安排回診」；被恢復時接回去（期間沒另外約才接）。

**保證金**（規則 `shared/deposit.js`，查詢 `lib/deposit.js`）：一隻貓從上次收保證金之後遲到滿 2 次或未到滿 1 次，下次約診要先收 200 元。看的是貓不是飼主。櫃台的決定記在被約的那筆掛號：`depositStatus`（`''`／`collected` 已收／`waived` 這次不收（要寫原因 `depositWaiveReason`）／`refunded` 取消時已退還／`carried` 取消時留著、沿用到下一筆）、`depositDecidedAt`。收了就歸零重算；不收不歸零。需要收而沒帶決定時新增掛號與新約回診回 422 `{ depositRequired: true }`。取消已收的掛號要選錢的去向（`depositOutcome: kept|refunded`）：留著的話下次約診自動沿用、不再收一次。看診完之後的退還／抵扣不追蹤，已收的掛號在掛號台卡片與處理視窗標「已收保證金 200」提醒櫃台。

**出席紀錄**不另存次數，由掛號即時算（`lib/attendance.js`）：遲到＝已到院而 `latenessMinutes > 0`（報到時算；超過預約時間 5 分鐘算遲到，前端 `LATE_GRACE_MINUTES`，一鍵報到自動記；櫃台手動記的不論幾分鐘都算），未到＝`no_show`。清單另外列出已取消的掛號（`cancelledAt`、`cancelReason`）與決定過保證金的掛號，但次數只算遲到與未到。取消報到不留紀錄。

索引：`{date, scheduledAt}`（某一天的時間軸）、`{scheduledAt}`（跨日搜尋）、`{status, scheduledAt}`、`{petId, date}`、`{ownerId, date}`、初診驗證碼兩條、`{recordId}`／`{imageUploadTodoId}`／`{medicationOrderId}`（partial，反查用）。

### clinicalNotes 病歷日誌

`petId`、`entryDate`、`content`、`source`（`manual`／`legacy_import`／`appointment`／`medication`）、`appointmentId`、`medicationOrderId`。日常記事的軌道，跟正式的健檢報告平行。

- **手動記事**（`manual`）與**舊系統匯入**（`legacy_import`，舊系統逐年累加的病歷全文，整段一筆）是自由文字，可改可刪。
- **看診日誌**（`appointment`）只存關聯，內容每次讀取時由掛號即時組成（`lib/clinicalNoteView.js`＋`lib/appointmentWorkflow.js` 的 `appointmentJournalSections`）：來院原因、體重／體溫、檢驗（報告上手動輸入或改過的數值）、IDEXX 檢驗（連到這次看診的原始結果，儀器給的每一項都列）、本次簡易紀錄、藥單、上傳影像、請轉告飼主、回診建議；`internalNote` 不進來。API 回傳 `sections`（分欄、保留格式標記；檢驗兩段另帶 `items`／`results` 結構，前端排成表格）、`content`（純文字版）、`fields`（編輯用原始值）。**日誌存在 ⇔ 貓在院內或已完成，而且有內容；只有來院原因時要醫師開始看診才算**（`lib/appointmentJournal.js` 的 `visitHasJournal`）。日期在建立時寫入（看診當天），之後可以從日誌改。從日誌修改＝`PUT` 帶 `fields`（來院原因、體重、體溫、本次簡易紀錄、請轉告飼主、回診建議）寫回掛號，**不看流程階段**（日誌是事後更正紀錄的地方）；IDEXX 數值在修改模式可以逐項改（`PUT /lab-results/:id/values`）或整份移除（`unmatch`）。不能單獨刪除。
- **藥單日誌**（`medication`）只存關聯，內容由藥單即時組成（標題「領藥（階段）」＋病況／藥單／備註）。**存在 ⇔ 藥單曾經被醫師審核過（`history` 有 `approve`）而且沒有取消**；診療台開的 `fromVisit` 藥單沒有自己的日誌（內容已經在看診日誌上）。可以從日誌更正病況／藥單／備註（寫回藥單、`history` 記 `journal_edit`；還在流程中的會退回待醫師確認），不能刪除，日期跟著藥單建立時間。
- 一筆掛號、一張藥單各最多一筆日誌（partial unique 索引）。索引 `{petId, entryDate, _id}`。

### medicalRecords 健檢報告

| 組別 | 欄位 |
|---|---|
| 基本 | `petId`、`vet`、`visitDate`、`followUpDate`、`examType`（＝表單名稱） |
| 範本快照 | `templateId`、`templateVersion`、`sections`（結案時凍結的表單結構＋作答） |
| 作答 | 具名欄位（`weightKg`、`temperatureC`、`chiefComplaint`、`diagnosis`、`conclusion`…）、`examinationFindings`、`labFindings`、`measurementAssessments`、`customValues`（自訂項目；作答存在哪裡由 `lib/formTemplate.js` 的 `storageFor` 決定） |
| 生命週期 | `status`：`draft`／`finalized`、`finalizedAt`；`pdfStatus`：`pending`／`generating`／`ready`／`failed`、`pdfFileId`（GridFS） |
| 修訂 | `reportVersion`、`revisionOf`、`revisionRootId`、`revisionReason`、`supersededBy` |
| 分享 | `shareToken`（uuid，unique）、`shareEnabled`、`sharedAt`、`shareExpiresAt`（預設 30 天，`SHARE_LINK_DAYS`） |
| 寄送 | `deliveryStatus`：`not_sent`／`sending`／`sent`／`failed`／`uncertain`、`deliveryError`、`lastDeliveryAttemptAt`、`sentAt`、`sentTo`、`emailMessageId` |

- **`status` 與 `deliveryStatus` 是兩個獨立的維度**：結案是臨床流程，寄不寄得出去是通訊結果，寄送失敗不讓報告退回草稿。`uncertain`＝SMTP 可能已收下、結果沒能可靠寫回，不能自動重送，清單上叫「結果待確認」，同時算進「待寄送」與「寄送失敗」兩個佇列。
- **已結案報告的內容一律讀 `sections` 快照**。草稿每次讀取時用目前範本即時組合，並補上「上次數值」對照（最近 20 份已結案報告裡同一項目的值，`lib/historyValues.js`）。
- **連著看診的草稿引用看診、不複製**（`lib/recordVisitLink.js`）：體重、體溫、回診日期、檢驗數值不存在草稿上。讀取（`GET /records/:id`）時把看診的值疊上去（`visitOverlay`，另帶 `visitLink`）；寫入（`PUT`）時這幾欄一律清掉，醫師在報告上改過的放在 `visitEdits`，同一個 transaction 寫回看診與病歷日誌（報告寫不進去，看診也回滾）。回診日期只能讀（只在掛號台約回診）。結案時把看診的值凍結進報告。看診被永久刪除前，先把值寫進還連著的草稿。
- **飼主開啟報告連結與 PDF 要密碼＝飼主手機後 6 碼**（`lib/reportPasscode.js`，不另存欄位，每次用當下的電話算；湊不滿 6 碼就沒有密碼）。公開頁 `GET /api/public/reports/:token` 要帶 `X-Report-Passcode` 標頭，同一個連結 15 分鐘內打錯 10 次就鎖。GridFS 裡存的是沒有密碼的原檔，**交出去（下載、Email 附件）那一刻才加密**（`lib/pdfEncrypt.js`）。
- 刪除：已寄出、寄送中、結果待確認的不能刪；已結案的要打字確認（`confirmText`＝貓咪名稱），草稿直接刪。刪除時同一個 transaction 回復修訂鏈、把指向它的掛號 `recordId` 清成 null（`__v` +1、廣播），之後刪掉 Cloudinary 圖片與 GridFS 裡的 PDF。
- 索引：`petId`、`shareToken`、`{supersededBy, updatedAt}`、`{supersededBy, visitDate}`、`{status, deliveryStatus}`、修訂相關兩條。跨貓咪清單沒有索引會變成記憶體排序（32MB 上限會直接失敗）——**新增查詢模式時要確認索引接得上**。

### formTemplates 健檢表單範本

`name`（unique）、`description`、`species`（`cat`／`dog`／`all`）、`enabled`、`order`、`version`、`sections[]`（區塊：`key`、`title`、`reportTitle`、`presentation`、`items[]`）、`presets[]`、`retiredKeys`。使用者自由增刪區塊與項目；key 由後端產生、永不修改、刪掉的不再重用。帶 `role` 的項目（`vet`、`visitDate` 印在報告頁首，`weight` 結案時寫回貓咪體重）被移除會讓對應功能失效，存檔要確認。詳見 [docs/FORM_BUILDER.md](docs/FORM_BUILDER.md)。

- 檢驗項目的 `idexxCodes[]`（IDEXX 項目代號，可多個，「、」或逗號分隔）與 `idexxInstrument`（檢驗別＝儀器名稱，留空＝任何儀器）：IDEXX 結果依「檢驗別＋代號」對到項目（`lib/labResultFill.js` 的 `matchLabItem`），撞名在存檔時擋。
- **預填模板** `presets[]`（`{ key, name, order, values }`）：同一份表單的另幾組預填值（「預防針」「牙齒」），在 `/settings/presets` 設定（不在表單設計頁，兩邊存檔不互相覆蓋），填報告時從頁首一鍵套用。只收文字／選項類欄位（`shared/formDefaults.js` 的 `presetEligible`：排除日期型別、名稱含「日期」的欄位、獸醫師）。疊在項目 `defaultValue` 之上；切換模板時上一組帶入而沒被改過的欄位退回預設值（`client/src/lib/formPresets.js`）。不影響結構、不動 `version`、不進快照。
- 被報告引用的表單不能刪，只能停用；掛號的預設表單（`clinicSettings.defaultAppointmentTemplateId`）不能停用或刪除，要先改預設。至少保留一份。

### medicationOrders 藥單

`petId`、`ownerId`、`appointmentId`、`fromVisit`、快照（`petName`、`ownerName`、`ownerPhone`）、`condition`／`prescription`／`note`（可格式化）、`status`、`needsRepack`、審核／包藥／領藥的人與時間、`history[]`（每次異動留當時內容）。階段定義在 `shared/medicationWorkflow.js`：`review` 待醫師確認 → `approved` 待包藥 → `ready` 待領藥 → `collected` 已領藥，另有 `cancelled`。櫃台登記的從 `review` 開始；改了已確認藥單的內容就退回待醫師確認（待領藥的標 `needsRepack`，包藥時要確認已停用舊藥包）。藥單與它的病歷日誌（及診療台藥單的寫回）在同一個 transaction。工具欄數字依裝置身分：醫師看待確認、櫃台看待包藥＋待領藥（`medicationTodoCount`）。

### labResults IDEXX 檢驗結果

設定、部署與排查見 [docs/IDEXX_INTERLINK.md](docs/IDEXX_INTERLINK.md)。IDEXX 不開放 API：InterLink（診所區網內的 Windows 電腦）把結果存成 XML，那台電腦上的抓檔程式（`bridge/`）上傳到 `POST /api/lab-results/import`（`IDEXX_BRIDGE_TOKEN` 驗證）。

- 一筆＝一台儀器對一隻貓的一次檢驗，`{diagnosticSetId, instrument}` unique。欄位是 `lib/idexxResult.js` 解析出來的：`runAt`、IDEXX 主機上的 `client`／`patient`（`patient.id` 是 IDEXX 回傳的病患編號）、`assays[]`（`code`、字串 `value`、`unit`、參考範圍、`qualifier`）、`notes[]`、原始檔 `rawXml`（`select: false`）。解析寬鬆、不驗證 DTD（IDEXX 實際輸出不完全符合）。重送與更正由 `lib/labResultImport.js` 判斷（一樣只加計數、不同以訊息時間新的為準、舊的不採用）。
- `overrides[]` 是醫師在病歷日誌改過的值；`assays` 是儀器原文、永遠不動，顯示一律經 `shared/labValues.js` 的 `effectiveAssays` 疊上去。
- **`petId` 空的＝待確認**。自動認貓：`patient.id` 是存在的貓咪 `_id`、**而且那隻貓檢驗當天有看診**才配對。認出後填進檢驗當天的看診（`lib/labResultApply.js`；當天好幾筆時挑檢驗前最後報到的）：**空格才填**，已有不同的值記成差異（`conflicts`、`conflictsOpen`）由醫師在比對視窗決定（預設都不覆蓋，可「復原」）；儀器判定無效（`!`、`-`）或超過 40 字的不填；表單沒有對應代號的記在 `unmappedCodes`（不算問題，全血檢常比表單項目多）。填過的記 `appointmentId`、`appliedAt`、`filled[]`；看診已完成或報告已結案時記 `fillClosed`。看診沒選表單時只記關聯不記 `appliedAt`，之後掛號建立、報到、修改掛號、建立報告草稿時由 `applyPendingLabResults` 補套用。
- 認不出的結果進工具欄「檢驗」的待確認清單：附檢驗當天的掛號當候選（同名排前、唯一同名預選）；人選了就照同一套規則填入，那隻貓當天沒看診就不配對。診療台「匯入檢驗結果」反方向操作，可以指定填進這次看診（不限當天）。選錯可「復原」（清掉還是當初填進去的值，並記 `autoMatchBlocked`，IDEXX 重送時不再自動配回）；品管測試可以「忽略」（`dismissedAt`）。看診取消、未到、被刪除或貓被刪除時，連過去的結果回到待確認清單。
- 填入狀態燈號（`LabFillStatus.vue`，規則 `client/src/lib/labFillStatus.js`）：黃＝有未處理的差異／看診沒選表單／填入時報告已結案；綠＝有填入；藍＝沒有填入新數值；沒有結果不畫。
- `lab-results:updated` 廣播 3 秒內合併成一次、上傳一份一份排隊至少隔 0.25 秒、抓檔程式一輪最多 20 份——IDEXX 主機補傳歷史紀錄時一次幾百份，不節流會拖垮伺服器。
- 索引 `{diagnosticSetId, instrument}`、`{petId, runAt, _id}`、`{appointmentId}`（partial：未處理差異）、`{appointmentId, runAt, _id}`（partial：連到看診的）。

**labBridgeStatuses**：每台抓檔程式一筆心跳（`bridgeId` unique、`lastSeenAt`、`lastUploadAt`、`pendingFiles`、`lastError`、`version`），超過三分鐘沒心跳算離線，「檢驗」面板顯示燈號。

**idexxRequests「送 IDEXX」**（已實作、預設關閉，`IDEXX_CENSUS_MODE=off`）：醫師或櫃台對在院的掛號按「送 IDEXX」（`labRequestedAt`），伺服器組好 XML、依設定編碼（`IDEXX_CENSUS_ENCODING`，預設 Big5，`lib/big5.js`）排隊，抓檔程式來拿、寫進 InterLink 的 `Requests\`、回報後記 `labDeliveredAt`。報到不自動送（不是每次看診都驗血）。掛號離開診所（完成、取消、取消報到、取消送）時排離院／取消通知；開單的檢驗已經做完就只記 `skipped`。XML 組法在 `lib/idexxCensus.js`（物種除非明寫是狗一律 `FELINE`、性別＋結紮四種、品種送 IDEXX 英文名、飼主姓名拆姓／名）。訊息種類 `census`／`work_request` 要到診所與 IDEXX 確認後才決定。排不進去只記 log、不讓報到失敗。

### chatMessages 全站內部聊天

`sender`（`vet`／`front_desk`）、`content`（≤1000 字）、`auto`、`snapshot`（自動通知附的修改前後）、`mentions[]`。醫師↔櫃台的全站即時聊天，跟任何掛號無關。診療台與掛號台的動作會自動發一則描述訊息（`auto: true`，文案 `lib/appointmentNotifications.js`，送出點 `composables/useAppointmentNotifier.js`，每台裝置可在「自動通知」逐項關掉）。`#` 標記貓咪：前端只送 `petId`，名字快照由伺服器寫入（`lib/petMentions.js`），同一個 transaction 把貓放進暫存區。

### pinnedPets 寵物暫存區

`petId`（unique）、`pinnedBy`、`source`（`mention`／`manual`）、`messageId`、`pinnedAt`。「把這隻貓丟給對方看病歷」的地方：全站一份、不隨日期清空、只能手動移除，重複放入只更新時間。

### todos 院內待辦

`content`（可格式化，≤500 字）、`createdBy`、`dueDate`、`starred`（置頂）、`status`（`open`／`done`）、`doneAt`、`doneBy`、`mentions[]`（內文的 `#` 標記，≤5 隻；不會放進暫存區）。全站共用的行政雜務清單，沒有指派對象、沒有重複待辦。`GET /api/todos` 回未完成（上限 200，置頂優先、有期限的由早到晚，超過上限時留最新的）＋最近完成 50 筆；任何異動後整份重讀並廣播。

### textTemplates 文字模板

`name`、`content`（可格式化，≤2,000 字）、`availableForAllFields`、`applicableItemKeys`、`enabled`、`usageCount`。填健檢報告與診療台時插入常用長文（診療台欄位用 `visit:visitNote`／`visit:specialCareNote` 這種固定 key）。

### intakeSubmissions 初診表

飼主在公開初診頁（`/intake`）用櫃台給的 4 位驗證碼填的資料，核准前絕不混入正式飼主／貓咪資料。`owner`、`pet`、`status`（`pending`／`approved`／`rejected`）、`linkedAppointmentId`。櫃台可以在審核前修改內容（`lib/intakeEdit.js`）。**核准＝建立飼主與貓咪、排定那筆掛號的日期與時段**（掛號中途被取消的話一併恢復成待報到）。**退回＝那筆掛號回到「等飼主填初診表」**，驗證碼沒過期的話飼主可以重填。初診一定要走這條路才報得了到。

### deliveryLogs 寄送流水帳

append-only：`recordId`、`petName`、`ownerName`（冗餘快照，不設 ref——報告被刪後仍查得到寄給了誰）、`attemptId`、`event`（`queued`／`sent`／`failed`／`uncertain`）、`recipient`、`messageId`、`error`。一次寄送＝`queued`＋結果，API 依 `attemptId` 合併成一列（`lib/deliveryAttempts.js`）。

**`sent`（畫面叫「已寄出」）只代表郵件伺服器收下了信，不代表送達**：

- 寄出前先擋（`lib/emailCheck.js`）：格式、常見網域錯字（`gmial.com` → 提示 `gmail.com`）、DNS 查無此網域（逾時一律放行）。
- 退信讀回來（`lib/mailBounces.js`＋`lib/bounceMessage.js`）：用寄信的 Gmail 帳號走 IMAP（唯讀，不標已讀、不搬、不刪），每 5 分鐘、以及每次寄出後 45 秒與 3 分鐘各看一次近 3 天的 mailer-daemon 通知；以 `In-Reply-To`／`References` 對回原信，同一個 `attemptId` 補一筆 `failed`（「退信：收件地址不存在」）。報告的 `deliveryStatus` 只在這封信還是它最後一次寄送時才改成 `failed`。冪等；`MAIL_BOUNCE_CHECK=off` 關掉。

### users 帳號

`username`（unique）、`passwordHash`（`scrypt$<salt>$<hash>`，`select: false`）、`active`、`tokenVersion`。單一共用帳號。第一次啟動時 collection 是空的就用 `AUTH_USERNAME`／`AUTH_PASSWORD_HASH` 建立（之後不再讀）。換密碼、撤銷登入用 `server/scripts/`（見第八節），不要手動改資料庫。JWT（HttpOnly cookie，30 天）是無狀態的，**`tokenVersion` 是唯一的撤銷手段**：每次請求比對版本與 `active`，改密碼／撤銷／停用會讓它 +1。

### clinicSettings

單一文件：`defaultAppointmentTemplateId`（掛號沒指定表單時用的預設表單）。

## 四、技術棧

| 層級 | 選擇 | 備註 |
|---|---|---|
| 前端 | Vue 3 + Vite | Composition API、`<script setup>`；狀態用 Pinia |
| UI 元件 | reka-ui + shadcn-vue 風格 | 元件在 `client/src/components/ui/`，可直接改 |
| CSS | Tailwind CSS v4 | 設定寫在 `client/src/style.css` 的 `@theme`（沒有 `tailwind.config.js`） |
| 圖示 | `@lucide/vue` | **不是** `lucide-vue-next` |
| 字體 | `@fontsource-variable/noto-sans-tc`、`@fontsource/ibm-plex-mono` | 自架；等寬字只給數字（`num` utility） |
| 富文字 | Tiptap（只裝 Document／Paragraph／Text／Bold＋自訂 `tint` 顏色 mark） | 存的是格式標記字串，不是 HTML |
| 表單驗證 | vee-validate | |
| 後端 | Node.js + Express | |
| 資料庫 | MongoDB（replica set）+ Mongoose | 跨文件寫入用 transaction |
| 登入 | `jsonwebtoken` + Node 內建 `crypto.scrypt` | |
| 即時通訊 | Socket.IO | 掛號以「天」為房間（`appointments:<date>`），其餘全站廣播；沿用 cookie session 驗證 |
| PDF | Puppeteer | 見第五節 |
| PDF 加密 | `@cantoo/pdf-lib` | 交出去時加飼主手機後 6 碼密碼 |
| Email | Nodemailer（Gmail SMTP、應用程式密碼） | |
| 退信讀取 | imapflow | 同一組 Gmail 帳密 |
| XML 解析 | fast-xml-parser | IDEXX 結果檔 |
| 圖片 | Cloudinary（前端直傳、後端簽章） | 健檢報告圖片欄位 |
| 測試 | Node 內建 `node --test` | 不裝額外框架 |

## 五、PDF 產生方式

**不另外維護 PDF 版型。** 前端的報告檢視頁 `/report/:token` 同時是飼主看的公開頁與 PDF 來源：結案後背景工作（`lib/reportPdfJobs.js`）用 Puppeteer 開這一頁截成 PDF、存進 GridFS（`reportPdfs`），`pdfStatus` 記進度、伺服器重啟後會接續。內部渲染帶 `x-pdf-render-secret` 標頭（不必輸入飼主密碼）。`@media print` 隱藏操作型 UI。

`lib/pdf.js`：Chromium 實例重用（快取 launch 的 promise，閒置五分鐘才關）；渲染排隊一次一個（並行會讓 `networkidle0` 永遠不滿足）；分頁關閉快取（共用實例拿到 304 會被當成失敗）。

## 六、API

除了標注的幾條，`/api/*` 都要登入（`AUTH_ENABLED=true` 或 `NODE_ENV=production` 時生效；本機開發預設不檢查）。錯誤一律 `{ message }`。

```
免登入
GET    /api/health                       資料庫與 transaction 是否可用（/api/health/live 只看程序活著）
GET    /api/auth/me ／ POST /api/auth/login（限流）／ POST /api/auth/logout
GET    /api/public/reports/:token        飼主看報告；X-Report-Passcode 標頭帶手機後 6 碼，沒帶或錯回 401 { passcodeRequired }，錯太多 429
POST   /api/public/intake-submissions/verify ／ POST /api/public/intake-submissions   公開初診頁（限流）
抓檔程式（Authorization: Bearer <IDEXX_BRIDGE_TOKEN>）
POST   /api/lab-results/import           上傳 XML 原始位元組（X-File-Name：URL 編碼檔名）；回 created／duplicate／updated／stale／ignored ＋ fill
POST   /api/lab-results/heartbeat        心跳
GET    /api/lab-results/requests ／ POST /api/lab-results/requests/:id/delivered   拿待送的 IDEXX 通知、回報已寫好

飼主（沒有獨立頁面，跟著貓咪出現）
GET    /api/owners?q=                    新增貓咪時搜尋既有飼主
POST   /api/owners ／ POST /api/owners/with-pet（新飼主＋第一隻貓，transaction）
GET    /api/owners/:id ／ PUT /api/owners/:id（帶 expectedVersion）／ DELETE /api/owners/:id（名下還有貓擋；目前沒有畫面入口）
GET    /api/owners/:id/attendance        飼主名下所有貓的遲到／未到次數（掛號視窗用）

貓咪
GET    /api/owners/:ownerId/pets ／ POST /api/owners/:ownerId/pets
GET    /api/pets?q=                      清單（每筆帶 lastEntryAt：最近一則病歷日誌）
GET    /api/pets/:id ／ PUT /api/pets/:id（帶 expectedVersion）／ DELETE /api/pets/:id（規則見第三節 pets）
GET    /api/pets/:id/attendance          出席紀錄清單（kind: late|no_show|cancelled|deposit）＋ counts（只算遲到與未到）＋ deposit（現在約診要不要收）

病歷日誌
GET    /api/pets/:petId/clinical-notes（?excludeAppointmentId=）／ POST（手動記事）
PUT    /api/clinical-notes/:id           手動／匯入改 content、entryDate；看診日誌帶 fields 寫回掛號；藥單日誌帶 fields 寫回藥單
DELETE /api/clinical-notes/:id           只限手動／匯入；看診與藥單日誌回 409

健檢報告
GET    /api/pets/:petId/records ／ POST /api/pets/:petId/records（templateId 必填）
GET    /api/pets/:petId/records/previous-values   上次數值對照
GET    /api/pets/:petId/records/finalized-sources 「從既有報告帶入」的來源清單
GET    /api/records                      跨貓咪清單：?view= todo|drafts|pending|failed|sent|all、?q=、分頁；回 counts（佇列數字不套用搜尋）
GET    /api/records/:id ／ PUT /api/records/:id（帶 expectedVersion，連著看診的另收 visitEdits）
POST   /api/records/:id/finalize         驗證必填 → 凍結 sections → 排 PDF
POST   /api/records/:id/pdf/retry ／ GET /api/records/:id/pdf（加密後下載）
POST   /api/records/:id/revisions        建立修訂草稿
POST   /api/records/:id/share ／ POST /api/records/:id/revoke-share
POST   /api/records/:id/send-email       寄 PDF＋連結給飼主（真的會寄出）
DELETE /api/records/:id                  已結案要 confirmText

掛號與看診
GET    /api/appointments?date=           某一天的全部掛號，另回 patientNotes（貓咪／飼主備註）與 labResultCounts
GET    /api/appointments/search?q=       跨日搜尋（貓咪、飼主、電話、來院原因），新到舊、分頁
GET    /api/appointments/intake-codes    還能用的初診驗證碼
POST   /api/appointments                 新增（date 省略＝今天；達保證金門檻要帶 deposit）
GET    /api/appointments/:id
PUT    /api/appointments/:id             修改（只限待報到與在院；在院的不能改日期；有草稿後不能換表單）
POST   /api/appointments/:id/check-in    報到（只限今天、已建檔的貓；可帶 isLate＋lateAt、checkinNumber）
POST   /api/appointments/:id/lab-request 送 IDEXX／取消送（{ requested }）；功能沒開回 409
PATCH  /api/appointments/:id/deposit     事後更正保證金紀錄
POST   /api/appointments/:id/cancel      取消（已收保證金要帶 depositOutcome）
POST   /api/appointments/:id/no-show ／ POST /api/appointments/:id/restore（恢復、或取消報到）
DELETE /api/appointments/:id             永久刪除（只限已取消／未到）

看診流水線：POST /api/appointments/:id/workflow/:action，body.version 必帶（不符 409），整支在一個 transaction
clinical        存看診內容（weightKg/temperatureC/labValues/visitNote/prescription/internalNote/specialCareNote/followUpRecommendation/imageUpload＋staff）
start           開始看診
unstart         取消看診，退回候診
handoff         送交櫃台（醫師寫了藥單就在這一刻建立／更新藥單）
reclaim         取回
complete        櫃台完成處理（歸還號碼牌）
followup        約回診（建立或改期下一筆掛號；規則同新增掛號）
record          建立／取得這次看診的健檢報告草稿
request-reopen ／ approve-reopen ／ reopen    醫師申請修改／櫃台核准／櫃台自己退回

藥單
GET    /api/medications?status=active|all|<階段>&petId=&q=   回 counts
GET    /api/medications/:id ／ POST /api/medications（櫃台登記）
POST   /api/medications/:id/actions/:action    edit／approve／return／ready／collect／cancel（帶 version）

IDEXX 檢驗結果
GET    /api/lab-results                  預設列待確認（附候選掛號）；?petId=&date=&appointmentId= 列那隻貓的；?q= 搜尋
POST   /api/lab-results/:id/match        選貓（{ petId, appointmentId? }）
POST   /api/lab-results/:id/unmatch ／ dismiss ／ undismiss
PUT    /api/lab-results/:id/values       病歷日誌改數值（{ values: { 代號: 值 } }）
GET    /api/lab-results/conflicts?appointmentId=
POST   /api/lab-results/:id/conflicts/resolve（{ overwrite: [key] }）／ conflicts/reopen
GET    /api/lab-results/bridge-status ／ DELETE /api/lab-results/bridge-status/:bridgeId

初診表
GET    /api/intake-submissions?status= ／ GET /api/intake-submissions/:id
PUT    /api/intake-submissions/:id       審核前修改（帶 version）
POST   /api/intake-submissions/:id/approve（date、time 必填）／ reject

協作
GET/POST /api/chat/messages
GET/POST /api/pinned-pets ／ DELETE /api/pinned-pets/:petId
GET/POST /api/todos ／ PUT /api/todos/:id ／ POST /api/todos/:id/complete|reopen ／ DELETE /api/todos/:id

設定與其他
GET/POST /api/settings/form-templates ／ GET/PUT/DELETE /api/settings/form-templates/:id
GET/PUT  /api/settings/appointment-settings    預設表單
GET    /api/text-templates（?includeDisabled=&q=）／ GET /api/text-templates/fields ／ POST ／ PUT /:id ／ POST /:id/use ／ DELETE /:id
GET    /api/delivery-logs                寄送流水帳（?recordId=&event=&q=&from=&to=）
GET    /api/uploads/image-signature      Cloudinary 直傳簽章（限流）
GET    /api/search?q=                    全站搜尋（飼主＋貓咪）
GET    /api/dashboard                    總覽數字
```

Socket.IO 事件（伺服器 → 前端）：`appointment:updated`（只送到那一天的房間；前端以 `join-day`／`leave-day` 加入）、`chat:new`、`pinned-pets:updated`、`todos:updated`（後兩個帶完整清單）、`medication:updated`、`intake:updated`、`lab-results:updated`、`clinical-note:updated`（後幾個只是「請重讀」）。

**儀錶板的數字必須跟點進去的清單筆數對得起來**（總覽四格對應掛號台 `?stage=`、報告四格對應 `/records?view=`），兩邊用同一套條件。

## 七、前端

### 骨架（`App.vue`）

`左側導覽 72px ｜ 工作區 ｜（工具欄面板 460px）｜ 右側工具欄 64px`。頁面由視窗捲動，兩條欄與並排的面板用 sticky 釘住。

- **左側導覽**（`components/shell/NavRail.vue`，項目 `lib/navigation.js`）：看診（總覽、診療台、掛號台、藥單）、資料（貓咪、報告、寄送）、設定（表單、模板、預填）。上方 Logo 與搜尋（`Ctrl/Cmd+K` 命令面板），下方設定選單（裝置身分、明暗主題、自動通知、登出）。手機寬度改成頁首漢堡選單。active 判斷用網址前綴，路由可用 `meta.nav` 指定歸屬。
- **右側工具欄**（`components/shell/UtilityRail.vue`）開側滑面板：暫存、藥單、待辦、檢驗（含 IDEXX 抓檔程式燈號）、初診（只在掛號台）、聊天。數字是紅色徽章＝要人動手（0 不畫）。藥單、初診、檢驗的數字在 `stores/workCounts.js`，隨對應的 socket 事件重讀；抓檔程式心跳每分鐘讀一次，有一台離線就亮「!」。
- **側滑面板**（`UtilityPanelHost.vue`＋`stores/utilityPanel.js`）：一次開一個，不加遮罩、不鎖背景；1600px 以上推開工作區，更窄時浮在上面。面板內可以「推入」一層（暫存區的貓 → 病歷速覽 `PetQuickView`；藥單 → 新增；初診 → 逐欄審核）。`KeepAlive` 保留草稿。外框統一 `panels/SidePanel.vue`。
- Toast 一律在畫面底部置中。
- **診療台與掛號台共用同一個日期**（`stores/clinicDate.js`，經 `composables/useClinicDate.js` 讀寫）：網址的 `?date=` 優先；等於今天時不記固定日期；進總覽頁重設成今天。

### 頁面

| 路由 | 頁面 | 重點 |
|---|---|---|
| `/` | 總覽 | 寄送失敗橫幅（有才出現）→ 今天的門診四格（今日掛號、在院、待櫃台處理、已完成）→ 健檢報告四格（草稿、待寄送、寄送失敗、本月已寄出）→ 近 8 週健檢量（CSS 長條）＋院內待辦前 8 筆。每個數字都點得進對應清單 |
| `/appointments` | 診療台 | 左欄「今日病患」（頁籤：進行中／已交櫃台／已完成；精簡／詳細切換）：每列左邊預約時間、右邊一顆狀態徽章，時間軸軌道＋「現在」線＋午休分隔，順序只由預約時間決定。右欄看診工作區（`VisitWorkspace`，一次一筆，切換前先存檔）：標頭規格欄（貓咪、飼主、就診時間）、醫療警示、可就地改的貓咪與飼主備註；內容依序量測 → 檢驗報告（`VisitLabTable`，IDEXX 原文，唯讀；「匯入檢驗結果」`LabImportDialog`；填入狀態燈號）→ 本次簡易紀錄 → 藥單 → 內部備註 → 交給櫃台（請轉告飼主、回診建議）；右邊歷次病歷日誌。每個欄位旁有去處標記（`DestTag`：日誌／報告／院內／藥單）。底部：送 IDEXX、開啟健檢報告、取消看診、完成看診送交櫃台（或取回修改、申請修改） |
| `/reception` | 掛號台 | 頁首（日期、掛號）→ 流程列四格（待報到、在院、待櫃台處理、已完成；點一格篩選 `?stage=`）→ 例外才出現的警示列（醫師申請修改、遲到未報到、待審初診表）→ 整頁時間軸（上午／下午可收合、「現在」線；已完成與未到／取消收在下面）。搜尋是跨日的，有關鍵字時換成搜尋結果表。卡片：左邊號碼牌或貓圖示＋名字與徽章，右邊飼主／電話／進度三欄，最右主要動作（報到、遲到、審核、處理）＋⋯。已建檔的貓一鍵報到（自動配號碼、過了寬限自動記遲到、可復原）；初診要等飼主填好初診表、審核通過才報得了到。掛號是雙欄 Modal（`AppointmentDialog`：誰與為什麼｜時段格），選了貓之後出現出席對照表與保證金欄位。已交櫃台的開櫃台處理視窗（`HandoffSheet`）：①請轉告飼主 ②本次簡易紀錄（體重體溫、上傳影像勾選框、歷次日誌）③約回診（`AppointmentSlotPicker split`），底部完成處理／退回處理中／核准修改 |
| `/medications` | 藥單 | 清單頁模板；頁籤依裝置身分預設（醫師：待醫師確認；櫃台：未完成），點貓咪切到詳情。工具欄面板是同一個 `MedicationWorkspace` 的 `compact` 版。「藥單」是物件，「領藥」只指交付 |
| `/pets`、`/pets/:id` | 貓咪 | 詳情頁：頁首名字、舊病歷號、藥物過敏、遲到／未到徽章、「約診需收保證金」；左貓咪右飼主兩欄可就地編輯；頁籤：病歷日誌（最上面就地新增）、健檢報告、出席紀錄（含保證金與已取消的掛號，可修改保證金紀錄；頁籤數字＝清單筆數）。遲到與未到只算這隻貓自己的 |
| `/pets/new` | 新增貓咪 | 飼主與貓咪同一頁（既有飼主／新增飼主），寬螢幕左右兩欄，有離開前的未儲存提示 |
| `/records` | 健檢報告清單 | 跨貓咪，佇列頁籤；寄送失敗的列左側紅線 |
| `/records/deliveries` | 寄送歷程 | 流水帳，含已刪除報告 |
| `/pets/:petId/records/new`、`/records/:id/edit` | 健檢報告填寫 | 自動存草稿、離開前攔截；套用預填模板；連著看診的草稿有「引用本次看診」說明條（體重、體溫、檢驗數值在這裡改會寫回看診）與填入狀態燈號，有未處理的檢驗差異時自動跳比對視窗 |
| `/records/:id/preview` | 報告預覽 | 結案、寄送、分享、下載 |
| `/report/:token` | 報告（公開） | 飼主看的頁面＋PDF 來源；先輸入手機後 6 碼（記在 `sessionStorage`） |
| `/intake` | 初診填寫（公開） | 飼主用手機填，獨立版面（`--intake-*` token），見 STYLE_GUIDE 第 10 節 |
| `/reception/intakes` | 初診表審核 | 左清單右逐欄審核（`IntakeReview`，跟初診面板共用），三段可就地修改，排定掛號日期與時段後核准 |
| `/settings/forms`、`/settings/forms/:id` | 表單管理／設計 | |
| `/settings/text-templates` | 文字模板 | |
| `/settings/presets`、`/settings/presets/:formId/:presetKey` | 預填模板 | 左表單清單、右模板；選中的表單記在 `?form=` |

另有 `/login`（登入，未登入時一律導過去、登入後回到原本的網址）。不存在的網址導回總覽。

### UI 規範（最容易做錯的幾條）

設計語言文件是 [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md)。**數值只在 `client/src/style.css`，畫面以程式為準**，STYLE_GUIDE 寫規則與理由。大改（新頁面、版面重排、新元件類型）先做設計提案、使用者確認後才實作；改完同一次更新 STYLE_GUIDE 與這一節。

- **明暗兩套、同一套形狀**：淺色（冷灰底、白卡片、深青主色）、深色（近黑藍底、青藍主色），不用光暈。所有色值只在 `style.css` 的 `:root`／`.dark`；`npm run build` 的 `scripts/audit-colors.mjs` 擋頁面裡的色碼、Tailwind 固定色階與原生 `title`。
- **一律用語意 token**：`bg-background`／`bg-card`／`bg-sunken`／`bg-hover`／`bg-field`；`text-foreground`／`text-muted-foreground`／`text-subtle-foreground`；`border-border`／`border-border-strong`；`bg-primary`、`bg-accent`；狀態 `danger`／`warning`／`success`／`info` 各配 `-surface`；`surgery`（紫，只給手術）。狀態色的明度刻意錯開（色盲時靠明度分辨），危險永遠是對比最高的那一個。
- **字級**（1920×1080 為目標）：`text-xl` 28 頁面標題／`text-lg` 22 區塊標題／`text-base` 18 內文／`text-sm` 16 控制項與次要文字／`text-xs` 15 註記與徽章／`text-2xs` 14 規格欄小標題（下限）。數字用 `num`。報告紙面 `.report-sheet` 走自己的尺度（A4）。
- **控制項高度** 36／40／44／48，預設 40。**同一排的按鈕一律同高**（主要動作靠實色突顯，不靠放大）：頁首、底部操作列、掛號台卡片動作是 40，清單列是 36。圓角：小標記 6、控制項 8、卡片 12、對話框 16。
- **按鈕**：`default` 實色（主要動作）、`soft` 主色淡面（推進流程的動作、清單列唯一的主要動作）、`secondary` 下凹底（輔助動作、圖示鈕、分頁）、`destructive` 淡紅、`destructive-solid` 實心紅（只給確認視窗的最終動作）。所有按鈕靜止時都有底色。狀態徽章盡量有顏色，灰色只給已取消、已停用。
- **頁面容器只有一種**：寬度與外距只在 `App.vue` 的 `<main>` 決定（滿版，不設 `max-w`）。每頁根節點 `flex flex-col gap-5`、第一個子元素是 `PageHeader`。會被側滑面板擠窄的區塊用 container query 依自己的寬度排。表單頁靠分欄避免單一輸入框拉成一長條。
- **清單頁一個模板**：`PageHeader`（標題＋主要動作；詳情頁用 `back-to` 返回鈕）→ `DataCard`（標頭：清單標題＋筆數、`#filters`；`#tabs` 一條 `FilterTabs`；`.desktop-data-header`＋`.desktop-data-row`；`#footer` 放 `ListFooter`）。篩選放卡片標頭；列上一顆主要動作，其餘收進 `RowActions`；1280px 以下改小卡。
- **身分資訊不用「·」串成一行**：標頭用規格欄（`SpecGrid`＋`SpecCell`），清單只寫「品種＋♂♀」（`PetLine`）；初診才出徽章。
- **欄位沒有值就留白**：不寫「未填…」「尚無…」「待確認」，也不補「—」（`formatDate` 沒值回空字串）；格子照畫、內容空著（需要時 `min-h-lh`）。例外：整個清單是空的空狀態、載入／錯誤訊息、修改前後對照的「（空白）」、下拉選項本身的「未記錄」。畫面只寫事實，不加結論或說明句。
- **品種一律 `BreedSelect`**，顯示一律經 `catBreedLabel`／`breedText`。
- **不用 `v-html`、`confirm()`／`alert()`、原生 `title`**：確認走 `ConfirmDialog`，提示走 `useToast()`，格式文字走 `RichText`，滑過提示用 `v-tip`（截斷文字 `v-tip.overflow`）。日期用 `ui/date-picker`（公開初診頁例外，用原生日期欄，手機上是系統滾輪）。
- **貓咪名、飼主名一律是連結**（`PatientLink` → `/pets/:id`；飼主名用 `quiet`）。例外：在按鈕或選項裡、沒建檔的初診、飼主看的報告頁、貓咪詳情頁自己。
- 圖示 `@lucide/vue`、`stroke-width="1.75"`；頭像一律貓。
- **用語**：員工畫面「貓咪」「櫃台」「醫師」「健檢報告」；公開初診頁「貓孩兒／家長」。
- 報告頁固定淺色、用 `report-*` token；`style.css` 的淺色選擇器是 `:root, .report-sheet`，紙面內的共用元件行內樣式寫 `var(--field)` 這種原始 token。公開初診頁也是獨立的一套（`--intake-*`、16px 為底、點擊範圍 44px）。
- 前端共用的 helper 不要各頁再寫一份：錯誤訊息 `lib/apiError.js` 的 `apiErrorMessage`；複製 `lib/clipboard.js`／`composables/useCopy.js`；伺服器分頁清單 `composables/usePagedList.js`；前端分頁 `composables/useClientPagination.js`；某隻貓的病歷日誌 `composables/usePetClinicalNotes.js`；網址參數 `composables/useSearchQueryParam.js`。

## 八、開發與驗證

```bash
# 前端（client/）
npm run build                  # 含色碼／title 檢查；驗證改動用這個
npm test                       # node --test，src/lib/*.test.js（純邏輯）
npm run test:workflow-browser  # 瀏覽器實測診療台與掛號台（記憶體資料，不連資料庫）
npm run test:medication-browser
npm run dev                    # 使用者自己開，不要主動啟動（會搶 port）

# 後端（server/）
npm run lint ／ npm test
npm run test:integration       # 需 TEST_MONGODB_URI（replica set、資料庫名含 test）；RUN_PDF_E2E、RUN_SMTP_E2E 另外開（SMTP 會真的寄信）
npm run dev                    # 使用者自己開
npm run auth:hash-password -- <密碼> ／ auth:set-password -- <帳號> <新密碼> ／ auth:revoke-sessions -- <帳號>
npm run migrate:legacy-pets -- [--dry-run] <jsonl>   # 舊系統資料匯入，見 server/scripts/legacy-migration/README.md
node scripts/_demo-seed.mjs [--clean]                # 示範資料（電話 0900100 開頭）；_idexx-demo-seed.mjs 是 IDEXX 示範（0900200）

# IDEXX 抓檔程式（bridge/，跑在診所電腦，不裝任何套件）
npm test ／ npm start ／ npm run check
npm run build:installer        # 產生 dist/IDEXX-Bridge-Setup.cmd；有 installer.preset.json（含密鑰、不進版控）時是全自動安裝檔
```

改完的驗證順序：後端 `npm run lint` + `npm test`，前端 `npm run build` + `npm test`（**前端 `npm test` 很容易漏**），動到 `bridge/` 再跑它的 `npm test`。根目錄 `start-dev.bat` 一次開前後端兩個視窗。

注意：

- **寄送 Email 會真的寄給飼主**，不要為了驗證擅自觸發。產 PDF 不對外，可以呼叫。
- 開發連的 MongoDB 是測試環境，但寫入（含測試資料）要先問過使用者。
- 純邏輯放在 `lib/`，不要留在路由檔裡——測試 import 路由檔會連帶載入 puppeteer 與 nodemailer。
- 帳號密碼一律用 `server/scripts/` 的腳本維護，不要手動改資料庫。
- 文字檔一律 UTF-8；看到疑似亂碼先停下確認（見 `AGENTS.md`）。
- 部署見 [docs/ZEABUR_DEPLOY.md](docs/ZEABUR_DEPLOY.md)（Docker 單一容器，Express 同時提供 API 與前端）。

## 九、已知限制與待辦

1. `/owners`、`/pets`、全站搜尋用不區分大小寫、不錨定開頭的正規表示式，走不到索引；資料量大後要改 text index 或 collation。
2. 「送 IDEXX」的訊息種類（`census`／`work_request`）與編碼要到診所跟 IDEXX 一起確認後才打開（`IDEXX_CENSUS_MODE` 預設 `off`）。
3. 舊系統資料：只遷移 `RegData.mdb::RecordData`（飼主／貓咪主檔＋病歷全文），其餘舊資料庫不遷移。

## 十、維護這份文件

| 改了什麼 | 要更新 |
|---|---|
| 流程規則（報到、看診、取消、回頭路） | 第二節、第三節 appointments |
| Mongoose schema 欄位、索引 | 第三節 |
| 新增／改名／刪除 API 路由或 socket 事件 | 第六節 |
| 新增前端頁面、路由、骨架 | 第七節 |
| 換套件、加開發指令 | 第四節、第八節 |
| 狀態語意（`status`／`deliveryStatus`／藥單階段） | 第三節、STYLE_GUIDE 色彩語意 |
| 做完待辦、發現新限制 | 第九節 |

只改實作細節（重構、修 bug、調樣式）而沒有動到上面這些面向時，不需要動這份文件。

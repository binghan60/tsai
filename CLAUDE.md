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

### 格式標記（粗體／四色）
本次簡易紀錄 `appointments.visitNote`、藥單 `medicationOrders.condition`／`prescription`／`note`、待辦 `todos.content` 這五個欄位可以加粗與上色（紅／橙／綠／藍，對應 `danger`／`warning`／`success`／`info` token）。**欄位仍是一般字串**，內容是 `shared/richText.js` 定義的極簡標記：粗體 `**字**`、顏色 `[red]字[/red]`，換行就是 `\n`、標記不跨行，`\` 跳脫 `\ * [`（不用 `#`，那是寵物標記）。前後端共用同一份 `parseRichText`／`normalizeRichText`／`richTextToPlain`／`richTextLength`：
- **存之前一律 `normalizeRichText`**（前端編輯器送出的字串跟伺服器整理後的一致，自動存檔才不會一存就被判成「跟本機不同」）；**字數上限與「不可空白」都看純文字**（schema 用 `lib/richTextSchema.js` 的 `richTextMaxLength`，不是 `maxlength`），只剩標記算空白。
- **顯示一律走 `RichText.vue` 拆成片段、文字插值輸出，永遠不用 `v-html`**，所以不需要 sanitizer。編輯用 `RichTextEditor.vue`（Tiptap）。
- 會被拿去當純文字用的地方一律 `richTextToPlain`：病歷日誌的 `content`、聊天快照、`aria-label`、`#寵物` 標記比對、文字模板（「存成模板」只存純文字）。病歷日誌的 `sections[].text` 則保留標記，日誌卡片才畫得出格式。

### owners 飼主
`name`、`phone`、`landline`、`email`、`address`、`notes`（皆選填，僅 `name`／`phone` 必填）。一位飼主可養多隻寵物。**`phone` 是手機**：09 開頭 10 碼，存之前整理成純數字（`shared/phone.js` 的 `checkMobilePhone`，前後端、公開初診頁、掛號的 `ownerPhone` 共用），市話放 `landline`；修改時沒動到的舊值照收——舊系統匯入的「電話」常是市話，不能因為改了姓名就存不進去。

### pets 寵物
`name`、`ownerId`、`species`、`breed`、`sex`、`neutered`、`birthDate`、`weightKg`、`allergies`、`chronicConditions`、`currentMedications`、`notes`。**寵物與報告都沒有自己的編號**，一律用 MongoDB 的 `_id`——早期的 `medicalRecordNumber`（`PET-…`）與 `reportNumber`（`HC-…`）只是 `_id` 截短，沒有人記得、紙本也沒印，已從 schema 移除（開發資料庫裡的舊值與索引沒清，不影響運作）。報告 PDF 檔名是「貓咪名＿健檢報告＿健檢日期」（`shared/reportFilename.js`，下載與 Email 附件共用）。`legacyMedicalRecordNumber`（選填，unique+sparse）是舊系統匯入時保留的舊病歷號，供追溯與匯入腳本判斷是否已匯過，非匯入資料一律是 `null`。

### medicalRecords 健檢報告
欄位分成幾組：

| 組別 | 欄位 |
|---|---|
| 基本 | `petId`、`vet`、`visitDate`、`followUpDate`、`examType` |
| **範本快照** | `templateId`、`templateVersion`、`sections`（結案時凍結的完整表單結構＋作答） |
| 具名臨床欄位 | `weightKg`、`temperatureC`、`heartRate`、`chiefComplaint`、`diagnosis`、`conclusion`、`other`、`customValues` 等 |
| 分享 | `shareToken`（uuid，unique）、`shareEnabled`、`sharedAt` |
| 生命週期 | `status`：`draft` / `finalized`、`finalizedAt`、`pdfGeneratedAt` |
| 修訂 | `reportVersion`、`revisionOf`、`revisionRootId`、`revisionReason`、`supersededBy` |
| 寄送 | `deliveryStatus`：`not_sent` / `sending` / `sent` / `failed`、`deliveryError`、`lastDeliveryAttemptAt`、`sentAt`、`sentTo`、`emailMessageId` |

**`status` 與 `deliveryStatus` 是兩個獨立的維度**，不要混成一個。報告結案與否是臨床流程，寄不寄得出去是通訊結果——寄送失敗不該讓報告退回草稿。

已結案報告的內容一律讀 `sections` 快照，報告檢視頁不再讀具名欄位。

**報到建立的草稿引用看診，不複製**（`lib/recordVisitLink.js`）：看診（掛號，`appointment.recordId` 指向草稿）是 `weightKg`、`temperatureC`、`followUpDate`（回診日期＋時間）與檢驗數值（依範本「檢驗」項目的 key）的**唯一存放處**，草稿本身不存這幾欄——跟病歷日誌同一個做法：
- **讀**：`GET /api/records/:id`（填寫頁、預覽）把看診的值疊到草稿上再回傳（`visitOverlay`，只改記憶體、不存回），另帶 `visitLink: { appointmentId, date }`。檢驗的手動判讀與備註是報告自己的內容，留在草稿上，只有數值來自看診。
- **寫**：`PUT` 送來的這幾欄一律清掉不存（`stripVisitFields`）；醫師在報告上改過的放在 `visitEdits: { weightKg?, temperatureC?, labValues?: { key: 值 } }`，同一個 transaction 裡寫回看診、同步病歷日誌（`applyVisitEdits`＋`lib/appointmentJournal.js`），報告寫不進去（版本衝突）看診也回滾。填寫頁只送跟上次伺服器值不同的欄位（`client/src/lib/recordVisitLink.js`），才不會拿舊畫面蓋掉診療台剛改的值；跟病歷日誌一樣不看流程階段。**回診日期只能讀**——它是櫃台敲定、同時建立下一筆掛號的那一步，只在掛號台改。
- **結案**：這一刻把看診的值凍結進報告欄位與 `sections` 快照，之後看診再改不影響。看診被刪除（只有已取消／未到的能刪）前，先把值寫進還連著的草稿。
- 對應是固定規則，不是表單設計器上的設定。早期版本是「複製進草稿＋`overriddenKeys` 記下醫師改過的欄位」，等於兩份資料，已經拿掉。

索引：`petId`、`shareToken`(unique)、`{supersededBy, updatedAt}`、`{status, deliveryStatus}`。後兩個是給跨寵物清單查詢用的——沒有它們那支查詢是全表掃描加記憶體排序，而記憶體排序有 32MB 硬上限，超過會直接失敗。**新增查詢模式時要一併確認索引接得上。**

### formTemplates 健檢表單範本
`name`、`description`、`species`、`enabled`、`order`、`version`，底下是 `sections[]`，每個 section 有 `items[]`。使用者可自由增刪區塊與項目。詳見 [docs/FORM_BUILDER.md](docs/FORM_BUILDER.md)。

檢驗項目另有 `idexxCodes[]`：IDEXX 儀器回傳的項目代號（例如 `CREA`；不同儀器代號不同就填好幾個，如 `RBC`、`RBC_BLD`），在表單設計頁的檢驗項目設定，用「、」或逗號分隔（代號本身可能有空格，不能用空白分隔），比對不分大小寫。IDEXX 結果進來時依它自動填進看診（見 labResults）。同一份表單裡同一個代號只能對到一個項目，`sanitizeSections` 會擋。

`presets[]` 是**預填模板**（`{ key, name, order, values }`，`values` 以項目 key 為鍵，複選存陣列）：同一份表單的另外幾組預填值，例如「預防針」「牙齒」，在獨立的設定頁 `/settings/presets` 逐欄設定（`PresetTemplatesPage` 清單 → `PresetEditPage` ＋ `PresetValuesEditor.vue`，**刻意不放在表單設計頁裡**——新增一組模板不該先走進整份表單的結構編輯；表單設計頁的存檔也因此不送 `presets`，兩邊不會互相覆蓋），填報告時從頁首「套用預填模板」手動一鍵帶入，同一個選單底部有捷徑：這份表單還沒有模板就直接開新增頁，有的話回清單並選中那份表單（`?form=`）。只收文字／選項類欄位（`shared/formDefaults.js` 的 `presetEligible`）：比 `defaultValue` 那批再少掉**日期**（回診日期、健檢日期是每次看診才決定的；除了 `date` 型別，**名稱含「日期」的欄位也排除**——自訂的「回診日期」常被建成文字欄位）與**獸醫師**（`role: 'vet'`），理學檢查、檢驗、量測、牙齒圖、圖片也不收。**它疊在項目 `defaultValue` 之上、兩者不互斥**：新建報告先照舊帶預設值，套模板只覆寫模板有設定的欄位；切換模板時，上一組帶入而醫師沒改過的欄位退回預設值，改過的留著（`client/src/lib/formPresets.js` 的 `planPresetApplication`），套用後的 toast 可「復原」。預填模板不影響表單結構，存檔**不動 `version`**、不進報告快照、報告也不記套過哪一組；掛號自動建草稿只套預設值不套模板。後端每次存檔都用 `sanitizePresets` 對著新的 sections 清洗，刪掉的項目與不合法的選項值一起消失；複製表單時連同預填模板一起複製。

### textTemplates 文字模板
`name`、`content`、`availableForAllFields`、`applicableItemKeys`、`enabled`、`usageCount`。填表時可插入文字欄位的長篇內容，取代了早期的 quickPhrases 常用語（該 collection 與其路由已移除）。

### clinicalNotes 病歷日誌
`petId`、`entryDate`、`content`、`source`（`manual` / `legacy_import` / `appointment` / `medication`）。醫師看診或拿藥時隨手記的自由文字記事，不用填表、不用結案，跟 `medicalRecords`（結案才鎖定的正式健檢報告）是兩條平行的軌道——日誌給日常記事用，健檢報告給需要 PDF／分享的正式場合用。`source: 'legacy_import'` 的記事來自舊系統資料遷移（見 `server/scripts/legacy-migration/`），內容是舊系統逐年累加的病歷全文，整段當一筆記事匯入，不逐筆拆分（舊資料格式不一致，拆分風險高於價值）。

`source: 'appointment'` 的記事跟掛號的 `visitNote`（見第二節 appointments）是**同一份資料、雙向同步**：`POST /api/appointments/:id/workflow/clinical` 或 `.../workflow/handoff` 之後，只要這筆掛號目前組出來的日誌內容非空，就會建立（或更新）一筆用 `appointmentId` 連結的日誌（見 `routes/appointmentWorkflow.js`，內容由 `lib/appointmentWorkflow.js` 的 `appointmentJournalContent` 即時組成：來院原因、體重／體溫、檢驗（`labSummary`，偏高偏低帶 ↑↓）、本次簡易紀錄、請轉告飼主、回診建議，依序併成一段文字，不是只寫入時的那幾個欄位；`internalNote` 刻意不算進來，見第二節 appointments 的 `internalNote`）。**API 回傳時除了串好的 `content`，另帶分欄的 `sections: [{ key, label, text }]`（藥單日誌再多一個 `title`）**，由 `lib/clinicalNoteView.js` 產生；另帶編輯表單用的原始值 `fields`；前端 `ClinicalNoteEntry.vue` 把每則日誌排成一張小報告卡（標頭：日期＋類型＋藥單進度；內文：「標籤｜內容」列，量測併成「生命徵象」一列、請轉告飼主警示底），修改也在卡片內就地、用同一套列進行，`ClinicalNotesPanel` 與 `PetDetailPage` 共用它；排列與表單規則在 `lib/clinicalNoteDisplay.js`，不要再把 `content` 字串拆回欄位——`content` 只留給差異比對、長度判斷與找不到來源時的後備，手動／舊系統匯入的日誌沒有 `sections`、照舊整段顯示；反過來，`PUT /api/clinical-notes/:id` 可以從日誌改回這筆掛號：body 帶 `fields` 時，來院原因、體重、體溫、本次簡易紀錄、請轉告飼主、回診建議**六欄都能改**、寫回掛號本身（`lib/appointmentWorkflow.js` 的 `applyJournalFields`，**不看流程階段**——日誌是事後更正紀錄的地方，櫃台完成後照樣改得動；診療台工作區那邊仍照原本的鎖定規則；`internalNote`／`handoffNote` 不從這裡改；六欄全空回 422）；只帶 `content` 的舊呼叫方式等同改 `visitNote`（見 `routes/clinicalNotes.js`）；`DELETE` 也會把對應掛號的 `visitNote` 清空，避免兩邊資料分岔。一筆掛號最多對應一筆日誌（`appointmentId` 唯一索引），`manual`／`legacy_import` 兩種來源沒有這個欄位、不受影響，一樣可自由編輯/刪除、沒有唯讀鎖定。索引 `{petId, entryDate, _id}`、`{appointmentId}`（partial unique）。刪除寵物前會檢查 `ClinicalNote.exists({petId})`，跟 `medicalRecords` 一樣擋刪除。

`source: 'medication'` 的日誌是**藥單（領藥紀錄，`medicationOrders`）自動生成的獨立日誌**：跟看診（掛號）那筆各自獨立、不併進去，一張藥單一筆（`medicationOrderId`，partial unique 索引）。做法跟掛號日誌一樣：日誌**只存關聯、不存內文**（`content` 不必填），每次讀取時由 `lib/clinicalNoteView.js` 依藥單的最新欄位即時組成（`lib/medicationWorkflow.js` 的 `medicationJournalContent`：第一行 `領藥（階段）`，已領藥另帶診所時區的領藥時間，接著是病況／藥單／備註，空欄位不出現）。**不變式：日誌存在 ⇔ 這張藥單曾經被醫師審核過，而且沒有取消**（`lib/medicationJournal.js` 的 `syncMedicationJournal`，藥單每個動作後都會重新同步）。審核之前（櫃台剛登記、醫師還沒看）不進病歷——病歷記的是醫師確認過的內容，不是草稿；審核之後一直在，之後被退回或修改只是標題回到「待醫師確認」，日誌不會消失又出現；**藥單取消就刪掉**——取消的藥單沒有真的開出去，不該留在病歷裡。「曾經審核過」看 `history` 有沒有 `approve`，不看 `approvedAt`（退回與修改會把它清掉）。`entryDate` 是藥單建立時間。日誌與藥單的儲存在同一個 transaction（`routes/medications.js` 的 `saveWithJournal`），任一邊失敗整筆回滾。**藥單日誌可以更正、不能刪**：`PUT` 帶 `fields`（病況／藥單／備註）會寫回藥單（`lib/medicationWorkflow.js` 的 `applyMedicationJournalEdit`），任何階段都能改，但每次有實際變動都在藥單 `history` 記一筆 `journal_edit`（連同改後內容）；**還在流程中的藥單改了就照「修改藥單」的規則退回待醫師確認**（待領藥的標 `needsRepack`）——藥已包好卻偷偷換了藥單，櫃台會交出錯的藥；已領藥的只是更正紀錄、不動階段；藥單內容不能清空。藥單日誌的日期跟著藥單建立時間走，不接受 `entryDate`。`DELETE` 仍回 409。舊藥單不做回填，下一次有動作時才會補出日誌。

### chatMessages 全站內部聊天
`sender`（`vet` / `front_desk`）、`content`、`auto`（布林，預設 `false`）。醫生↔櫃台的全站即時聊天紀錄，跟任何掛號／病患都無關（例如「今天下午提早關診」），所以不像 `visitNote`／`clinicalNotes` 那樣掛在 `petId`／`appointmentId` 底下，也沒有雙向同步這回事——單純是一份不斷增長的訊息紀錄。前端是右側工具欄的聊天面板（`panels/ChatPanel.vue`，見第六節），身分是裝置固定的（`useStaffIdentity`，存在 `localStorage`），不是頁面固定或使用者帳號決定的。索引 `{createdAt: 1}`。**不是每一筆都是使用者手動打字送出的**：診療台與櫃台工作台（見第六節）每完成一個會改變掛號狀態或內容的動作，會自動用同一支 `POST /chat/messages` API 補一則描述動作內容的系統訊息（例如「「豆豆」已完成看診，交給櫃台處理」）。文案集中在 `lib/appointmentNotifications.js`，送出的共用進入點是 `composables/useAppointmentNotifier.js`，`sender` 一樣是操作當下那台裝置的固定身分，`auto` 標成 `true`。`auto` 純粹是顯示用的標記——聊天視窗靠它在訊息旁加一個「自動通知」小標籤，跟手動打字的訊息區分開來；也讓發出動作的那台裝置自己判斷要不要跳未讀紅點（見下）。

`mentions`（選填陣列 `[{ petId, petName, ownerName }]`）是訊息裡用 `#` 標記的寵物。前端只送 `petId`，名字快照由伺服器查寵物文件後寫入（不採信前端文字），之後寵物改名或刪除舊訊息照樣顯示得出來。帶了 `mentions` 的訊息會在同一個 transaction 裡把這些寵物放進 `pinnedPets` 暫存區——訊息送出去了、暫存區卻沒放進去，對方就找不到那隻動物。

### pinnedPets 寵物暫存區
`petId`（unique）、`pinnedBy`（`vet` / `front_desk`）、`source`（`mention` / `manual`）、`messageId`、`pinnedAt`。櫃台接電話時要把某隻動物調出來問醫生，醫生得看病歷才能回答——暫存區就是「把這隻動物丟給對方看」的地方。**全站共用一份**（不是每台裝置各一份），**不隨日期清空、只能手動移除**。來源有兩個：聊天室 `#` 標記（`source: 'mention'`）與寵物詳情頁的「加入暫存區」（`manual`）。同一隻寵物重複放入是 upsert，只把 `pinnedAt` 推到最新、不會出現兩列。刪除寵物時一併刪掉它的暫存紀錄（暫存不是病歷，不擋刪除）。索引 `{petId}`(unique)、`{pinnedAt: -1}`。

### todos 院內待辦
`content`（必填，≤500 字）、`createdBy`（`vet` / `front_desk`）、`dueDate`（選填，`YYYY-MM-DD` 字串，理由同掛號的 `date`）、`status`（`open` / `done`）、`doneAt`、`doneBy`、`mentions`（陣列 `[{ petId, petName, ownerName }]`，內文裡用 `#` 標記的寵物，最多 5 隻）。「明天叫貨」「回電給王小姐」這類行政雜務的全站共用清單，跟掛號、病歷都無關，也不是聊天——聊天是流水，待辦有完成狀態。**刻意沒有指派對象**：診所只有醫生／櫃台兩種裝置身分（`useStaffIdentity`），指派沒有可以落腳的「人」；**也沒有重複待辦**（每日例行事項會讓範圍膨脹，用了再補）。

**連結寵物沒有獨立欄位，就是在內文直接打 `#寵物名`**（跟聊天室同一套：前端只送 `petId`，名字與飼主姓名的**快照**由伺服器查寵物文件寫入、不採信前端文字，兩邊共用 `lib/petMentions.js` 的 `parseMentionIds`／`mentionSnapshots`）。待辦的標記**不會**放進寵物暫存區——暫存區是「丟給對方看病歷」，待辦只是提醒。刪除寵物**不擋**（待辦不是病歷），只把標記裡該寵物的 `petId` 清成 null、快照保留，畫面上那個 `#名字` 變成不可點的灰字（見 `routes/pets.js`）。

`GET /api/todos` 回的是**未完成（上限 200，有期限的由早到晚排前面、沒期限的照建立順序接後面）＋最近完成 50 筆**的單一清單，前端依 `status` 分頁籤；任何異動後伺服器整份重讀並廣播 `todos:updated`，前端直接取代。排序在記憶體裡做（`lib/todos.js` 的 `sortOpenTodos`），筆數有上限所以沒有 32MB 排序上限的問題。索引 `{status, createdAt}`（未完成清單）、`{status, doneAt: -1}`（最近完成）、`{mentions.petId}`（刪寵物時找標記）。

### labResults IDEXX 檢驗結果
設定、部署、本機測試與排查見 [docs/IDEXX_INTERLINK.md](docs/IDEXX_INTERLINK.md)。IDEXX 不開放 API，院內檢驗儀的結果要靠 **IDEXX InterLink**（裝在跟 IDEXX 主機同一個區網的 Windows 電腦上）存成 XML＋PDF 檔，再由那台電腦上的抓檔程式上傳進來（`POST /api/lab-results/import`，用 `IDEXX_BRIDGE_TOKEN` 驗證、不走登入）。系統在雲端讀不到診所電腦的資料夾，所以一定要有這支抓檔程式。抓檔程式在 `bridge/`（獨立於 server、不裝任何套件，整個資料夾複製到診所電腦、裝 Node.js 就能跑；設定檔 `idexx-bridge.config.json` 含密鑰不進版控）：它不解析 XML、原檔照送，等檔案靜止才上傳，成功移到 `已上傳\年-月\`、伺服器一直讀不了移到 `無法讀取\`、連不上就留在原地重試，**檔案絕不刪除**。安裝用單一安裝檔 `IDEXX-Bridge-Setup.cmd`（`npm run build:installer` 產生；有 `installer.preset.json` 時網址與密鑰預先放在裡面、診所點兩下就裝完，沒有時安裝時才問），它最後呼叫 `bridge/install.ps1` 把抓檔程式註冊成 SYSTEM 帳號的排程工作（開機就跑、不用登入、每 5 分鐘補叫一次），每分鐘送心跳到 `labBridgeStatuses`（一台電腦一筆：`bridgeId`（設定檔 name 或電腦名稱，unique）、`lastSeenAt`（伺服器收到的時刻）、`lastUploadAt`、`pendingFiles`、`lastError`、`version`），超過三分鐘沒心跳就算離線——開發者人不在診所，停了要從系統上看得出來。一筆＝一台儀器對一隻貓的一次檢驗：`diagnosticSetId`＋`instrument` 唯一（同一次看診跑生化又跑血球是兩筆），欄位是 `lib/idexxResult.js` 解析出來的樣子——`runAt`、IDEXX 主機上登記的 `client`／`patient`（`patient.id` 是 IDEXX 回傳的病患編號，不是 `petId`）、`assays[]`（`code`／`value` 一律字串／`unit`／`referenceMin`／`referenceMax`／`criticalMin`／`criticalMax`／`qualifier`，欄位名稱跟看診的 `labValues` 一致，可直接用 `shared/labValues.js` 的 `labFlag`）、`notes[]`，外加原始檔 `rawXml`（`select: false`，解析規則修正後可重新解析）。**`petId` 是空的＝待配對**，沒有另外的狀態欄位。

**儀器驗完自動填進健檢報告**（使用者的要求：檢驗結果就是健檢報告的檢驗欄位，不另外做一個「檢驗結果」的地方）：上傳後 `lib/labResultApply.js` 先認貓——`patient.id` 是 24 位的貓咪 `_id` 而且那隻貓存在，就記 `petId`、`matchSource: 'patient_id'`（報到時送到 IDEXX 主機的編號會原樣帶回來；Census 報到通知尚未實作）；再找那隻貓**檢驗當天**（`runAt` 換算成台北日期）的看診，排除取消／未到，好幾筆時挑檢驗前最後報到的那筆（`lib/labResultFill.js` 的 `pickVisit`）；最後依看診表單檢驗項目的 `idexxCodes` 對照，在同一個 transaction 裡寫進 `appointment.labValues`、同步病歷日誌，之後廣播 `appointment:updated`。報告草稿本來就讀看診的值，所以填進看診＝報告打開就看得到。規則（`planLabFill`）：**空的格子才填**；已經有不同的值不蓋掉，記在 `conflicts[]` 給醫師決定；儀器判定無結果（`!`）或無效（`-`）、或超過 40 字的不填；表單沒對應代號的記在 `unmappedCodes[]`。填過的記 `appointmentId`、`appliedAt`、`filled[]`（`{ key, label, value }`）；找不到看診或看診沒選表單時不記 `appliedAt`，之後重送同一份檔案會再試。IDEXX 送更正版時會重新比一次，但一樣不蓋掉已經有的值。自動填入失敗不影響上傳本身（檔案已經存好）。已結案的報告不受影響（結案時已凍結）。

**認不出貓的結果進「待確認」清單**（工具欄「檢驗」，`panels/LabResultsPanel.vue`）：Census 報到通知還沒做（要到診所才能測），加上技術員在 IDEXX 主機上手打名字時也不會帶編號，所以要有人選。清單＝`petId` 空、`dismissedAt` 空的結果，每筆附**檢驗當天的掛號**當候選（`lib/labResultFill.js` 的 `rankCandidates`：取消／未到／沒建檔的不算，同名——去空白、不分大小寫——排前面，同名而且只有一隻就預選）。人選了貓就記 `matchSource: 'manual'`、照上面同一套規則填入（`matchManually`）；選錯可以「復原」（`unmatchLabResult`：只清**現在還是當初填進去的值**的欄位，被人改過的留著，`planUndo`），結果回到清單；品管測試、練習用的檢驗可以「忽略」（`dismissedAt`）。任何異動都廣播 `lab-results:updated`，各台工具欄的數字跟著變。IDEXX 會重送與更正同一份結果，`lib/labResultImport.js` 的 `planLabResultImport` 決定怎麼處理：內容一樣只加 `receiveCount`、內容不同以訊息時間較新的為準並記 `revisedAt`、比已存的舊就不採用；配對欄位永遠不被上傳覆寫。解析刻意寬鬆、不驗證 DTD——IDEXX 的實際輸出不完全符合它自己的 DTD（見該檔開頭）。索引 `{diagnosticSetId, instrument}`(unique)、`{petId, runAt: -1, _id: -1}`；找當天看診用 appointments 的 `{petId, date}`。

### deliveryLogs 寄送流水帳
append-only，每個寄送事件寫一筆（一次寄送＝`queued`＋結果兩筆，同一個 `attemptId`；API 回傳時合併成一次寄送一筆）：`recordId`、`petName`、`ownerName`、`event`（`queued`/`sent`/`failed`）、`recipient`、`messageId`、`error`、`createdAt`。

**刻意不設 `ref`、改冗餘存貓咪與飼主姓名**——報告可以被刪除，而這筆紀錄的價值正是在報告消失後還查得到寄給了誰。同理它是獨立 collection 而不是內嵌陣列。medicalRecords 上的 `sentTo`/`sentAt` 只留得住最後一次，重寄就覆蓋。

### users 帳號
`username`（unique）、`passwordHash`（`scrypt$<salt>$<hash>`，`select: false`）、`active`、`tokenVersion`。單人診所共用一組帳號，不是多使用者系統。

第一次啟動時若這個 collection 是空的，會用環境變數 `AUTH_USERNAME`／`AUTH_PASSWORD_HASH` 自動建立一筆（`config/auth.js` 的 `ensureBootstrapUser`）；建立後這兩個環境變數就不會再被讀取。之後要換密碼或撤銷登入用 `npm run auth:set-password -- <帳號> <新密碼>` / `npm run auth:revoke-sessions -- <帳號>`（見 `server/scripts/`），不是改環境變數重開機。

**登入用的 JWT 是無狀態的，`tokenVersion` 是唯一的撤銷手段**：token 簽章與過期時間本身沒辦法中途作廢，所以每次請求都會多查一次這筆帳號文件，比對 `tokenVersion` 是否跟簽發當下相同、`active` 是否仍為真。改密碼／執行 revoke-sessions／停用帳號都會讓 `tokenVersion` +1，現有 cookie 立刻失效，不用等 30 天自然過期。

### appointments 掛號與候診
只服務當日門診時間軸。`date`／`time` 是登記來源（`date` 由掛號時指定，預設今天），`scheduledAt` 供排序；既有病患帶 `ownerId`／`petId`，初診可先留空，但兩種情況都保存 `ownerName`／`ownerPhone`／`petName`／`species` 快照。**`ownerName` 在掛號階段是選填**——接電話時常常只問得到寵物名跟電話；`petName` 才是必填，一筆掛號至少要指得出是誰要來。到 `POST /:id/check-in` 才必填飼主姓名與電話，因為那一步要真的建立 `Owner` 文件，而 `Owner.name` 是必要欄位。`ownerPhone` 選填，但填了就要是手機（規則同 owners 的 `phone`）。

`isSurgery`（布林）／`surgeryName`（文字）是掛號時可勾選的手術標記，跟 `reason`（來院原因）是兩個獨立欄位、互不覆蓋——勾選手術不會動到來院原因文字，兩者可以同時填。勾選時 `surgeryName` 必填（後端 422 擋，前端 vee-validate 同步擋），未勾選則清空。**手術只是標記，沒有專屬時段**：時段規則跟一般門診相同（早期的中午手術時段 11:45–13:45 已經拿掉）。`estimatedDurationMinutes` 是預估診療時間，預設 15、限 15–240 且為 15 的倍數；整段必須落在同一診別內，Modal 會把開始格與後續占用格醒目標出，但與其他掛號重疊時只提醒、不阻擋。診療台、工作區與掛號台都會在勾選手術的那筆掛號旁標註紫色「手術」徽章（`SurgeryBadge`，`surgery` token；遲到徽章是紅色 `danger`，兩者刻意分開色相），帶出 `surgeryName`。**時段刻度是 15 分鐘**（`APPOINTMENT_TIME_STEP`，前端 `lib/appointmentTime.js` 同一組數字），門診時段 10:00–11:30、14:00–19:30，中間是午休；今天已經過去的時段照樣能選（現場補登用，使用者要求不要鎖）。

`labValues`（`[{ key, label, value, unit, referenceMin, referenceMax }]`）是這次看診的檢驗數值。**診療台工作區沒有檢驗區塊**（曾經有，使用者要求拿掉），數值由 **IDEXX 儀器自動填入**（見 labResults），或在健檢報告填寫頁輸入、經 `visitEdits` 寫回這裡。**檢驗項目不是另一份清單，而是掛號時選的健檢表單（`templateId`）裡「檢驗」類型的項目**（`shared/labValues.js` 的 `templateLabItems`）；`POST /workflow/clinical` 收 `labValues: { 項目key: 值 }`，只接受表單裡真的有的 key（否則 422），空字串＝拿掉那一項，存成含名稱、單位、參考範圍的快照（`lib/appointmentWorkflow.js` 的 `mergeLabValues`）。它會進病歷日誌的「檢驗」一行，也會帶入健檢報告草稿的 `labFindings`（見 medicalRecords）。

**一條四步流水線：預約 → 候診 → 看診 → 櫃台完成。** 真相是三個里程碑時間戳記，`status` 由它們推導出來，不是另一個獨立的維度（推導在 `lib/appointmentWorkflow.js` 的 `applyWorkflowAction` 尾端）：

| 里程碑 | 寫入時機 | 對應 `status` |
|---|---|---|
| `visitStartedAt` | 醫師在診療台按「看診」／「開始看診」（`POST /workflow/start`）——點開工作區只是先看資料，不算開始看診 | `arrived` |
| `handoffAt` | 醫師「完成看診，送交櫃台」（`POST /workflow/handoff`） | `pending_checkout` |
| `deskCompletedAt` | 櫃台「完成處理」（`POST /workflow/complete`） | `completed` |

`status` 仍是 `scheduled`／`arrived`／`pending_checkout`／`completed`／`cancelled`／`no_show`（索引、號碼牌與排班邏輯都依賴它），只是 `pending_checkout` 現在讀作「醫師已交櫃台、櫃台還沒處理完」。刻意不留 `arrived → completed` 的直接路徑（`lib/appointmentStatus.js` 的 `ALLOWED_TRANSITIONS` 沒有這條邊），逼所有看診都經過一個明確的交接點。

**`POST /workflow/reclaim`（取回這筆）是唯一的回頭路**：`handoffAt` 清成 null，這筆退回 `arrived` 讓醫師補資料。**櫃台按下「完成處理」之後就不能再取回**（`deskCompletedAt` 有值時回 409）——那時號碼牌已歸還、就診已結案。這條回頭路是刻意保留的：舊版「批價完成就再也改不了」正是當時最卡的地方。

`workflowVersion` 標記這筆用的是哪一代流程：`2` ＝這條四步流水線，`1` 是舊的批價／收款版本，`0` 是更早只有 `status` 的版本。舊版欄位（`billingItems`／`billingSubtotal`／`checkoutTotal`／`paymentMethod`／`billingCompletedAt`／`paymentCompletedAt`／`billingRevision`／`pendingCheckoutAt`／`visitCompletedAt`／`handoffAcknowledgedAt`）**已經從 schema 移除、讀不回來**，所以 `shared/appointmentWorkflow.js` 的 legacy 分支改由 `status` 回推階段（`pending_checkout` ＝已交櫃台、`completed` ＝已完成），不做資料庫遷移——沒有人會再去操作已結案的舊掛號，回推只是要讓它們在清單上落在正確的那一格。第一次被新流程碰到時 `adoptWorkflow` 會補上里程碑並把 `workflowVersion` 設成 2。

**文字欄位，各有各的讀者**（診所不用系統計價：批價清單、金額、付款方式都已退場；後來連「給櫃台的交辦」`handoffNote` 也整個移除，收費與領藥由櫃台直接處理）：

- `visitNote` 本次簡易紀錄：醫師寫的病歷內容，跟 `clinicalNotes`（病歷日誌）**雙向同步**（見第二節 clinicalNotes）——`POST /workflow/clinical` 帶了 `visitNote`／`weightKg`／`temperatureC`／`labValues` 任一個就建立／更新／刪除對應日誌，反過來直接編輯那筆日誌也會回頭覆蓋這裡。飼主看不到，也不進健檢報告。
- `internalNote` 內部備註：僅院內人員可見，不進健檢報告或飼主提醒，也刻意不併入病歷日誌（見第二節 `clinicalNotes` 的 `appointmentJournalContent`）——病歷日誌是「當次紀錄」的呈現，內部備註是行政備忘，兩者讀者不同。
- `specialCareNote` 請轉告飼主：面向飼主的照護提醒（例如「傷口勿舔舐」），櫃台處理視窗最上面用警示樣式呈現——那是最容易漏講的一件事。會進病歷日誌。
- `followUpRecommendation` 回診建議：醫師寫期間與原因，櫃台跟飼主敲定實際時段後才真的掛下一次的號。

這幾欄加上 `weightKg`／`temperatureC`／`labValues` 是同一支 `POST /workflow/clinical` 的可選欄位，前端自動存檔（1.2 秒 debounce）；連著的健檢報告草稿不必同步——它讀的就是這裡（見第二節 medicalRecords）。**櫃台按下完成處理之後就整組鎖定**（回 409）。醫生↔櫃台真正想聊、跟哪個病患無關的內容（例如「今天下午提早關診」），走工具欄的全站聊天，不是這些欄位——見第六節與第二節 `chatMessages`。

`followUpDate`（`YYYY-MM-DD`）與 `followUpTime`（`HH:MM`）分開存，理由跟 `date`／`time` 一樣是避免日期因伺服器時區偏移。它們只由 `POST /workflow/followup` 寫入——那是櫃台跟飼主敲定時段的那一刻，會在同一個 transaction 裡建立（或就地改期）下一筆掛號（`visitType: 'return'`、身分快照與 `templateId` 都照抄這次掛號），新掛號的 `_id` 記在 `followUpAppointmentId` 上。**約回診跟新增掛號是同一套**：body 另收 `estimatedDurationMinutes`、`reason`、`isSurgery`／`surgeryName`，時段、預估診療時間、手術標記的驗證都走 `lib/appointmentTime.js`（外加不得早於本次就診）；`reason` 沒帶時用 `followUpReason`→`followUpRecommendation`，帶空字串就存空字串（不補「回診」）；改期既有回診掛號時沒帶的欄位沿用那筆的值（櫃台處理視窗上已約好的回診有「修改」，帶入那筆回診目前的值、用同一塊時段選擇改期）。**所有排掛號的畫面也是同一塊**：日期＋預估診療時間＋時段格是 `AppointmentSlotPicker.vue`、手術標記是 `SurgeryField.vue`，掛號視窗、櫃台處理視窗的回診安排、初診表審核共用，不要在哪裡再放回時間下拉選單；已經被現場另外處理過（不再是 `scheduled`）的下一筆掛號不回頭改期，改回 409 要求從那筆掛號本身處理。

**`checkinNumber` 是發給飼主的實體號碼牌，不是佇列位置。** 報到時後端配一張「當天從未發出過」的號碼（`checkinNumberHistory` 記下每一張發過的牌，歸還後也不會再配發），櫃台可以在報到時或事後（`PATCH /:id/check-in-number`）改成手上實際發出去的號碼。**候診先後由 `checkedInAt` 決定，跟號碼大小無關**，所以改號碼不會改變誰先看診。離開佇列（完成／取消／未到／取消報到）就把自己的號碼清成 null，不動其他人的號碼。**送交櫃台轉入 `pending_checkout` 時不歸還號碼牌**——人還要去櫃台領藥付錢，號碼牌代表「現場還在」，不是「還沒看診」。兩人同時報到算到同一張牌時由唯一索引擋下、後端自動重試（`routes/appointments.js` 的 `withQueueRetry`）。配號與候診排序規則在 `lib/appointmentQueue.js`（`nextAvailableCheckinNumber`／`queueOrder`，純邏輯，可測）。



## 三、技術棧

| 層級 | 選擇 | 備註 |
|---|---|---|
| 前端 | Vue 3 + Vite | Composition API、`<script setup>` |
| UI 元件 | reka-ui + shadcn-vue 風格 | 元件在 `client/src/components/ui/`，可直接改 |
| CSS | Tailwind CSS v4 | `@tailwindcss/vite`，設定寫在 `client/src/style.css` 的 `@theme`（CSS-first，無 `tailwind.config.js`） |
| 圖示 | `@lucide/vue` | **不是** `lucide-vue-next`（已棄用） |
| 字體 | `@fontsource-variable/noto-sans-tc`、`@fontsource/ibm-plex-mono` | 自架不走 CDN，理由見第七節；等寬字只給數字（號碼牌、時間、量測、檢驗值、電話），用 `num` utility |
| 表單驗證 | vee-validate | |
| 後端 | Node.js + Express | 單人使用，不需要 Nest.js 的架構開銷 |
| 資料庫 | MongoDB + Mongoose | |
| 登入 | `jsonwebtoken` + Node 內建 `crypto.scrypt` | JWT 放在 HttpOnly cookie；密碼雜湊用內建 scrypt，不另外裝 bcrypt |
| 即時通訊 | Socket.IO | 兩種用途：掛號狀態即時同步（醫生↔櫃台，房間以「天」為單位 `appointments:<date>`）、全站內部聊天（不分房間，`io.emit` 廣播給所有連線）；伺服器掛在 Express 的 httpServer 上（`server/src/lib/realtime.js`），沿用既有的 cookie session 驗證連線 |
| 富文字 | Tiptap（`@tiptap/vue-3`，只裝 Document／Paragraph／Text／Bold／`@tiptap/extensions`） | 只給本次簡易紀錄、藥單、待辦上色與加粗；**不用 StarterKit**，另有自訂的 `tint` 顏色 mark。存的是 `shared/richText.js` 的標記字串，不是 HTML，見第二節「格式標記」 |
| PDF | Puppeteer | 見下節 |
| Email | Nodemailer | SMTP（Gmail 應用程式密碼） |
| XML 解析 | fast-xml-parser | 讀 IDEXX InterLink 存下的檢驗結果檔（`server/src/lib/idexxResult.js`）；寬鬆解析、不驗證 DTD——IDEXX 的實際輸出不完全符合它自己的 DTD |
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
帳號（唯一免登入的 /api/* 路由，連同 /api/public/reports/:token、GET /api/health，以及改用密鑰驗證的 POST /api/lab-results/import、/heartbeat）
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
GET    /api/pets                        列表（?q= 搜尋）；每筆另帶 lastEntryAt（最近一則病歷日誌的日期，清單的「最近紀錄」欄）
GET    /api/pets/:id                    詳情（含報告列表、病歷日誌列表）
PUT    /api/pets/:id
DELETE /api/pets/:id                    刪除（寵物仍有報告或病歷日誌時擋刪）

病歷日誌
GET    /api/pets/:petId/clinical-notes  該寵物的日誌列表（分頁）
POST   /api/pets/:petId/clinical-notes  新增一則日誌
PUT    /api/clinical-notes/:id          編輯日誌：手動／匯入日誌改 content／entryDate；掛號日誌帶 fields 改六個欄位並寫回掛號（只帶 content＝改 visitNote）；藥單日誌帶 fields 改病況／藥單／備註並寫回藥單、留 history（流程中的藥單會退回待醫師確認）
DELETE /api/clinical-notes/:id          刪除手動／舊系統匯入的日誌；掛號日誌與藥單日誌一律回 409（掛號日誌隨掛號存在、藥單日誌隨藥單取消移除）

報告
GET    /api/pets/:petId/records         該寵物的報告
GET    /api/pets/:petId/records/previous-values   填表時的「上次數值」對照
POST   /api/pets/:petId/records         新增
GET    /api/records                     跨寵物清單（?view= 工作佇列 / ?q= / 分頁）
GET    /api/records/:id                 連著看診的草稿另帶 visitLink（見第二節 medicalRecords）
PUT    /api/records/:id                 連著看診的草稿：體重／體溫／回診日期／檢驗數值不存在報告上；body.visitEdits 帶醫師改過的欄位，
                                       同一個 transaction 寫回看診與病歷日誌；回應同樣疊上看診的最新值
POST   /api/records/:id/finalize        結案：驗證 → 凍結 sections → 產 PDF → 鎖定
GET    /api/records/:id/pdf             下載 PDF
POST   /api/records/:id/revisions       建立修訂版
DELETE /api/records/:id                 刪除（已結案報告需帶 confirmText＝寵物名稱；草稿不需要）
POST   /api/records/:id/share           建立分享連結
POST   /api/records/:id/revoke-share    撤銷分享
POST   /api/records/:id/send-email      寄送 PDF + 連結給飼主

掛號與候診
GET    /api/appointments                當日掛號時間軸（?date=YYYY-MM-DD，預設今天）；另回 patientNotes { pets, owners }，
                                       以 id 為鍵的寵物／飼主備註（空白不回），給診療台佇列顯示「會咬人」之類的提醒（櫃台看板／處理視窗只用其中的飼主備註）
GET    /api/appointments/summary        週檢視用的日期範圍內每日掛號數（?start=&end=，最多 31 天）
GET    /api/appointments/intake-codes   已發出、飼主還能用的初診驗證碼（不分日期，條件跟公開初診頁驗證一致），給初診面板管理；
                                       作廢＝取消那筆掛號（走 /:id/cancel）
POST   /api/appointments                新增掛號（body 可帶 date，省略＝今天；time 每 15 分鐘一格，手術只是標記、時段規則相同）
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
POST   .../workflow/clinical            存量測、檢驗與文字欄位（weightKg/temperatureC/labValues{key:值}/visitNote/
                                       internalNote/specialCareNote/followUpRecommendation/followUpReason），前端
                                       自動存檔用；同步病歷日誌與健檢報告草稿。檢驗 key 不在掛號表單裡回 422，
                                       櫃台完成後回 409
POST   .../workflow/start               開啟工作區＝開始看診，寫 visitStartedAt
POST   .../workflow/handoff             完成看診，送交櫃台：寫 handoffAt → pending_checkout，號碼牌不歸還
POST   .../workflow/reclaim             取回這筆：清 handoffAt → 退回 arrived；deskCompletedAt 已寫入時回 409
POST   .../workflow/complete            櫃台完成處理：寫 deskCompletedAt → completed，歸還號碼牌
POST   .../workflow/followup            櫃台敲定回診時段：寫 followUpDate/Time 並建立（或改期）下一筆掛號；另收
                                       estimatedDurationMinutes/reason/isSurgery/surgeryName，規則同新增掛號
POST   .../workflow/record              建立／取得本次就診綁定的健檢報告草稿（body.templateId）

內部聊天（全站，不綁掛號／病患）
GET    /api/chat/messages               最近訊息（?limit=，預設 100），依時間正序回傳
POST   /api/chat/messages               新增一則訊息，body { sender: 'vet'|'front_desk', content, mentions?: [petId] }，
                                       成功後透過 Socket.IO 廣播給所有連線；帶 mentions（最多 5 隻）時同一個
                                       transaction 內把寵物放進暫存區，寵物不存在回 422

初診表（飼主在公開初診頁用驗證碼填寫；公開端是 /api/public/intake-submissions 的 /verify 與送出）
GET    /api/intake-submissions          待審清單（?status=pending|approved|rejected）
GET    /api/intake-submissions/:id
PUT    /api/intake-submissions/:id      審核前修改飼主填的內容，body { version, owner?, pet? }；只限待審核（否則 409），
                                       規則在 lib/intakeEdit.js，同一個 transaction 更新掛號上的姓名／電話／貓咪名快照
POST   /api/intake-submissions/:id/approve  建立飼主與貓咪並排定掛號；date、time 必填，另收 estimatedDurationMinutes/isSurgery/surgeryName，
                                       規則跟新增掛號相同（lib/appointmentTime.js）
POST   /api/intake-submissions/:id/reject

寵物暫存區（全站一份，見第二節 pinnedPets）
GET    /api/pinned-pets                 暫存清單，每筆帶 pet（name/species/breed/owner{name,phone}），新到舊
POST   /api/pinned-pets                 手動加入，body { petId, pinnedBy }（upsert）
DELETE /api/pinned-pets/:petId          手動移除；已不在暫存區也回 200

院內待辦（全站一份，見第二節 todos；每支成功後都回 { items } 最新完整清單）
GET    /api/todos                       未完成＋最近完成 50 筆
POST   /api/todos                       新增，body { content, createdBy, dueDate?, mentions?: [petId] }（最多 5 隻）；標記的寵物不存在回 422
PUT    /api/todos/:id                   改 content／dueDate／mentions；沒帶的欄位不動，dueDate 帶空值＝清掉，mentions 帶了就整組取代（空陣列＝全部拿掉）
POST   /api/todos/:id/complete          完成，body { doneBy }；冪等，已完成不覆寫完成時間與完成者
POST   /api/todos/:id/reopen            改回未完成；冪等
DELETE /api/todos/:id                   刪除；已不存在也回 200

即時通訊（Socket.IO，掛在 httpServer 上，沿用既有 cookie session 驗證）
join-day / leave-day（client→server）  加入／離開 appointments:<date> 房間
appointment:updated（server→client）   掛號本身狀態／欄位變動時廣播完整掛號文件（報到、取消、標記未到、恢復、調整
                                       號碼牌，以及 workflow 的每一支動作都會觸發），讓開著 `/appointments`
                                       診療台與 `/reception` 櫃台台的其他電腦即時反映新狀態，不用等 30 秒輪詢
chat:new（server→client）              全站內部聊天新增一則訊息時廣播，不分房間、廣播給所有已連線的 socket
pinned-pets:updated（server→client）   暫存區任何異動（# 標記、手動加入／移除、刪除寵物）後廣播 { items } 完整清單，前端直接取代
todos:updated（server→client）         待辦任何異動（新增、修改、完成、重開、刪除，以及刪寵物解除連結）後廣播 { items } 完整清單，前端直接取代
medication:updated（server→client）    藥單任何異動；前端重讀清單與工具欄上的待辦數字
intake:updated（server→client）        初診表送出、修改、核准、退回；前端重讀待審筆數（工具欄「初診」）
lab-results:updated（server→client）   IDEXX 結果收到新的／更正版、待確認清單有人確認／復原／忽略；前端重讀待確認筆數（工具欄「檢驗」）

IDEXX 檢驗結果（見第二節 labResults）
POST   /api/lab-results/import          診所電腦上的抓檔程式上傳 InterLink 存下的 XML：body 是檔案原本的位元組（Content-Type: application/xml），
                                       X-File-Name 放 URL 編碼的原檔名；Authorization: Bearer <IDEXX_BRIDGE_TOKEN>，掛在登入檢查之前。
                                       回 201 created／200 duplicate|updated|stale|ignored（不是檢驗結果的訊息），另帶 fill：
                                       自動填入看診的結果（unmatched／no_visit／no_template／applied／already_applied／error）；
                                       檔案不完整或看不懂回 422（抓檔程式之後再試）；伺服器沒設密鑰回 503
POST   /api/lab-results/heartbeat       抓檔程式每分鐘回報一次（同樣用 IDEXX_BRIDGE_TOKEN、掛在登入檢查之前），依 bridgeId upsert
GET    /api/lab-results                 預設列待確認（petId、dismissedAt 都空），每筆附 candidates（檢驗當天的掛號，同名唯一的 suggested）；
                                       ?petId= 列那隻貓的；新到舊、分頁（工具欄數字用 limit=1 的 total）
POST   /api/lab-results/:id/match       待確認清單選了貓，body { petId }；照自動填入規則填進當天看診，回 { fill }；已配對或已忽略回 409
POST   /api/lab-results/:id/unmatch     復原：清掉這份結果填進看診、還沒被改過的值，回到待確認，回 { cleared, kept }
POST   /api/lab-results/:id/dismiss     忽略（品管測試、練習）；已處理的回 409
GET    /api/lab-results/bridge-status   各台抓檔程式的最新心跳，另帶 online（三分鐘內有心跳）
DELETE /api/lab-results/bridge-status/:bridgeId  移除已經停掉的抓檔程式紀錄（換電腦、改名稱後的舊紀錄；面板上點紅燈）；還在回報的回 409

寄送紀錄
GET    /api/delivery-logs               流水帳，一筆＝一次寄送（queued 與結果依 attemptId 在資料庫裡先合併再分頁，lib/deliveryAttempts.js）；?recordId= / ?event=（這次寄送的最終結果）/ ?q= / ?from=&to= / 分頁

健檢表單設定
GET    /api/settings/form-templates
POST   /api/settings/form-templates
GET    /api/settings/form-templates/:id
PUT    /api/settings/form-templates/:id
DELETE /api/settings/form-templates/:id

文字模板
GET    /api/text-templates              列表（?includeDisabled= / ?q=）
GET    /api/text-templates/fields       可套用模板的欄位清單（掃描所有健檢範本，另固定帶兩個 visit: 前綴的診療台欄位：visit:visitNote / visit:specialCareNote）
POST   /api/text-templates
PUT    /api/text-templates/:id
POST   /api/text-templates/:id/use      累計使用次數
DELETE /api/text-templates/:id

其他
GET    /api/search                      全站搜尋（飼主 + 寵物）
GET    /api/dashboard                   總覽：today（今日掛號／上午下午／在院＝看診中＋候診／待櫃台處理／已完成／待安排回診，
                                       跟掛號台流程列同一套分段）、reports（草稿＋超過一天／待寄送／寄送失敗／本月已寄送與上月）、
                                       latestFailed（最近一份寄送失敗的貓咪與原因）、weeklyTrend（近 8 週，含 weekStart）
GET    /api/public/reports/:token        公開，飼主查看報告用
GET    /api/health
```

`AUTH_ENABLED=true`（或 `NODE_ENV=production`）時，除了上面標注的三支免登入路由，其餘 `/api/*` 都會被 `requireAuthentication` 擋下（見 `app.js` 掛載順序），未登入回 401。本機開發預設不設 `AUTH_ENABLED`，這道關卡整個略過。

`GET /api/records` 的 `view` 是預設工作佇列：`todo`（預設）/ `drafts` / `pending` / `failed` / `sent` / `all`。回傳帶 `counts` 給前端佇列徽章。**儀錶板卡片的數字必須跟對應佇列的筆數對得起來**——卡片可以點進清單，兩邊算法不同會直接讓人困惑。

刪除限制：`deliveryStatus` 為 `sent` 或 `sending` 的報告不給刪。刪除入口有兩個：`/pets/:id` 的報告頁籤（收在列上的 ⋯ 選單）與 `/records` 列表（同樣收在列上的 ⋯ 選單，危險項紅字）。報到時自動建立的草稿綁在掛號的 `recordId` 上，刪除報告會在同一個 transaction 內把指向它的掛號 `recordId` 清成 null（`__v` +1 並廣播 `appointment:updated`），否則診療台會開啟一份已不存在的草稿。

刪除確認：**只有已結案報告要打字確認**（`confirmText` 必須等於寵物名稱），草稿直接刪。打字確認防的是誤刪正式報告——它產過 PDF、可能已經給過飼主連結；草稿是工作中狀態，多一道抄名字只會訓練使用者無視確認。前端也照這個判準分流：草稿走 `ConfirmDialog`，已結案走 `DeleteRecordDialog`。

## 六、頁面規劃

### 骨架（`App.vue`）

`左側導覽 72px ｜ 工作區 ｜（工具欄面板 460px）｜ 右側工具欄 64px`。頁面本身仍由視窗捲動（返回上一頁時捲動位置才還原得回來），兩條欄與並排的面板用 sticky 釘在畫面上。

- **左側導覽**（`components/shell/NavRail.vue`，項目定義在 `lib/navigation.js`）：圖示＋兩三個字，分三組——看診（總覽、診療台、掛號台、藥單）、資料（貓咪、報告、寄送）、設定（表單、模板、預填）。最上面是 Logo 與搜尋（`Ctrl/Cmd+K` 命令面板，不換路由），最下面是設定選單（`AppSettingsMenu`：這台裝置的身分醫師／櫃台、明暗主題、自動通知設定、登出）與目前身分。不做收合——字已經在圖示下面。手機寬度改成頁首的漢堡選單。
- active 判斷用網址前綴（`router-link` 內建的比對路由記錄，抓不到獨立註冊的深層路由）；路由可以用 `meta.nav` 指定歸屬，更長的導覽項吃得下目前網址時讓給它（`/records/deliveries` 不算 `/records`）。
- **右側工具欄**（`components/shell/UtilityRail.vue`）開側滑面板：暫存、藥單、待辦、檢驗（IDEXX 結果待確認，每一頁都有，見第二節 labResults）、初診（只在掛號台）、聊天（最下面）。數字目前全部是**紅色徽章＝要人動手**（暫存區幾隻、藥單、待辦、待確認的檢驗結果、初診、聊天未讀，0 就不畫）；暫存區原本是灰色「狀態讀數」，使用者要求改紅——有貓被丟進暫存區就是有人要對方看。元件仍保留灰色讀數（`tone: 'neutral'`，0 也照顯示）給之後真正的狀態數字用。藥單的口徑依這台裝置的身分（醫師看待確認、櫃台看待包藥＋待領藥，`shared/medicationWorkflow.js` 的 `medicationTodoCount`）。藥單、初診、檢驗的數字在 `stores/workCounts.js`，由 `useGlobalChat` 那條連線在 `medication:updated`／`intake:updated`／`lab-results:updated` 時重讀。同一個 store 另存 IDEXX 抓檔程式的心跳狀態（`bridges`，每分鐘讀一次 `GET /api/lab-results/bridge-status`——離線就是沒消息，伺服器沒有事件可以推）：「檢驗」面板標頭、關閉鈕左邊每台診所電腦一顆**燈號**（綠＝連線中、黃＝連著但上傳卡住、紅＝超過三分鐘沒回報），滑過去（`v-tip`）才顯示狀態與最後回報時間——使用者要求做成燈號、不要佔一整列；文字規則在 `lib/labResults.js` 的 `bridgeStatusLine`，有任何一台離線時工具欄「檢驗」的徽章即使沒有待確認結果也亮「!」；從來沒有抓檔程式回報過就什麼都不顯示。
- **側滑面板**（`components/shell/UtilityPanelHost.vue`＋`stores/utilityPanel.js`）：一次開一個，**不加遮罩、不鎖背景**（一邊做事一邊查）；1600px 以上是版面裡的一欄、把工作區往左推，更窄時浮在工作區上面。面板內可以再「推入」一層、左上角返回：暫存區點一隻貓推入**病歷速覽**（`panels/PetQuickView.vue`，聊天與待辦的 `#` 標記也開這裡，`pinnedPets.openQuickView`）、藥單推入「新增藥單」、初診推入逐欄審核（初診面板分「待審核／已發出」兩個頁籤，預設待審核、發碼後切到已發出；已發出的驗證碼可複製、作廢，不必到時間軸逐天找）。面板用 `KeepAlive`，關掉再開表單草稿、聊天輸入都還在。面板外框統一用 `panels/SidePanel.vue`。
- 聊天是面板之一（`panels/ChatPanel.vue`），不再有右下角泡泡；標頭有「通知」鈕（顯示已開幾項），開「自動通知」的逐項開關（`NotificationSettingsDialog`，設定選單也有同一個入口）——開關決定的是**這台裝置做那些動作時要不要自動發訊息**（`useAppointmentNotifier`），不是這台看不看得到；改版時曾經只留在設定選單，使用者在聊天室找不到，不要再拿掉；面板開著時 `chat.open()`，未讀數由 chat store 依 `isOpen` 判斷。身分是裝置固定的（`useStaffIdentity`）。
- Toast 一律在畫面底部置中（`ToastContainer`，所有頁面同一個位置；早期診療台與掛號台放頁首下方、其他頁放右下，使用者要求統一改成中間下面）。

### 頁面

| 路由 | 頁面 | 說明 |
|---|---|---|
| `/` | 總覽 | 照設計稿 R2-Dashboard：頁首「前往掛號台」→ 寄送失敗橫幅（有才出現，點名最近一份的貓咪與原因＋「查看並重寄」）→「今天的門診」四格（今日掛號、在院、待櫃台處理、已完成，點進掛號台對應的 `?stage=`）→「健檢報告」四格（草稿、待寄送、寄送失敗、本月已寄送，點進 `/records?view=`；待櫃台處理／寄送失敗有數字時亮琥珀／紅框）→ 近 8 週健檢量長條（CSS 畫的單一序列，只標最新一週，其餘滑過整欄出 `Tooltip`：日期範圍＋份數，不用原生 `title`；0 也留 2px）＋院內待辦（未完成前 8 筆，圓圈可直接完成，「全部待辦」開工具欄面板）。**每一個數字都點得進對應清單，口徑跟那份清單一致。** 全站已經沒有圖表套件（echarts 隨舊總覽一起拿掉）。 |
| `/appointments` | 診療台 | **左欄「今日病患」400px＋右欄目前這一筆的看診工作區**（`VetConsolePage`＋`VisitWorkspace`）。左欄頂端三個頁籤：**進行中**（在院依報到順序、已報到的手術另成「手術」一組接在在院下面、今日排程依時段，三組可收合）／**已交櫃台**（最早交出的在上，可「取回」）／**已完成**（最近完成的在上）。**精簡／詳細**切換（裝置偏好）：精簡一行一筆（號碼／時段、名字、初診徽章、來院原因、手術／遲到／備註圖示、狀態）；詳細另外展開來院原因、徽章、備註。**順序只由掛號資料決定，點擊不會改變**。列上沒有關閉鈕：點哪一列就換成那隻貓，目前這一筆只用淡主色底標出（不加左側色條）；工作區**一次只掛一個**，切換前先把自動存檔送出（`VisitWorkspace` 的 `flush`），存不進去就留在原地，不另外保留切走那幾筆的輸入；工作區標頭沒有關閉鈕，送交櫃台後自動關。工作區標頭：左邊號碼牌，右邊一欄由上而下是名字、貓咪規格欄（品種、性別＋結紮、年齡、體重＋「本次」）、飼主規格欄（飼主、電話，有才出現的市話／Email／地址）＋就診時間（預約、報到、看診分鐘、交櫃台、完成），跟貓咪規格同一排、靠右（小標題同一條線），放不下時整組換到下一行、跟貓咪規格同一條左緣；不再收在 Info 彈出框；來院原因獨立一行放大；醫療警示分級；貓咪與飼主備註並排常駐、可就地編輯。內容由上而下：量測 → 本次簡易紀錄 → 內部備註 → 交給櫃台（請轉告飼主、回診建議），右欄歷次病歷日誌；**每個欄位旁有去處小標記**（`DestTag`：日誌／報告／院內）。 |
| `/reception` | 掛號台 | **頁首＋一條流程列＋整頁的看診時間軸**（`ReceptionPage`）。頁首：「掛號台＋時鐘」｜日期控制、「新增藥單」（開藥單面板並推入新增）、「掛號」。流程列四格「待報到 → 在院 → 待櫃台處理 → 已完成」一格一個數字，點一格只看那一段（`?stage=`），第三格列出正站在櫃台前的人。警示列只在有例外時出現（醫師申請修改、遲到未報到、待審初診表）。時間軸依預約時段排、左側軌道、上午診／下午診可收合（時段結束且沒有待處理時自動收合，`lib/receptionBoard.js` 的 `sessionAutoCollapsed`）、「現在」虛線、午休分隔線；已完成與未到／取消收在最下面。**卡片左邊是貓（名字、初診徽章、手術／遲到徽章、來院原因、請轉告飼主、飼主備註），右邊是對齊的三欄：飼主／電話（附複製鈕）／進度**，最右是主要動作（報到／遲到／處理）＋ `RowActions`。卡片底色只在還沒報到時用遲到（紅）／手術（紫）。整張卡片可點：已交櫃台開 `HandoffSheet`，待審初診表開初診面板，其餘開修改掛號。資料齊全的回診一鍵報到（號碼牌自動配發、超過 `LATE_GRACE_MINUTES` 自動記遲到、可「復原」）。**新增／修改掛號是置中的雙欄 Modal**（`AppointmentDialog`）：左欄誰、為什麼（手術只是標記＋名稱）、右欄時段格（`SlotGrid`，15 分鐘一格、格內列已約的名字、已過的時間照樣能選）。初診報到（`CheckInDrawer`）開在時間軸右側。**`HandoffSheet`（櫃台處理視窗）**：對話框 `size="2xl"`（最寬 90rem：右欄還能並排的下限；105rem 使用者覺得太大）。標頭一排：號碼牌｜貓、徽章、來院原因｜飼主規格欄（飼主、電話、預約、交櫃台、完成）；四段進度條已拿掉。飼主備註整條攤開在標頭下。左欄「跟飼主說」照講話順序編號：①請轉告飼主（有內容才用警示底，空的是灰底）②本次簡易紀錄，下面直接展開歷次病歷日誌（使用者要求不收頁籤）；右欄③約回診：醫師建議在上（標籤與內容同一行），`AppointmentSlotPicker` 的 `split` 並排（日期、診療時間、來院原因、手術一窄欄＋時段格），大部分就診都會當場約、時段一打開就看得到。底部左邊一句結果（「完成後會約 10/12（週一）14:30 回診」／「這次不約回診」），右邊「完成處理」收尾。 |
| `/medications` | 領藥 | 藥單的全頁版（`MedicationPickupPage`＋`MedicationWorkspace` 的全頁版型，只有待領藥與已領藥），是「站在櫃台交付藥包」的視圖。**跟健檢報告清單同一個模板**：DataCard 分欄（貓咪＋飼主電話、藥單內容一行摘要、登記時間＋「2 小時前」、狀態＋需重新包藥紅徽章），列上一顆主要動作（確認領藥／完成包藥，其餘「查看」）＋⋯（取消藥單）；**點貓咪整頁切換成詳情卡片**、左上返回鈕回清單，交完一筆回清單。詳情標頭是規格欄（飼主、電話可複製、登記時間），**已確認的藥單是唯讀檢視、藥單內容放大**（拿藥包逐項對照），飼主回報／處理備註是「標籤｜內容」列、歷次病歷日誌預設收合，底部一顆主要動作，修改藥單、提出意見、取消藥單收進 ⋯。「新增藥單」在頁首右上。工具欄的藥單面板是同一個 `MedicationWorkspace` 的 `compact` 版（卡片清單、清單與詳情在同一個容器內切換）。**「藥單」是物件，「領藥」只指交付那一步。** |
| `/pets`、`/pets/:id` | 貓咪列表／詳情 | 飼主不是獨立可瀏覽的實體，一律跟著貓咪出現。詳情頁頁首放名字、舊病歷號（有才出現）與藥物過敏（實心紅），下面一張卡片左貓咪右飼主兩欄，身分資料用規格欄，病史／過敏／備註用警示底，飼主電話可一鍵複製；兩邊各自就地編輯。病歷日誌與健檢報告用頁籤切換，日誌頁籤最上面是就地新增的一行。清單欄位：貓咪、品種、性別、飼主＋電話、最近紀錄（日期＋幾天前）、提醒（`ReminderTags`：過敏／病史／「注意」，`lib/petDisplay.js` 的 `petReminders`）。 |
| `/pets/new` | 新增貓咪 | 飼主與貓咪欄位同一頁，飼主段切「選擇既有飼主／新增飼主資料」；有離開前的未儲存提示。 |
| `/records` | 健檢報告清單 | 跨貓咪，佇列切換（預設「全部」）；寄送失敗的列左側一條紅線 |
| `/records/deliveries` | 寄送紀錄 | 流水帳，含已刪除報告的紀錄 |
| `/pets/:petId/records/new`、`/records/:id/edit` | 健檢報告填寫 | 自動存草稿、離開前攔截；連著看診的草稿在資訊列下方有「引用本次看診」說明條：體重、體溫、檢驗數值在這裡改會寫回看診（`lib/recordVisitLink.js`），回診日期唯讀。1280px 以上區段導覽是左側直排的步驟清單，更窄時改回上方橫排。底部操作列貼齊左右兩條欄。 |
| `/records/:id/preview` | 報告預覽 | `meta.bare`，後台用，有結案／寄送／分享操作 |
| `/report/:token` | 報告檢視頁 | `meta.bare`，**公開**，飼主查看用 + PDF 截圖來源 |
| `/intake` | 初診填寫（公開） | `meta.bare`，飼主在診所現場用手機、以櫃台給的 4 位驗證碼填。手機優先的獨立版面（`--intake-*` token，不跟主題），電腦版同外觀；草稿存 `sessionStorage`、不出提示。規則見 STYLE_GUIDE 第 10 節 |
| `/reception/intakes` | 初診表審核 | 全頁版（左清單、右逐欄審核，`IntakeReview.vue`，跟初診面板共用）。貓咪／醫療紀錄／飼主三段各有「修改」，就地改完存回初診表（`IntakeSectionEditor.vue`）；掛號日期與時段必填，規則跟掛號視窗的時段格相同（`lib/appointmentTime.js` 的 `appointmentSlotErrors`） |
| `/settings/forms`、`/settings/forms/:id` | 健檢表單管理／設計 | |
| `/settings/presets`、`/settings/presets/:formId/:presetKey` | 預填模板清單／單組編輯 | 清單是左右兩欄：左邊表單清單（搜尋同時比對表單與模板名稱、有模板的排前面、已停用的收在底下，`lib/presetForms.js`），右邊選中那份的模板；選哪份記在 `?form=`，窄螢幕左欄收成下拉選單。見第二節 formTemplates 的 `presets` |

**牙齒圖**（`components/formfields/DentalChart.vue`）：沿用以 tooth.jpg 取樣的貓 Modified Triadan d3 幾何。兩種操作（點選開選單／刷子一顆一顆標）、「其餘全部正常」（`restNormal`，報告會寫出來）、只有標了狀況或正在選的牙才拉出備註欄、每種狀況除了顏色還有形狀記號（缺牙虛線、牙結石點點、牙周病斜線、拔除打叉、其他實色），圖下方有文字清單（報告上也列出，`lib/dentalChart.js`）。

## 七、UI／視覺設計規範

**設計語言文件是 [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md)**（原則、元件用法、頁面模板、決策理由，以及畫面修改的流程）；這裡只列最容易做錯的幾條。**以誰為準**：數值只在 `client/src/style.css`，畫面以程式為準，STYLE_GUIDE 寫規則與理由，跟程式不一致時是文件過時、要更新。設計稿 https://claude.ai/artifact/Ev85Kihq8eDuUQLzsYbtBG（「第二輪 定稿規格」頁）是 2026-09 改版的**提案快照**，之後的決定沒有回填（列在 STYLE_GUIDE 第 9 節），**不要照設計稿把改好的地方改回去**。

**改畫面的流程**：大改（新頁面、版面重排、新元件類型）先做設計提案、使用者確認後才實作；小改直接改程式。**改完同一次**更新 STYLE_GUIDE 對應段落（連同理由）與這一節，並跑 `npm run build`、`npm test`、兩支瀏覽器測試；動到報告就照 STYLE_GUIDE 第 8 節比對紙面。

- **明暗兩套、同一套形狀**：淺色＝清爽臨床（冷灰底 `#f4f6f8`、白卡片、深青主色 `#007a7e`），深色＝深色專業（近黑藍底 `#07090c`、青藍主色 `#37d2f2`，卡片頂端一條內側高光；**不用光暈**——曾經在主要按鈕與看診中的號碼牌加青色光暈，使用者覺得看了不舒服，已拿掉）。所有色值只在 `client/src/style.css` 的 `:root`／`.dark`；`npm run build` 內含 `scripts/audit-colors.mjs`，頁面裡寫色碼或 Tailwind 固定色階會直接失敗。
- **一律用語意 token**：表面 `bg-background`／`bg-card`／`bg-sunken`（下凹：軌道、次要按鈕、唯讀區塊）／`bg-hover`／`bg-field`（輸入框）；文字三階 `text-foreground`／`text-muted-foreground`／`text-subtle-foreground`；邊框 `border-border`／`border-border-strong`（`border-input` 同後者）；主色 `bg-primary`、主色淡面 `bg-accent text-accent-foreground`（選取中、已結案）；狀態 `danger`／`warning`／`success`／`info` 各配 `-surface`，另有 `surgery`（紫，只給手術標記）與 `badge`（工具欄紅徽章）。
- **狀態色的明度是刻意錯開的**（紅綠色盲下只剩明度可辨），淺色 danger 最深、深色 danger 最亮——危險永遠是對比最高的那一個。新增狀態色要跟主色留 40° 以上色相距離。
- **字級**以 1920×1080 為目標、內文 18px：`text-xl` 28 頁面標題／`text-lg` 22 區塊與對話框標題／`text-base` 18 內文與輸入／`text-sm` 16 控制項、表單標籤、次要文字／`text-xs` 15 註記、徽章／`text-2xs` 14 規格欄小標題（下限）。尺寸定義在 `style.css` 的 `@theme`；不要用任意值字級。數字用 `num`（IBM Plex Mono＋tabular-nums）。報告紙面 `.report-sheet` 走自己的尺度（A4，改了會動到分頁）。
- **控制項高度** 36／40／44／48，預設 40（`Button` 的 `xs`/`sm` 36、`default` 40、`lg` 48）。**圓角**：格子與小標記 6、控制項 8（`rounded-lg`）、卡片 12（`rounded-xl`）、對話框 16（`rounded-2xl`）、膠囊 999。
- **按鈕** variant：`default` 實色、`secondary` 下凹底＋細邊、`soft` 主色淡面＋淡主色細邊、`destructive` 淡紅底＋淡紅細邊、`destructive-solid` 實心紅（只給確認視窗的最終動作）。**所有按鈕靜止時都要有底色**——工具列與清單列上的圖示鈕、關閉鈕、日期前後鈕、分頁一律 `secondary`；曾經有只在滑過時出底色的 `ghost`，使用者覺得沒有顏色不好看，已經拿掉，不要加回來。**推進流程的動作用 `soft`**（繼續填寫、新增健檢、審核、報到、安排回診…），取消／返回／分頁／就地編輯的鉛筆鈕這類輔助動作才用 `secondary`；清單列上唯一的主要動作（含查看報告、設定清單的編輯）一律 `soft`。**狀態徽章盡量有顏色**，灰色只留給已取消、已停用這種「不作用」的狀態（草稿是 `info`）。
- **頁面容器只有一種**：寬度與外距只在 `App.vue` 的 `<main>` 決定：**滿版**（填滿左側導覽與右側工具欄之間，`px-6 py-5`，不設 `max-w`），頁面自己不再包外框，**沒有例外**——診療台、掛號台跟其他頁同寬（早期的 `meta.wide` 已拿掉，因為現在每頁都滿版）；兩個工作台用 `xl:h-[calc(100dvh-2.5rem)]` 撐滿高度。**表單型頁面（新增貓咪、預填模板編輯）在頁內把表單限寬 `max-w-5xl`，頁首不限寬**，才不會在 1920 螢幕上把單一輸入框拉成一整條。會被側滑面板擠窄的區塊用 container query 依自己的寬度排（例如看診工作區 `@container/visit`），不要照視窗寬度排。每頁根節點一律 `flex flex-col gap-5`，第一個子元素一律是 `PageHeader`（連兩個工作台、總覽、貓咪詳情、健檢報告填寫、表單設計都是，工作台的日期控制放 `actions`、時鐘放 `meta`）；底部固定操作列的頁面（健檢報告填寫）才加底部留白。
- **清單頁一個模板**（照兩個工作台的卡片骨架）：`PageHeader`（只放標題與主要動作；詳情／編輯頁用 `back-to` 出圓形返回鈕，不再有麵包屑）→ 一張 `DataCard`：標頭左邊清單標題＋筆數、右邊 `#filters`（搜尋膠囊 `FilterBar`、`SegmentedControl`），下方 `#tabs` 一條 `FilterTabs`，內容是 `.desktop-data-header`（44px）＋`.desktop-data-row`（64px，欄寬用 `--data-columns`），`#footer` 放 `ListFooter`（「第 x–y 筆，共 n 筆」＋分頁）。**篩選放卡片標頭、不放頁首**；載入中與空狀態放在卡片裡（`inset`）。列上只留一顆主要動作，其餘收進 `RowActions` 的 ⋯ 選單；某列沒有選單時用同尺寸的空位補齊，按鈕才對得齊。1280px 以下改成一筆一張小卡。
- **身分資訊不用「·」「・」串成一行。** 標頭用規格欄（`SpecGrid`＋`SpecCell`：小標題在上、值在下、細線分隔）；清單只寫「品種＋♂♀」（`PetLine`／`PetSex`）；初診才出徽章，回診不出。
- **頁籤／分段切換**：`FilterTabs`（有計數）與 `SegmentedControl` 外觀相同（`segment-track`＋`segment-active`）。**下拉選單**用 `ui/dropdown-menu`（`RowActions` 已改用它），危險項放最後、前面一條線、靜止時就是紅字。
- **欄位沒有值就留白，不補提示文字。** 不要寫 `reason || '未填來院原因'`、`v-else>醫師沒有要轉告的事`、`'待確認'`、`'尚無備註'` 這類替資料說話的字；原本的格子（底色、標籤）照樣畫出來、內容空著，需要時用 `min-h-lh` 撐住一行高度。使用者明確要求過。例外：清單整個是空的空狀態（`EmptyState`「尚無健檢報告」）、載入／搜尋／錯誤訊息、修改前後對照裡的「（空白）」（那是在說「改成了空白」這件事本身）、下拉選項本身的「未記錄」。
- **不要用 `v-html`、`confirm()`／`alert()`**：確認走 `ConfirmDialog`，提示走 `useToast()`，格式文字走 `RichText`。滑過提示用 `v-tip="文字"`（截斷文字用 `v-tip.overflow`，只有真的被截斷才出；`lib/tooltipDirective.js`），**不要用原生 `title`**——要停很久才出現、樣式不一致；`npm run build` 的 audit 會擋。
- **貓咪名、飼主名一律是超連結**（`PatientLink`，連到 `/pets/:id`；飼主沒有自己的頁面，飼主名也連到那隻貓）：貓咪名主色字，飼主名與警示列裡的名字用 `quiet`（原字色＋細底線）。例外：名字在按鈕或選項裡（點下去做別的事，連結不能放進按鈕）、沒建檔的初診、飼主看的報告頁、貓咪詳情頁自己。
- 圖示統一 `@lucide/vue`，`stroke-width="1.75"`；頭像一律貓圖示（診所只看貓）。
- **用語**：員工畫面一律「貓咪」「櫃台」「醫師」「健檢報告」；「藥單」是物件、「領藥」只指交付；公開初診頁維持「貓孩兒／家長」。
- 報告頁（`/report/:token`、`/records/:id/preview`）固定淺色，用 `report-*` token，不跟主題切換。紙面裡共用的元件（牙齒圖）讀的是後台 token，所以 `style.css` 的淺色區塊選擇器是 `:root, .report-sheet`，紙面內一律拿到淺色值；這類元件的行內樣式要寫 `var(--field)` 這種原始 token，不要寫 `var(--color-field)`（那個在 `:root` 就算定值，擋不住 `html.dark`）。`.report-sheet` 另外把字級與行高鎖回改版前的 16px／1.5，動到 `@theme` 字級後要重新比對紙面分頁。
- 公開初診頁（`/intake`）也是獨立的一套：`--intake-*` token、只有一個強調色、16px 為底（iOS 輸入框小於 16px 會放大整頁）、點擊範圍 44px，不要借後台元件的樣式；見 STYLE_GUIDE 第 10 節。

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

# IDEXX 抓檔程式（bridge/，跑在診所電腦上，見第二節 labResults）
npm test               # node --test，不需要伺服器，會在系統暫存資料夾裡實際搬檔案
npm start              # 依 idexx-bridge.config.json 開始監看資料夾（前景執行，測試用）
npm run check          # 只檢查設定檔、資料夾與伺服器連線，送一次心跳就結束
npm run build:installer  # 產生 dist/IDEXX-Bridge-Setup.cmd：單一安裝檔，傳到診所電腦點兩下就裝好（要管理員權限、裝 Node、問設定、建排程工作）；
                         # 流程在 setupTemplate.ps1、打包在 buildInstaller.mjs。改了 bridge 的程式要重新產生。
                         # 有 bridge/installer.preset.json（網址＋密鑰，不進版控）時產生全自動的安裝檔、不問任何問題——那個檔案裡有密鑰
# 正式安裝／移除／查看狀態：install.ps1 / uninstall.ps1 / status.ps1（檔案要存成 UTF-8 with BOM，PowerShell 5.1 才讀得懂中文）
```

改完後的驗證順序：後端 `npm run lint` + `npm test`，前端 `npm run build` + `npm test`；動到 `bridge/` 再加跑它的 `npm test`。**前端那個 `npm test` 很容易漏掉**——它只涵蓋 `src/lib` 底下的純邏輯，但改動色彩 token 或狀態語意時正是它會抓到問題（斷言綁的是語意 token 名，不是色階名）。dev server 通常已經在跑（3000 / 5173），可以直接 curl API 驗證。

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

第 4 步同時重做了版面，這次**是重新拆成兩頁，但拆的方式跟第 1 步不同**：不是用路由鎖身分（那正是第 1 步失敗的原因），而是兩頁看同一份資料的不同切片，任何裝置都能開任何一頁、按任何按鈕。醫師頁解掉的是「一次只能停在一筆病患上」——舊版點一筆會整頁跳到 `/appointments/:id/visit`，比更早的 Modal 版更封閉；現在右欄是就地切換的工作區，點左欄哪一筆就換成哪一筆（一度做成可同時掛多筆、`v-show` 切換，但頁籤列拿掉後看不出開了哪幾筆，按 X 會跳到別隻貓；改成一次一筆、切換前先存檔）。櫃台頁解掉的是「要自己在時間軸上掃描誰該處理」——改成三個依優先順序排列的待辦匣，時間軸降為右欄參考。醫師「送交櫃台」之後仍可**取回這筆**（`POST /workflow/reclaim`），直到櫃台按下「完成處理」為止，這是刻意補上的回頭路。

5. **櫃台頁的四欄看板再改回時間軸。** 第 4 步的櫃台頁後來又做成四欄看板（待報到／在院／待櫃台處理／今日已完成各一欄、各自捲動），實際使用回饋是視線要在四個地方跳、比早期的時間軸還雜。現在是「上方一條橫式流程列（四格數字＋篩選）＋整頁的原版時間軸」，時段結束自動收合。同一次把掛號表單從側邊抽屜改成雙欄 Modal（時間軸佔滿寬度後抽屜擠不下），時段格改成 15 分鐘並在格內直接列名字，手術掛號開放中午的手術時段，遲到徽章改紅、手術徽章改紫。

6. **頁首那排開 Modal 的按鈕重做成一條 chip 群。** 藥單（原本叫「包藥」）、暫存區、初診、已交櫃台、已完成是版面定案後陸續補上去的，每顆各用當下最順手的寫法，結果同一列裡混了三種層級（查閱清單／待辦工作台／建立動作）卻長得一樣、兩頁位置又不同、數字徽章有三套寫法（裸 span、手寫絕對定位紅點、Badge），而且按鈕上的數字跟它打開的面板標題口徑不一致。現在兩頁共用同一條單行工具列：`標題＋時鐘 ｜ chip 群（置中）｜ 日期控制＋主要動作`，數字只有「灰＝狀態讀數、紅＝待辦」兩種讀法（`ConsoleChip` 的 `tone`），口徑統一在 `shared/medicationWorkflow.js` 的 `medicationTodoCount`（醫師看 `review`、櫃台看 `approved+ready`）。

   同一次解掉三件事：**藥單的三個入口收成一個**——櫃台原本有「包藥」（清單）、「領藥」（其實只開新增表單、不顯示待領清單）、側邊欄「領藥」（全頁）三個入口指向同一批資料，其中「領藥」這個字在頁首與側邊欄指兩件不同的事；現在 chip 群只有一顆「藥單」，建立新藥單的按鈕移進面板的清單工具列，全頁版留在側邊欄當交付視圖；櫃台頁首右側另有一顆「領藥」，開的是清單工具列那顆「領藥」的建立表單（`MedicationWorkspace` 的 `createOnly` 模式，獨立 Modal；原本那顆會 `router.push('/medications')` 跳頁，使用者要求改成就地開 Modal）。**`MedicationWorkspace` 不再自己開第二層 Modal**，清單與詳情是同一個容器內的兩個檢視。**櫃台補上 `medication:updated` 的 socket 監聽**（原本只在 `onMounted` 抓一次，面板關掉後數字就凍住）。

   版面上被 960px 這個數字逼出幾個決定：1280 視窗扣掉側邊欄 `w-64` 與 `lg:px-8` 只剩 950px，所以標題縮成「診療台」「掛號台」、副標題只留時鐘、「今天」鈕只在不是今天時才渲染、櫃台的搜尋搬進時間軸標頭、「今日已完成」改叫「已完成」。`ConsoleChipBar` 刻意沒有 `overflow-x-auto`：第一版有，結果 chip 連同紅徽章被默默裁掉，畫面上完全看不出少了東西。

   順手修掉：櫃台「暫存區」按鈕的 active 底色綁在「有沒有內容」而不是「面板開著沒」（有東西就永遠看起來是開啟中）、櫃台把面板與掛號流程擠在同一個 `drawer` ref（`closeDrawer` 因此同時管「關暫存區」與「丟掉掛號草稿」兩件不相干的事，現在拆成 `panel` 與 `drawer`）、`ModalDialog` 沒有標題區導致五個使用端各自手抄一段 `border-b p-5 pr-16`（櫃台暫存區那份就抄漏了說明文字、留下一個空 div）。`npm run test:medication-browser` 從 HEAD 起就有六處對不上實際 UI（按鈕文案、不存在的階段篩選鈕），一併修到真的會通過。

7. **全站 UI／UX 重做（2026-09）。** 照設計稿重建整套視覺與骨架：淺色「清爽臨床」、深色「深色專業」兩套 token，內文 18px、數字等寬；側邊欄換成 72px 分組圖示導覽；**頁首 chip 群與那幾個大 Modal 全部拿掉**，改成右側 64px 工具欄＋不遮擋背景的側滑面板（暫存區＋病歷速覽、藥單、待辦、初診、聊天），聊天泡泡一併退場。診療台左欄改成「進行中／已交櫃台／已完成」頁籤＋精簡／詳細切換；工作區與櫃台處理視窗的標頭改成左貓右飼主的規格欄，櫃台處理視窗右欄加上歷次病歷日誌。資料面同時改了三件事：**「給櫃台的交辦」`handoffNote` 移除**（連資料庫欄位）、**診療台新增檢驗數值**（項目來自掛號的健檢表單；後來又從診療台拿掉，改只在健檢報告填寫頁輸入，資料仍存在看診上）、**報告草稿改成引用看診、不再複製**（舊版每次看診存檔都無條件覆寫草稿並把 `__v` +1，填寫頁一開著就撞版本；中間試過「複製＋`overriddenKeys` 記下改過的欄位」，但那仍是兩份資料，最後改成跟病歷日誌一樣只存一份、在報告上改＝寫回看診）。手術專屬時段拿掉，手術只是標記。牙齒圖加上刷子、其餘全部正常、形狀記號與文字清單。用語統一成貓咪／櫃台／醫師／健檢報告。

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

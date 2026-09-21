# 專案全面性 Code Review 與改善建議書

審查日期：2026-09-21  
程式基準：Git `6aec997`，審查開始時工作目錄乾淨。  
範圍：Vue 前端、Express API、Mongoose 模型、共享流程、圖片／PDF／郵件、登入與即時推播、測試及部署設定。  
交付性質：審查與改善方案；本次未修改產品程式碼、資料庫或外部服務資料。

## 1. 整體結論

專案已具備可延續的基礎：正式環境強制登入、HttpOnly Cookie、密碼雜湊、部分資料版本控制、跨集合 transaction、報告內容快照，以及郵件結果不確定時的保守處理。現有前後端單元測試全部通過，套件稽核未回報已知漏洞。

主要風險集中在**同一筆資料透過不同入口修改時，規則沒有一致套用**，以及**圖片、報告快照與背景工作的生命週期不完整**。這些問題可能造成未上傳圖片被當成已儲存、歷史報告圖片被刪除、初診資料配對錯誤、已結案內容被另一個入口修改，以及撤銷登入後仍收到資料。

本次列出 **15 項具體發現：P1 七項、P2 八項**。未發現足以確認為 P0 的問題；這不代表已完成滲透測試或正式環境安全認證。建議先修正資料保存及結案邊界，再處理背景工作復原與工程整理。

優先序定義：P1 為應在下一次正式發布前優先處理的資料遺失、資料錯置、權限或結案一致性問題；P2 為下一輪應排入的正確性、可用性及驗證問題。以下位置的行號均以本次基準為準。

## 2. 審查方法與驗證結果

檔案盤點涵蓋 `client/src`、`server/src`、`shared` 共 318 個檔案（包含測試及資產）。採入口與資料流追蹤、全域模式搜尋、核心模組閱讀、現有測試及針對性重現；並非聲稱每個 UI 元件都經過逐行與完整瀏覽器驗證。

| 驗證 | 實際結果 | 解讀 |
| --- | --- | --- |
| `server: npm test` | 236 tests 通過、0 失敗 | 三組外部整合 suite 顯示 SKIP，不能視為整合驗證通過 |
| `server: npm run lint` | 通過 | 現有規則以 `no-undef`、`no-unused-vars` 為主 |
| `client: npm test` | 87 tests 通過、0 失敗 | 主要為工具函式與流程邏輯測試 |
| `client: npm run build` | 通過，含色彩稽核 | `DashboardPage` chunk 540.95 kB，gzip 184.00 kB，觸發大小警告 |
| `server/client: npm audit --json` | 兩邊均 0 個已知漏洞 | 僅代表執行當時 registry 回覆，不能涵蓋業務邏輯漏洞 |
| `client: npm run test:workflow-browser` | 失敗 | 等待已不存在的 `[data-filter="all"]` 逾時，腳本第 67 行 |
| `client: npm run test:medication-browser` | 失敗 | 第 120 行輸入 `#med-pet-search` 時找不到元素 |
| 禁用 UI API／日期輸入掃描 | 未命中 | 未發現 `alert/confirm/prompt` 呼叫或原生 `type="date"`／`type='date'` |
| 中文疑似亂碼掃描 | 未命中指定字元 | 掃描 `client/src`、`server/src`、`shared` |
| 常見危險輸出掃描 | 未命中搜尋模式 | 未發現 `v-html`、`innerHTML`、`eval(`、`new Function`；不等同完整 XSS 驗證 |
| Git 環境檔追蹤 | 僅 `.env.example`、`.env.test` | 未輸出本機秘密；未檢查全部 Git 歷史 |

執行環境為 Windows、Node `v24.19.0`、npm `11.17.0`；Dockerfile 使用 Node 22，本次未建置容器。初次測試／建置遇到沙箱子程序 `EPERM`，經工具核准於沙箱外重跑後取得上述結果；這個環境限制不列為產品缺陷。

未連接正式或測試 MongoDB，未寄送真實郵件、呼叫 Cloudinary 刪除、或執行真實報告 PDF 整合測試。瀏覽器 smoke scripts 使用記憶體假資料。下列「隔離重現」表示真實函式或路由配合受控替身，不表示已用真實資料庫完成端到端驗證。

## 3. 發現總表

| 編號 | 優先序 | 問題 | 主要影響 | 證據 |
| --- | --- | --- | --- | --- |
| F01 | P1 | 待上傳圖片被標為已儲存 | 離頁後圖片遺失 | 前端原函式隔離重現 |
| F02 | P1 | 修訂草稿刪除共用圖片資產 | 歷史報告圖片失效 | 跨路由追蹤＋helper 重現 |
| F03 | P1 | 初診短碼未保證唯一 | 初診資料連到錯誤掛號 | 產碼／查詢／索引追蹤＋模型驗證 |
| F04 | P1 | 撤銷 session 不影響既有 socket | 撤權後仍收到推播 | 真實本機 Socket.IO 連線重現 |
| F05 | P1 | 日誌入口繞過就診完成鎖定 | 無重開審核直接改內容 | 真實路由＋替身持久層重現 |
| F06 | P1 | 掛號同步寫入可穿過病歷結案鎖 | 作答與凍結快照不同 | 寫入條件與交錯順序分析 |
| F07 | P1 | 已結案報告仍引用現行寵物／飼主資料 | 線上版與 PDF 不一致 | 報告 payload 與前端呈現追蹤 |
| F08 | P2 | PDF 重啟復原缺少後續喚醒 | 長期卡在 generating | worker 與 retry 狀態分析 |
| F09 | P2 | 刪報告未清理 GridFS PDF | 殘留文件與儲存持續增加 | 全域資產生命週期追蹤 |
| F10 | P2 | 圖片上傳失敗後本地版本落後 | 重試持續版本衝突 | 前端原函式隔離重現 |
| F11 | P2 | 刪寵物漏檢查掛號與藥單 | 關聯失效、後續操作不完整 | 路由與模型追蹤 |
| F12 | P2 | 儀表板漏計 pending_checkout | 今日總數與報到數偏低 | helper 重現 |
| F13 | P2 | 日期／時間驗證入口不一致 | 無效日期被轉成其他日期 | 日期 helper 重現＋路由追蹤 |
| F14 | P2 | localStorage 例外中斷模組載入 | 封鎖儲存時可能整站白頁 | 模組 import 隔離重現 |
| F15 | P2 | 兩支瀏覽器測試無法跑完 | 主要 UI 流程沒有有效回歸保護 | 實際執行失敗 |

## 4. 逐項改善建議

### F01 — 待上傳圖片被標為已儲存

**位置：** [RecordFormPage.vue](../client/src/pages/RecordFormPage.vue#L695) 第 695、720、755、858、864 行；[ImageUploadField.vue](../client/src/components/formfields/ImageUploadField.vue#L69) 第 69 行。

`buildPayload()` 會濾掉 `pendingFile`，自動儲存又預設 `uploadImages=false`。儲存後用同一份已濾除圖片的 payload 比對，因此尚有本機圖片也會把 `isDirty` 清為 false。路由離開與關閉頁面保護依賴這個旗標，`confirmLeave()` 同樣沒有要求上傳圖片。

**重現：** 加入圖片，等待自動儲存，直接離頁；圖片從未進入伺服器。隔離執行原函式取得 `pendingImages=1`、`persistedImages=0`、`dirty=false`、`state=saved`。

**改善：** 把文字儲存狀態與待上傳資產數分開記錄；只要有 pending 圖片就不得顯示整份已儲存，也不得直接放行離頁。離頁儲存應等待上傳及最後寫入完成。

**驗收：** 加圖後自動儲存、返回、切路由、重新整理及上傳失敗，均不得無提示丟失圖片；成功返回後重新進入仍可見圖片。

### F02 — 修訂草稿會刪除舊報告仍使用的圖片

**位置：** [records.js](../server/src/routes/records.js#L734) 第 734、471、825、880 行；[imageUploads.js](../server/src/lib/imageUploads.js#L117) 第 117–153 行。

建立修訂時透過 `recordSnapshot(source)` 複製 `customValues`，圖片仍是相同 `publicId`。但更新草稿移除圖片、或刪除整份修訂草稿，會直接呼叫 Cloudinary destroy，沒有檢查原版及其他紀錄是否引用。即使舊報告已寄送、不能刪除，也能透過刪修訂草稿間接刪掉它的圖片。

**重現：** 原版 A 有圖片 X → 建立修訂 B → 刪 B 或從 B 移除 X → X 被加入清理清單，A 的公開頁仍引用 X。已用真實 helper 驗證清理清單；未執行外部資產刪除。

**改善：** 建立資產與紀錄的明確引用關係；僅於無引用時排入延後清理工作，清理前再次核對。需考慮新引用與清理同時發生，不能只加一次 `exists()` 查詢。也可在修訂時複製實體資產，但需評估成本。

**驗收：** 刪修訂、改修訂及兩份紀錄共用圖片時，仍被任何保留紀錄引用的資產不得被刪除。

### F03 — 四位初診驗證碼可能重複並配對到錯誤掛號

**位置：** [appointments.js](../server/src/routes/appointments.js#L49) 第 49、379 行；[Appointment.js](../server/src/models/Appointment.js#L113) 第 113 行；[intakeSubmissions.js](../server/src/routes/intakeSubmissions.js#L26) 第 26、74 行。

產碼只做 `randomInt(1000, 10000)`，沒有原子占用或碰撞重試；索引也不是 unique。公開提交以短碼查 `findOne()`，沒有另一個掛號識別因子。兩筆同時有效的掛號若同碼，提交資料會綁到其中一筆，且會改寫該掛號的姓名、電話、寵物名。

**證據：** 兩個相同短碼的 Appointment 均通過模型驗證，schema 索引沒有 unique。這證明缺少唯一性保障，並不表示本次觀察到正式資料已碰撞。

**改善：** 優先使用與掛號綁定的高熵一次性 token。若必須保留四位碼，使用獨立的有效碼配置集合，以唯一索引、原子配置與碰撞重試維持唯一性，並明確處理使用及過期釋放。不能直接對含大量空字串的現有欄位加全域 unique。

**驗收：** 強制產碼器連續回傳同值，包含並發建立時仍不會出現兩個有效同碼；使用、過期、取消後不可誤綁。

### F04 — 登入撤銷後，既有 WebSocket 仍能收到資料

**位置：** [realtime.js](../server/src/lib/realtime.js#L20) 第 20–45 行；[session.js](../server/src/lib/session.js#L39)；帳號撤銷及改密碼腳本。

Socket 只在連線 middleware 呼叫 `sessionUser()`，之後廣播不再驗證帳號停用或 `tokenVersion`。HTTP 每次查 DB 可立即撤權，socket 則持續保有接收權限。前端收到 HTTP 401 後斷線，不能保證所有已連線的客戶端都會主動呼叫 HTTP。

**重現：** 真實本機 Socket.IO 客戶端先登入連線，再將替身使用者 `tokenVersion` 改為 1；相同 cookie 的 `sessionUser()` 回傳 null，但既有 socket 仍收到 `chat:new`。

**改善：** socket 綁定使用者／session；撤銷時主動斷開相應連線，並以有界週期或其他可靠機制偵測 CLI／其他程序的撤權及 token 到期。單純事件 middleware 無法保護被動接收的廣播。

**驗收：** 改密碼、停用帳號、執行撤銷腳本後，在明確訂定的最長延遲內停止全部敏感推播。Socket.IO 官方明確說明連線 middleware 每條連線只執行一次，與本次結果一致。[官方說明](https://socket.io/docs/v4/middlewares/)

### F05 — 病歷日誌可繞過已完成就診的修改限制

**位置：** [clinicalNotes.js](../server/src/routes/clinicalNotes.js#L49) 第 49–68 行；[clinicalNoteView.js](../server/src/lib/clinicalNoteView.js#L21)；[appointmentWorkflow.js](../server/src/lib/appointmentWorkflow.js#L51) 第 51 行。

workflow 的 `clinical` 動作會拒絕修改已完成就診，但 `PUT /clinical-notes/:id` 直接寫入關聯 Appointment 的 `visitNote`，沒有檢查完成狀態或要求重開核准。輸出 view 還固定 `readOnly:false`，寵物頁與日誌面板有可用編輯入口。此外日誌更新缺少使用者讀取版本，先後送出的舊編輯仍可能覆蓋新內容。

**重現：** 相同 completed fixture 經 workflow 規則回 409；經真實日誌路由及替身持久層回 200，`visitNote` 已改寫，`deskCompletedAt` 仍有值。

**改善：** 所有能寫入就診資料的入口共用狀態與版本檢查；日誌入口也需走重開機制。手動日誌則加入版本條件，前端遇到 409 保留輸入並要求比對。

**驗收：** 從診療台、寵物頁、日誌面板及直接 API 修改 completed 就診，都採同一規則；兩位使用者以舊版本儲存時第二位收到衝突。

### F06 — 掛號同步可在病歷結案鎖定後改寫草稿

**位置：** [records.js](../server/src/routes/records.js#L525) 第 525–563 行；[appointmentWorkflow.js](../server/src/routes/appointmentWorkflow.js#L112) 第 112–126 行。

結案先把 `sections` 快照及 `finalizeAttemptId` 寫入仍為 draft 的病歷，再進入 transaction 改 finalized。一般病歷 PUT 會排除 finalize lock；掛號的 `clinical`／`followup` 同步只檢查 `status:'draft'`，可在兩步之間修改量測或回診日期。最終結案條件未核對 `__v`，仍可能成功保存舊快照與新作答的組合。

**觸發順序：** 結案取得鎖並凍結舊體重 → 掛號同步更新體重並提交 → 結案 transaction 以相同 attempt 完成。此為程式交錯分析，尚未用真實 replica set 重現。

**改善：** 共用草稿可寫 predicate，所有同步入口都拒絕 active finalize lock；結案提交同時核對鎖與版本。若改成同一 transaction 讀取／凍結，也需明確處理範本及相關資料版本。

**驗收：** 用可控制 barrier 的整合測試交錯結案與 clinical／followup 更新，只能得到一致的新快照或明確 409，不得靜默混用。

### F07 — 已結案報告的基本資料沒有凍結

**位置：** [records.js](../server/src/routes/records.js#L124) 第 124–168、1167 行；[ReportViewPage.vue](../client/src/pages/ReportViewPage.vue#L50)；[MedicalRecord.js](../server/src/models/MedicalRecord.js)。

臨床 `sections` 有快照，但公開報告仍 populate 現行 Pet／Owner，顯示當前名字、性別、生日、結紮、病史、疫苗及過敏等欄位。修改寵物資料後，舊公開報告會變，GridFS 已保存的 PDF 卻不變。修改時間若在結案與背景產 PDF 之間，第一次產生的 PDF 也不一定代表結案當下資料。

**改善：** 結案時凍結 `patientSnapshot` 與報告需要的飼主顯示資料，公開頁、內部預覽及 PDF 共用。郵件收件地址可以按業務規則取現值，但不應因此改寫歷史報告顯示內容。既有報告無法憑空還原當時值，遷移需標示其來源與限制。

**驗收：** 結案產 PDF 後改寵物姓名、生日與過敏資料，原版網頁內容仍與原 PDF 一致；修訂版依明確規則採新資料。

### F08 — PDF 工作在快速重啟後可能一直卡住

**位置：** [reportPdfJobs.js](../server/src/lib/reportPdfJobs.js#L53) 第 53、106、122 行；[records.js](../server/src/routes/records.js#L649) 第 649 行；[app.js](../server/src/app.js) 啟動與關機流程。

工作只在啟動、結案、手動 retry 時喚醒。啟動復原只接手超過 10 分鐘的 generating 工作；若產 PDF 中途重啟，當下尚未逾時，worker 查不到工作便退出，之後沒有 timer 在期限到達時再掃。retry API 又排除 generating，會一直卡到另一個操作碰巧喚醒 worker。這不需要多實例就會發生。

**改善：** 加入週期性復原／依最近 lease 到期時間喚醒、嘗試識別碼與有界重試；區分有效執行與失聯工作。啟動應在 HTTP 可服務後啟動 renderer，關機應等待或可靠交還背景工作。多實例前再補 lease ownership，避免舊 worker 覆寫接手者。

**驗收：** 產 PDF 時中止程序並立即啟動，在沒有任何新請求的情況下也會於規定時間內恢復；失敗與重試次數可觀測。

### F09 — 刪除報告後，PDF 留在 GridFS

**位置：** [records.js](../server/src/routes/records.js#L774) 第 774–880 行；[reportPdfJobs.js](../server/src/lib/reportPdfJobs.js#L9) 第 9–27、94 行。

刪除報告只刪 MedicalRecord、解除掛號及清理 Cloudinary。該路徑沒有讀取隱藏的 `pdfFileId`，也未清理 `reportPdfs.files`／`reportPdfs.chunks`。背景 worker 的 removePdf 只處理替換及產生失敗，已 ready 再刪除的檔案會殘留。

**改善：** 刪除 transaction 內保存持久化清理任務，提交後按 fileId 執行可重試清理；加上孤兒檔案稽核與保留期限。若有保留需求，應明訂而不是留下無關聯檔案。GridFS 檔案與 chunks 為獨立集合，應使用 bucket 刪除介面管理。[MongoDB 官方說明](https://www.mongodb.com/docs/drivers/node/current/crud/gridfs/)

**驗收：** 產生 PDF 後刪報告，於清理期限內檔案及 chunks 均移除；清理失敗可重試，重複執行不影響其他報告。

### F10 — 圖片上傳失敗後重試會使用過期版本

**位置：** [RecordFormPage.vue](../client/src/pages/RecordFormPage.vue#L730) 第 730–752 行。

儲存流程先 PUT 草稿，再上傳圖片，再做第二次 PUT，最後才更新 `documentVersion`。第一個 PUT 成功、上傳失敗時，資料庫版本已增加，本地版本卻沒更新；下一次儲存會自行撞到 409，即使沒有其他人修改。

**重現：** 執行原 `saveRecord`，讓上傳階段失敗再重試；取得 `expectedVersions=[0,0]`、DB version 1、本地 version 0，第二次出現 version conflict。

**改善：** 每次成功寫入後立即同步本地版本與已保存快照，獨立追蹤上傳及 metadata 儲存狀態；部分成功時保留可重試資產，避免重新整理成為唯一復原方式。

**驗收：** 第一段 PUT 成功、部分圖片成功、Cloudinary 失敗、最後 PUT 失敗等情境均能復原，不能由自己造成永久版本衝突。

### F11 — 寵物可在仍有掛號或藥單時被刪除

**位置：** [pets.js](../server/src/routes/pets.js#L198) 第 198–225 行；[medications.js](../server/src/routes/medications.js#L45)；[appointments.js](../server/src/routes/appointments.js#L303)。

刪寵物只檢查 MedicalRecord 與 ClinicalNote，沒有檢查 Appointment／MedicationOrder。先建立預約或獨立藥單、尚未產生病歷的寵物可以被刪除，留下指向不存在 Pet 的紀錄；後續查寵物詳情、建立文件及核對身分會不一致。

**改善：** 優先使用停用／封存取代有業務關聯的硬刪除，或者補齊所有關聯的限制。新增掛號、藥單及手動日誌也應驗證父資料，並使用相容的 transaction／父文件寫入協調，避免「檢查後才被另一請求建立引用」。

**驗收：** 只有掛號、只有藥單、只有手動日誌三種情況都符合保留規則；並發建立與刪除不產生孤兒資料。手動日誌 POST 目前直接採 `petId`，也應納入同一組關聯測試。

### F12 — 儀表板漏計已看診、待櫃台處理的個案

**位置：** [dashboard.js](../server/src/routes/dashboard.js#L39) 第 39–44、122–123 行；[Appointment.js](../server/src/models/Appointment.js) 的 status enum。

`appointmentStatusCounts()` 沒有 `pending_checkout`，這個合法狀態被丟棄。今日 total 由缺漏後的 counts 相加，本月 checkedIn 也只算 arrived＋completed；醫師送交櫃台時，個案反而會從總數消失。

**重現：** 傳入三筆 pending_checkout 的彙總，回傳全部為 0。

**改善：** 從共享流程定義推導合法狀態及各統計分類；total 應包含所有登記狀態，報到數需涵蓋已交櫃台者，並定義已完成是醫師完成還是櫃台完成。

**驗收：** scheduled → arrived → pending_checkout → completed 過程，總個案數保持不變，各分類按定義移動。

### F13 — 無效日期／時間會被正規化成其他時刻

**位置：** [clinicTime.js](../server/src/lib/clinicTime.js#L42) 第 42–64 行；[appointments.js](../server/src/routes/appointments.js#L347) 第 347、428 行；[intakeSubmissions.js](../server/src/routes/intakeSubmissions.js#L150) 第 150–168 行。

日期 helper 只檢查形狀後呼叫 `Date.UTC`，因此 2 月 31 日會自動進位。一般掛號 create／edit 沒有驗證日期真實存在；初診審核 time 則只檢查兩位數形狀，缺少小時、分鐘及營業時段限制。

**重現：** `combineClinicDateTime('2026-02-31','10:00')` 得到 `2026-03-03T02:00:00.000Z`；`('2026-09-21','99:99')` 得到 `2026-09-24T20:39:00.000Z`。可能造成 `date` 與 `scheduledAt` 指向不同日期。

**改善：** 共用嚴格 date-only／time-only 解析，轉換前先檢查原始年月日是否存在，保留合法 dayOffset 跨日能力。所有寫入入口共用時段及預估長度規則，錯誤輸入回 422。

**驗收：** 非閏年 2/29、2/31、月份 13、99:99、分鐘 60、非營業時段及無時段預約均有明確測試。

### F14 — localStorage 被封鎖時可能無法啟動前端

**位置：** [useStaffIdentity.js](../client/src/composables/useStaffIdentity.js#L7) 第 7–8 行；[App.vue](../client/src/App.vue#L13)；[GlobalChatWidget.vue](../client/src/components/GlobalChatWidget.vue#L6)。

身分模組在頂層直接讀 localStorage，沒有 try/catch；App 靜態匯入聊天元件，會在頁面判斷是否需要聊天之前載入這個模組。若瀏覽器封鎖站台儲存，例外可中斷 App 模組載入，連公開報告也可能受影響。其他偏好模組已存在容錯，可比照。

**重現：** 令 localStorage getter 擲出 SecurityError，再 import 原模組，import 失敗。

**改善：** 抽出可失敗的 storage adapter，讀寫失敗均退回記憶體預設值；不要在模組初始化把選用偏好當成必要服務。

**驗收：** localStorage 的 get、set 各自擲錯時，登入、公開報告及工作台仍可開啟。

### F15 — 主要瀏覽器回歸腳本失效

**位置：** [check-appointment-workflow.mjs](../client/scripts/check-appointment-workflow.mjs#L67) 第 67 行；[check-medication-workflow.mjs](../client/scripts/check-medication-workflow.mjs#L120) 第 120 行；[package.json](../client/package.json#L6)。

掛號測試等待的 `[data-filter="all"]` 在現行 `client/src` 已找不到。領藥測試點擊按鈕後立即輸入 `#med-pet-search` 而失敗；該 input 仍在元件內，現有證據不足以判定為產品功能故障，需檢查點擊目標及對話框掛載時序。兩支測試都未完成原訂業務驗證。

**改善：** 更新已移除的互動契約，使用穩定且具意義的 selector／可存取名稱，對 async 對話框等待可見狀態；錯誤時保存 console、失敗步驟及截圖。納入 CI，以實際 UI 流程驗收，不只檢查腳本能啟動。

**驗收：** 掛號→看診→交櫃台→完成、登記藥單→醫師確認→包藥→領藥，以及衝突、退回、重新開啟情境均能自動跑完。

## 5. 跨模組改善方案

以下是架構與維運建議，**不與上述 15 項已定位問題混算**。

### 5.1 建立一致的寫入規則

先將病歷、就診、日誌、藥單的「是否可改、版本檢查、父資料存在、交易邊界」收斂到應用服務；route 保留輸入轉換與 HTTP 回覆。從 F05／F06 相關入口開始，避免一次重寫全部架構。

`records.js` 有 1,186 行、`RecordFormPage.vue` 有 1,231 行（含空白行）。建議按具體責任抽出結案／修訂、分享、寄送、資產管理及前端儲存協調；拆檔需搭配行為測試，不能只把長函式搬到另一檔。

### 5.2 清楚界定人員身分與權限

現行設計是診所共用帳號，前端的 vet／front_desk 身分不是伺服器授權。藥單記錄 `req.user.username` 也只能追到共用帳號。若需求包含「只有醫師可核准」「可追溯實際操作者」，應改個別帳號、伺服器角色檢查及不可由前端自報的 actor。這是需求與設計決策，不能僅憑畫面分工就聲稱已有 RBAC。

### 5.3 把外部副作用做成可復原工作

PDF 產生、Cloudinary 清理與郵件傳送分別有不同一致性需求。使用持久化任務記錄、attemptId、狀態轉移及可重試清理；郵件保持既有 uncertain 模型，不能因逾時就假設未寄出並自動重寄。GridFS、圖片與病歷要有可核對的資產關聯。

另有較低優先的資料語意問題：`records.js:1075` 在寄送成功時把 `pdfGeneratedAt` 改成寄送時間。應保留產檔時間，使用 `sentAt` 表示寄送，避免稽核資訊混淆。

### 5.4 量測後再優化查詢及前端載入

| 項目 | 現況 | 建議驗證與改善 |
| --- | --- | --- |
| 掛號查詢 | 常依 `date` 篩選；schema 主要有 scheduledAt 索引 | 以真實資料量跑 explain，評估 `{date, time, _id}` 或符合實際排序的索引 |
| PDF 領取工作 | 查 status、pdfStatus、pdfAttemptedAt | 量測 queue 掃描成本，再選擇複合／partial index |
| 全域搜尋 | 不分大小寫包含搜尋，且先取最多 8 位 owner 再找其 pets | 分開處理 owner 顯示上限與 pet 關聯搜尋語意，量測大資料的 regex 掃描 |
| 寄送歷程 | queued 篩選先取所有已解決 attemptId，再用 `$nin` | 大量歷史資料時改為可索引的當前嘗試狀態或限制聚合範圍 |
| 儀表板 | 多個全表計數及 facet | 先量測 p95／掃描量，必要時短時間快取，確保不影響工作台即時資料 |
| 前端首頁 | Dashboard chunk 540.95 kB，圖表雖已採模組化 import 仍大 | 分析 bundle，評估圖表延遲載入與骨架畫面，不直接調高警告門檻掩蓋 |

本次沒有真實資料庫 explain、負載測試或瀏覽器效能 trace，因此不推估吞吐量或宣稱已確認資料庫效能瓶頸。

### 5.5 補上發布與維運證據

建議建立 CI：前後端單元測試、server lint、client lint／Vue 檢查、正式建置、套件稽核、隔離 replica set 整合測試及修復後的瀏覽器測試。將禁用原生 dialog／日期 input 與 UTF-8 掃描納入自動檢查。

目前未見 repository 內的 CI workflow；平台端可能另有設定，本次未驗證。建議將 Node 版本明確記錄並與 Docker Node 22 對齊，避免本機 Node 24 通過就推論容器必然通過。

部署面需確認 `trust proxy=1` 與實際代理拓撲一致，並確認後端不能被繞過代理直連。是否能偽造 IP 取決於部署，不在缺乏環境證據時列為已成立漏洞。[Express 官方說明](https://expressjs.com/en/guide/behind-proxies/)

為既有單實例部署加入 requestId、背景工作耗時／重試／失敗指標與結構化錯誤，建立備份還原演練。`connectDB()` 啟動時會做資料更新、dropIndex 與 `Pet.syncIndexes()`；建議逐步改成可追蹤、可回滾的版本化 migration，部署前先核對索引變更。

## 6. 執行順序與驗收門檻

| 階段 | 工作 | 完成條件 |
| --- | --- | --- |
| 第一批：阻止資料遺失與錯置 | F01、F02、F03、F05；同步修 F10 | 圖片不誤報已存、不誤刪共用資產、有效碼唯一、完成就診不能繞入口修改 |
| 第二批：一致性與撤權 | F04、F06、F07 | socket 撤權有明確上限；並發結案測試通過；歷史網頁與 PDF 使用同一快照 |
| 第三批：復原與正確性 | F08、F09、F11–F14 | 重啟可自行復原、資產可回收、關聯不懸空、統計／日期／受限儲存測試通過 |
| 持續進行：發布保護 | F15、CI、真實 replica set／PDF 整合 | 主要瀏覽器流程全綠，至少驗證交易回滾及並發場景，再作正式發布判斷 |
| 後續整理 | 服務拆分、權限需求、查詢與 bundle 優化 | 有具體指標與驗收，再決定工作量，避免無目標重構 |

建議的最低回歸矩陣：

1. 圖片：待上傳、自動儲存、離頁、部分上傳失敗、修訂共用、刪除及清理重試。
2. 就診：各狀態的所有修改入口、舊版本覆寫、結案與同步並發、重開核准。
3. 身分：短碼碰撞及重複提交、HTTP／socket 到期與撤銷、角色分工的伺服器規則。
4. PDF：產生中中止、快速重啟、過期 lease、檔案遺失、刪除與背景工作交錯。
5. UI：受限 storage、切換病患、跨頁與跨裝置更新、兩支完整 smoke workflows。

工期應在資產模型、短碼 UX 及歷史快照遷移規則確認後估算。本建議書以相依性與驗收門檻安排順序，不以未經團隊評估的天數承諾代替排程。

## 7. 隔離重現紀錄摘要

下列輸出來自本次對原函式／路由的受控執行，使用虛構識別碼及記憶體資料；未接觸真實病例。

```text
F01 pending-image-autosave:
  pendingImages=1, persistedImages=0, dirty=false, state=saved

F02 shared-image-delete:
  source、deletingRevision、removingFromRevision 皆包含同一 publicId

F03 duplicate-code-model-validation:
  [accepted, accepted]
  index={intakeVerificationCode:1,intakeVerificationExpiresAt:1}, unique 未設定

F04 session-revocation:
  httpSessionAfterRevoke=null
  socketReceivedAfterRevoke=review-only

F05 completed-appointment-write:
  workflow-route-rule=409
  clinical-note-route=200, visitNote=changed-after-completed,
  deskCompletedAtPresent=true

F10 upload-failure-retry:
  expectedVersions=[0,0], dbVersion=1, localVersion=0,
  error=version conflict

F12 dashboard-pending:
  input=[{_id:pending_checkout,count:3}]
  output={scheduled:0,arrived:0,completed:0,cancelled:0,no_show:0}

F13 invalid-date/time:
  2026-02-31 10:00 -> 2026-03-03T02:00:00.000Z
  2026-09-21 99:99 -> 2026-09-24T20:39:00.000Z

F14 storage-module-import:
  SecurityError: Storage blocked
```

F06 的並發交錯、F08 的完整重啟復原及 F09 的真實 GridFS 清理，仍需隔離 MongoDB replica set／PDF 整合環境驗證。既有測試全綠與本次發現並不矛盾：多數缺口位於跨入口、外部資產及故障復原，超出現有單元測試斷言範圍。

# IDEXX 檢驗結果串接（InterLink）

把診所 IDEXX 院內檢驗儀的結果自動收進系統。這份文件涵蓋原理、診所端與 IDEXX 主機的設定、抓檔程式的部署、本機測試方式與排查。資料模型與 API 的規格見 CLAUDE.md 第二節 `labResults` 與第五節。

> 最後更新：2026-09-30。**解析、系統收檔、抓檔程式已完成並在本機驗證；開機自動執行（排程工作）與心跳已完成；自動歸檔、畫面、PDF 尚未實作**，見第 8 節。

## 1. 原理

IDEXX **不開放 API**。它給看診軟體廠商的串接方式是 **IDEXX InterLink**：一支 Windows 常駐程式，裝在跟 IDEXX 主機（IDEXX VetLab Station，觸控螢幕那台）同一個區網的電腦上，把雙方的溝通轉成**資料夾裡的 XML 檔案**。

系統部署在 Zeabur 雲端，讀不到診所電腦的資料夾，所以中間要多一支我們自己寫的**抓檔程式**（`bridge/`），跑在同一台電腦上：

```
【診所區網內】                                          【網際網路】
檢驗儀 → IDEXX 主機 ──區網──→ InterLink 電腦                    系統（Zeabur）
                              ├ InterLink：收結果、存成檔案
                              └ 抓檔程式：盯資料夾、上傳 ──────→ POST /api/lab-results/import
```

- **IDEXX 主機 ↔ InterLink 電腦一定要在同一個區網**：Auto-Detect 靠區網廣播找對方，出不了路由器。IDEXX 建議用網路線、避免 WiFi。
- **抓檔程式 ↔ 系統只要能上網**：系統可以繼續放在雲端。
- IDEXX 主機是封閉機器，不能在上面裝任何程式，所以一定要另外一台 Windows 電腦。

### 三個資料夾（InterLink 安裝時的預設位置）

| 用途 | 方向 | 預設路徑 | 誰寫入 → 誰讀取 |
|---|---|---|---|
| **XML 結果**（數值、參考範圍、貓名） | IDEXX → 系統 | `C:\IDEXX Interlink\Results\Data\` | InterLink → 抓檔程式 |
| **PDF 報告**（IDEXX 印出來的那張） | IDEXX → 系統 | `C:\IDEXX Interlink\Results\Reports\` | InterLink → 抓檔程式（尚未實作） |
| **報到／離院通知**（Census） | 系統 → IDEXX | `C:\IDEXX Interlink\Requests\` | 抓檔程式 → InterLink（尚未實作） |

安裝程式另外會建 `C:\IDEXX Interlink\Reference Lab\Results\{Data,Reports}`，那是 IDEXX **外送實驗室**的結果，要向 IDEXX 申請帳密才會啟用；文件註明不是每個國家都有，目前不處理。

`Requests` 裡的檔案由 **InterLink 自己清理**（收到同一隻貓的離院通知時，把報到與離院兩份一起刪），抓檔程式只放不刪。

## 2. 診所端設定：InterLink 電腦

1. **安裝 InterLink**（`IDEXX_Inhouse_Interlink_Standalone_Application.exe`，約 267MB，2013 年版；能向 IDEXX 要到較新版更好）。安裝時：
   - Integrate with IDEXX VetLab Station → **Yes**
   - **Auto-Detect**
   - 名稱：維持 `InterLink` 或改成系統名稱，**12 字以內、建議英文**（會顯示在 IDEXX 主機首頁的圖示上，中文不一定顯示得出來）
   - 三個資料夾：**全部維持預設**（見上表）。維持預設，遠端教學與排查時講的路徑才會一致。
2. **確認設定畫面**（雙擊右下角 InterLink 圖示 → IDEXX VetLab Station 分頁）：
   - IDEXX VetLab Station Connection：**On (Auto-Detect)**
   - Save XML messages：**Yes**
   - Send Work Request/Census Messages：**Yes**（之後自動歸檔要用）
3. **防火牆**：第一次開啟時若 Windows 跳出詢問，按「允許」。電腦的網路要設成**私人網路**，設成公用網路會擋掉區網廣播，圖示會一直是黃色。這是最常見的卡關點。
4. **電腦要保持「已登入」**：InterLink 是登入 Windows 後才自動啟動的程式，不是背景服務。停在登入畫面時它不會跑。（抓檔程式裝成排程工作後開機就會跑，不受影響；但 InterLink 沒跑就不會有新檔案。）
5. **輸出資料夾不要放在 OneDrive 等同步資料夾底下**：同步會暫時鎖檔、或只留雲端佔位檔，抓檔程式會讀不到。

InterLink 圖示顏色：**綠＝已連線、黃＝找不到 IDEXX 主機、紅＝有問題（看 Manage Connections 分頁的說明）、灰＝停用**。InterLink 自己的 log 在 `C:\ProgramData\IDEXX Interlink\rolling.log`。

## 3. 診所端設定：IDEXX 主機

建議請 **IDEXX 業務或技術人員**處理。操作畫面見 IDEXX 的《How to connect IVLS using InterLink Application》（2 頁，每一步都有截圖）。

1. **開通 SmartService**：IDEXX 的遠端服務，InterLink 連線的前提。IDEXX 主機要能上網；Settings 畫面有 SmartService 分頁可看狀態，但開通要**聯絡 IDEXX**（Programmer's Guide 列的號碼是「Asia 0800-291-018」，最保險是直接問 IDEXX 業務）。很多診所裝儀器時已經開好，先請診所拍 SmartService 分頁確認。
2. **Settings → Practice Management 分頁 → 選「Other」→「Network Connection」→ OK。**
   **一台 IDEXX 主機只能接一套看診軟體**（選項是 Cornerstone／Other／None 三選一），已經接了別家要先處理。
3. 首頁會出現 `InterLink` 圖示（Not Ready）→ **點它，設定「Do not transmit records created before」的日期**。選今天或昨天，免得幾年份的舊結果一次全部傳過來。
4. **Instruments → Practice Management 分頁 → 選「On (Transmit result records and report)」。**
5. IDEXX 主機上的 InterLink 圖示變成**綠色 Ready**、電腦右下角圖示也變綠，就是接通了。

### 驗收（不用浪費試劑）

用 Instruments → Practice Management 分頁的 **Resend**，或把第 3 項的日期往前調，讓 IDEXX 主機補傳最近做過的檢驗。然後檢查 `Results\Data\` 有沒有出現 XML、`Results\Reports\` 有沒有 PDF。**到這裡為止是診所與 IDEXX 的部分**，之後才輪到抓檔程式。

## 4. 系統端設定（正式環境）

在 Zeabur 服務的 Variables 加上：

```dotenv
IDEXX_BRIDGE_TOKEN=<至少 32 字元的隨機字串>
```

- 抓檔程式設定檔的 `token` 要填**同一個值**。
- 沒設或少於 32 字元時上傳 API 整個關閉（回 503）。忘了設的時候寧可收不到，也不能讓任何人都能往系統裡丟檔案。
- 產生隨機值：`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`。
- 懷疑外洩就換一組，兩邊一起改；伺服器改完要重新部署或重啟。

## 5. 抓檔程式部署（診所電腦）

`bridge/` 獨立於 server、**不裝任何套件**（不用跑 `npm install`），只有它要放到診所那台裝了 InterLink 的電腦上，`server`、`client` 都不用。

| 檔案 | 診所電腦要不要 |
|---|---|
| `idexxBridge.js` | 要，程式本體 |
| `package.json` | 要，`npm start`／`npm run check` 靠它，心跳回報的版本號也從這裡讀 |
| `install.ps1`、`uninstall.ps1`、`status.ps1` | 要，安裝成開機自動執行、移除、遠端查看狀態 |
| `idexx-bridge.config.json` | 要，**在診所電腦上另外建**（見第 3 步） |
| `idexx-bridge.config.example.json` | 可有可無，只是範本 |
| `idexxBridge.test.js` | 不需要，開發用的測試，放了也不影響 |

開發者不在診所，實務上是**遠端桌面連進那台電腦自己裝**：

1. 安裝 **Node.js 20 以上**，用**官方安裝程式**（https://nodejs.org，LTS 版）。不要用 nvm：它裝在個人資料夾，換版本或移除使用者時排程工作會跟著失效。
2. 把 `bridge/` 壓成 zip，用遠端桌面工具的檔案傳輸放過去，解壓到例如 `C:\IDEXX Bridge\`。**不要放在 OneDrive 底下。**
3. 複製 `idexx-bridge.config.example.json` 成 `idexx-bridge.config.json`，填入：

   ```json
   {
     "serverUrl": "https://正式網址",
     "token": "跟 Zeabur 的 IDEXX_BRIDGE_TOKEN 相同",
     "resultsDir": "C:\\IDEXX Interlink\\Results\\Data",
     "pollSeconds": 10,
     "settleSeconds": 3,
     "failAfterMinutes": 30,
     "heartbeatSeconds": 60,
     "name": "櫃台電腦"
   }
   ```

   `name` 是系統上顯示的名稱，可省略（省略就用電腦名稱）。這個檔案含密鑰，已列在 `.gitignore`，不進版控。**密鑰在診所電腦上直接貼進去**：不要打包在 zip 裡，也不要用 LINE、Email 傳給診所人員。
4. 先檢查：在該資料夾執行 `npm run check`。要看到「✔ 伺服器連線與密鑰正確」與「✔ 資料夾存在」兩行。
5. 安裝成開機自動執行：**以系統管理員身分**開啟 PowerShell，切到該資料夾執行

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

   它會再檢查一次（沒通過就不裝），然後建立排程工作「IDEXX Bridge」並立刻啟動：
   - 用 **SYSTEM 帳號**執行：開機就跑、**不用等人登入**，也沒有視窗可以誤關。
   - 除了開機，**每 5 分鐘也會叫一次**：已經在跑就不重複開，萬一停了最慢 5 分鐘內會被叫起來。另外設了失敗後每分鐘重試。
   - 改了設定檔或換了 Node.js 版本，再跑一次 `install.ps1` 就是重新安裝。
6. 確認：執行 `powershell -ExecutionPolicy Bypass -File .\status.ps1`，看排程工作狀態是 Running、log 有「開始監看 …」。系統上 `GET /api/lab-results/bridge-status` 會看到這台的心跳（畫面尚未實作）。

**同一個資料夾不要同時跑兩份**：裝了排程工作之後，就不要再另外開視窗 `npm start`。兩份會搶同一個檔案，雖然伺服器會判斷成重複、不會多存，但會在 log 留下搬檔失敗的錯誤。

移除：以系統管理員身分執行 `uninstall.ps1`。只移除排程工作，程式、設定檔、log、已上傳的檔案都不會刪。

三支 `.ps1` 都存成 **UTF-8 with BOM**。Windows 內建的 PowerShell 5.1 沒有 BOM 就不會用 UTF-8 讀，中文訊息會變亂碼。修改後要維持這個編碼。

### 要跟診所人員交代的

診所人員不需要懂抓檔程式，只要知道：

- 那台電腦**不要關機**；**也不要登出**，因為 InterLink 是 IDEXX 的程式，要登入 Windows 後才會跑（抓檔程式開機就會跑，不受影響）。重開機後要登入回桌面。
- 發現 IDEXX 的結果沒進系統時，先看右下角 InterLink 圖示是不是綠色，再聯絡開發者（排查見第 9 節）。

### 抓檔程式的規則

| 情況 | 處理 |
|---|---|
| 檔案還在寫入（大小或修改時間還在變、或還沒靜止 `settleSeconds`） | 先不動，下一輪再看 |
| 伺服器收下（201 created／200 duplicate、updated、stale、ignored） | 移到 `已上傳\年-月\`，同名時檔名加時間 |
| 伺服器說不完整或看不懂（400／422） | 留著重試；超過 `failAfterMinutes` 還是一樣，移到 `無法讀取\` 等人處理 |
| 連不上、密鑰錯、伺服器錯誤（0／401／503／5xx） | 留在原地，這一輪先停，下一輪再試 |

- **檔案絕不刪除**。
- 依修改時間**舊到新**上傳：IDEXX 的更正版比原始版晚寫出來，順序對了伺服器才不會當成過期。
- 抓檔程式**不解析 XML**，原檔照送，編碼由伺服器判斷。解析規則要改只改伺服器，不必動診所電腦。
- log 寫進 `idexx-bridge.log`（跟程式同一個資料夾，超過 5MB 換成 `.old`；前景 `npm start` 時也會印在視窗上）。同一個錯誤只在第一次出現與恢復時各記一次。
- 每 `heartbeatSeconds`（預設 60 秒）送一次心跳：電腦名稱、版本、還留在資料夾的 XML 數、最後一次上傳成功的時間、目前的錯誤。

## 6. 系統收到之後

`POST /api/lab-results/import` 解析 XML（`server/src/lib/idexxResult.js`）存進 `labResults`，同一次檢驗以 **`diagnosticSetId`＋`instrument`** 識別：

| 收到的 | 系統怎麼做 | 回應 |
|---|---|---|
| 第一次收到 | 新增一筆，`petId` 空的（待配對） | 201 `created` |
| 內容一樣（IDEXX 的 Resend、抓檔程式重試） | 只加 `receiveCount` | 200 `duplicate` |
| 內容不同、訊息較新（Replace／Restore） | 覆寫內容、記 `revisedAt`，配對欄位不動 | 200 `updated` |
| 內容不同、但訊息比已存的舊 | 不採用 | 200 `stale` |
| 不是檢驗結果（例如開單完成訊息） | 不處理，讓抓檔程式歸檔 | 200 `ignored` |
| 檔案不完整、看不懂 | 不存 | 422 |

目前可以用 `GET /api/lab-results`（登入後）看待配對的結果；畫面尚未實作。

## 7. 本機測試（沒有 IDEXX 主機）

抓檔程式分不出檔案是 InterLink 寫的還是手動丟的，所以手動丟檔就能測完 InterLink 之後的整條路。

1. `server/.env` 加上 `IDEXX_BRIDGE_TOKEN=<32 字元以上>`，**重啟後端**（nodemon 不會因為 `.env` 變動自動重啟）。
2. 確認後端讀到了：不帶密鑰 POST `http://localhost:3000/api/lab-results/import` 應該回 **401**（503＝還沒讀到設定）。
3. `bridge/idexx-bridge.config.json` 的 `serverUrl` 填 `http://localhost:3000`、`token` 同上、`resultsDir` 填 `C:\IDEXX Interlink\Results\Data`（本機也裝了 InterLink 的話）或任意本機資料夾。
4. `bridge` 資料夾執行 `npm start`。
5. 把範例 XML 複製進 `resultsDir`：repo 的 `server/test/fixtures/idexx/`，或本機的 `C:\IDEXX Interlink\測試用範例\`。約 10 秒後視窗顯示「已上傳 …（created／duplicate）」，檔案移到 `已上傳\年-月\`。
6. 想看失敗情境：先關後端再丟檔（會顯示「暫時無法上傳，會自動重試」，後端開回來後自動補傳）；或丟一個亂打的 `.xml`（30 分鐘後移到 `無法讀取\`）。

在自己電腦裝 InterLink 只為了熟悉設定畫面與預設路徑：沒有 IDEXX 主機時它不會產生任何檔案，圖示會一直是黃色。它預設開機自動啟動，不用時從「新增或移除程式」解除。

自動測試：後端 `npm test`（解析用 `server/test/fixtures/idexx/` 的真實範例）、`bridge/` 的 `npm test`（會在系統暫存資料夾實際搬檔案，不需要伺服器）。

## 8. 待辦與尚未確認的事

**尚未實作（依建議順序）**

1. **自動歸檔（Census 報到／離院通知）**：櫃台報到時系統產生報到通知（`patient_id` 帶貓咪的 `_id`），抓檔程式寫進 `Requests\`，InterLink 送到 IDEXX 主機，貓咪出現在主機的在院清單；技術員點選那隻貓跑檢驗，結果帶著同一個編號回來，系統直接歸檔。櫃台完成處理時送離院通知。**技術員若在 IDEXX 主機上自己新增病患、手打名字，結果不會帶編號**，所以手動配對不能拿掉，只是變少。
2. **畫面**：漏網結果的「待配對」面板（右側工具欄，拿 IDEXX 上的貓名比對今天在院的貓，唯一一隻就預選、人按確認）、貓咪詳情頁的「檢驗結果」頁籤。
3. **PDF 報告**上傳，依 IDEXX 文件，PDF 檔名是該次檢驗的 `diagnostic_set_id`。
4. **心跳的畫面**：心跳已經在收（`GET /api/lab-results/bridge-status`），還沒有畫面顯示「最後回報 N 分鐘前」，也還不會在離線時提醒。
5. **數值自動填進健檢報告**：表單設計器的檢驗項目要加「IDEXX 代號」對照（例如「腎臟功能（CRE）」↔ `CREA`），對到的才寫進看診的 `labValues`。

**要到診所實測才知道**

- 報到通知的**編碼**：IDEXX 給的報到範例是 **Big5**，中文貓名可能要用 Big5 送才不會在 IDEXX 主機上亂碼。實作時做成可切換。
- InterLink 2013 版在診所的 Windows 版本上能不能正常跑。
- SmartService 是否已開通、IDEXX 主機有沒有接別家看診軟體。

## 9. 排查

| 症狀 | 先看哪裡 |
|---|---|
| 電腦右下角 InterLink 圖示是黃色 | 防火牆有沒有允許、網路是不是「私人」、跟 IDEXX 主機是否同一台路由器；IDEXX 主機那邊第 3 節的第 2～4 項有沒有設 |
| 圖示綠色但 `Results\Data\` 沒有檔案 | IDEXX 主機 Instruments → Practice Management 是否選了 On；「Do not transmit records created before」的日期是不是設得太晚 |
| 有 XML 但系統沒收到 | 遠端連進去跑 `status.ps1` 看 log：401＝兩邊密鑰不一致；503＝伺服器沒設 `IDEXX_BRIDGE_TOKEN`；連不上＝電腦沒網路或 `serverUrl` 錯。`npm run check` 可以單獨測連線 |
| 檔案一直留在 `Results\Data\` 不動 | 抓檔程式沒在跑：`status.ps1` 看排程工作狀態；系統的 `bridge-status` 超過三分鐘沒心跳就是停了或電腦沒網路 |
| `status.ps1` 找不到排程工作 | 沒用系統管理員身分開 PowerShell（SYSTEM 的排程工作一般使用者看不到），或還沒跑 `install.ps1` |
| 檔案被移到 `無法讀取\` | 伺服器一直解析失敗：把檔案帶回來，用 `server/test/fixtures/idexx/` 的方式加成測試範例再修 `idexxResult.js` |
| 中文貓名是亂碼 | 看 XML 開頭宣告的 `encoding` 與實際編碼是否一致 |

## 10. IDEXX 格式的已知怪癖

以下都是真實範例檔裡看到的，已經在 `idexxResult.js` 處理、在測試裡釘住：

- **不符合它自己的 DTD**：Catalyst One 的輸出在 `<assay_result>` 裡夾了一段不屬於任何欄位的文字（`41`），所以解析時不驗證 DTD。
- **儀器名稱與項目代號比文件新**：文件（2013）沒列 `Catalyst_One`、`IDEXX_inVue_Dx`、`SDMA`，所以清單不寫死，沒見過的照收。
- **同一個「微」字有兩種碼位**：Catalyst 用 `µ`（U+00B5），inVue 用 `μ`（U+03BC），統一成後者。
- **結果不一定是數字**：SNAP 是 `Positive`／`Negative`，inVue 是整句判讀（`100-150 K/uL (Mildly decreased)`、`--.-- Result Suppressed. See below.`），一律存字串。
- **沒量體重時送 0**，當成沒有資料。
- **時間沒有時區**（`MM/DD/YYYY hh:mm:ss.sss AM|PM`，診所牆上時間），照台北時區換算。
- **直接在 IDEXX 主機上開單的檢驗**，`requisition_number` 與 `patient_id` 都是空字串。

## 11. 參考資料

IDEXX 提供的原始資料（安裝檔、PDF 文件、DTD、範例 XML）**不在 repo 裡**：安裝檔很大，文件也註明不得轉載。目前放在開發者電腦的 `Desktop\IDEXX 資料\InterLink\`：

- 《How to connect IVLS using InterLink Application Eng》：IDEXX 主機端設定，2 頁，有截圖
- 《IDEXX InterLink Programmer's Guide Appendix》：XML 格式（附錄 A）、物種代碼（B）、各儀器項目代號（C）、報告排序（D）
- 《InterLink Application Operator's Guide》：InterLink 電腦端設定
- `DTDs for InterLink.zip`：`result_20.dtd`、`census_20.dtd`、`work_request_20.dtd`、`acknowledgement_20.dtd`
- `xml sample\`：真實輸出範例，已複製（去識別）到 `server/test/fixtures/idexx/`

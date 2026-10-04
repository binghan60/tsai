# IDEXX 檢驗結果串接（InterLink）

把診所 IDEXX 院內檢驗儀的結果自動收進系統。這份文件涵蓋原理、診所端與 IDEXX 主機的設定、抓檔程式的部署、本機測試方式與排查。資料模型與 API 的規格見 CLAUDE.md 第二節 `labResults` 與第五節。

> 最後更新：2026-10-04。**已完成**：解析、系統收檔、抓檔程式、開機自動執行與心跳、表單的 IDEXX 代號、自動填進健檢報告、認不出貓時的「待確認」清單（工具欄「檢驗」）、跟醫師手打的值不同時的比對視窗。**已實作但預設關閉**：報到時送貓咪到 IDEXX 主機（Census，要到診所才能驗證，見第 7 節之後的「報到通知」）。**尚未實作**：報告上的 IDEXX 標記、PDF，見第 8 節。

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

### 四個角色各管一段

| 角色 | 在哪裡 | 誰寫的 | 只負責 |
|---|---|---|---|
| 動物系統（網站＋資料庫） | 雲端 | 我們 | 解析結果、填進健檢報告；把要送給 IDEXX 的通知組成 XML 排隊 |
| 抓檔程式（`bridge/`） | 診所的 InterLink 電腦 | 我們 | C 槽資料夾 ↔ 動物系統：結果檔原封上傳、通知原封寫進資料夾 |
| InterLink | 同一台電腦 | IDEXX | C 槽資料夾 ↔ IDEXX 主機 |
| IDEXX 主機 | 檢驗室 | IDEXX | 接儀器、跑檢驗 |

- **抓檔程式和 InterLink 彼此不認識**，唯一的交集是 `C:\IDEXX Interlink\` 底下的資料夾：像兩個郵差共用一個信箱，InterLink 管 IDEXX 那一段、抓檔程式管雲端那一段。
- **兩個方向都是抓檔程式主動連動物系統**，動物系統永遠不主動連進診所（診所的路由器、防火牆擋著，從外面連不進去）；網頁與雲端伺服器也都碰不到使用者電腦的 C 槽，這就是一定要有抓檔程式的原因。
- **抓檔程式不解析、不組 XML**：結果檔原檔照送，通知由伺服器組好、它原檔照寫。格式要改時只改雲端，不必請診所重裝。

兩個方向：

```
檢驗結果（已完成）
  IDEXX 主機驗完 → InterLink 存成 Results\Data\xxx.xml
  → 抓檔程式看到新檔、上傳 → 動物系統解析、填進健檢報告 → 抓檔程式把檔案移到「已上傳」

報到通知（已實作、預設關閉，見「報到通知」一節）
  櫃台按「報到」→ 動物系統在資料庫存一筆「待送出」的通知（已組好的 XML）
  → 抓檔程式每幾秒問「有沒有要送的？」→ 拿到後寫進 Requests\ → 回報「寫好了」
  → InterLink 送到 IDEXX 主機 → 貓咪出現在主機的在院清單
```

### 三個資料夾（InterLink 安裝時的預設位置）

| 用途 | 方向 | 預設路徑 | 誰寫入 → 誰讀取 |
|---|---|---|---|
| **XML 結果**（數值、參考範圍、貓名） | IDEXX → 系統 | `C:\IDEXX Interlink\Results\Data\` | InterLink → 抓檔程式 |
| **PDF 報告**（IDEXX 印出來的那張） | IDEXX → 系統 | `C:\IDEXX Interlink\Results\Reports\` | InterLink → 抓檔程式（尚未實作） |
| **報到／離院通知**（Census） | 系統 → IDEXX | `C:\IDEXX Interlink\Requests\` | 抓檔程式 → InterLink（預設關閉） |

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
| `install.ps1`、`uninstall.ps1`／`uninstall.cmd`、`status.ps1`／`status.cmd` | 要，安裝成開機自動執行、移除、查看狀態（`.cmd` 是點兩下用的） |
| `idexx-bridge.config.json` | 要，**在診所電腦上另外建**（見第 3 步） |
| `idexx-bridge.config.example.json` | 可有可無，只是範本 |
| `idexxBridge.test.js` | 不需要，開發用的測試，放了也不影響 |

### 最簡單：單一安裝檔

在開發電腦的 `bridge` 資料夾執行 `npm run build:installer`，產生 **`bridge/dist/IDEXX-Bridge-Setup.cmd`**（約 35 KB，`dist/` 不進版控）。把這一個檔案傳到診所電腦，**點兩下**：

1. 自動要求系統管理員權限（跳出的視窗按「是」）。
2. 找 Node.js；沒有就用 Windows 內建的 winget 自動安裝，裝不了才提示手動裝。
3. 依序問：系統網址、密鑰、InterLink 存結果的資料夾（預設 `C:\IDEXX Interlink\Results\Data`）、在系統上顯示的名稱（不填就用電腦名稱，一般直接按 Enter）。
4. 把程式放到 `C:\IDEXX Bridge`、寫好設定檔，檢查連線，建立開機自動執行的排程工作。

**全自動（建議）：先把設定放進安裝檔。** 在 `bridge` 資料夾照 `installer.preset.example.json` 建一份 `installer.preset.json`（不進版控），填正式網址與密鑰，再 `npm run build:installer`。這樣產生的安裝檔**不問任何問題**：診所點兩下、在 Windows 的權限視窗按一次「是」（這一步省不掉），就自動裝完，最後顯示綠色的「安裝完成」。可放的欄位：`serverUrl`、`token`（這兩個都有才會全自動），以及選填的 `resultsDir`（InterLink 沒照預設路徑裝時）、`name`（一般不要填，見下面）。前提是 InterLink 已經裝好，不然會停在「找不到結果資料夾」。

**有預設值的安裝檔裡有密鑰，等於一把鑰匙**：只傳給診所那台電腦，裝完就刪掉，不要放在群組或雲端硬碟。萬一外流：在 Zeabur 換一組 `IDEXX_BRIDGE_TOKEN`、改 `installer.preset.json`、重新產生再裝一次，舊的就失效。沒有 `installer.preset.json` 時，安裝檔不含密鑰、改成安裝時一題一題問。

**重複執行＝更新**：會帶出上次的設定（按 Enter 沿用；安裝檔裡有預設值時以預設值為準），用來更新程式或改設定。改了 `bridge` 裡的程式要重新 `npm run build:installer` 再傳一次。安裝檔會先停掉正在跑的抓檔程式（包含手動 `npm start` 開的）。

安裝流程在 `setupTemplate.ps1`，打包在 `buildInstaller.mjs`；最後一步呼叫的就是下面的 `install.ps1`。

### 手動安裝（安裝檔不能用時）

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

**移除：點兩下 `C:\IDEXX Bridge\uninstall.cmd`**（會自己要求管理員權限、跑完停住讓你看結果）。它會刪掉排程工作，**並直接結束正在跑的抓檔程式**——實測發現「停止排程工作」不一定會把已經在跑的程式關掉，工作刪了、程式還在背景繼續送心跳。程式、設定檔、log、已上傳的檔案都不會刪。移除後燈號約三、四分鐘才變紅。

**看狀態：點兩下 `C:\IDEXX Bridge\status.cmd`**（同樣自己要求管理員權限、停住）。不要用右鍵「用 PowerShell 執行」開 `.ps1`：那樣不是管理員、視窗一閃就關，看不到結果也做不了事。

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

### 自動填進健檢報告

健檢報告的檢驗數值存在「看診」上，報告是讀看診的值來顯示，所以系統把 IDEXX 的數值寫進那次看診，報告打開就有了（病歷日誌的「檢驗」那一行也會跟著出現）。收下結果後依序做三件事：

1. **認貓**：XML 裡的病患編號是系統裡某隻貓的編號（報到時送到 IDEXX 主機的編號會原樣帶回來），就是那隻。在 IDEXX 主機上手動新增的病患沒有編號，認不出來。
2. **找看診**：那隻貓、檢驗當天的掛號，排除取消與未到。當天有好幾筆時挑檢驗前最後報到的那筆；都還沒報到就不猜。
3. **填數值**：依那次看診選的健檢表單，拿每個檢驗項目的「IDEXX 代號」對照：
   - 格子是空的 → 填入
   - 已經有一樣的值 → 不動
   - 已經有**不一樣**的值 → **不蓋掉**，記下來讓醫師決定（見下面「跟醫師手打的值不同時」）
   - 儀器判定無結果或無效、或超過 40 字的整句判讀 → 不填
   - 表單上沒有這個代號 → 不填，記為「未對應」

上傳的回應裡的 `fill` 說明這次做到哪一步：`unmatched`（認不出貓）、`no_visit`（當天沒掛號）、`no_template`（看診沒選表單）、`applied`（已填入，附填了哪些）。找不到看診時，之後重送同一份檔案會再試一次。

### 跟醫師手打的值不同時

像 Windows 複製檔案遇到同名檔案時的「取代或略過」：跳出一個比對視窗，逐項列出「報告上目前 → IDEXX」，**預設全部不勾**（醫師手打的可能是刻意修正的），下面三個按鈕：

- **都不要**：全部保留報告上的值。
- **覆蓋勾選的（n）**：只換勾選的項目。
- **全部覆蓋**：全部換成 IDEXX 的值。

右上角 ✕＝稍後再說，不算處理。這個視窗出現在兩個地方，哪邊處理完另一邊就消失：

1. **打開那隻貓當天的健檢報告草稿時自動跳出**。按了稍後再說，「引用本次看診」下面會留一條黃色提示，按「逐項比對」再叫出來。
2. **工具欄「檢驗」面板**的「數值跟報告不同」段落（工具欄的紅色數字也算進去）。在待確認清單選了貓、填入時遇到不同的值，也會直接跳出來。

列出時跟看診**現在**的值重新比：醫師之後已經自己改成一樣、或清空的項目不再列出。已結案的報告不受影響。

### 認不出貓時：工具欄「檢驗」

報到通知（Census）做好之前，**真的 IDEXX 結果都不會帶系統的貓咪編號**；做好之後，技術員在 IDEXX 主機上手打名字時也不會帶。這些結果會出現在右側工具欄的「**檢驗**」（紅色數字＝有幾筆待確認），每一頁都有，醫師、櫃台都能處理：

1. 點開清單，點一筆進入確認畫面，會列出**檢驗當天的掛號**。IDEXX 上的名字跟某隻貓同名、而且只有一隻，就已經預先選好。
2. 不在當天掛號裡就按「搜尋其他貓咪」。不過當天沒掛號就沒有健檢報告可以填，系統會明白告訴你。
3. 按「**確認是○○並填入**」，就照上面同一套規則填進那隻貓當天的健檢報告。提示會說填了哪些、或為什麼沒填。
4. **選錯了**：按提示上的「復原」。系統只清掉**還是剛才填進去那個值**的欄位，已經被人改過的留著，結果回到清單。
5. **忽略**：IDEXX 的品管測試（QC）、練習用的檢驗不是任何一隻貓的，忽略後就不會再出現。

**表單要先設定 IDEXX 代號**：表單設計頁 → 點檢驗項目 → 「IDEXX 代號」欄位。多個代號用「、」分開（代號本身可能有空格，例如 `Bile acids Preprandial`，所以不能用空白分隔）。代號可以從收到的 XML 的 `assay_name` 查，或看 Programmer's Guide 附錄 C。同一份表單裡同一個代號只能填在一個項目。

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

## 報到通知：把貓咪送到 IDEXX 主機（已實作、預設關閉）

櫃台按「報到」後約 10 秒，貓咪出現在 IDEXX 主機首頁的在院清單；技術員從清單點那隻貓跑檢驗，結果帶著系統的貓咪編號回來，自動填進健檢報告、不用經過待確認清單。櫃台按「完成處理」（或取消、取消報到、標記未到）時送離院通知，貓咪從主機清單消失（InterLink 會把到院、離院兩份檔案一起刪）。

**伺服器設定**（Zeabur 環境變數，改了要重新部署）：

| 變數 | 值 | 說明 |
|---|---|---|
| `IDEXX_CENSUS_MODE` | `off`（預設）／`census`／`work_request` | `census`＝報到通知（Census_Notice）；`work_request`＝開單（Work_Request，IDEXX 台灣給的範例是這種，檢驗項目留空）。兩種在主機上看起來差在哪要現場試 |
| `IDEXX_CENSUS_ENCODING` | `big5`（預設）／`utf-8` | 中文貓名在主機上是亂碼就換另一種 |

**抓檔程式設定**：`idexx-bridge.config.json` 的 `requestsDir`（安裝檔會自動填 `C:\IDEXX Interlink\Requests`，資料夾不存在就留空、不送）。1.1.0 版以後才有這個功能，舊版要重新安裝。

**到診所的驗證步驟**（跟 IDEXX 的人一起）：

1. InterLink 設定裡「Send Work Request/Census Messages」是 **Yes**。
2. Zeabur 設 `IDEXX_CENSUS_MODE=census`，重新部署。
3. 掛號台報到一隻測試貓 → 約 10 秒後 `C:\IDEXX Interlink\Requests\` 出現一個數字檔名的 `.xml` → IDEXX 主機的在院清單出現這隻貓。
4. 檢查主機上的貓名、飼主名是不是亂碼；是的話改 `IDEXX_CENSUS_ENCODING=utf-8` 再試。
5. 從清單點這隻貓跑一個檢驗 → 結果應該**直接**填進健檢報告，不進「檢驗」的待確認清單。
6. 櫃台按「完成處理」→ 貓咪從主機清單消失。
7. 第 3 步主機沒出現：看 InterLink 的 log（`C:\ProgramData\IDEXX Interlink\rolling.log`）有沒有拒收的原因；或改 `IDEXX_CENSUS_MODE=work_request` 再試。

**本機可以驗證到哪裡**：設好 `IDEXX_CENSUS_MODE` 與抓檔程式的 `requestsDir`（本機隨便建一個資料夾也可以），報到一隻貓，看資料夾裡出現的 XML 內容對不對；InterLink 之後的事只能在診所驗證。**注意：這會寫入資料庫（每次報到、完成處理各一筆通知）。**

**排查**：`status.ps1` 會列出 Requests 資料夾裡有幾個檔案——在院內的貓各留一份是正常的，下班後還一大堆代表 InterLink 沒在處理；抓檔程式寫不進去或拿不到通知時，系統上的燈號會變黃、滑過去看得到原因。

## 8. 待辦與尚未確認的事

**尚未實作（依建議順序）**

1. **Census 報到／離院通知——程式已完成、預設關閉，剩到診所驗證**（步驟見上一節「報到通知」）。原本的規劃：櫃台報到時系統產生報到通知（`patient_id` 帶貓咪的 `_id`），抓檔程式寫進 `Requests\`，InterLink 送到 IDEXX 主機，貓咪出現在主機的在院清單；技術員點選那隻貓跑檢驗，結果帶著同一個編號回來，系統就自動填進報告。櫃台完成處理時送離院通知。**技術員若在 IDEXX 主機上自己新增病患、手打名字，結果不會帶編號**，要教診所從清單點選。
2. ~~待確認清單~~（已完成，見第 6 節）。原本規劃的貓咪詳情頁「檢驗結果」頁籤取消：使用者確認檢驗結果就是健檢報告的內容，不另外做一個地方。
3. **報告上的 IDEXX 標記**：填寫頁的檢驗欄位標出「來自 IDEXX」。（跟醫師手打的值不同時的比對視窗已完成，見第 6 節。）
4. **PDF 報告**上傳，依 IDEXX 文件，PDF 檔名是該次檢驗的 `diagnostic_set_id`。
5. ~~心跳的畫面~~（已完成）：工具欄「檢驗」面板標頭（關閉鈕左邊）每台診所電腦一顆燈號——綠燈「連線中」、黃燈「連線中，但上傳有問題」（附卡住的檔案數與錯誤）、紅燈「沒有回報，新的檢驗結果進不來」；滑鼠移到燈上才顯示這些說明與最後回報時間。離線時工具欄的「檢驗」按鈕亮紅色「!」。畫面每分鐘更新一次。診所下班關機後會顯示紅色，這是正常的。**換電腦或改了設定檔的 `name` 後，舊的那筆會一直亮紅燈：點那顆紅燈就能移除**（只有已經沒在回報的能移除）。系統用名稱認電腦、大小寫不同就算兩台，所以安裝檔的「顯示名稱」不要自己填電腦名稱，留空讓抓檔程式自己取。

**要到診所實測才知道**

- 報到通知的**編碼**：IDEXX 給的報到範例是 **Big5**，所以預設 Big5，可切成 UTF-8（`IDEXX_CENSUS_ENCODING`）。
- 報到通知用 **Census 還是開單（Work Request）**：兩種都做了（`IDEXX_CENSUS_MODE`），哪一種在主機上比較順要現場試。
- 飼主名稱放在哪個欄位：中文全名目前整個放 `last_name`，主機上顯示得怪再調整（`server/src/lib/idexxCensus.js`）。
- InterLink 2013 版在診所的 Windows 版本上能不能正常跑。
- SmartService 是否已開通、IDEXX 主機有沒有接別家看診軟體。

## 9. 排查

| 症狀 | 先看哪裡 |
|---|---|
| 電腦右下角 InterLink 圖示是黃色 | 防火牆有沒有允許、網路是不是「私人」、跟 IDEXX 主機是否同一台路由器；IDEXX 主機那邊第 3 節的第 2～4 項有沒有設 |
| 圖示綠色但 `Results\Data\` 沒有檔案 | IDEXX 主機 Instruments → Practice Management 是否選了 On；「Do not transmit records created before」的日期是不是設得太晚 |
| 有 XML 但系統沒收到 | 遠端連進去跑 `status.ps1` 看 log：401＝兩邊密鑰不一致；503＝伺服器沒設 `IDEXX_BRIDGE_TOKEN`；連不上＝電腦沒網路或 `serverUrl` 錯。`npm run check` 可以單獨測連線 |
| 工具欄「檢驗」亮紅色「!」、面板標頭是紅燈 | 抓檔程式超過三分鐘沒心跳：那台電腦關機、沒網路，或排程工作停了。遠端連進去跑 `status.ps1` |
| 檔案一直留在 `Results\Data\` 不動 | 抓檔程式沒在跑：`status.ps1` 看排程工作狀態；系統的「檢驗」面板會亮紅燈 |
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

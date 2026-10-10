# IDEXX 檢驗結果串接（InterLink）

把診所 IDEXX 院內檢驗儀的結果自動收進系統，以及反方向把貓咪送到 IDEXX 主機的待驗清單。這份文件是原理、診所端與 IDEXX 主機的設定、抓檔程式的部署、本機測試與排查；資料模型與 API 規格見 CLAUDE.md 第三節 `labResults` 與第六節。

**現況**

| 功能 | 狀態 |
|---|---|
| 收結果、解析、自動認貓、填進看診與健檢報告、待確認清單、數值比對視窗、填入狀態燈號 | 完成 |
| 抓檔程式（開機自動執行、心跳、單一安裝檔） | 完成 |
| 「送 IDEXX」：把貓咪送到 IDEXX 主機的待驗清單 | 程式完成、**預設關閉**，要到診所跟 IDEXX 一起驗證（第 8 節） |
| IDEXX 的 PDF 報告上傳、報告上標示「來自 IDEXX」 | 尚未實作（第 11 節） |

## 1. 原理

IDEXX **不開放 API**。它給看診軟體廠商的串接方式是 **IDEXX InterLink**：一支 Windows 常駐程式，裝在跟 IDEXX 主機（IDEXX VetLab Station，觸控螢幕那台）同一個區網的電腦上，把雙方的溝通轉成**資料夾裡的 XML 檔案**。

系統部署在雲端，讀不到診所電腦的資料夾，所以中間要多一支我們自己寫的**抓檔程式**（`bridge/`），跑在同一台電腦上：

```
【診所區網內】                                          【網際網路】
檢驗儀 → IDEXX 主機 ──區網──→ InterLink 電腦                    系統（雲端）
                              ├ InterLink：收結果、存成檔案
                              └ 抓檔程式：盯資料夾、上傳 ──────→ POST /api/lab-results/import
```

- **IDEXX 主機 ↔ InterLink 電腦一定要在同一個區網**：Auto-Detect 靠區網廣播找對方，出不了路由器。IDEXX 建議用網路線、避免 WiFi。
- **抓檔程式 ↔ 系統只要能上網**。
- IDEXX 主機是封閉機器，不能裝任何程式，所以一定要另外一台 Windows 電腦。

### 四個角色各管一段

| 角色 | 在哪裡 | 誰寫的 | 只負責 |
|---|---|---|---|
| 動物系統（網站＋資料庫） | 雲端 | 我們 | 解析結果、填進看診；把要送給 IDEXX 的通知組成 XML 排隊 |
| 抓檔程式（`bridge/`） | 診所的 InterLink 電腦 | 我們 | C 槽資料夾 ↔ 動物系統：結果檔原封上傳、通知原封寫進資料夾 |
| InterLink | 同一台電腦 | IDEXX | C 槽資料夾 ↔ IDEXX 主機 |
| IDEXX 主機 | 檢驗室 | IDEXX | 接儀器、跑檢驗 |

- **抓檔程式和 InterLink 彼此不認識**，唯一的交集是 `C:\IDEXX Interlink\` 底下的資料夾。
- **兩個方向都是抓檔程式主動連動物系統**，動物系統永遠不主動連進診所（路由器、防火牆擋著）。
- **抓檔程式不解析、不組 XML**：結果檔原檔照送，通知由伺服器組好、它原檔照寫。格式要改只改雲端，不必請診所重裝。

```
檢驗結果
  IDEXX 主機驗完 → InterLink 存成 Results\Data\xxx.xml
  → 抓檔程式看到新檔、上傳 → 動物系統解析、填進看診 → 抓檔程式把檔案移到「已上傳」

送 IDEXX（預設關閉）
  醫師或櫃台按「送 IDEXX」→ 動物系統存一筆待送的通知（已組好的 XML）
  → 抓檔程式每 10 秒來拿 → 寫進 Requests\ → 回報寫好了
  → InterLink 送到 IDEXX 主機 → 貓咪出現在主機的清單
```

### InterLink 的資料夾（安裝時的預設位置）

| 用途 | 方向 | 預設路徑 | 誰寫入 → 誰讀取 |
|---|---|---|---|
| **XML 結果**（數值、參考範圍、貓名） | IDEXX → 系統 | `C:\IDEXX Interlink\Results\Data\` | InterLink → 抓檔程式 |
| **PDF 報告**（IDEXX 印出來的那張） | IDEXX → 系統 | `C:\IDEXX Interlink\Results\Reports\` | 目前不處理 |
| **到院／離院通知** | 系統 → IDEXX | `C:\IDEXX Interlink\Requests\` | 抓檔程式 → InterLink |

安裝程式另外會建 `C:\IDEXX Interlink\Reference Lab\Results\{Data,Reports}`，那是 IDEXX **外送實驗室**的結果，要另外向 IDEXX 申請，不處理。`Requests` 裡的檔案由 **InterLink 自己清理**（收到同一隻貓的離院通知時把兩份一起刪），抓檔程式只放不刪。

## 2. 診所端設定：InterLink 電腦

1. **安裝 InterLink**（`IDEXX_Inhouse_Interlink_Standalone_Application.exe`，約 267MB，2013 年版；能向 IDEXX 要到較新版更好）：
   - Integrate with IDEXX VetLab Station → **Yes**
   - **Auto-Detect**
   - 名稱：維持 `InterLink` 或改成系統名稱，**12 字以內、建議英文**（會顯示在 IDEXX 主機首頁的圖示上）
   - 三個資料夾：**全部維持預設**，遠端排查時講的路徑才會一致。
2. **確認設定畫面**（雙擊右下角 InterLink 圖示 → IDEXX VetLab Station 分頁）：
   - IDEXX VetLab Station Connection：**On (Auto-Detect)**
   - Save XML messages：**Yes**
   - Send Work Request/Census Messages：**Yes**（送 IDEXX 要用）
3. **防火牆**：第一次開啟時 Windows 跳出詢問按「允許」。網路要設成**私人網路**，公用網路會擋掉區網廣播、圖示一直是黃色——最常見的卡關點。
4. **電腦要保持已登入**：InterLink 是登入 Windows 後才啟動的程式，不是背景服務。（抓檔程式開機就跑，不受影響；但 InterLink 沒跑就不會有新檔案。）
5. **輸出資料夾不要放在 OneDrive 等同步資料夾底下**：同步會暫時鎖檔、或只留雲端佔位檔。

InterLink 圖示：**綠＝已連線、黃＝找不到 IDEXX 主機、紅＝有問題（看 Manage Connections 分頁）、灰＝停用**。log 在 `C:\ProgramData\IDEXX Interlink\rolling.log`。

## 3. 診所端設定：IDEXX 主機

建議請 **IDEXX 業務或技術人員**處理，操作畫面見《How to connect IVLS using InterLink Application》。

1. **開通 SmartService**（IDEXX 的遠端服務，InterLink 連線的前提）：IDEXX 主機要能上網；Settings 的 SmartService 分頁看得到狀態，開通要**聯絡 IDEXX**（Programmer's Guide 列的號碼是 Asia 0800-291-018，最保險是問 IDEXX 業務）。很多診所裝儀器時已經開好。
2. **Settings → Practice Management → 選「Other」→「Network Connection」→ OK。** 一台 IDEXX 主機只能接一套看診軟體（Cornerstone／Other／None 三選一），已經接了別家要先處理。
3. 首頁出現 `InterLink` 圖示（Not Ready）→ **點它，設定「Do not transmit records created before」**：選今天或昨天，免得幾年份的舊結果一次全部傳過來。
4. **Instruments → Practice Management → 選「On (Transmit result records and report)」。**
5. IDEXX 主機上的 InterLink 圖示變**綠色 Ready**、電腦右下角圖示也變綠，就接通了。

**驗收（不用浪費試劑）**：用 Instruments → Practice Management 的 **Resend**，或把第 3 項的日期往前調，讓主機補傳最近的檢驗，檢查 `Results\Data\` 有沒有出現 XML。到這裡是診所與 IDEXX 的部分，之後才輪到抓檔程式。

## 4. 系統端設定

伺服器環境變數：

```dotenv
IDEXX_BRIDGE_TOKEN=<至少 32 字元的隨機字串>
```

- 抓檔程式設定檔的 `token` 要填**同一個值**。
- 沒設或少於 32 字元時上傳 API 整個關閉（回 503）——寧可收不到，也不能讓任何人往系統裡丟檔案。
- 產生隨機值：`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`。
- 懷疑外洩就換一組，兩邊一起改；伺服器改完要重新部署。

## 5. 抓檔程式部署（診所電腦）

`bridge/` 獨立於 server、**不裝任何套件**，只有它要放到裝了 InterLink 的電腦上。

| 檔案 | 用途 |
|---|---|
| `idexxBridge.js` | 程式本體 |
| `package.json` | `npm start`／`npm run check`；心跳回報的版本號也從這裡讀 |
| `install.ps1`、`uninstall.ps1`／`.cmd`、`status.ps1`／`.cmd` | 安裝成開機自動執行、移除、查看狀態（`.cmd` 是點兩下用的） |
| `idexx-bridge.config.json` | 設定檔，含密鑰、不進版控（在診所電腦上建） |
| `idexx-bridge.config.example.json` | 設定範本 |
| `setupTemplate.ps1`、`buildInstaller.mjs` | 單一安裝檔的流程與打包 |
| `idexxBridge.test.js` | 開發用測試 |

### 單一安裝檔（建議）

在開發電腦的 `bridge` 資料夾執行 `npm run build:installer`，產生 **`bridge/dist/IDEXX-Bridge-Setup.cmd`**（約 35 KB，`dist/` 不進版控）。把這一個檔案傳到診所電腦，**點兩下**：

1. 自動要求系統管理員權限（按「是」）。
2. 找 Node.js；沒有就用 winget 自動安裝，裝不了才提示手動裝。
3. 依序問：系統網址、密鑰、InterLink 存結果的資料夾（預設 `C:\IDEXX Interlink\Results\Data`）、顯示名稱（一般直接按 Enter，用電腦名稱）。`Requests` 資料夾自動帶入（跟 Results 同一層，不存在就留空、不送）。
4. 把程式放到 `C:\IDEXX Bridge`、寫好設定檔、檢查連線，建立開機自動執行的排程工作。

**全自動**：在 `bridge` 資料夾照 `installer.preset.example.json` 建 `installer.preset.json`（不進版控），填正式網址與密鑰（`serverUrl`、`token`，選填 `resultsDir`），再 `npm run build:installer`。產生的安裝檔**不問任何問題**：診所點兩下、在權限視窗按一次「是」就裝完。前提是 InterLink 已經裝好。`name` 一般不要填——系統用名稱認電腦，大小寫不同就算兩台。

**含預設值的安裝檔裡有密鑰**：只傳給診所那台電腦，裝完就刪，不要放在群組或雲端硬碟。外流時換一組 `IDEXX_BRIDGE_TOKEN`、改 `installer.preset.json`、重新產生再裝一次。

**重複執行＝更新**：會帶出上次的設定（按 Enter 沿用）。改了 `bridge` 的程式要重新產生安裝檔再傳一次。安裝檔會先停掉正在跑的抓檔程式。

### 手動安裝（安裝檔不能用時）

開發者不在診所，實務上是遠端桌面連進那台電腦：

1. 安裝 **Node.js 20 以上**，用官方安裝程式（LTS 版）。不要用 nvm：它裝在個人資料夾，換版本或移除使用者時排程工作會跟著失效。
2. 把 `bridge/` 放到例如 `C:\IDEXX Bridge\`（**不要放在 OneDrive 底下**）。
3. 複製 `idexx-bridge.config.example.json` 成 `idexx-bridge.config.json`：

   ```json
   {
     "serverUrl": "https://正式網址",
     "token": "跟伺服器的 IDEXX_BRIDGE_TOKEN 相同",
     "resultsDir": "C:\\IDEXX Interlink\\Results\\Data",
     "requestsDir": "C:\\IDEXX Interlink\\Requests",
     "pollSeconds": 10,
     "settleSeconds": 3,
     "failAfterMinutes": 30,
     "heartbeatSeconds": 60
   }
   ```

   `name`（系統上顯示的名稱）可省略，省略就用電腦名稱。**密鑰在診所電腦上直接貼進去**，不要打包在 zip 裡，也不要用 LINE、Email 傳。
4. 執行 `npm run check`：要看到「✔ 伺服器連線與密鑰正確」與「✔ 資料夾存在」。
5. **以系統管理員身分**開 PowerShell，執行 `powershell -ExecutionPolicy Bypass -File .\install.ps1`。它會再檢查一次（沒通過就不裝），然後建立排程工作「IDEXX Bridge」並立刻啟動：
   - 用 **SYSTEM 帳號**執行：開機就跑、不用等人登入，也沒有視窗可以誤關。
   - 除了開機，**每 5 分鐘也叫一次**（已經在跑就不重複開），另外失敗後每分鐘重試。
   - 改了設定檔或換了 Node.js 版本，再跑一次 `install.ps1`。
6. 點兩下 `status.cmd` 確認：排程工作是 Running、log 有「開始監看 …」；系統的「檢驗」面板標頭出現這台電腦的綠燈。

**同一個資料夾不要同時跑兩份**：裝了排程工作之後就不要另外 `npm start`，兩份會搶同一個檔案。

**移除：點兩下 `uninstall.cmd`**：刪掉排程工作並結束正在跑的抓檔程式（只停排程工作不一定會關掉已經在跑的程式）。程式、設定檔、log、已上傳的檔案都不刪。移除後燈號約三、四分鐘才變紅。

**看狀態：點兩下 `status.cmd`**。不要用右鍵「用 PowerShell 執行」開 `.ps1`：不是管理員、視窗一閃就關。

`.ps1` 都存成 **UTF-8 with BOM**：Windows 內建的 PowerShell 5.1 沒有 BOM 就不用 UTF-8 讀，中文會變亂碼。

### 要跟診所人員交代的

- 那台電腦**不要關機、不要登出**（InterLink 要登入 Windows 後才會跑）。重開機後要登入回桌面。
- IDEXX 的結果沒進系統時，先看右下角 InterLink 圖示是不是綠色，再聯絡開發者。

### 抓檔程式的規則

| 情況 | 處理 |
|---|---|
| 檔案還在寫入（大小或修改時間還在變、或還沒靜止 `settleSeconds`） | 先不動，下一輪再看 |
| 伺服器收下（201 created／200 duplicate、updated、stale、ignored） | 移到 `已上傳\年-月\`，同名時檔名加時間 |
| 伺服器說不完整或看不懂（400／422） | 留著重試；超過 `failAfterMinutes` 移到 `無法讀取\` 等人處理 |
| 連不上、密鑰錯、伺服器錯誤（0／401／503／5xx） | 留在原地，這一輪先停，下一輪再試 |

- **檔案絕不刪除**。
- 依修改時間**舊到新**上傳（IDEXX 的更正版比原始版晚寫出來）；一輪最多 20 份、兩份之間隔 0.2 秒（`maxFilesPerRound`、`uploadGapMs`）。
- 不解析 XML，原檔照送，編碼由伺服器判斷。
- 有 `requestsDir` 時每一輪也去拿待送的通知：先寫在旁邊的 `.idexx-bridge-tmp\` 再搬進 `Requests\`（InterLink 不會讀到寫一半的檔案），寫好後回報。
- log 寫進程式資料夾的 `idexx-bridge.log`（超過 5MB 換成 `.old`）。同一個錯誤只在第一次出現與恢復時各記一次。
- 每 `heartbeatSeconds`（預設 60 秒）送一次心跳：名稱、版本、還留在資料夾的 XML 數、最後一次上傳成功的時間、目前的錯誤。

## 6. 系統收到之後

`POST /api/lab-results/import` 解析 XML（`server/src/lib/idexxResult.js`）存進 `labResults`，同一次檢驗以 **`diagnosticSetId`＋`instrument`** 識別：

| 收到的 | 系統怎麼做 | 回應 |
|---|---|---|
| 第一次收到 | 新增一筆 | 201 `created` |
| 內容一樣（Resend、抓檔程式重試） | 只加 `receiveCount` | 200 `duplicate` |
| 內容不同、訊息較新（更正版） | 覆寫內容、記 `revisedAt`，配對欄位不動 | 200 `updated` |
| 內容不同、但訊息比已存的舊 | 不採用 | 200 `stale` |
| 不是檢驗結果（例如開單完成訊息） | 不處理，讓抓檔程式歸檔 | 200 `ignored` |
| 檔案不完整、看不懂 | 不存 | 422 |

上傳一份一份排隊處理、至少隔 0.25 秒；「檢驗清單有更新」的廣播 3 秒內合併成一次。IDEXX 主機補傳歷史紀錄時會一口氣進來幾百份，不節流的話每台開著的瀏覽器都跟著重讀，會把伺服器拖垮。

### 自動填進看診與健檢報告

檢驗數值存在「看診」上，健檢報告草稿與病歷日誌都讀看診的值，所以系統把 IDEXX 的數值寫進那次看診，報告打開就有。收下結果後：

1. **認貓**：XML 裡的病患編號是系統裡某隻貓的編號（送 IDEXX 時送出的編號會原樣帶回來），**而且那隻貓檢驗當天有看診**，就是那隻。在 IDEXX 主機上手動新增的病患沒有編號，認不出來。
2. **找看診**：那隻貓檢驗當天的掛號，排除取消與未到。當天有好幾筆時挑檢驗前最後報到的那筆；都還沒報到就不猜。
3. **填數值**：依那次看診選的健檢表單，拿每個檢驗項目的「IDEXX 代號」對照：
   - 格子是空的 → 填入
   - 已經有一樣的值 → 不動
   - 已經有**不一樣**的值 → **不蓋掉**，記下來讓醫師決定（見下面）
   - 儀器判定無結果或無效、或超過 40 字的整句判讀 → 不填
   - 表單上沒有這個代號 → 不填（全血檢常比表單項目多，這是常態，不算問題）

回應的 `fill` 說明做到哪一步：`unmatched`（認不出貓，或那隻貓當天沒有看診）、`no_template`（看診沒選表單，只記關聯）、`applied`（已填入）、`error`（填入失敗，檔案已經存好）。之後那隻貓的掛號建立、報到、修改掛號或建立報告草稿時，會自動把還沒套用的結果補認、補填。

IDEXX 送更正版時會重新比一次：看診上還是上一版自動填的值就換成更正後的，醫師改過的不動。看診已完成或報告已結案時照樣填進看診（病歷日誌是事後更正的地方），但提示「數值沒有進報告」。

### 跟報告上的值不同時

像 Windows 複製檔案遇到同名檔案時的比對視窗：逐項列「報告上目前 → IDEXX」，附參考範圍、單位與偏高偏低，**預設全部不勾**（醫師手打的可能是刻意修正的）：

- **都不要**：全部保留報告上的值。
- **覆蓋勾選的（n）**：只換勾選的項目。
- **全部覆蓋**：全部換成 IDEXX 的值。

✕＝稍後再說，不算處理。按下去後的提示可以「復原」。視窗出現在：

1. **打開連著看診的健檢報告草稿時自動跳出**；按了稍後再說，之後從「引用本次看診」那一條的填入狀態燈號再開。
2. **工具欄「檢驗」面板**的「數值跟報告不同」段落（工具欄的數字也算進去）。

哪邊處理完另一邊就消失。列出時跟看診**現在**的值重新比，醫師之後已經自己改成一樣或清空的不再列出。已結案的報告不受影響。

### 填入狀態燈號

診療台「檢驗報告」標題旁、健檢報告填寫頁「引用本次看診」那一條，各有一顆燈號，點開看每台儀器的明細（跟報告不同的、已填入的、報告上沒有這個欄位的）：

- **黃**：有還沒處理的數值差異、看診沒選健檢表單、或填入時報告已結案
- **綠**：已填入 N 項
- **藍**：沒有填入新數值（都已經有了、或表單沒有對應欄位）

### 認不出貓時：工具欄「檢驗」

還沒進到任何一次看診的結果，出現在右側工具欄的「**檢驗**」（紅色數字＝待確認筆數），每一頁都有，醫師、櫃台都能處理：

1. 點一筆，會列出**檢驗當天的掛號**。IDEXX 上的名字跟某隻貓同名、而且只有一隻，就已經預先選好（清單列上也可以直接按「確認是○○」）。
2. 確認後照上面同一套規則填進那隻貓當天的看診。那隻貓當天沒有看診就不配對、留在清單。
3. **別天的看診**（昨天驗、今天回來看報告）：在診療台那次看診的「檢驗報告」按「匯入檢驗結果」，選一份指定填進這次看診。
4. **選錯了**：按提示上的「復原」。只清掉**還是剛才填進去那個值**的欄位，被人改過的留著，結果回到清單；IDEXX 之後重送同一份也不會再自動配回去。
5. **忽略**：IDEXX 的品管測試（QC）、練習用的檢驗不是任何一隻貓的，忽略後不再出現（提示上可以復原）。

看診被取消、標記未到或刪除，連到它的結果也回到清單。

### 表單要先設定 IDEXX 代號

表單設計頁 → 點檢驗項目 → 「IDEXX 代號」。多個代號用「、」或逗號分開（代號本身可能有空格，例如 `Bile acids Preprandial`，不能用空白分隔）。代號可以從收到的 XML 的 `assay_name` 查，或看 Programmer's Guide 附錄 C。同一個代號只能對到一個項目；不同儀器的代號撞名時，在「IDEXX 檢驗別」填儀器名稱（例如 `Catalyst_One`），同一個代號在不同儀器上就能對到不同格子。檢驗別留空＝任何儀器都對。

### 抓檔程式的燈號

工具欄「檢驗」面板標頭（關閉鈕左邊）每台診所電腦一顆燈，滑過去看狀態與最後回報時間：

- **綠**：連線中
- **黃**：連線中，但上傳有問題（附卡住的檔案數與錯誤）
- **紅**：超過三分鐘沒回報，新的檢驗結果進不來；這時工具欄的「檢驗」亮紅色「!」

診所下班關機後是紅燈，正常。換電腦或改了 `name` 後舊的那筆會一直紅：點那顆紅燈就能移除（只有已經沒在回報的能移除）。

## 7. 本機測試（沒有 IDEXX 主機）

抓檔程式分不出檔案是 InterLink 寫的還是手動丟的，所以手動丟檔就能測完 InterLink 之後的整條路。**這會寫入開發資料庫。**

1. `server/.env` 加上 `IDEXX_BRIDGE_TOKEN=<32 字元以上>`，**重啟後端**（nodemon 不會因為 `.env` 變動重啟）。
2. 不帶密鑰 POST `http://localhost:3000/api/lab-results/import` 應該回 **401**（503＝還沒讀到設定）。
3. `bridge/idexx-bridge.config.json` 的 `serverUrl` 填 `http://localhost:3000`、`token` 同上、`resultsDir` 填任意本機資料夾。
4. `bridge` 資料夾執行 `npm start`。
5. 把範例 XML（`server/test/fixtures/idexx/`）複製進 `resultsDir`。約 10 秒後顯示「已上傳 …」，檔案移到 `已上傳\年-月\`。
6. 失敗情境：先關後端再丟檔（後端開回來後自動補傳）；或丟一個亂打的 `.xml`（30 分鐘後移到 `無法讀取\`）。

示範資料：在 `server` 資料夾執行 `node scripts/_idexx-demo-seed.mjs` 建一組 IDEXX 情境（飼主電話 0900200 開頭，加 `--clean` 只清掉）。

自動測試：後端 `npm test`（解析用 `server/test/fixtures/idexx/` 的真實範例）、`bridge/` 的 `npm test`（在系統暫存資料夾實際搬檔案，不需要伺服器）。

## 8. 送 IDEXX：把貓咪送到 IDEXX 主機（預設關閉）

**報到不會自動送**——不是每次看診都驗血（預防針、拆線都不驗），全部送過去技術員反而要自己分辨。要驗的時候按「**送 IDEXX**」：

- 醫師：診療台看診工作區底部那一排按鈕。
- 櫃台：掛號台卡片的 ⋯ 選單（例如術前檢查，飼主一到就知道要驗）。

按下後約 10 秒，貓咪出現在 IDEXX 主機首頁的清單；技術員從清單點那隻貓跑檢驗，結果帶著系統的貓咪編號回來，自動填進看診、不經過待確認清單。徽章在抓檔程式回報寫好之前是琥珀色「尚未送到 IDEXX」，之後才是「已送 IDEXX」；按下時沒有任何一台抓檔程式在線會直接提示。按錯可以「取消送 IDEXX」。櫃台完成處理（或取消、取消報到、標記未到）時自動從主機清單收掉；用開單（`work_request`）而且檢驗已經做完時不再送取消（主機上那張單已經自己完成）。不選檢驗項目，技術員在主機上自己選儀器。伺服器沒開時兩邊的按鈕都不出現。

**伺服器設定**（環境變數，改了要重新部署）：

| 變數 | 值 | 說明 |
|---|---|---|
| `IDEXX_CENSUS_MODE` | `off`（預設）／`census`／`work_request` | `census`＝到院／離院通知（Census_Notice）；`work_request`＝開單（Work_Request，IDEXX 台灣給的範例是這種，單號是掛號編號） |
| `IDEXX_CENSUS_ENCODING` | `big5`（預設）／`utf-8` | 中文貓名在主機上是亂碼就換另一種；Big5 沒有的字送「?」 |

送出的內容（`server/src/lib/idexxCensus.js`）：貓咪編號、名字、物種（一律 `FELINE`，除非明寫是狗）、性別＋結紮、生日、體重、品種（IDEXX 英文名稱）、飼主姓／名（中文 2～4 字第一個字是姓、常見複姓兩個字；英文名最後一段是姓）。

**抓檔程式設定**：`idexx-bridge.config.json` 的 `requestsDir`（安裝檔自動填 `C:\IDEXX Interlink\Requests`）。

**到診所的驗證步驟**（跟 IDEXX 的人一起）：

1. InterLink 設定裡「Send Work Request/Census Messages」是 **Yes**。
2. 伺服器設 `IDEXX_CENSUS_MODE=census`，重新部署。
3. 掛號台報到一隻測試貓，按「**送 IDEXX**」→ 約 10 秒後 `Requests\` 出現一個數字檔名的 `.xml` → IDEXX 主機的清單出現這隻貓。
4. 檢查主機上的貓名、飼主名是不是亂碼；是的話改 `IDEXX_CENSUS_ENCODING=utf-8` 再試。
5. 從清單點這隻貓跑一個檢驗 → 結果應該**直接**填進看診，不進待確認清單。
6. 櫃台按「完成處理」→ 貓咪從主機清單消失。
7. 第 3 步主機沒出現：看 InterLink 的 log（`C:\ProgramData\IDEXX Interlink\rolling.log`）有沒有拒收的原因；或改 `IDEXX_CENSUS_MODE=work_request` 再試。

**本機可以驗證到哪裡**：設好 `IDEXX_CENSUS_MODE` 與抓檔程式的 `requestsDir`（本機隨便建一個資料夾），報到一隻貓、按「送 IDEXX」，看資料夾裡出現的 XML 內容對不對；InterLink 之後的事只能在診所驗證。這會寫入資料庫（每次送出、收掉各一筆通知）。

**排查**：`status.cmd` 會列出 `Requests` 資料夾裡有幾個檔案——在院內的貓各留一份是正常的，下班後還一大堆代表 InterLink 沒在處理。抓檔程式寫不進去或拿不到通知時，燈號變黃。

## 9. 排查

| 症狀 | 先看哪裡 |
|---|---|
| 電腦右下角 InterLink 圖示是黃色 | 防火牆有沒有允許、網路是不是「私人」、跟 IDEXX 主機是否同一台路由器；IDEXX 主機那邊第 3 節第 2～4 項 |
| 圖示綠色但 `Results\Data\` 沒有檔案 | IDEXX 主機 Instruments → Practice Management 是否選了 On；「Do not transmit records created before」是不是設得太晚 |
| 一口氣進來幾百份舊結果、待確認暴增 | IDEXX 主機在補傳歷史紀錄（「Do not transmit records created before」設得太早，或有人按了 Resend）：**把日期改成今天**。系統有節流（第 5、6 節），不會被拖垮，但待確認清單要一筆一筆忽略 |
| 有 XML 但系統沒收到 | 遠端跑 `status.cmd` 看 log：401＝兩邊密鑰不一致；503＝伺服器沒設 `IDEXX_BRIDGE_TOKEN`；連不上＝沒網路或 `serverUrl` 錯。`npm run check` 可以單獨測連線 |
| 工具欄「檢驗」亮紅色「!」 | 抓檔程式超過三分鐘沒心跳：電腦關機、沒網路，或排程工作停了 |
| 檔案一直留在 `Results\Data\` 不動 | 抓檔程式沒在跑：`status.cmd` 看排程工作狀態 |
| `status.ps1` 找不到排程工作 | 不是用系統管理員身分執行（SYSTEM 的排程工作一般使用者看不到），或還沒安裝 |
| 檔案被移到 `無法讀取\` | 伺服器一直解析失敗：把檔案帶回來加成 `server/test/fixtures/idexx/` 的測試範例，再修 `idexxResult.js` |
| 中文貓名是亂碼 | 看 XML 開頭宣告的 `encoding` 與實際編碼是否一致 |

## 10. IDEXX 格式的已知怪癖

都是真實範例檔裡看到的，已經在 `idexxResult.js` 處理、在測試裡釘住：

- **不符合它自己的 DTD**：Catalyst One 的輸出在 `<assay_result>` 裡夾了一段不屬於任何欄位的文字，所以解析時不驗證 DTD。
- **儀器名稱與項目代號比文件新**：文件（2013）沒列 `Catalyst_One`、`IDEXX_inVue_Dx`、`SDMA`，所以清單不寫死，沒見過的照收。
- **同一個「微」字有兩種碼位**：Catalyst 用 `µ`（U+00B5），inVue 用 `μ`（U+03BC），統一成後者。
- **結果不一定是數字**：SNAP 是 `Positive`／`Negative`，inVue 是整句判讀（`100-150 K/uL (Mildly decreased)`），一律存字串。
- **沒量體重時送 0**，當成沒有資料。
- **時間沒有時區**（`MM/DD/YYYY hh:mm:ss.sss AM|PM`，診所牆上時間），照台北時區換算。
- **直接在 IDEXX 主機上開單的檢驗**，`requisition_number` 與 `patient_id` 都是空字串。

## 11. 待辦與要到診所才知道的事

**尚未實作**

1. **報告上標示「來自 IDEXX」**：填寫頁的檢驗欄位標出哪些值是儀器填的。
2. **IDEXX 的 PDF 報告上傳**：依 IDEXX 文件，PDF 檔名是該次檢驗的 `diagnostic_set_id`。

**要到診所實測**

- 送 IDEXX 用 `census` 還是 `work_request`、編碼用 Big5 還是 UTF-8。
- 飼主姓名在主機上顯示得對不對（`splitOwnerName`）。
- 技術員在 IDEXX 主機上自己新增病患、手打名字時結果不會帶編號——要教診所從清單點選。
- InterLink 2013 版在診所的 Windows 版本上能不能正常跑；SmartService 是否已開通、IDEXX 主機有沒有接別家看診軟體。

## 12. 參考資料

IDEXX 提供的原始資料（安裝檔、PDF 文件、DTD、範例 XML）**不在 repo 裡**（安裝檔很大，文件也註明不得轉載），放在開發者電腦的 `Desktop\IDEXX 資料\InterLink\`：

- 《How to connect IVLS using InterLink Application Eng》：IDEXX 主機端設定，有截圖
- 《IDEXX InterLink Programmer's Guide Appendix》：XML 格式（附錄 A）、物種代碼（B）、各儀器項目代號（C）、報告排序（D）
- 《InterLink Application Operator's Guide》：InterLink 電腦端設定
- `DTDs for InterLink.zip`：`result_20.dtd`、`census_20.dtd`、`work_request_20.dtd`、`acknowledgement_20.dtd`
- `xml sample\`：真實輸出範例，已去識別複製到 `server/test/fixtures/idexx/`

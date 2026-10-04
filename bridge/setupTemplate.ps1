# 單一安裝檔 IDEXX-Bridge-Setup.cmd 的本體。buildInstaller.mjs 把它接在一小段 cmd 開頭後面、
# 並把程式檔案（base64）填進下面的 $files。安裝檔開頭那段 cmd 會先設好 $setupFile（安裝檔自己的路徑）。
#
# 做的事：要求管理員權限 → 找 Node.js（沒有就用 winget 裝）→ 問網址／密鑰／結果資料夾（重跑時帶出上次的值）
# → 把程式放到 C:\IDEXX Bridge、寫設定檔 → 呼叫 install.ps1 檢查連線並建立排程工作。
# 重複執行＝更新程式或改設定。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$installDir = 'C:\IDEXX Bridge'
$defaultResultsDir = 'C:\IDEXX Interlink\Results\Data'
$taskName = 'IDEXX Bridge'
$files = @{} #__FILES__
# 打包時預先放好的設定（installer.preset.json）；空的就改用問的。
$preset = @{} #__PRESET__

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Stop-Setup($text) {
  Say ''
  Say "✘ $text" 'Red'
  exit 1
}

Say ''
Say '=== IDEXX 抓檔程式安裝 ===' 'Cyan'
Say '把 IDEXX InterLink 存下的檢驗結果自動上傳到系統。'
Say ''

# 1. 管理員權限：建立「開機就執行」的排程工作需要。沒有就自己重新以管理員身分開一次。
$identity = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Say '需要系統管理員權限，請在跳出的視窗按「是」。'
  try {
    Start-Process -FilePath $setupFile -Verb RunAs
  } catch {
    Stop-Setup '沒有取得管理員權限，安裝沒有進行。'
  }
  exit 99
}

# 2. Node.js：優先用官方安裝程式裝在 Program Files 的（所有帳號都用得到）。
function Find-Node {
  $official = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $official) { return $official }
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  return $null
}
$node = Find-Node
if (-not $node) {
  Say '這台電腦沒有 Node.js，嘗試自動安裝（可能需要一兩分鐘）…'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    & winget install --id OpenJS.NodeJS.LTS -e --scope machine --silent --accept-source-agreements --accept-package-agreements
  }
  $node = Find-Node
  if (-not $node) {
    Stop-Setup '無法自動安裝 Node.js。請到 https://nodejs.org 下載 LTS 版安裝，再執行一次這個安裝檔。'
  }
}
$nodeVersion = (& $node --version).Trim()
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 20) {
  Stop-Setup "Node.js 版本 $nodeVersion 太舊，需要 20 以上。請到 https://nodejs.org 安裝 LTS 版再執行一次。"
}
Say "✔ Node.js $nodeVersion" 'Green'

# 3. 設定。打包時有放預設值（installer.preset.json）就全自動、不問任何問題；沒有才一題一題問。
$configPath = Join-Path $installDir 'idexx-bridge.config.json'
$config = [ordered]@{}
if (Test-Path $configPath) {
  try {
    $existing = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $existing.PSObject.Properties) { $config[$property.Name] = $property.Value }
  } catch {
    Say '上次的設定檔讀不了，重新設定。' 'Yellow'
  }
}
# 安裝檔裡預先放好的值優先於這台電腦上次的設定（換密鑰時重新打包、再裝一次就會更新）。
foreach ($key in $preset.Keys) { $config[$key] = $preset[$key] }
if (-not $config['resultsDir']) { $config['resultsDir'] = $defaultResultsDir }

function Ask($label, $default, $shown) {
  if ($default) {
    if (-not $shown) { $shown = $default }
    $answer = Read-Host "$label [$shown]"
  } else {
    $answer = Read-Host $label
  }
  if ([string]::IsNullOrWhiteSpace($answer)) { return "$default" }
  return $answer.Trim()
}

if ($preset['serverUrl'] -and $preset['token']) {
  Say "使用安裝檔裡預先設定好的值（$($config['serverUrl'])）。"
  if (-not (Test-Path $config['resultsDir'])) {
    Stop-Setup "找不到 InterLink 存檢驗結果的資料夾：$($config['resultsDir'])。請先安裝 IDEXX InterLink，再執行一次這個安裝檔。"
  }
} else {
  if ($config['serverUrl']) { Say '找到上次的設定，直接按 Enter 就沿用。' }
  Say ''
  while ($true) {
    $config['serverUrl'] = (Ask '系統網址（例如 https://xxx.zeabur.app）' $config['serverUrl']).TrimEnd('/')
    if ($config['serverUrl'] -match '^https?://') { break }
    Say '網址要以 http:// 或 https:// 開頭。' 'Yellow'
  }
  while ($true) {
    $config['token'] = Ask '密鑰（跟伺服器的 IDEXX_BRIDGE_TOKEN 相同）' $config['token'] '已設定，按 Enter 沿用'
    if ($config['token'].Length -ge 32) { break }
    Say '密鑰至少 32 個字元。' 'Yellow'
  }
  while ($true) {
    $config['resultsDir'] = Ask 'InterLink 存檢驗結果（XML）的資料夾' $config['resultsDir']
    if (Test-Path $config['resultsDir']) { break }
    Say "找不到這個資料夾：$($config['resultsDir'])。請確認 InterLink 已經安裝，或輸入正確的位置。" 'Yellow'
  }
  # 不要自己帶入電腦名稱當預設：留空時抓檔程式會用它自己取的電腦名稱（os.hostname()），
  # 跟 Windows 的 COMPUTERNAME 大小寫不同，帶入的話系統上會多出一筆看起來像另一台電腦的紀錄。
  $config['name'] = Ask '在系統上顯示的名稱（不填就用電腦名稱）' $config['name']
}

# 報到通知寫進 InterLink 的 Requests 資料夾（跟 Results 同一層）。不問：InterLink 裝好就有，
# 找不到就留空、不送報到通知（填了不存在的資料夾，系統上的燈號會一直是黃的）。
if (-not $config['requestsDir']) {
  $candidate = Join-Path (Split-Path (Split-Path $config['resultsDir'])) 'Requests'
  $config['requestsDir'] = if (Test-Path $candidate) { $candidate } else { '' }
}
if ($config['requestsDir']) { Say "✔ 報到通知寫進 $($config['requestsDir'])" 'Green' }

# 4. 放檔案。先停掉正在跑的抓檔程式（排程工作或手動開的），同一個資料夾不能同時跑兩份。
Say ''
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*idexxBridge.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force $installDir | Out-Null
foreach ($name in $files.Keys) {
  [IO.File]::WriteAllBytes((Join-Path $installDir $name), [Convert]::FromBase64String($files[$name]))
}
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
Say "✔ 程式與設定檔已放到 $installDir" 'Green'

# 5. 檢查連線、建立排程工作（install.ps1 做）。
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir 'install.ps1') -TaskName $taskName -NodePath $node
if ($LASTEXITCODE -ne 0) {
  Stop-Setup '安裝沒有完成。修正上面的問題後，再執行一次這個安裝檔（剛才輸入的設定已經記住了）。'
}

Say ''
Say '=== 安裝完成 ===' 'Green'
Say '之後這台電腦開機就會在背景自動上傳，不需要開任何視窗。'
Say '系統的「檢驗」面板一分鐘內會亮綠燈。可以關閉這個視窗了。'

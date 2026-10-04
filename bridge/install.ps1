# IDEXX 抓檔程式：建立 Windows 排程工作，開機就在背景執行（不用登入、看不到視窗、停了會自動重開）。
#
# 用法：以「系統管理員身分」開啟 PowerShell，切到這個資料夾後執行
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# 重複執行＝重新安裝（先移除舊的排程工作再建新的），改了設定檔或換了 Node.js 版本後再跑一次即可。
# 移除用 uninstall.ps1，查看狀態用 status.ps1。
#
# 一般不用直接跑這支：單一安裝檔 IDEXX-Bridge-Setup.cmd（npm run build:installer 產生）會放好檔案、
# 寫好設定檔再呼叫它。NodePath 是安裝檔剛裝好 Node.js、PATH 還沒更新時用來指定 node.exe 的位置。
param([string]$TaskName = 'IDEXX Bridge', [string]$NodePath = '')

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here 'idexxBridge.js'
$config = Join-Path $here 'idexx-bridge.config.json'

function Fail($message) {
  Write-Host "✘ $message" -ForegroundColor Red
  exit 1
}

$identity = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail '要用「以系統管理員身分執行」開啟 PowerShell 再跑一次（建立開機就執行的排程工作需要管理員權限）。'
}
if (-not (Test-Path $config)) {
  Fail "找不到設定檔 $config。請先複製 idexx-bridge.config.example.json 成 idexx-bridge.config.json 並填好。"
}
if ($here -like '*OneDrive*') {
  Write-Host '⚠ 這個資料夾在 OneDrive 底下，同步可能鎖住或卸載檔案。建議搬到例如 C:\IDEXX Bridge 再安裝。' -ForegroundColor Yellow
}

# 排程工作要寫死 node.exe 的完整路徑：SYSTEM 帳號的 PATH 跟登入的使用者不同，只寫 node 會找不到。
if ($NodePath -and (Test-Path $NodePath)) {
  $nodePath = $NodePath
} else {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { Fail '找不到 Node.js。請先用官方安裝程式（https://nodejs.org）安裝 LTS 版，重開 PowerShell 後再跑一次。' }
  $nodePath = $node.Source
}
$nodeVersion = (& $nodePath --version).Trim()
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 20) { Fail "Node.js 版本 $nodeVersion 太舊，需要 20 以上。" }
# nvm 這類工具會把 node 放在 C:\nvm4w\nodejs 之類的捷徑（symlink）後面，實際檔案在個人資料夾，要追到真正位置才判斷得出來。
$nodeDir = Split-Path $nodePath
$nodeRealDir = (Get-Item $nodeDir).Target
if (-not $nodeRealDir) { $nodeRealDir = $nodeDir }
if ("$nodeRealDir" -like "$env:USERPROFILE*") {
  Write-Host "⚠ Node.js 實際裝在個人資料夾（$nodeRealDir，例如用 nvm 安裝），這個使用者被移除或換版本時抓檔程式會跟著失效。診所電腦請改用官方安裝程式。" -ForegroundColor Yellow
}
Write-Host "Node.js $nodeVersion（$nodePath）"

Write-Host '檢查設定檔、資料夾與伺服器連線…'
& $nodePath $script --check
if ($LASTEXITCODE -ne 0) { Fail '檢查沒通過，排程工作沒有建立。修正上面的問題後再跑一次。' }

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host '移除舊的排程工作…'
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
# 「停止排程工作」不一定會關掉已經在跑的程式（見 uninstall.ps1）；不關的話新舊兩份會同時盯同一個資料夾。
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*idexxBridge.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$script`"" -WorkingDirectory $here
$atStartup = New-ScheduledTaskTrigger -AtStartup
# 除了開機，每 5 分鐘也叫一次：程式萬一停了，最慢 5 分鐘內會被叫起來；已經在跑就不會重複開（IgnoreNew）。
$everyFiveMinutes = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
# SYSTEM 帳號：不用任何人登入就會跑，也不會跳出視窗讓人誤關。
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atStartup, $everyFiveMinutes) `
  -Settings $settings -Principal $principal `
  -Description '把 IDEXX InterLink 存下的檢驗結果上傳到系統。設定檔與 log 在同一個資料夾。' | Out-Null
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 5
$info = Get-ScheduledTask -TaskName $TaskName
Write-Host ''
Write-Host "✔ 已建立排程工作「$TaskName」，目前狀態：$($info.State)" -ForegroundColor Green
Write-Host '  之後開機就會在背景執行。查看狀態與最近的 log：powershell -ExecutionPolicy Bypass -File .\status.ps1'

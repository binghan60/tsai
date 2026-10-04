# IDEXX 抓檔程式：遠端排查用，看排程工作有沒有在跑、資料夾裡卡了幾個檔案、最近的 log。
#
# 用法（切到這個資料夾後執行；看排程工作的狀態需要系統管理員身分）：
#   powershell -ExecutionPolicy Bypass -File .\status.ps1
#
# 一般直接點兩下同資料夾的 status.cmd：它帶 -Pause，這裡自己要求管理員權限（SYSTEM 的排程工作一般使用者看不到）、
# 跑完停住讓人看結果。
param([string]$TaskName = 'IDEXX Bridge', [int]$Lines = 20, [switch]$Pause)

$identity = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($Pause -and -not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  try {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-TaskName', "`"$TaskName`"", '-Lines', $Lines, '-Pause')
    exit
  } catch {
    Write-Host '沒有取得管理員權限，看不到排程工作的狀態，只顯示 log。' -ForegroundColor Yellow
  }
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  $info = $task | Get-ScheduledTaskInfo
  Write-Host "排程工作「$TaskName」：$($task.State)"
  Write-Host "  上次啟動：$($info.LastRunTime)　結果代碼：$($info.LastTaskResult)（267009＝執行中）"
  Write-Host "  下次觸發：$($info.NextRunTime)"
} else {
  Write-Host "找不到排程工作「$TaskName」（還沒安裝，或這個 PowerShell 不是系統管理員身分）。" -ForegroundColor Yellow
}

$config = Join-Path $here 'idexx-bridge.config.json'
if (Test-Path $config) {
  $resultsDir = (Get-Content $config -Raw -Encoding UTF8 | ConvertFrom-Json).resultsDir
  if (Test-Path $resultsDir) {
    $pending = @(Get-ChildItem $resultsDir -Filter '*.xml' -File).Count
    $failed = if (Test-Path (Join-Path $resultsDir '無法讀取')) { @(Get-ChildItem (Join-Path $resultsDir '無法讀取') -File).Count } else { 0 }
    Write-Host "資料夾 $resultsDir：待上傳 $pending 個、無法讀取 $failed 個"
  } else {
    Write-Host "找不到設定檔裡的資料夾：$resultsDir" -ForegroundColor Yellow
  }
}

$log = Join-Path $here 'idexx-bridge.log'
Write-Host ''
if (Test-Path $log) {
  Write-Host "最近 $Lines 行 log（$log）："
  Get-Content $log -Tail $Lines -Encoding UTF8
} else {
  Write-Host '還沒有 log（抓檔程式沒跑過）。'
}

if ($Pause) { Write-Host ''; Read-Host '按 Enter 關閉' }

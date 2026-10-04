# IDEXX 抓檔程式：移除 install.ps1 建立的排程工作。不會刪除任何檔案（程式、設定檔、log、已上傳的檢驗結果都留著）。
#
# 用法：以「系統管理員身分」開啟 PowerShell，切到這個資料夾後執行
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#
# 一般直接點兩下同資料夾的 uninstall.cmd：它會帶 -Pause，這裡自己要求管理員權限、跑完停住讓人看結果。
# （曾經要人自己開管理員 PowerShell，結果用右鍵「用 PowerShell 執行」開，不是管理員、視窗又一閃就關，什麼都沒做。）
param([string]$TaskName = 'IDEXX Bridge', [switch]$Pause)

$ErrorActionPreference = 'Stop'
$identity = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '需要系統管理員權限，請在跳出的視窗按「是」。'
  try {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-TaskName', "`"$TaskName`"", '-Pause')
  } catch {
    Write-Host '✘ 沒有取得管理員權限，沒有移除。' -ForegroundColor Red
    if ($Pause) { Read-Host '按 Enter 關閉' }
  }
  exit
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "✔ 已移除排程工作「$TaskName」，抓檔程式不會再自動執行。" -ForegroundColor Green
} else {
  Write-Host "沒有排程工作「$TaskName」。"
}

# 「停止排程工作」不一定會把已經在跑的程式關掉（實測過：工作刪了，node 還在背景繼續送心跳），
# 所以直接找出抓檔程式的程序結束掉。系統帳號跑的程序只有管理員看得到指令列，所以這支要用管理員執行。
$running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*idexxBridge.js*' })
foreach ($process in $running) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
if ($running.Count) { Write-Host "✔ 已關閉正在執行的抓檔程式（$($running.Count) 個）。" -ForegroundColor Green }
Write-Host '系統的「檢驗」面板大約三、四分鐘後會變成紅燈（超過三分鐘沒有回報才算斷線），之後可以點紅燈移除那筆紀錄。'
if ($Pause) { Write-Host ''; Read-Host '按 Enter 關閉' }

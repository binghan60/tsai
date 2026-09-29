# IDEXX 抓檔程式：移除 install.ps1 建立的排程工作。不會刪除任何檔案（程式、設定檔、log、已上傳的檢驗結果都留著）。
#
# 用法：以「系統管理員身分」開啟 PowerShell，切到這個資料夾後執行
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
param([string]$TaskName = 'IDEXX Bridge')

$ErrorActionPreference = 'Stop'
$identity = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '✘ 要用「以系統管理員身分執行」開啟 PowerShell 再跑一次。' -ForegroundColor Red
  exit 1
}

if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
  Write-Host "沒有排程工作「$TaskName」，不需要移除。"
  exit 0
}
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "✔ 已移除排程工作「$TaskName」，抓檔程式不會再自動執行。" -ForegroundColor Green

<#
只在裝了 32-bit Jet ODBC 驅動（"Microsoft Access Driver (*.mdb)"）的 Windows 機器上跑一次。
這台開發機沒有 64-bit 的 ACE OLEDB/ODBC 驅動，只有系統內建的 32-bit Jet 驅動，
所以本腳本必須用 32-bit PowerShell 執行，例如：

  & 'C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe' -NonInteractive -ExecutionPolicy Bypass -File extract-recorddata.ps1

輸出是一個 JSON Lines 檔（每行一個 JSON 物件），內含真實個資，不要進 git（已在 .gitignore 排除）。
#>
param(
  [string]$DbPath = "$PSScriptRoot\..\..\..\Data\RegData.mdb",
  [string]$OutFile = "$PSScriptRoot\legacy-recorddata-export.jsonl"
)

Add-Type -AssemblyName System.Windows.Forms

function Get-Val($reader, $name) {
  $value = $reader[$name]
  if ($value -eq [DBNull]::Value) { return $null }
  return $value
}

# RTF 轉純文字：舊系統的「病歷」欄位是醫師手打十幾年累積的 RTF 格式文字，
# 用 RichTextBox 讀回純文字是最簡單可靠的做法，不用額外裝套件。
# 轉換失敗（不是合法 RTF，例如舊資料本來就存了純文字）時就直接用原始字串。
#
# 共用同一個 RichTextBox 實例，不要在迴圈裡每筆 New-Object：這是真的 Win32 控制項，
# 20,000+ 次疊代下來每筆都新建又不 Dispose 會把 USER/GDI handle 用盡，
# 導致後面的轉換從某個時間點開始全部失敗、掉進 catch 回傳未轉換的原始 RTF。
$script:rtfConverter = New-Object System.Windows.Forms.RichTextBox

function Convert-RtfToText($rtf) {
  if ([string]::IsNullOrWhiteSpace($rtf)) { return '' }
  try {
    $script:rtfConverter.Rtf = $rtf
    return $script:rtfConverter.Text
  } catch {
    return $rtf
  }
}

function Format-DateValue($value) {
  if ($null -eq $value) { return $null }
  if ($value -is [DateTime]) { return $value.ToString('yyyy-MM-dd') }
  return $value.ToString()
}

if (-not (Test-Path $DbPath)) {
  Write-Error "找不到 $DbPath"
  exit 1
}

$connStr = "Driver={Microsoft Access Driver (*.mdb)};Dbq=$DbPath;"
$conn = New-Object System.Data.Odbc.OdbcConnection($connStr)
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = 'SELECT * FROM [RecordData]'
$reader = $cmd.ExecuteReader()

$writer = New-Object System.IO.StreamWriter($OutFile, $false, [System.Text.Encoding]::UTF8)
$count = 0
while ($reader.Read()) {
  $row = [ordered]@{
    legacyMedicalRecordNumber = Get-Val $reader '病歷號碼'
    petName                   = Get-Val $reader '名字'
    species                   = Get-Val $reader '種類'
    breed                     = Get-Val $reader '品種'
    sex                       = Get-Val $reader '性別'
    birthDate                 = Format-DateValue (Get-Val $reader '出生日')
    weightKg                  = Get-Val $reader '體重'
    neutered                  = Get-Val $reader '結紮'
    chipId                    = Get-Val $reader '識別晶片'
    ownerName                 = Get-Val $reader '主人'
    phone                     = Get-Val $reader '電話'
    mobilePhone                = Get-Val $reader '大哥大'
    email                     = Get-Val $reader 'Email'
    chartNotes                = Convert-RtfToText (Get-Val $reader '病歷')
  }
  $writer.WriteLine(($row | ConvertTo-Json -Compress -Depth 3))
  $count++
  if ($count % 2000 -eq 0) { Write-Host "已處理 $count 筆" }
}
$writer.Close()
$reader.Close()
$conn.Close()
$script:rtfConverter.Dispose()

Write-Host "完成，共 $count 筆，輸出至 $OutFile"

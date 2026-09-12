# 專案工作規範

## 中文檔案與編碼

- 專案文字檔一律以 UTF-8 讀寫與儲存，尤其是 `.vue`、`.js`、`.css`、`.md`。
- 修改含中文的檔案前，若看到 `�`、`嚗`、`撠`、`銝`、``、``、`` 等疑似 mojibake 亂碼，必須先停止並確認原始內容，不可直接在亂碼基礎上繼續改。
- 禁止用會依系統預設 ANSI/Big5 編碼覆寫檔案的方式修改程式碼；在 Windows PowerShell 需要寫入文字時，必須明確使用 UTF-8，或優先使用 `apply_patch`。
- 修改含中文 UI 字串後，完成前以 `rg` 檢查該檔案沒有殘留疑似亂碼；若發現既有可見 UI 文字已損壞，應一併修復。

## 對話框

- 禁止使用瀏覽器原生對話框：`window.alert`、`window.confirm`、`window.prompt`，以及全域 `alert`、`confirm`、`prompt`。
- 需要確認、輸入原因、提示錯誤或要求使用者決策時，必須使用專案既有的 Vue 對話框元件（例如 `ConfirmDialog`、`ModalDialog` 與 `Alert`）。
- 完成前以 `rg` 檢查上述原生 API 未出現在 `client/src`；若既有程式有發現，應一併改為專案元件。

## 日期輸入

- 禁止使用原生 `<input type="date">`。日期選擇一律使用專案的 `DatePicker` 元件。
- 完成前以 `rg` 檢查 `client/src` 沒有 `type="date"` 或 `type='date'`；若既有程式有發現，應一併改為 `DatePicker`。

# 專案工作規範

## 對話框

- 禁止使用瀏覽器原生對話框：`window.alert`、`window.confirm`、`window.prompt`，以及全域 `alert`、`confirm`、`prompt`。
- 需要確認、輸入原因、提示錯誤或要求使用者決策時，必須使用專案既有的 Vue 對話框元件（例如 `ConfirmDialog`、`ModalDialog` 與 `Alert`）。
- 完成前以 `rg` 檢查上述原生 API 未出現在 `client/src`；若既有程式有發現，應一併改為專案元件。

## 日期輸入

- 禁止使用原生 `<input type="date">`。日期選擇一律使用專案的 `DatePicker` 元件。
- 完成前以 `rg` 檢查 `client/src` 沒有 `type="date"` 或 `type='date'`；若既有程式有發現，應一併改為 `DatePicker`。

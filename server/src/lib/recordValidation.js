// 報告結案前的完整性檢查。
//
// 從 routes/records.js 抽出來的純邏輯：這裡不碰 Express、不碰資料庫，
// 吃 sections 吐出「還缺什麼」的清單。抽出來的理由是它值得被測——
// 結案之後報告就會產生 PDF 寄給飼主，而且鎖定不能再改，這裡漏判等於把
// 不完整的醫療報告送出門。留在路由檔裡的話，測試得連帶載入 puppeteer 與 nodemailer。

// 「這個項目有沒有作答」的唯一判準，與前端 validateForPreview() 對齊：
// finding 看有沒有標記過檢查結果（它沒有 value，看 value 會永遠不滿足）；
// lab 是標記過或填了數值都算，「按了正常但沒填數值」也是有作答。
export function itemHasAnswer(item) {
  if (item.type === 'finding') return item.status !== 'not_checked';
  if (item.type === 'lab') return item.status !== 'not_checked' || String(item.value ?? '').trim() !== '';
  return item.value !== null && item.value !== undefined && String(item.value).trim() !== '';
}

// 結案前的完整性檢查全部改看範本組出來的 sections，
// 使用者改欄位名稱、搬動位置或新增自訂項目都會自動納入。
export function validateFinalRecord(sections) {
  const missing = [];
  const items = sections.flatMap((section) => section.items ?? []);

  for (const item of items.filter((entry) => entry.required)) {
    if (!itemHasAnswer(item)) missing.push(item.label);
  }

  return missing;
}

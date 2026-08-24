// 報告結案前的完整性檢查。
//
// 從 routes/records.js 抽出來的純邏輯：這裡不碰 Express、不碰資料庫，
// 吃 sections 吐出「還缺什麼」的清單。抽出來的理由是它值得被測——
// 結案之後報告就會產生 PDF 寄給飼主，而且鎖定不能再改，這裡漏判等於把
// 不完整的醫療報告送出門。留在路由檔裡的話，測試得連帶載入 puppeteer 與 nodemailer。

// 「這份報告有沒有臨床內容」改由範本決定：只要任何一個非固定預設的項目有填就算。
// visitDate 有預設值、vet 是行政欄位，都不能當作「有臨床內容」的訊號。
export const PREFILLED_ROLES = new Set(['visitDate', 'vet']);

// 「這個項目有沒有作答」的唯一判準，臨床內容檢查與必填檢查共用同一份 ——
// 兩邊各寫一份遲早會分岔成「前端放行、後端 422」。與前端 validateForPreview() 對齊：
// finding 看有沒有標記過檢查結果（它沒有 value，看 value 會永遠不滿足）；
// lab 是標記過或填了數值都算，「按了正常但沒填數值」也是有作答。
export function itemHasAnswer(item) {
  if (item.type === 'finding') return item.status !== 'not_checked';
  if (item.type === 'lab') return item.status !== 'not_checked' || String(item.value ?? '').trim() !== '';
  return item.value !== null && item.value !== undefined && String(item.value).trim() !== '';
}

export function hasClinicalContent(sections) {
  return sections.some((section) =>
    (section.items ?? []).some((item) => !PREFILLED_ROLES.has(item.role) && itemHasAnswer(item))
  );
}

// 結案前的完整性檢查全部改看範本組出來的 sections，
// 使用者改欄位名稱、搬動位置或新增自訂項目都會自動納入。
export function validateFinalRecord(sections) {
  const missing = [];
  const items = sections.flatMap((section) => section.items ?? []);
  const byRole = (role) => items.find((item) => item.role === role);
  const filled = (item) => item && String(item.value ?? '').trim();

  for (const item of items.filter((entry) => entry.required)) {
    if (!itemHasAnswer(item)) missing.push(item.label);
  }

  if (!hasClinicalContent(sections)) missing.push('基本量測、結論、診斷、理學檢查或檢驗結果');

  // 結論與照護建議至少要有一項；兩個欄位都被停用時就不檢查。
  const conclusion = byRole('conclusion');
  const treatmentPlan = byRole('treatmentPlan');
  if ((conclusion || treatmentPlan) && !filled(conclusion) && !filled(treatmentPlan)) {
    missing.push([conclusion?.label, treatmentPlan?.label].filter(Boolean).join('或'));
  }

  const abnormalWithoutNote = items
    .filter((item) => (item.type === 'finding' || item.type === 'lab') && item.status === 'abnormal' && !item.note?.trim())
    .map((item) => item.label);
  if (abnormalWithoutNote.length) missing.push(`異常說明（${abnormalWithoutNote.join('、')}）`);

  return missing;
}

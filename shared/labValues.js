// 檢驗數值的共用規則：診療台的檢驗網格、病歷日誌的檢驗摘要、健檢報告草稿的帶入都用這份。
// 檢驗項目不是另一份清單，而是掛號時選的健檢表單裡「檢驗」類型的項目。

// 表單裡啟用中的檢驗項目（停用的區塊、停用的項目都不算）。
export function templateLabItems(template) {
  const items = [];
  for (const section of template?.sections ?? []) {
    if (section.enabled === false) continue;
    for (const item of section.items ?? []) {
      if (item.type === 'lab' && item.enabled !== false) items.push(item);
    }
  }
  return items;
}

// 偏高 ↑／偏低 ↓；不是數字、沒有參考範圍、在範圍內都回空字串。
export function labFlag(lab) {
  const text = String(lab?.value ?? '').trim();
  const numeric = Number(text);
  if (!text || !Number.isFinite(numeric)) return '';
  if (lab.referenceMax !== null && lab.referenceMax !== undefined && numeric > lab.referenceMax) return '↑';
  if (lab.referenceMin !== null && lab.referenceMin !== undefined && numeric < lab.referenceMin) return '↓';
  return '';
}

// 「5.5–19.5」這種參考範圍文字；只有一邊時寫成「≤ 19.5」「≥ 5.5」。
export function labRangeText(item) {
  const min = item?.referenceMin;
  const max = item?.referenceMax;
  const hasMin = min !== null && min !== undefined;
  const hasMax = max !== null && max !== undefined;
  if (hasMin && hasMax) return `${min}–${max}`;
  if (hasMax) return `≤ ${max}`;
  if (hasMin) return `≥ ${min}`;
  return '';
}

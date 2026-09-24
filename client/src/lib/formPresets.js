import { normalizeTemplateValue, presetEligible } from '../../../shared/formDefaults.js';

// 兩個作答是否「一樣」：複選不管勾選順序，其餘一律當字串比（數字欄位可能是 5 也可能是 '5'）。
export function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const list = (value) => (Array.isArray(value) ? value : []).map(String).sort();
    return JSON.stringify(list(a)) === JSON.stringify(list(b));
  }
  return String(a ?? '').trim() === String(b ?? '').trim();
}

// 套用預填模板要改哪些欄位。預設值是底、模板是疊在上面的一層：
// - 新模板有設定的欄位：改成模板值。
// - 上一個模板帶入過、新模板沒有的欄位：使用者沒動過（目前值仍等於當初帶入的值）才退回 baseValue，
//   動過的留著——切換模板不能把醫師親手打的字洗掉。
// - 其餘欄位一律不碰。
// previous 是上一次套用的 { key, applied }；頁面重新整理後就沒有了，此時只做「套上新模板」。
export function planPresetApplication({ items, preset, previous = null, currentValue, baseValue }) {
  const changes = [];
  const applied = {};
  for (const item of items ?? []) {
    if (!presetEligible(item)) continue;
    const current = currentValue(item);
    const next = normalizeTemplateValue(item, preset?.values?.[item.key]);
    if (next !== undefined) {
      applied[item.key] = next;
      if (!sameValue(current, next)) changes.push({ item, value: next });
      continue;
    }
    const previousValue = previous?.applied?.[item.key];
    if (previousValue === undefined || !sameValue(current, previousValue)) continue;
    const base = baseValue(item);
    if (!sameValue(current, base)) changes.push({ item, value: base });
  }
  return { changes, applied };
}

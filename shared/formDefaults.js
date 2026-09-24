// 預設值與預填模板能設定的欄位型別是同一批：理學檢查、檢驗、量測、牙齒圖、圖片
// 每次都是實際看診的結果，放進範本容易帶到錯的內容。
export const DEFAULT_VALUE_TYPES = new Set(['text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox']);

// 預填模板再排除兩類：日期（回診日期、健檢日期都是每次看診當下才決定，寫死在模板裡只會帶錯日子）
// 與看診醫師（誰看診跟做哪種檢查無關）。預設值不受影響。
// 日期除了看型別也看名稱：使用者自訂的「回診日期」常被建成文字欄位（好填「兩週後」這種寫法），
// 只看型別會漏掉它。
export const PRESET_VALUE_TYPES = new Set([...DEFAULT_VALUE_TYPES].filter((type) => type !== 'date'));
const PRESET_EXCLUDED_ROLES = new Set(['vet', 'visitDate']);
const DATE_LABEL = /日期/;

export function presetEligible(item) {
  return Boolean(item)
    && item.enabled !== false
    && PRESET_VALUE_TYPES.has(item.type)
    && !PRESET_EXCLUDED_ROLES.has(item.role)
    && !DATE_LABEL.test(String(item.label ?? ''));
}

// Dependency-free so the browser and API apply identical template-default rules.
// raw 可以是字串或陣列：預設值存成逗號分隔的字串，預填模板的複選直接存陣列。
export function normalizeTemplateValue(item, raw) {
  if (item?.enabled === false || !DEFAULT_VALUE_TYPES.has(item?.type)) return undefined;
  if (item.type === 'checkbox') {
    const options = new Set((item.options ?? []).filter(Boolean));
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
    const selected = [...new Set(list.map((option) => String(option ?? '').trim()))].filter((option) => options.has(option));
    return selected.length ? selected : undefined;
  }
  if (Array.isArray(raw)) return undefined;
  const value = String(raw ?? '').trim();
  if (!value) return undefined;
  if (['select', 'radio'].includes(item.type) && !(item.options ?? []).includes(value)) return undefined;
  return value;
}

export function defaultValueForItem(item) {
  return normalizeTemplateValue(item, item?.defaultValue);
}

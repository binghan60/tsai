// 這份清單只是「預設表單範本」的種子資料（見 formTemplateSeed.js）。
// 系統實際使用的項目定義存在資料庫的 FormTemplate，不要再從這裡讀。
export const BASIC_MEASUREMENT_DEFINITIONS = [
  { key: 'weightKg', label: '體重', group: '基本量測', unit: 'kg' },
  { key: 'temperatureC', label: '體溫', group: '基本量測', unit: '°C' },
  { key: 'heartRate', label: '心率', group: '基本量測', unit: '次/分' },
  { key: 'respiratoryRate', label: '呼吸率', group: '基本量測', unit: '次/分' },
  { key: 'bodyConditionScore', label: '體態評分', group: '基本量測', unit: '/ 9' },
];

export const LAB_TEST_DEFINITIONS = [
  { key: 'rbc', label: '紅血球', group: '基礎血檢' },
  { key: 'wbc', label: '白血球', group: '基礎血檢' },
  { key: 'platelets', label: '血小板', group: '基礎血檢' },
  { key: 'neutrophils', label: '嗜中性球', group: '白血球分類' },
  { key: 'lymphocytes', label: '淋巴球', group: '白血球分類' },
  { key: 'monocytes', label: '單核球', group: '白血球分類' },
  { key: 'eosinophils', label: '嗜酸性球', group: '白血球分類' },
  { key: 'basophils', label: '嗜鹼性球', group: '白血球分類' },
  { key: 'glucose', label: '血糖（GLU）', group: '生化與器官功能' },
  { key: 'sdma', label: '腎臟功能（SDMA）', group: '生化與器官功能' },
  { key: 'bun', label: '腎臟功能（BUN）', group: '生化與器官功能' },
  { key: 'cre', label: '腎臟功能（CRE）', group: '生化與器官功能' },
  { key: 'albumin', label: '肝臟功能（ALB）', group: '生化與器官功能' },
  { key: 'alt', label: '肝臟酵素（ALT）', group: '生化與器官功能' },
  { key: 'alp', label: '膽囊（ALP）', group: '生化與器官功能' },
  { key: 'sodium', label: '鈉（Na）', group: '電解質' },
  { key: 'potassium', label: '鉀（K）', group: '電解質' },
  { key: 'chloride', label: '氯（Cl）', group: '電解質' },
  { key: 'urine_specific_gravity', label: '尿比重', group: '尿液檢查' },
  { key: 'urine_sediment', label: '尿渣', group: '尿液檢查', numeric: false },
];

export function normalizeSpecies(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text.includes('貓') || text.includes('feline') || text === 'cat') return 'cat';
  if (text.includes('狗') || text.includes('犬') || text.includes('canine') || text === 'dog') return 'dog';
  return 'all';
}

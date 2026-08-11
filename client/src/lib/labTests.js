export const BASIC_MEASUREMENTS = [
  { key: 'weightKg', label: '體重', group: '基本量測', unit: 'kg', inputMin: 0, step: 0.01 },
  { key: 'temperatureC', label: '體溫', group: '基本量測', unit: '°C', inputMin: 0, step: 0.1 },
  { key: 'heartRate', label: '心率', group: '基本量測', unit: '次/分', inputMin: 0, step: 1 },
  { key: 'respiratoryRate', label: '呼吸率', group: '基本量測', unit: '次/分', inputMin: 0, step: 1 },
  { key: 'bodyConditionScore', label: '體態評分', group: '基本量測', unit: '/ 9', inputMin: 1, inputMax: 9, step: 1 },
];

export const LAB_TESTS = [
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

export const LAB_GROUPS = [...new Set(LAB_TESTS.map((item) => item.group))];
export const REFERENCE_GROUPS = [...new Set([...BASIC_MEASUREMENTS, ...LAB_TESTS].map((item) => item.group))];

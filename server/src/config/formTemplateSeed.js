import { BASIC_MEASUREMENT_DEFINITIONS, LAB_TEST_DEFINITIONS } from './labTests.js';

// 一份範本 = 一種健檢類型。這些是原本寫死在表單裡的健檢類型，
// 各自建成一份內容相同的範本，之後可以分別調整成不同的表單。
export const SEED_TEMPLATE_NAMES = ['例行健檢', '幼年健檢', '熟齡健檢', '術前評估', '追蹤檢查', '其他'];

export const DEFAULT_TEMPLATE_NAME = SEED_TEMPLATE_NAMES[0];

// 量測項目的輸入限制，原本散在 client/src/lib/labTests.js，改由範本提供。
const MEASUREMENT_INPUT = {
  weightKg: { min: 0, step: 0.01 },
  temperatureC: { min: 0, step: 0.1 },
  heartRate: { min: 0, step: 1 },
  respiratoryRate: { min: 0, step: 1 },
  bodyConditionScore: { min: 1, max: 9, step: 1 },
};

// 原本硬編碼在 RecordFormPage.vue 的 EXAMINATION_ITEMS。
const EXAMINATION_ITEMS = [
  { key: 'auscultation', label: '聽診' },
  { key: 'palpation', label: '觸診' },
  { key: 'general', label: '整體外觀與精神' },
  { key: 'oral', label: '口腔與牙齦' },
  { key: 'skin_coat', label: '皮膚與被毛' },
  { key: 'eyes', label: '眼睛' },
  { key: 'ears', label: '耳朵' },
  { key: 'cardiovascular', label: '心血管' },
  { key: 'respiratory', label: '呼吸系統' },
  { key: 'digestive', label: '腹部與消化系統' },
  { key: 'musculoskeletal', label: '肌肉骨骼' },
  { key: 'neurological', label: '神經與行為' },
  { key: 'urogenital', label: '泌尿生殖系統' },
];

function withOrder(items) {
  return items.map((item, index) => ({ ...item, order: index }));
}

// 產生與現行表單完全對應的區塊結構。
// key 一律沿用既有欄位名稱，確保歷史報告的 examinationFindings／labFindings 對得上。
export function buildDefaultSections() {
  return withOrder([
      {
        key: 'info',
        title: '健檢資訊與健康背景',
        // 醫師／日期／類型在報告上是提到頁首的，這個區塊在報告上只剩主訴與病史。
        reportTitle: '主訴與病史',
        description: '記錄本次健檢基本資訊、主訴與病史',
        presentation: 'keyValue',
        items: withOrder([
          { key: 'vet', label: '獸醫師', type: 'text', role: 'vet', required: true },
          { key: 'visitDate', label: '健檢日期', type: 'date', role: 'visitDate', required: true },
          { key: 'chiefComplaint', label: '主訴', type: 'textarea', rows: 3 },
          { key: 'history', label: '病史', type: 'textarea', rows: 3 },
        ]),
      },
      {
        key: 'measurements',
        title: '基本量測',
        description: '包含範例中的體重與體溫',
        presentation: 'grid',
        items: withOrder(
          BASIC_MEASUREMENT_DEFINITIONS.map((item) => ({
            key: item.key,
            label: item.label,
            type: 'measurement',
            role: item.key === 'weightKg' ? 'weight' : null,
            unit: item.unit ?? '',
            ...MEASUREMENT_INPUT[item.key],
          }))
        ),
      },
      {
        key: 'examination',
        title: '理學檢查',
        description: '整合聽診、觸診、口腔牙齦與各身體系統',
        presentation: 'findings',
        items: withOrder(EXAMINATION_ITEMS.map((item) => ({ ...item, type: 'finding' }))),
      },
      {
        key: 'labs',
        title: '血液與尿液檢查',
        description: '輸入數值後，已設定範圍的項目會自動判斷',
        presentation: 'table',
        items: withOrder([
          ...LAB_TEST_DEFINITIONS.map((item) => ({
            key: item.key,
            label: item.label,
            type: 'lab',
            group: item.group,
            numeric: item.numeric !== false,
          })),
          { key: 'labSummary', label: '檢驗總結', type: 'textarea', rows: 3 },
        ]),
      },
      {
        key: 'conclusion',
        title: '結論與診斷',
        description: '統整檢查發現並記錄診斷與後續方向',
        presentation: 'prose',
        items: withOrder([
          { key: 'conclusion', label: '結論', type: 'textarea', role: 'conclusion', rows: 4 },
          { key: 'diagnosis', label: '診斷', type: 'textarea', rows: 4 },
          { key: 'treatmentPlan', label: '照護與追蹤建議', type: 'textarea', role: 'treatmentPlan', rows: 4 },
          { key: 'other', label: '其他備註', type: 'textarea', rows: 3 },
        ]),
      },
  ]);
}

// 每個健檢類型各建一份內容相同的範本，之後可以分別調整。
export function buildSeedTemplates() {
  return SEED_TEMPLATE_NAMES.map((name, index) => ({
    name,
    // 種子表單先不限物種，使用者可依需要各自收窄成貓／犬專用。
    species: 'all',
    enabled: true,
    order: index,
    version: 1,
    sections: buildDefaultSections(),
  }));
}

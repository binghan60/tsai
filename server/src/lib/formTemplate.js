import FormTemplate, { ITEM_ROLES, ITEM_TYPES, PRESENTATIONS } from '../models/FormTemplate.js';
import MedicalRecord from '../models/MedicalRecord.js';
import { buildSeedTemplates } from '../config/formTemplateSeed.js';
import { normalizeSpecies } from '../config/labTests.js';

// 這個型別填出來的值長什麼樣，以及 schema 欄位收的是什麼值。
const TYPE_VALUE_KIND = {
  number: 'number',
  measurement: 'number',
  date: 'date',
  text: 'string',
  textarea: 'string',
  quickSelect: 'string',
  select: 'string',
  radio: 'string',
  // 複選的作答是字串陣列，塞不進任何具名欄位，一律收進 customValues。
  checkbox: 'list',
  image: 'list',
  dentalChart: 'object',
};
const SCHEMA_VALUE_KIND = { Number: 'number', Date: 'date', Map: 'object' };
const ITEM_SPANS = ['auto', 'wide', 'full'];

// 每個項目的作答存在哪裡。由後端判定後隨範本一起回傳，
// 前端不必自己維護一份「哪些是內建欄位」的清單。
export function storageFor(item) {
  if (item.type === 'finding') return 'examinationFindings';
  if (item.type === 'lab') return 'labFindings';
  const path = MedicalRecord.schema.path(item.key);
  if (!path) return 'custom';
  // 型別與具名欄位對不上就改收進 customValues（Mixed）。範本要能自由改型別，
  // 就不能硬塞進型別固定的 schema 欄位 —— 把體溫改成文字後填「微燒」會 cast 失敗。
  const schemaKind = SCHEMA_VALUE_KIND[path.instance] ?? 'string';
  return TYPE_VALUE_KIND[item.type] === schemaKind ? 'field' : 'custom';
}

// 預設值是範本的一部分，建立草稿的入口不只表單頁：掛號完成也會在後端直接建草稿。
// 因此必須在後端同樣套用，否則從掛號進入的新健檢會漏掉預設值。
export function defaultRecordFields(template) {
  const fields = {};
  const customValues = {};
  const supportedTypes = new Set(['text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox', 'quickSelect']);

  for (const item of flattenItems(template)) {
    const text = String(item.defaultValue ?? '').trim();
    if (!text || item.enabled === false || !supportedTypes.has(item.type)) continue;

    let value = text;
    if (item.type === 'checkbox') {
      const options = new Set((item.options ?? []).filter(Boolean));
      value = text.split(',').map((option) => option.trim()).filter((option) => options.has(option));
      if (!value.length) continue;
    } else if (['select', 'radio'].includes(item.type) && !(item.options ?? []).includes(value)) {
      continue;
    }

    if (storageFor(item) === 'custom') customValues[item.key] = value;
    else fields[item.key] = value;
  }

  return Object.keys(customValues).length ? { ...fields, customValues } : fields;
}

// 第一次執行時把預設的健檢類型建進資料庫。
export async function ensureSeedTemplates() {
  if (await FormTemplate.exists({})) return;
  try {
    await FormTemplate.insertMany(buildSeedTemplates());
  } catch (err) {
    // 並發初始化時會撞上 name 的唯一索引，後到的直接沿用既有資料。
    if (err.code !== 11000) throw err;
  }
}

// 建立報告時可選的健檢類型（停用的不列出）。
// 帶 species 時只回傳適用於該物種的表單（含不限物種的）。
export async function listTemplates({ includeDisabled = false, species } = {}) {
  await ensureSeedTemplates();
  const filter = includeDisabled ? {} : { enabled: { $ne: false } };
  if (species) {
    const normalized = normalizeSpecies(species);
    // null 同時涵蓋「值為 null」與「欄位不存在」—— 在 species 欄位加入前建立的表單
    // 沒有這個欄位，它們等同於「不限物種」，不能被濾掉。
    if (normalized !== 'all') filter.species = { $in: [normalized, 'all', null] };
  }
  return FormTemplate.find(filter).sort({ order: 1, createdAt: 1 });
}

// 報告要用「它自己的」範本。找不到時回傳 null，呼叫端會退回報告自己的
// sections 快照（已結案報告一定有快照）。
export async function templateForRecord(record) {
  if (!record?.templateId) return null;
  return FormTemplate.findById(record.templateId);
}

function sortByOrder(list) {
  return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// includeDisabled：範本編輯器要看到停用項目，填表單／出報告則只要啟用的。
export function serializeTemplate(template, { includeDisabled = false } = {}) {
  const doc = template.toObject ? template.toObject() : template;
  const sections = sortByOrder(doc.sections ?? [])
    .filter((section) => includeDisabled || section.enabled !== false)
    .map((section) => ({
      ...section,
      items: sortByOrder(section.items ?? [])
        .filter((item) => includeDisabled || item.enabled !== false)
        .map((item) => ({ ...item, storage: storageFor(item) })),
    }));

  return {
    _id: doc._id,
    name: doc.name,
    description: doc.description ?? '',
    species: doc.species ?? 'all',
    enabled: doc.enabled !== false,
    order: doc.order ?? 0,
    version: doc.version,
    documentVersion: doc.__v ?? 0,
    updatedAt: doc.updatedAt,
    sections,
  };
}

// 類型選單只需要名稱，不必把整份結構送過去。
export function serializeTemplateSummary(template) {
  const doc = template.toObject ? template.toObject() : template;
  return {
    _id: doc._id,
    name: doc.name,
    description: doc.description ?? '',
    species: doc.species ?? 'all',
    enabled: doc.enabled !== false,
    documentVersion: doc.__v ?? 0,
    order: doc.order ?? 0,
    sectionCount: (doc.sections ?? []).length,
    itemCount: (doc.sections ?? []).reduce((sum, section) => sum + (section.items ?? []).length, 0),
  };
}

// ── 範本編輯 ──
// key 由後端產生且永不修改，使用者改的是 label；已刪除的 key 記在 retiredKeys，
// 不再重複使用，避免新項目繼承到舊項目的歷史語意。
function nextKey(prefix, taken) {
  let key;
  do {
    key = `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
  } while (taken.has(key));
  taken.add(key);
  return key;
}

// 注意 Number('  ') 是 0 而不是 NaN —— 沒有先 trim 的話，
// 在參考範圍欄位打幾個空白就會被存成 0（上限 0 會讓所有數值都判成異常）。
const numberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
};

function sanitizeItem(raw, key, index) {
  const type = ITEM_TYPES.includes(raw.type) ? raw.type : 'text';
  return {
    key,
    label: String(raw.label ?? '').trim() || '未命名項目',
    type,
    role: ITEM_ROLES.includes(raw.role) ? raw.role : null,
    group: String(raw.group ?? '').trim(),
    unit: String(raw.unit ?? '').trim(),
    placeholder: String(raw.placeholder ?? '').trim(),
    defaultValue: String(raw.defaultValue ?? '').trim(),
    options: Array.isArray(raw.options) ? raw.options.map((option) => String(option).trim()).filter(Boolean) : [],
    quickMenuId: String(raw.quickMenuId ?? '').trim(),
    span: ITEM_SPANS.includes(raw.span) ? raw.span : 'auto',
    order: index,
    enabled: raw.enabled !== false,
    required: raw.required === true,
    numeric: raw.numeric !== false,
    rows: Number.isFinite(Number(raw.rows)) && raw.rows ? Number(raw.rows) : null,
    // 跟 referenceMin／referenceMax 走同一個 numberOrNull。原本這三個只擋 ''，
    // 於是打幾個空白會被 Number('  ') 判成 0——max 變成 0 的話每個數值都會超出上限，
    // 那份報告就再也結不了案；打上非數字則是 NaN，存檔時直接 cast 失敗。
    min: numberOrNull(raw.min),
    max: numberOrNull(raw.max),
    step: numberOrNull(raw.step),
    referenceMin: numberOrNull(raw.referenceMin),
    referenceMax: numberOrNull(raw.referenceMax),
  };
}

// 區塊與項目是兩個獨立的命名空間 —— 預設範本裡「結論」既是區塊也是項目，
// 兩者同名並不衝突，只要各自不重複即可。
function collectKeys(list) {
  const seen = new Set();
  const duplicates = new Set();
  for (const key of list) {
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return { seen, duplicates };
}

export function sanitizeSections(rawSections, existing) {
  const retired = new Set(existing?.retiredKeys ?? []);
  const knownSectionKeys = new Set((existing?.sections ?? []).map((section) => section.key));
  const knownItemKeys = new Set((existing?.sections ?? []).flatMap((section) => (section.items ?? []).map((item) => item.key)));

  // key 就是身分。同一份送出的內容裡出現重複 key，代表前端有 bug 或有人想
  // 把某個項目的識別碼安到別的項目上；無法分辨意圖，直接拒收。
  const sectionKeys = collectKeys((rawSections ?? []).map((section) => section.key));
  const itemKeys = collectKeys((rawSections ?? []).flatMap((section) => (section.items ?? []).map((item) => item.key)));
  const duplicates = [...sectionKeys.duplicates, ...itemKeys.duplicates];
  if (duplicates.length) return { error: `表單結構有重複的識別碼：${duplicates.join('、')}` };

  // 只要 key 還在目前的範本裡就沿用。這裡刻意不查 retiredKeys ——
  // 已刪除的 key 本來就不在 knownKeys 裡，再查一次沒有意義，
  // 反而會誤傷：retiredKeys 是單一集合，但區塊與項目是兩個命名空間，
  // 種子裡「結論」剛好兩者同名，刪掉結論區塊會連帶讓結論欄位被迫改名。
  // retiredKeys 的真正用途是讓 nextKey 不要撞到舊 key（見下方 taken）。
  const reusableSection = (key) => Boolean(key) && knownSectionKeys.has(key);
  const reusableItem = (key) => Boolean(key) && knownItemKeys.has(key);
  const takenSections = new Set([...retired, ...[...sectionKeys.seen].filter(reusableSection)]);
  const takenItems = new Set([...retired, ...[...itemKeys.seen].filter(reusableItem)]);

  const sections = (rawSections ?? []).map((rawSection, sectionIndex) => ({
    key: reusableSection(rawSection.key) ? rawSection.key : nextKey('section', takenSections),
    title: String(rawSection.title ?? '').trim() || '未命名區塊',
    reportTitle: String(rawSection.reportTitle ?? '').trim(),
    description: String(rawSection.description ?? '').trim(),
    presentation: PRESENTATIONS.includes(rawSection.presentation) ? rawSection.presentation : 'keyValue',
    order: sectionIndex,
    enabled: rawSection.enabled !== false,
    items: (rawSection.items ?? []).map((rawItem, itemIndex) =>
      sanitizeItem(rawItem, reusableItem(rawItem.key) ? rawItem.key : nextKey('custom', takenItems), itemIndex)
    ),
  }));

  // 這次存檔後消失的 key 全部歸入 retiredKeys。
  const survivingSections = new Set(sections.map((section) => section.key));
  const survivingItems = new Set(sections.flatMap((section) => section.items.map((item) => item.key)));
  const newlyRetired = [
    ...[...knownSectionKeys].filter((key) => !survivingSections.has(key)),
    ...[...knownItemKeys].filter((key) => !survivingItems.has(key)),
  ];
  return { sections, retiredKeys: [...new Set([...retired, ...newlyRetired])] };
}

// 帶 role 的項目消失會讓對應的系統功能失效，儲存前先擋下來。
export function missingRoles(sections, existing) {
  // before／after 的條件必須對稱，否則區塊一旦停用，之後每次儲存都會
  // 重複跳出同一則「移除連動欄位」的確認。
  const before = new Set(
    (existing?.sections ?? []).flatMap((section) => (section.items ?? [])
      .filter((item) => item.role && item.enabled !== false && section.enabled !== false)
      .map((item) => item.role))
  );
  const after = new Set(
    sections.flatMap((section) => (section.items ?? [])
      .filter((item) => item.role && item.enabled !== false && section.enabled !== false)
      .map((item) => item.role))
  );
  return [...before].filter((role) => !after.has(role));
}

export function flattenItems(template) {
  const doc = template.toObject ? template.toObject() : template;
  return (doc.sections ?? []).flatMap((section) =>
    (section.items ?? []).map((item) => ({ ...item, sectionKey: section.key }))
  );
}

// 後端靠 role 找欄位，不寫死欄位名稱，使用者才能自由改標籤與搬動位置。
export function findItemByRole(template, role) {
  return flattenItems(template).find((item) => item.role === role && item.enabled !== false) ?? null;
}

import { storageFor } from './formTemplate.js';

// 把「範本結構」與「報告的實際作答」組合成報告頁可以直接渲染的區塊快照。
//
// 臨床資料存在 MedicalRecord 的具名欄位（weightKg、diagnosis、examinationFindings…），
// 這裡負責把它們對應回範本項目。草稿每次讀取都即時組合；結案時把結果凍結成
// record.sections，之後改範本就不會回頭改動已結案的報告。

function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0);
}

// 讀哪裡由 storageFor 決定，跟寫入端同一套判斷。不能用「具名欄位優先」——
// 項目改過型別後具名欄位可能還留著舊值，報告會一直顯示改型別之前的內容。
function readValue(record, item) {
  if (storageFor(item) === 'field') return record[item.key];
  const custom = record.customValues;
  if (!custom) return null;
  const value = custom instanceof Map ? custom.get(item.key) : custom[item.key];
  return value === undefined ? null : value;
}

function baseItem(item) {
  return {
    key: item.key,
    label: item.label,
    type: item.type,
    role: item.role ?? null,
    unit: item.unit ?? '',
    group: item.group ?? '',
    span: item.span ?? 'auto',
    // 結案驗證是走訪組合後的 sections，必填旗標一定要跟著帶過來。
    required: item.required === true,
  };
}

// Mongoose 子文件用展開運算子只會拿到 _doc、$__ 這些內部屬性，schema 欄位一個都取不到，
// 組出來的項目會缺 key／label。取欄位前一律先轉成純物件。
const plain = (doc) => (doc?.toObject ? doc.toObject() : doc);

function composeItem(record, item) {
  if (item.type === 'finding') {
    const saved = (record.examinationFindings ?? []).find((entry) => entry.key === item.key);
    return {
      ...baseItem(item),
      status: saved?.status ?? 'not_checked',
      note: saved?.note ?? '',
    };
  }

  if (item.type === 'lab') {
    const saved = (record.labFindings ?? []).find((entry) => entry.key === item.key);
    return {
      ...baseItem(item),
      unit: saved?.unit || item.unit || '',
      status: saved?.status ?? 'not_checked',
      statusSource: saved?.statusSource ?? 'manual',
      value: saved?.value ?? '',
      referenceMin: saved?.referenceMin ?? null,
      referenceMax: saved?.referenceMax ?? null,
      note: saved?.note ?? '',
      numeric: item.numeric !== false,
    };
  }

  if (item.type === 'measurement') {
    const assessment = (record.measurementAssessments ?? []).find((entry) => entry.key === item.key);
    return {
      ...baseItem(item),
      unit: assessment?.unit || item.unit || '',
      value: readValue(record, item) ?? null,
      status: assessment?.status ?? 'not_checked',
      statusSource: assessment?.statusSource ?? 'auto',
      referenceMin: assessment?.referenceMin ?? null,
      referenceMax: assessment?.referenceMax ?? null,
    };
  }

  // 其餘一般欄位直接對應同名欄位。複選沒作答時要是空陣列，不是空字串。
  return { ...baseItem(item), value: readValue(record, item) ?? (item.type === 'checkbox' ? [] : '') };
}

// 使用者刪掉某個項目後，已經記錄過該項目的報告不能讓資料憑空消失 ——
// 病歷必須完整保留當時記錄的內容。補回對應型別的區塊尾端；
// 真的找不到落腳處就另開一個區塊收容。
function appendOrphans(sections, record) {
  const knownKeys = new Set(sections.flatMap((section) => section.items.map((item) => item.key)));
  const orphans = [];

  for (const saved of record.examinationFindings ?? []) {
    if (knownKeys.has(saved.key)) continue;
    orphans.push({ type: 'finding', item: { ...baseItem({ ...plain(saved), type: 'finding' }), status: saved.status, note: saved.note ?? '' } });
  }
  for (const saved of record.labFindings ?? []) {
    if (knownKeys.has(saved.key)) continue;
    orphans.push({
      type: 'lab',
      item: {
        ...baseItem({ ...plain(saved), type: 'lab' }),
        status: saved.status,
        statusSource: saved.statusSource ?? 'manual',
        value: saved.value ?? '',
        referenceMin: saved.referenceMin ?? null,
        referenceMax: saved.referenceMax ?? null,
        note: saved.note ?? '',
        // labFindingSchema 沒有存 numeric，範本又已經刪掉這個項目，只能從記下來的值回推。
        // 一律當數值型會讓「少量結晶」這類文字結果永遠卡在結案驗證，
        // 而孤兒項目在表單上已經改不到了，使用者無從補救。
        numeric: !String(saved.value ?? '').trim() || Number.isFinite(Number(saved.value)),
      },
    });
  }
  if (!orphans.length) return sections;

  const leftover = [];
  for (const orphan of orphans) {
    const host = [...sections].reverse().find((section) => section.items.some((item) => item.type === orphan.type));
    if (host) host.items.push(orphan.item);
    else leftover.push(orphan.item);
  }
  if (leftover.length) {
    sections.push({
      key: 'removed_items',
      title: '其他紀錄',
      description: '目前表單範本已不包含這些項目，但本報告仍保留原始紀錄。',
      presentation: leftover.every((item) => item.type === 'finding') ? 'findings' : 'table',
      order: sections.length,
      items: leftover,
    });
  }
  return sections;
}

export function composeReportSections(record, template) {
  const sections = (template?.sections ?? [])
    .filter((section) => section.enabled !== false)
    .slice()
    .sort(byOrder)
    .map((section) => ({
      key: section.key,
      title: section.reportTitle || section.title,
      description: section.description ?? '',
      presentation: section.presentation ?? 'keyValue',
      order: section.order ?? 0,
      items: (section.items ?? [])
        .filter((item) => item.enabled !== false)
        .slice()
        .sort(byOrder)
        .map((item) => composeItem(record, item)),
    }));

  return appendOrphans(sections, record);
}

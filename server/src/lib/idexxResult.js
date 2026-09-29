import { TextDecoder } from 'node:util';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { combineClinicDateTime } from './clinicTime.js';

// IDEXX InterLink 存下來的檢驗結果 XML（result_20.dtd）→ 整理好的資料。
// 格式見 IDEXX InterLink Programmer's Guide 附錄 A.5，但實際檔案比文件亂，這裡照真實範例寬鬆處理：
// - 不驗證 DTD：Catalyst One 的輸出在 <assay_result> 裡夾了一段不屬於任何欄位的文字。
// - 儀器名稱與項目代號不寫死：文件（2013 年）沒列 Catalyst_One、IDEXX_inVue_Dx、SDMA，之後還會有新的。
// - 數值一律是字串：SNAP 回 Positive／Negative，inVue 回整句判讀，不是每一項都是數字。

export class IdexxParseError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'IdexxParseError';
    this.code = code;
  }
}

// 結果檔目前都是 UTF-8，但 IDEXX 給的請求範例是 Big5——照 XML 宣告的編碼解碼，中文貓名才不會變亂碼。
// 有 BOM 就一定是 UTF-8；TextDecoder 會自己把 BOM 拿掉。
export function decodeIdexxXml(input) {
  if (typeof input === 'string') return input;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1];
  const label = hasBom ? 'utf-8' : declared || 'utf-8';
  let decoder;
  try {
    decoder = new TextDecoder(label);
  } catch {
    throw new IdexxParseError(`不支援的檔案編碼：${label}`, 'encoding');
  }
  return decoder.decode(bytes);
}

const IDEXX_DATE_TIME =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(AM|PM)?)?$/i;

function idexxDateParts(value) {
  const match = IDEXX_DATE_TIME.exec(String(value ?? '').trim());
  if (!match) return null;
  const [, month, day, year, hourText, minute = '00', second = '0', fraction = '0', meridiem] = match;
  let hour = Number(hourText ?? 0);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  }
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  if (hour > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  return {
    date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${minute}`,
    ms: Number(second) * 1000 + Number(fraction.padEnd(3, '0')),
  };
}

// IDEXX 主機記的是診所的牆上時間（MM/DD/YYYY hh:mm:ss.sss AM|PM），沒有帶時區，
// 所以要照診所時區換算，不能直接 new Date()——伺服器在 UTC，會整整差八小時。
export function parseIdexxDateTime(value) {
  const parts = idexxDateParts(value);
  if (!parts) return null;
  const base = combineClinicDateTime(parts.date, parts.time);
  return base ? new Date(base.getTime() + parts.ms) : null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'assay_result' || name === 'instrument_note',
});

// 只有文字的元素解析出來是字串；帶屬性或夾雜文字的元素，文字在 #text 底下。
function text(node) {
  if (typeof node === 'string') return node.trim();
  if (node && typeof node['#text'] === 'string') return node['#text'].trim();
  return '';
}

function attr(node, name) {
  return String(node?.[`@_${name}`] ?? '').trim();
}

function toNumber(value) {
  const raw = text(value);
  return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
}

// 同一個「微」字，Catalyst 用 µ（U+00B5 micro sign）、inVue 用 μ（U+03BC 希臘字母），統一成後者才比對得起來。
function normalizeUnit(value) {
  return text(value).replace(/µ/g, 'μ');
}

function parseAssay(node) {
  const range = node.assay_reference_range ?? {};
  return {
    code: attr(node, 'assay_name'),
    value: text(node.result_value),
    unit: normalizeUnit(node.result_value_uom_cd),
    referenceMin: toNumber(range.low),
    referenceMax: toNumber(range.high),
    criticalMin: toNumber(range.critical_low),
    criticalMax: toNumber(range.critical_high),
    qualifier: text(node.result_qualifier),
  };
}

function parseWeight(node) {
  const value = toNumber(node?.weight);
  // 沒量體重時 IDEXX 主機送 0，當成沒有資料。
  if (value === null || value <= 0) return null;
  return { value, unit: attr(node, 'patient_weight_uom') };
}

function person(node) {
  return { firstName: text(node?.first_name), lastName: text(node?.last_name) };
}

export function parseIdexxResult(input) {
  const xml = decodeIdexxXml(input);
  // 抓檔時 InterLink 可能還沒寫完；不完整的檔案要明確報錯，不能默默少讀幾項。
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new IdexxParseError(`XML 不完整（第 ${validation.err.line} 行：${validation.err.msg}）`, 'malformed');
  }

  const message = parser.parse(xml)?.message;
  if (!message) throw new IdexxParseError('不是 IDEXX InterLink 的訊息檔', 'unknown');
  const messageType = attr(message, 'message_type');
  if (messageType !== 'Result') {
    throw new IdexxParseError(`不是檢驗結果（${messageType || '未知類型'}）`, 'not_result');
  }

  const result = message.body?.result;
  const diagnosticSetId = attr(result, 'diagnostic_set_id');
  const instrument = attr(result, 'instrument');
  if (!diagnosticSetId || !instrument) {
    throw new IdexxParseError('檢驗結果缺少 diagnostic_set_id 或 instrument', 'invalid');
  }
  const assays = (result.results?.assay_result ?? []).map(parseAssay).filter((assay) => assay.code);
  if (!assays.length) throw new IdexxParseError('檢驗結果裡沒有任何項目', 'invalid');

  const patient = result.patient ?? {};
  return {
    messageId: attr(message, 'message_id'),
    messageAt: parseIdexxDateTime(attr(message, 'message_dt')),
    // New_Results／Replace_Previous_Results／Restore_Previous_Results／Resend_of_Previous_Results
    subType: attr(message, 'message_sub_type'),
    // 從我們這邊開單才會有；直接在 IDEXX 主機上做的檢驗是空字串。
    requisitionNumber: attr(result, 'requisition_number'),
    // 同一次檢驗的識別碼，重送、更正都沿用同一個，用來判斷「這份已經收過」。
    diagnosticSetId,
    instrument,
    runAt: parseIdexxDateTime(text(result.run_dt)),
    client: { id: attr(result.client, 'client_id'), ...person(result.client) },
    patient: {
      // 報到時送給 IDEXX 主機的編號會原樣帶回來；IDEXX 主機不認得這隻貓時是空字串。
      id: attr(patient, 'patient_id'),
      name: text(patient.patient_name),
      species: attr(patient, 'patient_species'),
      gender: attr(patient, 'patient_gender'),
      breed: text(patient.patient_breed),
      birthDate: idexxDateParts(text(patient.patient_birth_dt))?.date ?? null,
      weight: parseWeight(patient.patient_weight),
    },
    doctor: person(result.doctor),
    assays,
    notes: (result.instrument_notes?.instrument_note ?? []).map(text).filter(Boolean),
  };
}

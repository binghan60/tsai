import { combineClinicDateTime } from './clinicTime.js';
import { templateLabItems } from '../../../shared/labValues.js';
import { mergeLabValues, workflowError } from './appointmentWorkflow.js';

// 報到建立的健檢報告草稿連著一筆看診（appointment.recordId 指向它）。
// 體重、體溫、回診日期、檢驗數值只存在看診上——草稿不存這幾欄的值：
//   - 讀取時由看診即時疊上去（visitOverlay）；
//   - 在報告上改＝寫回看診（applyVisitEdits），診療台、病歷日誌、報告永遠是同一個值；
//   - 結案時才把當下的值凍結進報告（routes/records.js 的 finalize）。
// 回診日期例外只能讀：它是櫃台敲定時段、同時建立下一筆掛號的那一步，只在掛號台改。
// 檢驗項目靠範本裡「檢驗」類型項目的 key 對應，不是表單設計器上的設定。
export const VISIT_FIELDS = ['weightKg', 'temperatureC', 'followUpDate'];

export { templateLabItems };

export function visitValues(appointment) {
  return {
    weightKg: appointment?.weightKg ?? null,
    temperatureC: appointment?.temperatureC ?? null,
    followUpDate: appointment?.followUpDate ? combineClinicDateTime(appointment.followUpDate, appointment.followUpTime) : null,
    labs: new Map((appointment?.labValues ?? []).map((lab) => [lab.key, String(lab.value ?? '')])),
  };
}

// 跟填寫頁（RecordFormPage 的 applyAutomaticJudgement）同一套自動判讀：數值落在參考範圍外＝異常；
// 文字結果（numeric: false）有內容就標異常提醒醫師確認。醫師手動選過狀態的不動。
function judgeLab(finding, item) {
  if (finding.statusSource === 'manual' && finding.status !== 'not_checked') return finding;
  const text = String(finding.value ?? '').trim();
  if (!text) return { ...finding, status: 'not_checked', statusSource: 'auto' };
  if (item.numeric === false) return { ...finding, status: 'abnormal', statusSource: 'auto' };
  const numeric = Number(text);
  const min = item.referenceMin ?? null;
  const max = item.referenceMax ?? null;
  if (!Number.isFinite(numeric) || (min === null && max === null)) return { ...finding, status: 'not_checked', statusSource: 'auto' };
  const abnormal = (min !== null && numeric < min) || (max !== null && numeric > max);
  return { ...finding, status: abnormal ? 'abnormal' : 'normal', statusSource: 'auto', unit: item.unit || finding.unit || '', referenceMin: min, referenceMax: max };
}

const plain = (value) => (value && typeof value.toObject === 'function' ? value.toObject() : { ...value });

// 疊上看診值後的欄位。檢驗的狀態（手動判讀）與備註是報告自己的內容，留在草稿上；只有數值來自看診。
export function visitOverlay(record, appointment, template) {
  const visit = visitValues(appointment);
  const items = templateLabItems(template);
  const current = new Map((record?.labFindings ?? []).map((finding) => [finding.key, plain(finding)]));
  const labFindings = [];
  for (const item of items) {
    const existing = current.get(item.key);
    const value = visit.labs.get(item.key) ?? '';
    if (!existing && !value) continue;
    const base = existing ?? {
      key: item.key, label: item.label, group: item.group || '', status: 'not_checked', statusSource: 'auto',
      value: '', unit: item.unit || '', referenceMin: item.referenceMin ?? null, referenceMax: item.referenceMax ?? null, note: '',
    };
    labFindings.push(judgeLab({ ...base, value }, item));
  }
  // 範本裡已經拿掉的檢驗項目照原樣留著。
  for (const [key, finding] of current) if (!items.some((item) => item.key === key)) labFindings.push(finding);
  return { weightKg: visit.weightKg, temperatureC: visit.temperatureC, followUpDate: visit.followUpDate, labFindings };
}

// 填寫頁送來的草稿欄位裡，屬於看診的那幾欄不存：值一律清掉，只留檢驗的狀態與備註。
export function stripVisitFields(fields, template) {
  const next = { ...fields };
  for (const field of VISIT_FIELDS) if (next[field] !== undefined) next[field] = null;
  if (Array.isArray(next.labFindings)) {
    const labKeys = new Set(templateLabItems(template).map((item) => item.key));
    next.labFindings = next.labFindings.map((finding) => (labKeys.has(finding?.key) ? { ...finding, value: '' } : finding));
  }
  return next;
}

export function hasVisitEdits(edits) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) return false;
  return edits.weightKg !== undefined || edits.temperatureC !== undefined
    || (edits.labValues && typeof edits.labValues === 'object' && Object.keys(edits.labValues).length > 0);
}

// 報告上改了看診的欄位：寫回看診。跟病歷日誌一樣不看流程階段——報告常在看診結束後才寫，
// 是事後更正紀錄的地方；診療台工作區那邊仍照原本的鎖定規則。
// edits 只帶醫師這次真的改過的欄位（填寫頁跟上次從伺服器拿到的值比），不會拿舊畫面蓋掉診療台剛改的值。
export function applyVisitEdits(appointment, edits, labItems) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) throw workflowError('看診欄位格式不正確');
  for (const field of ['weightKg', 'temperatureC']) {
    if (edits[field] === undefined) continue;
    const value = edits[field] === '' || edits[field] === null ? null : Number(edits[field]);
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw workflowError('量測值必須是有效的非負數');
    appointment[field] = value;
  }
  if (edits.labValues !== undefined) appointment.labValues = mergeLabValues(appointment.labValues, edits.labValues, labItems);
}

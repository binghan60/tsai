import { combineClinicDateTime } from './clinicTime.js';
import { templateLabItems } from '../../../shared/labValues.js';

// 報到時建立的健檢報告草稿，這幾個欄位預設跟著這次看診（appointment）走。
// 看診是唯一存放處；報告只是在醫師沒有親手改過之前，一直帶入看診的值。
// 醫師在報告裡改過的欄位記在 record.overriddenKeys，之後就不再覆蓋；檢驗項目記成 `lab:<key>`。
// 帶入是固定規則，不是範本上的設定：體重／體溫／回診日期看具名欄位，檢驗看項目 key。
export const FOLLOWED_FIELDS = ['weightKg', 'temperatureC', 'followUpDate'];
export const labOverrideKey = (key) => `lab:${key}`;

export { templateLabItems };

// 客戶端送來的覆寫清單只收這份範本真的有的欄位，重複的去掉。
export function sanitizeOverriddenKeys(keys, template) {
  if (!Array.isArray(keys)) return [];
  const allowed = new Set([...FOLLOWED_FIELDS, ...templateLabItems(template).map((item) => labOverrideKey(item.key))]);
  return [...new Set(keys.map(String).filter((key) => allowed.has(key)))];
}

// 看診要求報告呈現的值。
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
const sameNumber = (a, b) => (a ?? null) === (b ?? null);
const sameDate = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

// 回傳要寫進草稿的 $set（只有真的不同、又沒被覆寫的欄位）；沒東西要改就回空物件。
// record 可以是 Mongoose 文件，也可以是「現有文件＋這次送來的欄位」合併後的普通物件。
export function followedPatch(record, appointment, template) {
  if (!record || record.status === 'finalized') return {};
  const overridden = new Set(record.overriddenKeys ?? []);
  const visit = visitValues(appointment);
  const patch = {};
  for (const field of ['weightKg', 'temperatureC']) {
    if (!overridden.has(field) && !sameNumber(record[field], visit[field])) patch[field] = visit[field];
  }
  if (!overridden.has('followUpDate') && !sameDate(record.followUpDate, visit.followUpDate)) patch.followUpDate = visit.followUpDate;

  const items = templateLabItems(template);
  if (items.length) {
    const current = new Map((record.labFindings ?? []).map((finding) => [finding.key, plain(finding)]));
    let changed = false;
    const next = [];
    for (const item of items) {
      const existing = current.get(item.key);
      const value = visit.labs.get(item.key) ?? '';
      if (overridden.has(labOverrideKey(item.key)) || (existing && existing.value === value) || (!existing && !value)) {
        if (existing) next.push(existing);
        continue;
      }
      const base = existing ?? {
        key: item.key, label: item.label, group: item.group || '', status: 'not_checked', statusSource: 'auto',
        value: '', unit: item.unit || '', referenceMin: item.referenceMin ?? null, referenceMax: item.referenceMax ?? null, note: '',
      };
      next.push(judgeLab({ ...base, value }, item));
      changed = true;
    }
    // 範本裡已經拿掉的檢驗項目照原樣留著，不在這裡刪別人的資料。
    for (const [key, finding] of current) if (!items.some((item) => item.key === key)) next.push(finding);
    if (changed) patch.labFindings = next;
  }
  return patch;
}

// 草稿初建時的欄位（報到、或診療台按「建立表單草稿」）。
export function initialFollowedFields(appointment, template) {
  return followedPatch({ status: 'draft', overriddenKeys: [], labFindings: [] }, appointment, template);
}

// 看診資料改了之後把草稿同步過去。刻意不動 __v：填寫頁開著時自動存檔不該因此撞版本衝突；
// 填寫頁送出的跟隨欄位本來就會在 PUT 時被這套規則改回看診的值（routes/records.js）。
export async function syncDraftFromAppointment({ appointment, MedicalRecord, FormTemplate, session = null }) {
  if (!appointment?.recordId) return null;
  const record = await MedicalRecord.findById(appointment.recordId).session(session);
  if (!record || record.status !== 'draft') return null;
  const template = record.templateId ? await FormTemplate.findById(record.templateId).session(session) : null;
  const patch = followedPatch(record, appointment, template);
  if (!Object.keys(patch).length) return record;
  await MedicalRecord.updateOne({ _id: record._id, status: 'draft' }, { $set: patch }, { session });
  return record;
}

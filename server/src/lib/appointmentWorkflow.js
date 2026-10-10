import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { normalizeRichText, richTextLength, richTextToPlain } from '../../../shared/richText.js';
import { effectiveAssays, labFlag } from '../../../shared/labValues.js';

// 看診流水線的規則（純邏輯，不碰資料庫）。動作有：
//   clinical 存看診內容／start 開始看診／unstart 取消看診／handoff 送交櫃台／reclaim 取回／complete 櫃台完成／
//   request-reopen 醫師申請修改／approve-reopen 櫃台核准／reopen 櫃台自己退回／followup、record 由路由處理（這裡只確認階段）。
export function workflowError(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

// 診療台的文字欄位。系統不計價、不保存金額；收費與領藥由櫃台直接處理。
const CLINICAL_TEXT_FIELDS = ['visitNote', 'prescription', 'internalNote', 'specialCareNote', 'followUpRecommendation'];
const CLINICAL_FIELDS = [...CLINICAL_TEXT_FIELDS, 'weightKg', 'temperatureC', 'labValues', 'imageUpload'];
// 交給櫃台之後櫃台自己還能改的欄位（櫃台處理視窗上有）；其餘要醫師先取回。
const DESK_EDITABLE_FIELDS = ['visitNote', 'internalNote', 'imageUpload'];
const LAB_VALUE_MAX = 40;

// 病歷日誌裡的一行檢驗摘要：「WBC 22.4 ×10³/µL ↑　ALT 168 U/L ↑」。
// 偏高／偏低的箭頭跟健檢報告的自動判讀一致（參考範圍外＝異常，shared/labValues.js 的 labFlag）。
function labSummary(labValues) {
  return (labValues ?? [])
    .filter((lab) => String(lab.value ?? '').trim())
    .map((lab) => [lab.label, lab.value, lab.unit, labFlag(lab)].filter(Boolean).join(' '))
    .join('　');
}

const LAB_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// 診所時區的「10/7 14:32」。自己組字串，不用 Intl 排好的那一串（各版本夾的空白字元不一樣）。
function labTimeLabel(value) {
  const parts = Object.fromEntries(LAB_TIME.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${Number(parts.month)}/${Number(parts.day)} ${parts.hour}:${parts.minute}`;
}

// 病歷日誌裡的 IDEXX 原始結果：連到這次看診的每一份（當天自動歸過來的、診療台「匯入檢驗結果」指定的）各一行，
// 「Catalyst One（10/7 14:32）：CREA 1.8 mg/dL ↑　BUN 25 mg/dL」。儀器給的每一項都列，不管表單有沒有對應欄位——
// 看診沒選表單、表單沒設代號時數值填不進 labValues，日誌上只能靠這一段看到檢驗結果。
function idexxJournalText(labResults) {
  return (labResults ?? [])
    .map((result) => {
      const assays = effectiveAssays(result)
        .filter((assay) => String(assay.value ?? '').trim())
        .map((assay) => [assay.code, assay.value, assay.unit, labFlag(assay)].filter(Boolean).join(' '))
        .join('　');
      if (!assays) return '';
      const when = result.runAt ? `（${labTimeLabel(result.runAt)}）` : '';
      return `${result.instrument || 'IDEXX'}${when}：${assays}`;
    })
    .filter(Boolean)
    .join('\n');
}

// 「檢驗」那一行只留不是 IDEXX 帶進來的數值（手動輸入、或醫師改過的）：IDEXX 填進來而且沒被改過的，
// 已經在「IDEXX 檢驗」那一段，不重複列。
function labValuesOutsideIdexx(labValues, labResults) {
  const filled = new Set((labResults ?? []).flatMap((result) => (result.filled ?? []).map((entry) => `${entry.key}\u0000${entry.value}`)));
  return (labValues ?? []).filter((lab) => !filled.has(`${lab.key}\u0000${lab.value}`));
}

// 送來的檢驗數值（健檢報告填寫頁經 visitEdits 寫回）是 { key: value }；只收掛號範本裡真的有的檢驗項目，
// 存成含名稱、單位、參考範圍的快照（見 models/Appointment.js 的 labValues）。空值＝拿掉。
export function mergeLabValues(current, incoming, labItems) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw workflowError('檢驗數值格式不正確');
  const items = new Map((labItems ?? []).map((item) => [item.key, item]));
  const values = new Map((current ?? []).map((lab) => [lab.key, String(lab.value ?? '')]));
  for (const [key, raw] of Object.entries(incoming)) {
    if (!items.has(key)) throw workflowError('檢驗項目不在這次掛號的表單裡');
    if (raw !== null && typeof raw !== 'string' && typeof raw !== 'number') throw workflowError('檢驗數值格式不正確');
    const value = String(raw ?? '').trim();
    if (value.length > LAB_VALUE_MAX) throw workflowError(`檢驗數值過長（最多 ${LAB_VALUE_MAX} 字）`);
    values.set(key, value);
  }
  return [...items.values()]
    .filter((item) => values.get(item.key))
    .map((item) => ({
      key: item.key, label: item.label, value: values.get(item.key), unit: item.unit || '',
      referenceMin: item.referenceMin ?? null, referenceMax: item.referenceMax ?? null,
    }));
}

function imageUploadText(appointment) {
  if (appointment.imageUpload === false) return '否';
  if (appointment.imageUpload !== true) return '';
  return appointment.imageUploadDoneAt ? `已完成　${labTimeLabel(appointment.imageUploadDoneAt)}` : '是';
}

// 可以上色、加粗的欄位（格式標記見 shared/richText.js）。存之前一律標準化，
// 前端編輯器送出的字串跟這裡整理後的一致，才不會一存檔就被判成跟本機不同。
const RICH_TEXT_FIELDS = new Set(['visitNote', 'prescription']);
const cleanText = (field, value) => {
  const text = String(value ?? '');
  return (RICH_TEXT_FIELDS.has(field) ? normalizeRichText(text) : text).trim();
};

// 來院原因、「本次簡易紀錄」、給飼主的照護提醒、回診建議與當次量測需在病歷日誌中一同閱讀；
// 也同步成同一筆自動日誌，避免醫師日後只能看到本次簡易紀錄卻缺少看診當下交辦飼主的內容。
// internalNote 刻意不放進來——那是僅院內人員可見的備註，不該進入病歷日誌。
// 回傳分欄的段落（空的不回），前端依 key 分段呈現；純文字版 appointmentJournalContent 由它串成。
// visitNote 那一段保留格式標記，日誌卡片才畫得出粗體與顏色。
// 病歷日誌是由欄位拼成的報告，不是一段文字：檢驗兩段除了 text（純文字版，給 content 用）另帶結構，
// 前端才能排成表格——labValues 帶 items（一項一格），idexx 帶 results（一台儀器一段、一項一列，跟診療台的檢驗報告同一張表）。
// labResults：連到這次看診的 IDEXX 結果（lib/appointmentJournal.js 的 linkedLabResults），沒有就不帶。
export function appointmentJournalSections(appointment, labResults = []) {
  const text = value => String(value ?? '').trim();
  const measured = value => value !== null && value !== undefined;
  const reportLabs = labValuesOutsideIdexx(appointment.labValues, labResults).filter((lab) => String(lab.value ?? '').trim());
  return [
    { key: 'reason', label: '來院原因', text: text(appointment.reason) },
    { key: 'weightKg', label: '體重', text: measured(appointment.weightKg) ? `${appointment.weightKg} kg` : '' },
    { key: 'temperatureC', label: '體溫', text: measured(appointment.temperatureC) ? `${appointment.temperatureC} °C` : '' },
    {
      key: 'labValues', label: '檢驗', text: labSummary(reportLabs),
      items: reportLabs.map((lab) => ({ key: lab.key, label: lab.label, value: String(lab.value), unit: lab.unit || '', flag: labFlag(lab) })),
    },
    {
      key: 'idexx', label: 'IDEXX 檢驗', text: idexxJournalText(labResults),
      results: (labResults ?? []).map((result) => ({ _id: result._id, instrument: result.instrument, runAt: result.runAt, assays: result.assays ?? [], overrides: result.overrides ?? [], notes: result.notes ?? [] })),
    },
    { key: 'visitNote', label: '本次簡易紀錄', text: text(appointment.visitNote) },
    // 醫師在診療台寫的藥單（保留格式標記）；送交櫃台時另外在藥單建立一筆（lib/visitMedicationOrder.js）。
    { key: 'prescription', label: '藥單', text: richTextToPlain(appointment.prescription).trim() ? text(appointment.prescription) : '' },
    // 櫃台處理視窗的「上傳影像」：勾了是「是」，勾過又取消是「否」（使用者要求留著、不要消失）；從來沒勾過（null）不列。
    // 那筆待辦完成後改成「已完成」加完成時間（診所時區）。
    { key: 'imageUpload', label: '上傳影像', text: imageUploadText(appointment) },
    { key: 'specialCareNote', label: '請轉告飼主', text: text(appointment.specialCareNote) },
    { key: 'followUpRecommendation', label: '回診建議', text: text(appointment.followUpRecommendation) },
  ].filter(section => section.text);
}

// 純文字版：量測併成一行，本次簡易紀錄不帶標籤，其餘段落帶「標籤：」前綴。
// 格式標記在這裡拿掉——content 給差異比對、長度判斷與聊天快照用，不該看到 ** 或 [red]。
export function appointmentJournalContent(appointment, labResults = []) {
  const byKey = new Map(appointmentJournalSections(appointment, labResults).map(section => [section.key, section]));
  const labelled = key => (byKey.has(key) ? `${byKey.get(key).label}：${byKey.get(key).text}` : '');
  return [
    labelled('reason'),
    [labelled('weightKg'), labelled('temperatureC')].filter(Boolean).join('　'),
    labelled('labValues'),
    labelled('idexx'),
    richTextToPlain(byKey.get('visitNote')?.text || ''),
    byKey.has('prescription') ? `藥單：${richTextToPlain(byKey.get('prescription').text)}` : '',
    labelled('imageUpload'),
    labelled('specialCareNote'),
    labelled('followUpRecommendation'),
  ].filter(Boolean).join('\n\n');
}

// 日誌編輯表單要的原始值（量測是數字，不是「4.2 kg」這種顯示字串）。
export const APPOINTMENT_JOURNAL_FIELDS = ['reason', 'weightKg', 'temperatureC', 'visitNote', 'specialCareNote', 'followUpRecommendation'];
const JOURNAL_TEXT_LIMITS = { reason: 500, visitNote: 10000, specialCareNote: 500, followUpRecommendation: 500 };

export function appointmentJournalFields(appointment) {
  return Object.fromEntries(APPOINTMENT_JOURNAL_FIELDS.map(key => [key, appointment[key] ?? (key === 'weightKg' || key === 'temperatureC' ? null : '')]));
}

// 從病歷日誌直接改這次就診的內容。跟 workflow 的 clinical 不同，這裡**不看流程階段**：
// 病歷日誌是事後回頭更正紀錄的地方，櫃台完成處理之後照樣要改得動（看診工作區那邊仍然鎖著）。
// 只收日誌看得到的欄位，internalNote 不在這裡改；檢驗數值要對著範本的項目，只在健檢報告填寫頁改。
// labResults：連到這次看診的 IDEXX 結果——日誌上還有檢驗時，六個欄位全空也不算清空（日誌仍有內容）。
export function applyJournalFields(appointment, body, { labResults = [] } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw workflowError('日誌欄位格式不正確');
  for (const [key, max] of Object.entries(JOURNAL_TEXT_LIMITS)) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== 'string') throw workflowError('日誌欄位格式不正確');
    const text = cleanText(key, body[key]);
    if (richTextLength(text) > max) throw workflowError(`內容過長（最多 ${max} 字）`);
    appointment[key] = text;
  }
  for (const key of ['weightKg', 'temperatureC']) {
    if (body[key] === undefined) continue;
    const value = body[key] === '' || body[key] === null ? null : Number(body[key]);
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw workflowError('量測值必須是有效的非負數');
    appointment[key] = value;
  }
  if (!appointmentJournalSections(appointment, labResults).length) throw workflowError('日誌內容不能全部清空');
}

export function assertWorkflowVersion(appointment, version) {
  if (!Number.isInteger(version) || version !== (appointment.__v ?? 0)) {
    throw workflowError('資料已更新，請載入最新內容後再確認；尚未儲存的輸入會保留。', 409);
  }
}

// labItems：這次掛號範本裡的檢驗項目（route 讀範本後傳進來），用來驗證 labValues。
export function applyWorkflowAction(appointment, action, body, now = new Date(), { labItems = [] } = {}) {
  if (!['arrived', 'pending_checkout', 'completed'].includes(appointment.status) || !appointment.petId) {
    throw workflowError('請先完成報到，才能處理看診與交辦');
  }
  const state = workflowState(appointment);

  if (action === 'clinical') {
    if (state.completed) throw workflowError('櫃台已完成這筆就診，不能再修改內容', 409);
    const requestedFields = CLINICAL_FIELDS.filter((field) => body[field] !== undefined);
    const onlyJournalFields = requestedFields.length > 0 && requestedFields.every((field) => DESK_EDITABLE_FIELDS.includes(field));
    if (state.handedOff && !onlyJournalFields) throw workflowError('這筆就診已交給櫃台，請先取回再修改內容', 409);
    for (const field of CLINICAL_TEXT_FIELDS) {
      if (body[field] !== undefined) appointment[field] = cleanText(field, body[field]);
    }
    for (const field of ['weightKg', 'temperatureC']) {
      if (body[field] === undefined) continue;
      const value = body[field] === '' || body[field] === null ? null : Number(body[field]);
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw workflowError('量測值必須是有效的非負數');
      appointment[field] = value;
    }
    if (body.labValues !== undefined) appointment.labValues = mergeLabValues(appointment.labValues, body.labValues, labItems);
    if (body.imageUpload !== undefined) {
      if (typeof body.imageUpload !== 'boolean') throw workflowError('上傳影像的格式不正確');
      appointment.imageUpload = body.imageUpload;
    }
  } else if (action === 'start') {
    if (!state.handedOff) appointment.visitStartedAt ||= now;
  } else if (action === 'unstart') {
    // 取消看診：按錯貓、或看到一半飼主離開——退回候診，之後才能取消報到／取消掛號。
    // 只在送交櫃台之前；已經寫的內容留著。
    if (state.handedOff) throw workflowError('這筆就診已交給櫃台，請先取回', 409);
    if (!state.started) throw workflowError('這筆就診還沒開始看診', 409);
    appointment.visitStartedAt = null;
  } else if (action === 'handoff') {
    if (state.handedOff) throw workflowError('這筆就診已交給櫃台', 409);
    appointment.visitStartedAt ||= now;
    appointment.handoffAt = now;
  } else if (action === 'reclaim') {
    // 取回：櫃台按下「完成處理」之前都可以，之後不行——那時號碼牌已歸還、就診已結案。
    if (state.completed) throw workflowError('櫃台已完成處理，這筆就診不能再取回', 409);
    if (!state.handedOff) throw workflowError('這筆就診還在看診中，不需要取回', 409);
    appointment.handoffAt = null;
  } else if (action === 'complete') {
    if (!state.handedOff) throw workflowError('請等醫師完成看診並送交櫃台', 409);
    if (state.completed) throw workflowError('這筆就診已完成處理', 409);
    appointment.deskCompletedAt = now;
  } else if (action === 'request-reopen') {
    if (!state.completed) throw workflowError('只有已完成的就診可以申請修改', 409);
    if (appointment.reopenRequest?.requestedAt && !appointment.reopenRequest.approvedAt) {
      throw workflowError('這筆就診已有待核准的修改申請', 409);
    }
    const reason = String(body.reason || '').trim();
    appointment.reopenRequest = { reason, requestedAt: now, approvedAt: null };
  } else if (action === 'approve-reopen') {
    if (!state.completed || !appointment.reopenRequest?.requestedAt) throw workflowError('目前沒有待核准的修改申請', 409);
    appointment.deskCompletedAt = null;
    appointment.reopenRequest.approvedAt = now;
  } else if (action === 'reopen') {
    // 櫃台自己退回：按錯「完成處理」或完成後才發現要改，不必等醫師申請。跟核准修改走到同一個狀態；
    // 剛好有待核准的申請就一併算核准，掛號台的警示才會消失。號碼牌已歸還，不再配回去。
    if (!state.completed) throw workflowError('這筆就診還沒完成處理', 409);
    appointment.deskCompletedAt = null;
    if (appointment.reopenRequest?.requestedAt && !appointment.reopenRequest.approvedAt) appointment.reopenRequest.approvedAt = now;
  } else if (!['followup', 'record'].includes(action)) {
    throw workflowError('不支援的診務操作');
  }

  const next = workflowState(appointment);
  appointment.status = next.completed ? 'completed' : next.handedOff ? 'pending_checkout' : 'arrived';
  if (appointment.status === 'completed') {
    // 完成＝離開診所：歸還號碼牌（記進 history，當天不再配發同一張）。
    const history = Array.from(appointment.checkinNumberHistory || []);
    if (appointment.checkinNumber && !history.includes(appointment.checkinNumber)) history.push(appointment.checkinNumber);
    appointment.checkinNumberHistory = history;
    appointment.checkinNumber = null;
  }
}

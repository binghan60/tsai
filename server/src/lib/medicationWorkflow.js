import { medicationLabel } from '../../../shared/medicationWorkflow.js';
import { normalizeRichText, richTextLength, richTextToPlain } from '../../../shared/richText.js';

const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }); };

const collectedAtParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// 不直接用 format()：ICU 版本不同時日期與時間之間會夾特殊空白字元，看不出來但會跑進病歷內文，
// 所以取各個欄位自己組成「9/22 14:30」。
function collectedAtLabel(value) {
  const part = (type) => collectedAtParts.formatToParts(new Date(value)).find((item) => item.type === type)?.value;
  return `${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}

// 領藥紀錄在病歷日誌裡的內文，每次讀取都由藥單即時組成（日誌本身只存 medicationOrderId）。
// 標題帶目前階段，讀日誌的人一眼看得出這張藥單走到哪、是不是已經領走。
export function medicationJournalStage(order) {
  const collected = order.status === 'collected' && order.collectedAt ? ` ${collectedAtLabel(order.collectedAt)}` : '';
  return `${medicationLabel(order.status)}${collected}`;
}

export function medicationJournalTitle(order) {
  return `領藥（${medicationJournalStage(order)}）`;
}

// 病況／藥單／備註可以上色、加粗（shared/richText.js）。段落保留格式標記給日誌卡片呈現，
// 串成的 content 則是純文字（差異比對、聊天快照用）。
const hasText = value => Boolean(richTextToPlain(value).trim());

export function medicationJournalSections(order) {
  return [
    { key: 'condition', label: '病況', text: String(order.condition || '').trim() },
    { key: 'prescription', label: '藥單', text: String(order.prescription || '').trim() },
    { key: 'note', label: '備註', text: String(order.note || '').trim() },
  ].filter(section => hasText(section.text));
}

export function medicationJournalContent(order) {
  const fields = medicationJournalSections(order).map(section => `${section.label}：${richTextToPlain(section.text)}`);
  return [medicationJournalTitle(order), ...fields].join('\n\n');
}

export function medicationJournalFields(order) {
  return { condition: order.condition || '', prescription: order.prescription || '', note: order.note || '' };
}
const limits = { condition: 5000, prescription: 10000, note: 3000 };

export function medicationFields(body) {
  const fields = {};
  for (const [key, max] of Object.entries(limits)) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'string') fail(`${key} 格式或長度不正確`);
    const text = normalizeRichText(body[key]).trim();
    // 字數算純文字，格式標記不佔額度。
    if (richTextLength(text) > max) fail(`${key} 格式或長度不正確`);
    fields[key] = text;
  }
  return fields;
}

export function recordMedicationEvent(order, action, actor, from, reason = '', now = new Date()) {
  order.history.push({ action, actor, at: now, from, to: order.status, reason,
    condition: order.condition, prescription: order.prescription, note: order.note });
}

// 從病歷日誌更正藥單內容。任何階段都能改（已領藥也可以——那是事後更正紀錄），
// 每次有實際變動都在 history 記一筆 journal_edit，連同改後內容，事後查得到誰在何時改了什麼。
// 還在流程中的藥單照「修改藥單」的規則退回待醫師確認：藥已經包好卻偷偷換了藥單，櫃台會交出錯的藥。
// 回傳 false 代表沒有任何變動（不留軌跡、不必儲存）。
export function applyMedicationJournalEdit(order, body, actor, now = new Date()) {
  if (order.status === 'cancelled') fail('已取消的藥單不在病歷中，不能修改', 409);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('日誌欄位格式不正確');
  const fields = medicationFields(body);
  const changed = Object.keys(fields).some(key => fields[key] !== order[key]);
  if (!changed) return false;
  const from = order.status;
  Object.assign(order, fields);
  if (!hasText(order.prescription)) fail('藥單內容不能清空');
  if (from !== 'collected') {
    order.needsRepack ||= from === 'ready';
    order.status = 'review';
    order.approvedAt = null;
    order.approvedBy = '';
    order.packedAt = null;
    order.packedBy = '';
  }
  recordMedicationEvent(order, 'journal_edit', actor, from, '', now);
  return true;
}

export function applyMedicationAction(order, action, body, actor, now = new Date()) {
  if (!Number.isSafeInteger(body.version) || body.version !== order.__v) fail('藥單已更新，請重新載入後再操作；目前輸入已保留。', 409);
  if (['collected', 'cancelled'].includes(order.status)) fail('已領藥或已取消的藥單不可再修改', 409);
  const from = order.status;
  const fields = medicationFields(body);
  const clinicalChanged = ['condition', 'prescription', 'note'].some(key => fields[key] !== undefined && fields[key] !== order[key]);
  if (action === 'edit') {
    Object.assign(order, fields);
    if (clinicalChanged) {
      order.needsRepack ||= from === 'ready';
      order.status = 'review';
      order.approvedAt = null;
      order.approvedBy = '';
      order.packedAt = null;
      order.packedBy = '';
    }
  } else if (action === 'approve') {
    if (from !== 'review') fail('僅待醫師確認的藥單可送交包藥', 409);
    Object.assign(order, fields);
    if (!hasText(order.prescription)) fail('請填寫藥單內容後再送交包藥');
    order.status = 'approved';
    order.approvedAt = now;
    order.approvedBy = actor;
  } else if (action === 'return') {
    if (from !== 'approved') fail('僅待包藥的藥單可退回醫師重審', 409);
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) fail('請填寫退回意見（最多 500 字）');
    order.status = 'review';
    order.approvedAt = null;
    order.approvedBy = '';
    order.packedAt = null;
    order.packedBy = '';
  } else if (action === 'cancel') {
    order.status = 'cancelled';
  } else {
    const transition = { ready: ['approved', 'ready'], collect: ['ready', 'collected'] }[action];
    if (!transition) fail('不支援的藥單操作');
    if (from !== transition[0]) fail('藥單狀態已改變，請依目前進度操作', 409);
    if (clinicalChanged) fail('修改藥單後必須先重新交由醫師確認', 409);
    if (!order.approvedAt) fail('藥單尚未經醫師確認', 409);
    if (action === 'ready') {
      if (order.needsRepack && body.acknowledgeRepack !== true) fail('請先確認已停止使用舊藥包，依新藥單重新包藥');
      order.packedBy = actor;
      order.needsRepack = false;
      order.packedAt = now;
    }
    if (action === 'collect') order.collectedAt = now;
    order.status = transition[1];
  }
  const reason = ['cancel', 'return'].includes(action) && typeof body.reason === 'string' ? body.reason.trim() : '';
  recordMedicationEvent(order, action, actor, from, reason, now);
}

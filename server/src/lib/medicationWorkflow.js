import { medicationLabel } from '../../../shared/medicationWorkflow.js';

const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }); };

const collectedAtParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// 不直接用 format()：ICU 版本不同時日期與時間之間會夾特殊空白字元，看不出來但會跑進病歷內文，
// 所以取各個欄位自己組成「9/22 14:30」。
function collectedAtLabel(value) {
  const part = (type) => collectedAtParts.formatToParts(new Date(value)).find((item) => item.type === type)?.value;
  return `${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}

// 領藥紀錄在病歷日誌裡的內文，每次讀取都由藥單即時組成（日誌本身只存 medicationOrderId）。
// 第一行標題帶目前階段，讀日誌的人一眼看得出這張藥單走到哪、是不是已經領走。
export function medicationJournalContent(order) {
  const stage = medicationLabel(order.status);
  const collected = order.status === 'collected' && order.collectedAt ? ` ${collectedAtLabel(order.collectedAt)}` : '';
  const field = (label, value) => {
    const text = String(value || '').trim();
    return text ? `${label}：${text}` : '';
  };
  return [`領藥（${stage}${collected}）`, field('病況', order.condition), field('藥單', order.prescription), field('備註', order.note)].filter(Boolean).join('\n\n');
}
const limits = { condition: 5000, prescription: 10000, note: 3000 };

export function medicationFields(body) {
  const fields = {};
  for (const [key, max] of Object.entries(limits)) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'string' || body[key].length > max) fail(`${key} 格式或長度不正確`);
    fields[key] = body[key].trim();
  }
  return fields;
}

export function recordMedicationEvent(order, action, actor, from, reason = '', now = new Date()) {
  order.history.push({ action, actor, at: now, from, to: order.status, reason,
    condition: order.condition, prescription: order.prescription, note: order.note });
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
    if (!order.prescription?.trim()) fail('請填寫藥單內容後再送交包藥');
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

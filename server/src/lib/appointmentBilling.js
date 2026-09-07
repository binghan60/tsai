// 掛號批價／開藥清單的純邏輯：正規化單一項目、加總小計、組聊天通知摘要。
// 抽出來是因為金額計算要能被 node --test 覆蓋，路由檔本身測不到（import 會連帶載入
// puppeteer/nodemailer），仿照 appointmentQueue.js 的抽離模式。

const BILLING_KINDS = ['fee', 'medication'];

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

// 正規化單一項目；name 空白視為無效列，回傳 null 讓呼叫端過濾掉。
export function sanitizeBillingItem(raw) {
  const name = String(raw?.name ?? '').trim();
  if (!name) return null;

  const kind = BILLING_KINDS.includes(raw?.kind) ? raw.kind : 'fee';
  const quantity = toNonNegativeNumber(raw?.quantity, 1);
  const unitPrice = toNonNegativeNumber(raw?.unitPrice, 0);
  // amount 允許人工覆寫（例如整批藥另外喊價）；沒給或給了無效值才退回自動計算並四捨五入。
  const amount = raw?.amount === undefined || raw?.amount === null || raw?.amount === ''
    ? Math.round(quantity * unitPrice)
    : toNonNegativeNumber(raw.amount, Math.round(quantity * unitPrice));

  return {
    kind,
    name,
    quantity,
    unitPrice,
    amount,
    dosage: String(raw?.dosage ?? '').trim(),
    instructions: String(raw?.instructions ?? '').trim(),
  };
}

export function sanitizeBillingItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map(sanitizeBillingItem).filter(Boolean);
}

export function calculateBillingSubtotal(items) {
  if (!Array.isArray(items)) return 0;
  return Math.round(items.reduce((sum, item) => sum + toNonNegativeNumber(item?.amount, 0), 0));
}

// 給聊天通知用的簡短摘要，例如「驅蟲藥、看診費等 3 項」；不逐項列出金額，避免洗版聊天室。
export function summarizeBillingItems(items, { limit = 3 } = {}) {
  const names = (Array.isArray(items) ? items : [])
    .map((item) => String(item?.name ?? '').trim())
    .filter(Boolean);
  if (names.length === 0) return '';
  const shown = names.slice(0, limit).join('、');
  return names.length > limit ? `${shown}等 ${names.length} 項` : shown;
}

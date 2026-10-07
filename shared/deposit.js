// 保證金規則（前後端共用）。
//
// 一隻貓從「上次收保證金之後」算起，遲到滿 DEPOSIT_LATE_LIMIT 次或未到滿 DEPOSIT_NO_SHOW_LIMIT 次，
// 下次約診就要先收保證金。看的是貓不是飼主：同一位飼主的兩隻貓各算各的。
// 收了就歸零重算；櫃台也可以選「這次不收」並留原因，那樣不歸零，下次約診還是會提醒。
// 系統只記這筆掛號「已收」或「這次不收」，之後退還、抵診療費或沒收都由櫃台自己處理，不追蹤金額。
export const DEPOSIT_AMOUNT = 200;
export const DEPOSIT_LATE_LIMIT = 2;
export const DEPOSIT_NO_SHOW_LIMIT = 1;
export const DEPOSIT_REASON_MAX_LENGTH = 200;
// 取消一筆已收保證金的掛號時，櫃台要說這筆錢的去向：
// kept＝先留在診所，下次約診沿用（不再收一次）；refunded＝已退還，次數不歸零，下次約診照樣要求收。
// 未到不問：保證金視為沒收，那次未到本身就會讓下次約診再被要求收。
export const DEPOSIT_CANCEL_OUTCOMES = ['kept', 'refunded'];

// counts 是 { lateCount, noShowCount }（上次收保證金之後的次數）。
export function depositRequired(counts) {
  return (counts?.lateCount ?? 0) >= DEPOSIT_LATE_LIMIT || (counts?.noShowCount ?? 0) >= DEPOSIT_NO_SHOW_LIMIT;
}

// 為什麼要收：「遲到 2 次」「未到 1 次」「遲到 2 次、未到 1 次」。只列有達到門檻的那幾項。
export function depositCauseText(counts) {
  const parts = [];
  if ((counts?.lateCount ?? 0) >= DEPOSIT_LATE_LIMIT) parts.push(`遲到 ${counts.lateCount} 次`);
  if ((counts?.noShowCount ?? 0) >= DEPOSIT_NO_SHOW_LIMIT) parts.push(`未到 ${counts.noShowCount} 次`);
  return parts.join('、');
}

// 事後更正某筆掛號的保證金紀錄（貓咪詳情頁「出席紀錄」）：收錯、漏記、後來才退。
// 可以改成的狀態；carried（沿用到下一筆）是系統在約下一筆診時自動記的，不能手動選。
export const DEPOSIT_EDITABLE_STATUSES = ['', 'collected', 'waived', 'refunded'];
export const DEPOSIT_STATUS_LABELS = {
  '': '沒有保證金紀錄',
  collected: `已收 ${DEPOSIT_AMOUNT} 元`,
  waived: '這次不收',
  refunded: '已退還',
  carried: '沿用到下一筆',
};

export function checkDepositEdit(input) {
  const status = String(input?.status ?? '');
  if (!DEPOSIT_EDITABLE_STATUSES.includes(status)) return { error: '保證金狀態不正確' };
  if (status !== 'waived') return { status, reason: '' };
  const reason = String(input?.reason ?? '').trim();
  if (!reason) return { error: '這次不收保證金，請填寫原因' };
  if (reason.length > DEPOSIT_REASON_MAX_LENGTH) return { error: `不收保證金的原因請在 ${DEPOSIT_REASON_MAX_LENGTH} 字以內` };
  return { status, reason };
}

// 約診時櫃台的決定：{ status: 'collected' } 或 { status: 'waived', reason }。
// 不需要收的時候一律存空的（不採信呼叫端硬塞的狀態）；需要收卻沒決定、或不收卻沒寫原因，回 error。
export function checkDepositDecision(input, required) {
  if (!required) return { status: '', reason: '' };
  const status = input?.status;
  if (status === 'collected') return { status, reason: '' };
  if (status === 'waived') {
    const reason = String(input?.reason ?? '').trim();
    if (!reason) return { error: '這次不收保證金，請填寫原因' };
    if (reason.length > DEPOSIT_REASON_MAX_LENGTH) return { error: `不收保證金的原因請在 ${DEPOSIT_REASON_MAX_LENGTH} 字以內` };
    return { status, reason };
  }
  return { error: `這隻貓約診要先收保證金 ${DEPOSIT_AMOUNT} 元，請選擇「已收」或「這次不收」` };
}

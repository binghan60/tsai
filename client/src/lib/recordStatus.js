export const RECORD_STATUS_META = {
  // 原本是 bg-cream-200 搭 text-ink-600，對比只有 3.7:1，過不了 4.5。
  // 徽章的「低調」該來自中性底色，不是把文字洗淡。
  draft: { label: '草稿', class: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300', dotClass: 'bg-amber-600' },
  finalized: { label: '已結案', class: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300', dotClass: 'bg-brand-600' },
};

export const DELIVERY_STATUS_META = {
  // stone 是固定淺色階，深色主題下會變成淺底淺字——這裡走中性 token。
  not_sent: { label: '待寄送', class: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300', dotClass: 'bg-amber-600' },
  sending: { label: '寄送中', class: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300', dotClass: 'bg-sky-600' },
  sent: { label: '已寄送', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400', dotClass: 'bg-emerald-600' },
  failed: { label: '寄送失敗', class: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300', dotClass: 'bg-red-600' },
  uncertain: { label: '結果待確認', class: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300', dotClass: 'bg-amber-600' },
};

// 寄送流水帳的事件。跟 DELIVERY_STATUS_META 分開是因為兩者回答的問題不同：
// 那個是「這份報告現在的寄送狀態」，這個是「當時那一次嘗試發生了什麼」。
export const DELIVERY_EVENT_META = {
  queued: { label: '開始寄送', class: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300', dotClass: 'bg-sky-600' },
  sent: { label: '寄送成功', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400', dotClass: 'bg-emerald-600' },
  failed: { label: '寄送失敗', class: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300', dotClass: 'bg-red-600' },
  uncertain: { label: '結果待確認', class: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300', dotClass: 'bg-amber-600' },
};

export const AVAILABILITY_STATUS_META = {
  enabled: { label: '使用中', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300', textClass: 'text-emerald-700 dark:text-emerald-300', dotClass: 'bg-emerald-600' },
  disabled: { label: '已停用', class: 'bg-muted text-muted-foreground', textClass: 'text-muted-foreground', dotClass: 'bg-muted-foreground' },
};

export function isFinalizedRecord(record) {
  return Boolean(record && record.status !== 'draft');
}

export function getDeliveryStatus(record) {
  return record?.deliveryStatus || 'not_sent';
}

export function getRecordWorkflowStatusMeta(record) {
  return record?.status === 'draft'
    ? RECORD_STATUS_META.draft
    : DELIVERY_STATUS_META[getDeliveryStatus(record)];
}

export function getAvailabilityStatusMeta(enabled) {
  return enabled === false ? AVAILABILITY_STATUS_META.disabled : AVAILABILITY_STATUS_META.enabled;
}

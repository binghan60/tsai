export const RECORD_STATUS_META = {
  draft: { label: '草稿', class: 'bg-cream-200 text-ink-600 dark:bg-zinc-800 dark:text-zinc-400' },
  finalized: { label: '已結案', class: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' },
};

export const DELIVERY_STATUS_META = {
  not_sent: { label: '未寄送', class: 'bg-stone-100 text-stone-600 dark:bg-zinc-800 dark:text-zinc-300' },
  sending: { label: '寄送中', class: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' },
  sent: { label: '已寄送', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  failed: { label: '寄送失敗', class: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' },
};

// 寄送流水帳的事件。跟 DELIVERY_STATUS_META 分開是因為兩者回答的問題不同：
// 那個是「這份報告現在的寄送狀態」，這個是「當時那一次嘗試發生了什麼」。
export const DELIVERY_EVENT_META = {
  queued: { label: '開始寄送', class: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' },
  sent: { label: '寄送成功', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  failed: { label: '寄送失敗', class: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' },
};

export function isFinalizedRecord(record) {
  return Boolean(record && record.status !== 'draft');
}

export function getDeliveryStatus(record) {
  return record?.deliveryStatus || 'not_sent';
}

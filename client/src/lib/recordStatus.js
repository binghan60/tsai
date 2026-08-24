// 狀態色一律走語意 token（--success / --warning / --info / --danger），不用 Tailwind
// 的 amber-50 / emerald-50 那類固定色階。兩個理由：
// 一、那些 *-50 是冷調亮白，疊在卡片上對比只有 1.00–1.02，底色等於沒畫出來；
// 二、固定色階不隨主題走，得在每個使用點補一份 dark: 雙寫，全站因此長出第二套配色。
//
// 主色（primary / petrol）刻意不參與狀態語意：主色只表示「這是主要操作」，
// 狀態色只表示「這筆資料現在怎麼了」。唯一的例外是 finalized——「已結案」不是
// 異常也不是完成，它是流程走到主線上的下一步，用 accent（主色的淡面）最準。
export const RECORD_STATUS_META = {
  draft: { label: '草稿', class: 'bg-muted text-foreground', dotClass: 'bg-muted-foreground' },
  finalized: { label: '已結案', class: 'bg-accent text-accent-foreground', dotClass: 'bg-primary' },
};

export const DELIVERY_STATUS_META = {
  // draft 與 not_sent 之前共用同一組 amber，畫面上分不出「還沒寫完」跟「寫完了還沒寄」。
  // 現在草稿是中性（沒有人在等它），待寄送是 warning（在等你動手）。
  not_sent: { label: '待寄送', class: 'bg-warning-surface text-warning', dotClass: 'bg-warning' },
  sending: { label: '寄送中', class: 'bg-info-surface text-info', dotClass: 'bg-info' },
  sent: { label: '已寄送', class: 'bg-success-surface text-success', dotClass: 'bg-success' },
  failed: { label: '寄送失敗', class: 'bg-danger-surface text-danger', dotClass: 'bg-danger' },
  // 「結果待確認」跟「寄送失敗」同一個色相家族——兩者都要人去看一眼——但這個是
  // 不確定、不是已知失敗，所以用外框而不是實心淡底，掃過列表時分得出輕重。
  uncertain: { label: '結果待確認', class: 'border-danger/45 text-danger', dotClass: 'bg-danger/60' },
};

// 寄送流水帳的事件。跟 DELIVERY_STATUS_META 分開是因為兩者回答的問題不同：
// 那個是「這份報告現在的寄送狀態」，這個是「當時那一次嘗試發生了什麼」。
export const DELIVERY_EVENT_META = {
  queued: { label: '開始寄送', class: 'bg-info-surface text-info', dotClass: 'bg-info' },
  sent: { label: '寄送成功', class: 'bg-success-surface text-success', dotClass: 'bg-success' },
  failed: { label: '寄送失敗', class: 'bg-danger-surface text-danger', dotClass: 'bg-danger' },
  uncertain: { label: '結果待確認', class: 'border-danger/45 text-danger', dotClass: 'bg-danger/60' },
};

export const AVAILABILITY_STATUS_META = {
  enabled: { label: '使用中', class: 'bg-success-surface text-success', textClass: 'text-success', dotClass: 'bg-success' },
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

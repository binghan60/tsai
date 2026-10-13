// 狀態色一律走語意 token（--success / --warning / --info / --danger），不用 Tailwind
// 的 amber-50 / emerald-50 那類固定色階。兩個理由：
// 一、那些 *-50 是冷調亮白，疊在卡片上對比只有 1.00–1.02，底色等於沒畫出來；
// 二、固定色階不隨主題走，得在每個使用點補一份 dark: 雙寫，全站因此長出第二套配色。
//
// 主色（primary / petrol）刻意不參與狀態語意：主色只表示「這是主要操作」，
// 狀態色只表示「這筆資料現在怎麼了」。唯一的例外是 finalized——「已結案」不是
// 異常也不是完成，它是流程走到主線上的下一步，用 accent（主色的淡面）最準。
//
// 灰色只留給「已經不作用」的狀態（已停用、已取消）。草稿曾經是灰的，但它是還沒做完的工作，
// 使用者反映灰色看起來像沒有狀態；改用 info（進行中）。跟「寄送中」同色，但寄送中只出現在
// 已結案報告上、而且只有幾秒，兩者不會同時出現在同一個位置。
export const RECORD_STATUS_META = {
  draft: { label: '草稿', class: 'bg-info-surface text-info', dotClass: 'bg-info' },
  finalized: { label: '已結案', class: 'bg-accent text-accent-foreground', dotClass: 'bg-primary' },
};

export const DELIVERY_STATUS_META = {
  // draft 與 not_sent 之前共用同一組 amber，畫面上分不出「還沒寫完」跟「寫完了還沒寄」。
  // 現在草稿是 info（還在寫），待寄送是 warning（寫完了、在等你寄）。
  not_sent: { label: '待寄送', class: 'bg-warning-surface text-warning', dotClass: 'bg-warning' },
  sending: { label: '寄送中', class: 'bg-info-surface text-info', dotClass: 'bg-info' },
  sent: { label: '已寄出', class: 'bg-success-surface text-success', dotClass: 'bg-success' },
  failed: { label: '寄送失敗', class: 'bg-danger-surface text-danger', dotClass: 'bg-danger' },
  // 「結果待確認」跟「寄送失敗」同一個色相家族——兩者都要人去看一眼——但這個是
  // 不確定、不是已知失敗，所以用外框而不是實心淡底，掃過列表時分得出輕重。
  uncertain: { label: '結果待確認', class: 'border-danger/45 text-danger', dotClass: 'bg-danger/60' },
};

// 報告清單的「櫃台處理」欄：這筆看診櫃台那一端走到哪（shared/appointmentWorkflow.js 的 deskProcessingState）。
// 醫師還在處理＝info（進行中，還沒輪到櫃台）；待櫃台處理與待核准修改＝warning（球在櫃台手上）；
// 完成＝success。沒有連著看診或不在流程中時沒有狀態，欄位留白。
export const DESK_STATUS_META = {
  with_doctor: { label: '醫師處理中', class: 'bg-info-surface text-info', dotClass: 'bg-info' },
  desk_pending: { label: '待櫃台處理', class: 'bg-warning-surface text-warning', dotClass: 'bg-warning' },
  reopen_requested: { label: '待核准修改', class: 'bg-warning-surface text-warning', dotClass: 'bg-warning' },
  desk_done: { label: '櫃台已完成', class: 'bg-success-surface text-success', dotClass: 'bg-success' },
};

// 「櫃台處理」欄實際畫的徽章。櫃台勾了「這次看診不寄就診紀錄」且已完成處理時，只標「不寄就診紀錄」一顆
// （不寄就等於處理完了，不必再疊一顆「櫃台已完成」）；還沒完成處理（含退回處理中）時兩顆都畫，才看得出球在誰手上。
export function deskBadges(record) {
  const noVisit = Boolean(record?.deskNoVisitRecord);
  const status = DESK_STATUS_META[record?.deskStatus];
  const badges = [];
  if (status && !(noVisit && record.deskStatus === 'desk_done')) badges.push({ key: 'status', label: status.label, class: status.class });
  if (noVisit) badges.push({ key: 'no-visit', label: '不寄就診紀錄', class: 'bg-warning-surface text-warning' });
  return badges;
}

// 寄送流水帳的事件。跟 DELIVERY_STATUS_META 分開是因為兩者回答的問題不同：
// 那個是「這份報告現在的寄送狀態」，這個是「當時那一次嘗試發生了什麼」。
export const DELIVERY_EVENT_META = {
  queued: { label: '寄送中', class: 'bg-info-surface text-info', dotClass: 'bg-info' },
  sent: { label: '已寄出', class: 'bg-success-surface text-success', dotClass: 'bg-success' },
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

export function getAvailabilityStatusMeta(enabled) {
  return enabled === false ? AVAILABILITY_STATUS_META.disabled : AVAILABILITY_STATUS_META.enabled;
}

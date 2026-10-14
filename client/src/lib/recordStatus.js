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

// 報告清單一列最多一顆膠囊：淡底膠囊只給「要有人動手」的狀態，其餘畫成圓點或勾＋文字（仍然有顏色）。
// 一列三四顆彩色膠囊時，掃不出哪幾列要處理；同一個琥珀色也同時代表了好幾件事。
// 回傳 { label, style: 'pill' | 'dot' | 'check' | 'text', class, dotClass? }，由 StatusMark.vue 畫。

// 「報告」欄：報告與寄送併成一欄——草稿以外都是已結案，所以「已結案」不另外畫，直接寫寄送走到哪。
// 櫃台勾了「這次看診不寄就診紀錄」的報告不會寄，已結案而還沒寄的寫「不寄就診紀錄」、不寫「待寄送」（沒有人要去寄）。
export function reportMark(record) {
  if (!isFinalizedRecord(record)) return { key: 'draft', label: RECORD_STATUS_META.draft.label, style: 'dot', class: 'text-foreground', dotClass: RECORD_STATUS_META.draft.dotClass };
  const delivery = getDeliveryStatus(record);
  if (delivery === 'not_sent' && record?.deskNoVisitRecord) return { key: 'no_visit', label: '不寄就診紀錄', style: 'dot', class: 'text-warning', dotClass: 'bg-warning' };
  const meta = DELIVERY_STATUS_META[delivery] ?? DELIVERY_STATUS_META.not_sent;
  if (delivery === 'sent') return { key: delivery, label: meta.label, style: 'check', class: 'text-success' };
  if (delivery === 'sending') return { key: delivery, label: meta.label, style: 'dot', class: 'text-foreground', dotClass: meta.dotClass };
  return { key: delivery, label: meta.label, style: 'pill', class: meta.class };
}

// 「報告」欄的副行：草稿、已寄出、寄送失敗這些狀態上，另外註明櫃台勾了不寄（主狀態已經寫了的就不重複）。
export function reportMarkNote(record) {
  if (!record?.deskNoVisitRecord) return '';
  return reportMark(record).key === 'no_visit' ? '' : '不寄就診紀錄';
}

// 「櫃台」欄：球在櫃台手上（待櫃台處理、待核准修改）才是膠囊；醫師處理中、已完成只寫字。
export function deskMark(record) {
  const status = record?.deskStatus;
  const meta = DESK_STATUS_META[status];
  if (!meta) return null;
  if (status === 'desk_pending' || status === 'reopen_requested') return { key: status, label: meta.label, style: 'pill', class: meta.class };
  if (status === 'desk_done') return { key: status, label: '已完成', style: 'check', class: 'text-muted-foreground' };
  return { key: status, label: meta.label, style: 'text', class: 'text-muted-foreground' };
}

// 填寫報告頁固定列的櫃台狀態：醫師常常看完診就先寫報告，飼主還在櫃台，可能還會決定不寄或有別的事。
// 球在櫃台手上、或櫃台勾了不寄就診紀錄才是膠囊；醫師處理中、櫃台已完成只寫字。visitLink 來自 GET /records/:id。
export function visitDeskMarks(visitLink) {
  if (!visitLink) return [];
  const marks = [];
  const status = visitLink.deskStatus;
  if (status === 'with_doctor') marks.push({ key: status, label: '還沒送交櫃台', style: 'text', class: 'text-muted-foreground' });
  if (status === 'desk_pending') marks.push({ key: status, label: '櫃台還沒處理完', style: 'pill', class: DESK_STATUS_META.desk_pending.class });
  if (status === 'reopen_requested') marks.push({ key: status, label: DESK_STATUS_META.reopen_requested.label, style: 'pill', class: DESK_STATUS_META.reopen_requested.class });
  if (visitLink.noVisitRecord) marks.push({ key: 'no_visit', label: '不寄就診紀錄', style: 'pill', class: 'bg-warning-surface text-warning' });
  else if (status === 'desk_done') marks.push({ key: status, label: '櫃台已完成', style: 'check', class: 'text-muted-foreground' });
  return marks;
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

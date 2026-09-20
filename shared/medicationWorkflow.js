export const MEDICATION_STAGES = [
  { key: 'review', label: '待醫師確認' },
  { key: 'approved', label: '待包藥' },
  { key: 'ready', label: '待領藥' },
  { key: 'collected', label: '已領藥' },
  { key: 'cancelled', label: '已取消' },
];

export const MEDICATION_ACTIVE = ['review', 'approved', 'ready'];
export const medicationLabel = status => MEDICATION_STAGES.find(stage => stage.key === status)?.label || status;

// 頁首「藥單」按鈕的數字：只算「這個角色現在要動手的」，不是未完成總數。
// 醫師等的是待確認，櫃台等的是待包藥與待領藥；兩邊看同一批藥單，但在等的不是同一段。
// 口徑放這裡是因為之前診療台、櫃台、面板標題各自算一次，同一顆按鈕跟它打開的面板顯示不同數字。
export const MEDICATION_ROLE_QUEUE = { doctor: ['review'], reception: ['approved', 'ready'] };
export const medicationTodoCount = (counts, mode) =>
  (MEDICATION_ROLE_QUEUE[mode] || MEDICATION_ACTIVE).reduce((sum, key) => sum + (counts?.[key] || 0), 0);

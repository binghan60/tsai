export const MEDICATION_STAGES = [
  { key: 'review', label: '待醫師確認' },
  { key: 'approved', label: '待包藥' },
  { key: 'ready', label: '待領藥' },
  { key: 'collected', label: '已領藥' },
  { key: 'cancelled', label: '已取消' },
];

export const MEDICATION_ACTIVE = ['review', 'approved', 'ready'];
export const medicationLabel = status => MEDICATION_STAGES.find(stage => stage.key === status)?.label || status;

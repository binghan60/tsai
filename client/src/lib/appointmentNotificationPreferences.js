import { computed, ref, watch } from 'vue';

const STORAGE_KEY = 'clinic.appointmentNotificationPreferences';

export const NOTIFICATION_OPTIONS = [
  { key: 'create', label: '新增掛號' },
  { key: 'edit', label: '編輯掛號資料' },
  { key: 'check_in', label: '報到' },
  { key: 'undo_check_in', label: '取消報到' },
  { key: 'cancel', label: '取消掛號' },
  { key: 'no_show', label: '標記未到診' },
  { key: 'restore', label: '恢復掛號' },
  { key: 'handoff', label: '完成看診交給櫃台' },
  { key: 'reclaim', label: '醫師取回修改' },
  { key: 'desk_complete', label: '櫃台完成處理' },
  { key: 'follow_up', label: '預約回診' },
  { key: 'visit_note', label: '本次簡易紀錄更新' },
  { key: 'handoff_note', label: '櫃台交辦更新' },
  { key: 'special_care_note', label: '飼主提醒更新' },
  { key: 'measurements', label: '量測資料更新' },
  { key: 'follow_up_data', label: '回診資料更新' },
  { key: 'historical_note', label: '歷次病歷日誌更新' },
];

const VISIT_DATA_KEYS = new Map([
  ['本次簡易紀錄', 'visit_note'],
  ['櫃台交辦', 'handoff_note'],
  ['飼主提醒', 'special_care_note'],
  ['量測資料', 'measurements'],
  ['回診資料', 'follow_up_data'],
  ['歷次病歷日誌', 'historical_note'],
]);

const defaultPreferences = Object.fromEntries(NOTIFICATION_OPTIONS.map(option => [option.key, true]));

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return { ...defaultPreferences, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch {
    return { ...defaultPreferences };
  }
}

const preferences = ref(readPreferences());

watch(preferences, (value) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); }
  catch { /* localStorage may be unavailable in private browsing; keep in memory only. */ }
}, { deep: true });

export function notificationPreferenceKey(action, options = {}) {
  if (action !== 'visit_data') return action;
  const changedParts = options.changedParts || [];
  return VISIT_DATA_KEYS.get(changedParts[0]) || 'visit_note';
}

export function isAppointmentNotificationEnabled(action, options = {}) {
  const key = notificationPreferenceKey(action, options);
  return preferences.value[key] !== false;
}

export function useAppointmentNotificationPreferences() {
  const enabledCount = computed(() => NOTIFICATION_OPTIONS.filter(option => preferences.value[option.key] !== false).length);
  function setPreference(key, enabled) {
    preferences.value = { ...preferences.value, [key]: Boolean(enabled) };
  }
  function enableAll() {
    preferences.value = { ...defaultPreferences };
  }
  function disableAll() {
    preferences.value = Object.fromEntries(NOTIFICATION_OPTIONS.map(option => [option.key, false]));
  }
  return { options: NOTIFICATION_OPTIONS, preferences, enabledCount, setPreference, enableAll, disableAll };
}

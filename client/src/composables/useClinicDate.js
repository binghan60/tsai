import { watch } from 'vue';
import { useRoute } from 'vue-router';
import { useSearchQueryParam } from './useSearchQueryParam';
import { useClinicDateStore } from '../stores/clinicDate';

// 診療台與掛號台看的是同一天（stores/clinicDate.js）：醫師翻到明天看預約、切去掛號台要改那筆掛號，
// 不該又回到今天再翻一次。
//
// 日期照舊寫在網址上（?date=，重新整理與上一頁才還原得回來）；進頁面時網址沒帶日期就用 store 記的那一天，
// 網址有帶的以網址為準（從搜尋結果、通知連進來的那一天）。
export function useClinicDate(today) {
  const route = useRoute();
  const store = useClinicDateStore();
  const homePath = route.path;
  const date = useSearchQueryParam('date', today);
  if (typeof route.query.date !== 'string' && store.date) date.value = store.date;

  watch(date, (value) => {
    // 離開這一頁時網址上的 date 會消失、date 跟著退回今天——那不是使用者翻回今天，不能記下來。
    if (route.path !== homePath) return;
    store.set(value, today);
  }, { immediate: true });

  return date;
}

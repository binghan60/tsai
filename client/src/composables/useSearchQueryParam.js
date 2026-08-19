import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// 列表頁的搜尋字串同步進網址的 ?q=。
//
// 只存在 ref 裡的話，點進某一筆詳情再按返回，搜尋條件整個蒸發：搜尋框空了、
// 列表變回全部、捲軸回到頂端，使用者得重打一次關鍵字才能接回剛剛看到的地方。
// 條件寫在網址上，返回時就會自己長回來（配合 router 的 scrollBehavior 還原捲動位置）。
//
// 用 replace 而不是 push：每打一個字都推一筆歷史紀錄的話，按上一頁會變成逐字倒退。
export function useSearchQueryParam(paramName = 'q') {
  const route = useRoute();
  const router = useRouter();
  const initial = route.query[paramName];
  const query = ref(typeof initial === 'string' ? initial : '');

  watch(query, (value) => {
    const next = value.trim();
    const current = typeof route.query[paramName] === 'string' ? route.query[paramName] : '';
    if (next === current) return;
    router.replace({ query: { ...route.query, [paramName]: next || undefined } });
  });

  return query;
}

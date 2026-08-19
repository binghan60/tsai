import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// 列表頁的篩選狀態同步進網址（搜尋關鍵字、佇列、頁碼）。
//
// 只存在 ref 裡的話，點進某一筆詳情再按返回，篩選條件整個蒸發：搜尋框空了、
// 列表變回全部、捲軸回到頂端，使用者得重設一次才能接回剛剛看到的地方。
// 條件寫在網址上，返回時就會自己長回來（配合 router 的 scrollBehavior 還原捲動位置），
// 而且整條網址可以直接存成書籤或貼給別人。
//
// 用 replace 而不是 push：每打一個字都推一筆歷史紀錄的話，按上一頁會變成逐字倒退。
//
// defaultValue 是「這個參數不出現在網址上時代表什麼」。等於預設值就把參數拿掉，
// 網址只記錄偏離預設的部分，不會被 ?view=todo&page=1 這種等同沒說的雜訊塞滿。
export function useSearchQueryParam(paramName = 'q', defaultValue = '') {
  const route = useRoute();
  const router = useRouter();
  const initial = route.query[paramName];
  const query = ref(typeof initial === 'string' ? initial : defaultValue);

  watch(query, (value) => {
    const next = String(value ?? '').trim();
    const target = next && next !== defaultValue ? next : undefined;
    const current = typeof route.query[paramName] === 'string' ? route.query[paramName] : undefined;
    if (target === current) return;
    router.replace({ query: { ...route.query, [paramName]: target } });
  });

  return query;
}

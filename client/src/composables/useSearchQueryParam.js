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

// 這一輪待寫進網址的參數。
//
// 同一個 tick 裡改兩個參數（換佇列時同時把頁碼重設回 1 就是）會各觸發一次 watcher，
// 而 router.replace 是非同步的：第二個 watcher 讀到的 route.query 還是舊的，
// 組出來的網址會蓋掉第一個剛寫進去的參數。症狀是「在第 2 頁換佇列，網址上的 view 不見了」，
// 畫面當下正確（ref 值是對的），重整或返回才會退回預設佇列 —— 正好抵銷這個 composable 的用意。
//
// 所以先把變更收集起來，等這一輪同步變更都跑完，再合併成一次 replace。
let pendingPatch = null;

function scheduleQueryPatch(router, route, name, value) {
  if (pendingPatch) {
    pendingPatch[name] = value;
    return;
  }
  pendingPatch = { [name]: value };

  queueMicrotask(() => {
    const patch = pendingPatch;
    pendingPatch = null;
    // 合併的基準要等到這個時間點才讀，拿到的才是最新的網址。
    const readCurrent = (key) => (typeof route.query[key] === 'string' ? route.query[key] : undefined);
    if (Object.entries(patch).every(([key, next]) => next === readCurrent(key))) return;
    router.replace({ query: { ...route.query, ...patch } });
  });
}

export function useSearchQueryParam(paramName = 'q', defaultValue = '') {
  const route = useRoute();
  const router = useRouter();
  const initial = route.query[paramName];
  const query = ref(typeof initial === 'string' ? initial : defaultValue);

  watch(query, (value) => {
    const next = String(value ?? '').trim();
    scheduleQueryPatch(router, route, paramName, next && next !== defaultValue ? next : undefined);
  });

  return query;
}

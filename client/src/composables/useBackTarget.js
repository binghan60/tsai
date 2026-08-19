import { computed, toValue } from 'vue';
import { useRouter } from 'vue-router';
import { useReturnPath } from '../router';

// 頁面「返回」的目的地與文字。
//
// 優先回到使用者真正的出發點（router 在 afterEach 記進 history.state 的 chFrom），
// 沒有紀錄時（直接開網址、從外部連結進來）才退回該頁寫死的上層網址。
// 寫死的上層網址常常不是使用者來的地方——從工作台點進健檢編輯頁，
// 返回卻被送去寵物資料頁，就是那種「進得去出不來原地」的迷路感。
//
// 跟著 router 的 returnPath 走而不是在 setup 取快照：/pets/1 → /pets/2 這種同路由跳轉
// 會重用元件實例、不重跑 setup，快照就會停在舊的來源上。
export function useBackTarget(fallback, fallbackLabel) {
  const router = useRouter();
  const returnPath = useReturnPath();

  return {
    to: computed(() => returnPath.value || toValue(fallback) || '/'),
    label: computed(() => {
      if (!returnPath.value) return toValue(fallbackLabel);
      // 來源頁的名稱直接取路由的 meta.title，各頁不用自己再維護一份對照表。
      const title = String(router.resolve(returnPath.value).meta?.title ?? '');
      return `回${title || '上一頁'}`;
    }),
  };
}

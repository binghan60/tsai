import { computed, ref, toValue, watch } from 'vue';
import { pageCount, pageSlice } from '../lib/pagination';

// 整份清單已經在前端（store 或一次拿回來的資料）時的分頁：切出這一頁、
// 清單變短讓最後一頁空掉時退回新的最後一頁。
// scrollTarget 是清單頂端的元素 ref，換頁時捲回去（側滑面板的清單各自捲動）。
export function useClientPagination(source, { pageSize = 20, scrollTarget = null } = {}) {
  const page = ref(1);
  const totalPages = computed(() => pageCount(toValue(source).length, pageSize));
  const pageItems = computed(() => pageSlice(toValue(source), page.value, pageSize));

  watch(totalPages, (value) => {
    if (page.value > value) page.value = value;
  });

  function goToPage(value) {
    page.value = value;
    scrollTarget?.value?.scrollIntoView({ block: 'start' });
  }

  return { page, totalPages, pageItems, goToPage, pageSize };
}

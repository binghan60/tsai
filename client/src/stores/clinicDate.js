import { defineStore } from 'pinia';

// 診療台與掛號台共用的「正在看哪一天」：在其中一頁翻到別天，切到另一頁也停在那一天。
// 空字串＝今天：不記成某個固定日期，分頁開過夜之後才不會停在昨天。只存在記憶體，重新整理就回到今天。
// 兩頁透過 composables/useClinicDate.js 讀寫（它負責跟網址的 ?date= 對齊）。
export const useClinicDateStore = defineStore('clinicDate', {
  state: () => ({ date: '' }),
  actions: {
    set(date, today) {
      this.date = date && date !== today ? date : '';
    },
    // 總覽頁的數字都是今天的，從那裡點進掛號台要落在今天，不能停在先前翻到的別天。
    reset() {
      this.date = '';
    },
  },
});

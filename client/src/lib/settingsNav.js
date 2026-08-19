import { LayoutList, Recycle } from '@lucide/vue';

// 設定頁的子導覽。新增一項設定＝這裡加一筆 + 加一條路由 + 寫一個頁面，
// 導覽、手機版排版、頁面標題都會自動跟著處理。
//
// group 用來分類；只有一組時不會顯示分類標題，等設定變多再自然浮現。
export const SETTINGS_GROUPS = [
  {
    group: '健檢',
    items: [
      { to: '/settings/forms', label: '健檢表單', icon: LayoutList, hint: '區塊、項目與參考範圍' },
    ],
  },
  {
    group: '報告',
    items: [
      { to: '/settings/trash', label: '回收桶', icon: Recycle, hint: '已刪除的健檢報告' },
    ],
  },
];

export const SETTINGS_ITEMS = SETTINGS_GROUPS.flatMap((entry) => entry.items);

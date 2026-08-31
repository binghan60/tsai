// 欄位在網格版式裡要佔多寬。用「自動／加寬／整排」而不是直接給欄數 ——
// 各版式的欄數不同（欄位清單 3 欄、量測格狀 5 欄），而且同一個網格在窄容器
// 會收合成 2 欄甚至 1 欄，寫死欄數在畫布上就會超出總欄數。
//
// breakpoint 指的是「這個網格從哪個容器寬度開始有兩欄以上」，
// col-span 必須跟著同一個門檻，否則單欄時 span-2 會憑空長出第二欄。
const WIDE_CLASS = {
  sm: '@sm:col-span-2',
  xl: '@xl:col-span-2',
  // 報告頁是固定寬度的列印文件，用視窗斷點就夠了。
  report: 'sm:col-span-2',
};

export function spanClass(item, breakpoint) {
  // 牙齒圖需要的橫向空間遠超過一般欄位，不管範本作者有沒有設定 span 都強制整排。
  if (item?.type === 'dentalChart' || item?.type === 'image' || item?.span === 'full') return 'col-span-full';
  if (item?.span === 'wide') return WIDE_CLASS[breakpoint] ?? '';
  return '';
}

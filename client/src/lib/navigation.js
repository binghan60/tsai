import { Cat, CalendarClock, FileText, Layers, LayoutDashboard, LayoutTemplate, Pill, Send, Stethoscope, Type } from '@lucide/vue';

// 左側 72px 圖示導覽，分三組：看診（每天在用的工作台）、資料、設定。
// 每一項都是圖示＋兩三個字，不做收合／展開——字已經在圖示下面了，不用再滑過才看得到。
export const NAV_GROUPS = [
  {
    label: '看診',
    items: [
      { to: '/', label: '總覽', icon: LayoutDashboard, exact: true },
      { to: '/appointments', label: '診療台', icon: Stethoscope },
      { to: '/reception', label: '掛號台', icon: CalendarClock },
      { to: '/medications', label: '藥單', icon: Pill },
    ],
  },
  {
    label: '資料',
    items: [
      { to: '/pets', label: '貓咪', icon: Cat },
      { to: '/records', label: '報告', icon: FileText },
      { to: '/records/deliveries', label: '寄送', icon: Send },
    ],
  },
  {
    label: '設定',
    items: [
      { to: '/settings/forms', label: '表單', icon: LayoutTemplate },
      { to: '/settings/text-templates', label: '模板', icon: Type },
      { to: '/settings/presets', label: '預填', icon: Layers },
    ],
  },
];

// 攤平給手機選單與頁面標題用。
export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

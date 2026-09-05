import { defineStore } from 'pinia';

const MAX_ITEMS = 30;

// 判斷一則留言是要給哪一頁看的：已完成的掛號只有櫃台頁看得到（醫生頁只顯示
// 候診中的掛號）；候診中則看 sender——醫生發的給櫃台看，櫃台發的給醫生看。
// 跟 NotificationBell 拿掉之前的導頁邏輯是同一組規則，現在改用來算側邊欄徽章。
function isForFrontDesk(item) {
  return item.status === 'completed' || item.sender === 'vet';
}

// 全站共用的「掛號留言」未讀清單。不再有下拉清單 UI（見側邊欄「看診」／「櫃台」
// 徽章與各頁卡片上的紅點），這裡純粹是資料層：記錄有哪些掛號有未讀留言，
// 供側邊欄徽章計數與頁面內判斷某張卡片/某列是否要顯示紅點。
export const useAppointmentNotificationsStore = defineStore('appointmentNotifications', {
  state: () => ({ items: [] }),
  getters: {
    count: (state) => state.items.length,
    // 側邊欄「看診」項目：候診中、櫃台發的留言（醫生還沒看）。
    doctorCount: (state) => state.items.filter((item) => !isForFrontDesk(item)).length,
    // 側邊欄「櫃台」項目：已完成的留言，或候診中由醫生發的留言（櫃台還沒看）。
    frontDeskCount: (state) => state.items.filter(isForFrontDesk).length,
    // destination 傳 'doctor'／'front-desk' 只算對應方向；同一筆掛號可能同時有
    // 兩個方向的未讀（例如互相回覆，或櫃台在已完成的掛號上留言），不分方向會
    // 把不屬於自己那一份也算進去。
    isUnread: (state) => (appointmentId, destination) =>
      state.items.some((item) => item.appointmentId === appointmentId && (isForFrontDesk(item) ? 'front-desk' : 'doctor') === destination),
  },
  actions: {
    add(item) {
      if (this.items.some((existing) => existing.id === item.id)) return;
      this.items.unshift(item);
      if (this.items.length > MAX_ITEMS) this.items.length = MAX_ITEMS;
    },
    // 使用者在頁面上實際看到某筆掛號的留言串時（展開卡片、開啟編輯彈窗），
    // 對應的通知就不再需要留著——但只清掉「這個角色自己看到的那個方向」。
    // 同一筆掛號可能同時有給醫生跟給櫃台看的未讀（例如互相回覆），不分方向整筆
    // 清掉的話，一邊點開查看會連對方根本還沒看過的通知也一起清掉。
    clearAppointment(appointmentId, destination) {
      this.items = this.items.filter((item) => {
        if (item.appointmentId !== appointmentId) return true;
        return (isForFrontDesk(item) ? 'front-desk' : 'doctor') !== destination;
      });
    },
    clearAll() {
      this.items = [];
    },
  },
});

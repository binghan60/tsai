import { defineStore } from 'pinia';

// 全站即時聊天的訊息與未讀狀態，只在記憶體裡、不持久化。跟舊版
// appointmentNotifications 不同的是這裡只有「一個」對話（不分方向），
// isOpen 放在這裡是為了讓 addMessage 自己判斷要不要計未讀，不用元件另外傳狀態進來。
export const useChatStore = defineStore('chat', {
  state: () => ({ messages: [], unreadCount: 0, isOpen: false, historyLoaded: false }),
  actions: {
    setHistory(list) {
      this.messages = list ?? [];
      this.historyLoaded = true;
    },
    addMessage(message) {
      if (this.messages.some((item) => item._id === message._id)) return;
      this.messages.push(message);
      if (!this.isOpen) this.unreadCount += 1;
    },
    open() {
      this.isOpen = true;
      this.unreadCount = 0;
    },
    close() {
      this.isOpen = false;
    },
    reset() {
      this.messages = [];
      this.unreadCount = 0;
      this.isOpen = false;
      this.historyLoaded = false;
    },
  },
});

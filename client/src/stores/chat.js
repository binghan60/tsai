import { defineStore } from 'pinia';

// 掛號頁的動作會自動發一則系統訊息到聊天室（見 AppointmentsPage.vue 的
// notifyChat）；操作那台裝置自己不需要因為自己剛做的事而跳未讀紅點——那不是
// 「別人講了什麼」，是自己剛做的事的回音。用「身分＋內容」這組送出前就還原
// 得出來的線索佔位（不能等伺服器回應才標記，socket 廣播可能先到，見掛號即時
// 同步用過的同一種手法），5 秒後自動過期；跟真的重複的訊息內容撞在一起的機率
// 極低，可以接受。純模組層級的暫存，不用進 Pinia 的 state。
const pendingAutoKeys = new Map();
function autoKey(sender, content) {
  return `${sender}::${content}`;
}

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
    // 送出自動訊息「之前」呼叫，讓稍後收到的同一則廣播能認出是自己這台裝置發的。
    markPendingAuto(sender, content) {
      const key = autoKey(sender, content);
      clearTimeout(pendingAutoKeys.get(key));
      pendingAutoKeys.set(key, setTimeout(() => pendingAutoKeys.delete(key), 5000));
    },
    addMessage(message) {
      if (this.messages.some((item) => item._id === message._id)) return;
      const key = autoKey(message.sender, message.content);
      const isOwnAuto = message.auto && pendingAutoKeys.has(key);
      if (isOwnAuto) {
        clearTimeout(pendingAutoKeys.get(key));
        pendingAutoKeys.delete(key);
      }
      this.messages.push(message);
      if (!this.isOpen && !isOwnAuto) this.unreadCount += 1;
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

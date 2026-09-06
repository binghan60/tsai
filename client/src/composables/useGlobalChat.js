import { onBeforeUnmount, onMounted, watch } from 'vue';
import { getSocket } from '../api/socket';
import { http } from '../api/http';
import { useAuthStore } from '../stores/auth';
import { useChatStore } from '../stores/chat';

// 全站常駐：由 App.vue 呼叫一次，取代原本 useGlobalAppointmentNotifications
// 「擁有連線生命週期」的角色——只要登入著就持續連線，不因切換頁面而斷線；
// 掛號頁面自己的 useAppointmentRealtime 只負責依日期 join/leave 房間，
// 不再自己開關連線，理由同舊版。
//
// 全站聊天沒有房間概念（見 server/src/lib/realtime.js 的 emitChatMessage），
// 不需要 join/leave，登入後直接連線、載入歷史、監聽 chat:new 即可。
export function useGlobalChat() {
  const socket = getSocket();
  const auth = useAuthStore();
  const store = useChatStore();

  async function loadHistory() {
    try {
      const { data } = await http.get('/chat/messages');
      store.setHistory(data.items ?? []);
    } catch {
      // 歷史載入失敗不影響之後即時收到的新訊息，安靜失敗即可。
    }
  }

  function handleMessage(message) {
    store.addMessage(message);
  }

  onMounted(() => {
    socket.on('chat:new', handleMessage);
  });

  // 開發環境預設不啟用登入（AUTH_ENABLED 沒開），後端 sessionUser 這時對任何
  // 請求都直接回傳一個 bypass user，/auth/me 一樣會回登入成功，所以這裡不用
  // 特別分開處理開發／正式環境，單純看 auth.isAuthenticated 即可。
  watch(
    () => auth.isAuthenticated,
    (loggedIn) => {
      if (loggedIn) {
        socket.connect();
        loadHistory();
      } else {
        store.reset();
        socket.disconnect();
      }
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    socket.off('chat:new', handleMessage);
  });
}

import { onBeforeUnmount, onMounted, watch } from 'vue';
import { getSocket } from '../api/socket';
import { useAuthStore } from '../stores/auth';
import { useAppointmentNotificationsStore } from '../stores/appointmentNotifications';
import { wasRecentlySent } from '../lib/sentMessageTracker';
import { clinicDateInput } from '../lib/datetime';

// 全站常駐：由 App.vue 呼叫一次，只要登入著就持續連線、監聽「今天」這個房間的
// 留言廣播，不因切換頁面而斷線——掛號只服務當日，所以未讀徽章只需要關心今天。
// 跟掛號頁面各自的 useAppointmentRealtime（依使用者選的日期 join/leave）是
// 不同關注點：那邊管「這個頁面現在看的是哪一天」，這裡管「連線本身活多久」。
export function useGlobalAppointmentNotifications() {
  const socket = getSocket();
  const auth = useAuthStore();
  const store = useAppointmentNotificationsStore();

  function joinToday() {
    socket.emit('join-day', clinicDateInput());
  }

  function handleMessage({ appointmentId, petName, date, status, message }) {
    // 這裡在 App 外殼層級，不知道這台裝置算醫生還是櫃台（身分是頁面固定的，
    // 不是全域狀態），改用「是不是我自己剛送出的」來排除，見 lib/sentMessageTracker.js。
    if (wasRecentlySent({ id: message._id, appointmentId, sender: message.sender, content: message.content })) return;
    store.add({
      id: message._id ?? `${appointmentId}-${message.createdAt}`,
      appointmentId,
      petName,
      date,
      status,
      sender: message.sender,
      content: message.content,
      createdAt: message.createdAt,
    });
  }

  onMounted(() => {
    socket.on('connect', joinToday);
    socket.on('visit-message:new', handleMessage);
  });

  // 開發環境預設不啟用登入（AUTH_ENABLED 沒開），後端 sessionUser 這時對任何
  // 請求都直接回傳一個 bypass user，/auth/me 一樣會回登入成功，所以這裡不用
  // 特別分開處理開發／正式環境，單純看 auth.isAuthenticated 即可。
  watch(
    () => auth.isAuthenticated,
    (loggedIn) => {
      if (loggedIn) {
        socket.connect();
      } else {
        store.clearAll();
        socket.disconnect();
      }
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    socket.off('connect', joinToday);
    socket.off('visit-message:new', handleMessage);
  });
}

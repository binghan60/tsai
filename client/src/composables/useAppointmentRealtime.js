import { onBeforeUnmount, onMounted, watch } from 'vue';
import { getSocket } from '../api/socket';

// 掛號相關的即時推播，在 AppointmentsPage（醫生）／FrontDeskPage（櫃台）掛載時
// 加入使用者選定日期的房間（見後端 lib/realtime.js），dateRef 換日期時要 leave
// 舊的、join 新的。連線本身（connect/disconnect）由全站常駐的
// useGlobalAppointmentNotifications（App.vue 掛載時建立）統一管理，這裡只負責
// 房間與事件的訂閱/取消訂閱，不再自己開關連線——否則離開這兩頁時斷線，會連帶
// 打斷側邊欄未讀徽章（useGlobalAppointmentNotifications）仍在使用的同一條連線。
//
// handlers 全部選填：
// - onMessage：新增一則看診留言，payload 為 { appointmentId, message }。
// - onAppointmentUpdate：掛號本身狀態／欄位變動（完成看診、候診中或已完成修正
//   看診資料都會觸發），payload 是完整的掛號文件，讓清單即時反映新狀態，
//   不用等輪詢——這是醫生按「更新」後櫃台能立刻看到最新量測／回診資料的機制。
export function useAppointmentRealtime(dateRef, handlers = {}) {
  const { onMessage, onAppointmentUpdate } = handlers;
  const socket = getSocket();

  function join(date) {
    if (date) socket.emit('join-day', date);
  }
  function leave(date) {
    if (date) socket.emit('leave-day', date);
  }
  function handleConnect() {
    // 斷線重連後房間會被伺服器清空，要重新 join 目前的日期。
    join(dateRef.value);
  }

  onMounted(() => {
    socket.on('connect', handleConnect);
    if (onMessage) socket.on('visit-message:new', onMessage);
    if (onAppointmentUpdate) socket.on('appointment:updated', onAppointmentUpdate);
    // 連線可能已經由全域那邊建立好了；如果還沒（例如剛登入、還在連線中），
    // 之後的 connect 事件會補發 join。
    if (socket.connected) join(dateRef.value);
  });

  watch(dateRef, (next, previous) => {
    leave(previous);
    join(next);
  });

  onBeforeUnmount(() => {
    socket.off('connect', handleConnect);
    if (onMessage) socket.off('visit-message:new', onMessage);
    if (onAppointmentUpdate) socket.off('appointment:updated', onAppointmentUpdate);
    leave(dateRef.value);
  });
}

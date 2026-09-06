import { onBeforeUnmount, onMounted, watch } from 'vue';
import { getSocket } from '../api/socket';

// 掛號狀態的即時推播，在 AppointmentsPage 掛載時加入使用者選定日期的房間
// （見後端 lib/realtime.js），dateRef 換日期時要 leave 舊的、join 新的。
// 連線本身（connect/disconnect）由全站常駐的 useGlobalChat（App.vue 掛載時
// 建立，負責全站聊天浮動視窗）統一管理，這裡只負責房間與事件的訂閱/取消訂閱，
// 不再自己開關連線——否則離開這頁時斷線，會連帶打斷聊天視窗仍在使用的同一條連線。
//
// onAppointmentUpdate 選填：掛號本身狀態／欄位變動（完成看診、候診中或已完成修正
// 看診資料都會觸發），payload 是完整的掛號文件，讓清單即時反映新狀態，不用等
// 輪詢——這台電腦存好資料後，開著同一頁的另一台電腦能立刻看到最新內容。
export function useAppointmentRealtime(dateRef, handlers = {}) {
  const { onAppointmentUpdate } = handlers;
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
    if (onAppointmentUpdate) socket.off('appointment:updated', onAppointmentUpdate);
    leave(dateRef.value);
  });
}

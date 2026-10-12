import { onMounted, onBeforeUnmount, ref } from 'vue';
import { getSocket } from '../api/socket';
import { useAppointmentRealtime } from './useAppointmentRealtime';

// 掛號台、診療台的即時同步：掛號一有異動，伺服器就把那一筆推到那一天的房間（useAppointmentRealtime）。
// 沒有定時輪詢——以前每 30 秒重抓一整天，每台裝置、分頁在背景也照抓，大多是白抓。
// 斷線期間錯過的，重新連上（connect）時整天重抓一次補回來。
export function useClinicSync(date, refresh, onUpdate) {
  const socket = getSocket();
  const connected = ref(socket.connected);
  const lastUpdated = ref(null);
  function reconnect() { connected.value = true; refresh(); }
  function disconnect() { connected.value = false; }
  useAppointmentRealtime(date, { onAppointmentUpdate: (item) => { lastUpdated.value = new Date(); onUpdate(item); } });
  onMounted(() => {
    socket.on('connect', reconnect);
    socket.on('disconnect', disconnect);
  });
  onBeforeUnmount(() => {
    socket.off('connect', reconnect);
    socket.off('disconnect', disconnect);
  });
  return { connected, lastUpdated };
}

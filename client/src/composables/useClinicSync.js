import { onMounted, onBeforeUnmount, ref } from 'vue';
import { getSocket } from '../api/socket';
import { useAppointmentRealtime } from './useAppointmentRealtime';

export function useClinicSync(date, refresh, onUpdate) {
  const socket = getSocket();
  const connected = ref(socket.connected);
  const lastUpdated = ref(null);
  let timer;
  function reconnect() { connected.value = true; refresh(); }
  function disconnect() { connected.value = false; }
  useAppointmentRealtime(date, { onAppointmentUpdate: (item) => { lastUpdated.value = new Date(); onUpdate(item); } });
  onMounted(() => {
    socket.on('connect', reconnect);
    socket.on('disconnect', disconnect);
    timer = setInterval(refresh, 30000);
  });
  onBeforeUnmount(() => {
    socket.off('connect', reconnect);
    socket.off('disconnect', disconnect);
    clearInterval(timer);
  });
  return { connected, lastUpdated };
}

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { http } from '../api/http';
import { getSocket } from '../api/socket';
import { labFillStatus } from '../lib/labFillStatus';

// 這次看診的 IDEXX 填入狀態（規則在 lib/labFillStatus.js）：讀連到這次看診的結果，加上還沒處理的數值差異。
// source()：{ petId, appointmentId, baseDate, version }。version（看診的 __v）變了就重讀——
// 醫師在別處把數值改成跟 IDEXX 一樣，差異就不該再列。新結果進來、有人處理掉差異靠 lab-results:updated。
export function useLabFillStatus(source) {
  const results = ref([]);
  const conflictGroups = ref([]);
  let request = 0;

  async function load() {
    const id = ++request;
    const { petId, appointmentId } = source();
    if (!petId || !appointmentId) {
      results.value = [];
      conflictGroups.value = [];
      return;
    }
    try {
      const [linked, conflicts] = await Promise.all([
        http.get('/lab-results', { params: { petId, appointmentId, limit: 50 } }),
        http.get('/lab-results/conflicts', { params: { appointmentId } }),
      ]);
      if (id !== request) return;
      results.value = linked.data.items || [];
      conflictGroups.value = conflicts.data.items || [];
    } catch {
      // 讀不到就維持原樣；下一次有結果進來會再讀。
    }
  }

  const socket = getSocket();
  onMounted(() => {
    load();
    socket.on('lab-results:updated', load);
  });
  onBeforeUnmount(() => socket.off('lab-results:updated', load));
  watch(() => { const { petId, appointmentId, version } = source(); return [petId, appointmentId, version]; }, load);

  const status = computed(() => labFillStatus({
    results: results.value, conflictGroups: conflictGroups.value, appointmentId: source().appointmentId, baseDate: source().baseDate,
  }));
  return { status, reload: load };
}

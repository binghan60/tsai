import { apiErrorMessage } from '../lib/apiError';
import { computed, ref } from 'vue';
import { http } from '../api/http';
import { useToast } from './useToast';
import { useWorkCountsStore } from '../stores/workCounts';

// 送 IDEXX：把貓咪送到 IDEXX 主機的待驗清單（伺服器 POST /appointments/:id/lab-request）。
// 報到不自動送——不是每次看診都驗血，由醫師（診療台）或櫃台（掛號台 ⋯ 選單）按下去才送。
// 伺服器沒開這個功能時 enabled 是 false，兩邊都不出按鈕。
export function canRequestLab(appointment) {
  return Boolean(appointment?.petId) && (appointment?.status === 'arrived' || appointment?.status === 'pending_checkout');
}

// 通知真的寫進 IDEXX 主機了沒：抓檔程式回報後伺服器記 labDeliveredAt，比這次按下去的時間晚才算。
export function labRequestDelivered(appointment) {
  return Boolean(appointment?.labRequestedAt && appointment.labDeliveredAt
    && new Date(appointment.labDeliveredAt) >= new Date(appointment.labRequestedAt));
}

export function useLabRequest() {
  const counts = useWorkCountsStore();
  const toast = useToast();
  const busy = ref(false);
  const enabled = computed(() => counts.labRequestEnabled);

  // 回傳更新後的掛號（失敗回 null）；其他台靠 appointment:updated 跟上。
  async function setLabRequest(appointment, requested) {
    if (busy.value) return null;
    busy.value = true;
    try {
      const { data } = await http.post(`/appointments/${appointment._id}/lab-request`, { requested });
      if (requested) {
        const action = { label: '復原', handler: () => setLabRequest(data, false) };
        // 診所電腦上的抓檔程式沒在回報：通知只是排著隊，主機上看不到這隻貓。
        if (counts.bridges.some((bridge) => bridge.online)) {
          toast.success('約 10 秒後出現在 IDEXX 主機的清單上', `${data.petName} 已送 IDEXX`, { action });
        } else {
          toast.addToast({ type: 'error', title: `${data.petName} 還沒送到 IDEXX`, message: '診所電腦沒有回報，連上之後才會出現在 IDEXX 主機的清單上', action });
        }
      } else {
        toast.success('已從 IDEXX 主機的清單收回', `${data.petName} 已取消送 IDEXX`);
      }
      return data;
    } catch (err) {
      toast.error(apiErrorMessage(err, '送 IDEXX 失敗，請稍後再試'));
      return null;
    } finally {
      busy.value = false;
    }
  }

  return { enabled, busy, setLabRequest };
}

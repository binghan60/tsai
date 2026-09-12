import { http } from '../api/http';
import { useChatStore } from '../stores/chat';
import { useStaffIdentity } from './useStaffIdentity';
import { appointmentNotification } from '../lib/appointmentNotifications';
import { isAppointmentNotificationEnabled } from '../lib/appointmentNotificationPreferences';

// 診務頁每個會改變掛號狀態或內容的動作，成功後順手發一則系統訊息到全站聊天室，
// 讓開著聊天視窗的另一邊不用切回診務頁也知道現場發生了什麼事。
//
// 這只是錦上添花的提示：貼失敗（例如網路不穩）不 await、不阻塞，也不影響動作本身。
// 送出前先在 store 佔位，操作的這台裝置才不會因為自己剛做的事跳未讀紅點——
// socket 廣播可能比 HTTP 回應先到，所以不能等回應才標記。
export function useAppointmentNotifier() {
  const chatStore = useChatStore();
  const { identity } = useStaffIdentity();
  return function notifyChat(appointment, action, options) {
    if (!isAppointmentNotificationEnabled(action, options)) return;
    const content = appointmentNotification(appointment, action, options);
    chatStore.markPendingAuto(identity.value, content);
    http.post('/chat/messages', { sender: identity.value, content, auto: true, ...(options?.snapshot ? { snapshot: options.snapshot } : {}) }).catch(() => {});
  };
}

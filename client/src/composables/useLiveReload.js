import { onBeforeUnmount, onMounted } from 'vue';
import { getSocket } from '../api/socket';

// 資料有連動的畫面：伺服器推「請重讀」的失效通知（沒有內容，只是告訴你它變了）時，自己重讀一次。
// 這是全站的慣例——連動的資料（藥單↔看診、待辦↔掛號、報告↔貓咪頁、飼主↔待辦的 Email…）一律用 websocket
// 推，不靠使用者重新整理、也不另外定時輪詢。
//
//   reload：重讀的函式。要靜默（不閃載入畫面、失敗不蓋掉現有內容），由呼叫端的 reload 自己處理。
//   events：要聽的 socket 事件名稱。
//   match(event, payload)：選填，回 false 的通知不處理（例如日誌只關心同一隻貓的）。
//   delay：合併短時間內的多次通知（診療台自動存檔、IDEXX 補傳都會連發），最後一次之後才重讀。
// 斷線重連（connect）時也補讀一次，補回斷線期間錯過的異動。
// 回傳 schedule()：呼叫端自己的觸發來源（例如掛號房間的推播）也能走同一個合併。
export function useLiveReload(reload, { events = [], match = null, delay = 250 } = {}) {
  const socket = getSocket();
  let timer = null;

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      reload();
    }, delay);
  }

  const handlers = events.map((event) => [event, (payload) => {
    if (!match || match(event, payload)) schedule();
  }]);

  onMounted(() => {
    for (const [event, handler] of handlers) socket.on(event, handler);
    socket.on('connect', schedule);
  });

  onBeforeUnmount(() => {
    clearTimeout(timer);
    for (const [event, handler] of handlers) socket.off(event, handler);
    socket.off('connect', schedule);
  });

  return { schedule };
}

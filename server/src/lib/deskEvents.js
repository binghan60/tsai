// 櫃台按「完成處理」之後要接著做的事：排著等櫃台的自動寄送（lib/reportDelivery.js 的 runAutoSends，app.js 接上）。
// 用掛勾而不是在路由直接呼叫：路由測試不連資料庫，不該連帶跑寄信的背景工作。
const handlers = [];

export function onDeskCompleted(handler) {
  handlers.push(handler);
}

export function notifyDeskCompleted() {
  for (const handler of handlers) {
    try {
      handler();
    } catch (err) {
      console.error('[desk] 完成處理後續工作失敗', err);
    }
  }
}

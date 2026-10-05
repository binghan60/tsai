import { Server } from 'socket.io';
import { sessionUser } from './session.js';

// 未呼叫 initRealtime() 時整個模組保持 no-op——單元測試只用 supertest 打
// server/src/app.js 匯出的 app，從不啟動真正的 httpServer，不該因為這個功能
// 而要求測試也起一個 socket server。
let io = null;

function dayRoom(date) {
  return `appointments:${date}`;
}

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: process.env.CLIENT_ORIGIN ? { origin: process.env.CLIENT_ORIGIN, credentials: true } : undefined,
  });

  // 沿用既有的 sessionUser：AUTH_ENABLED 沒開時它本來就回傳 bypass user，
  // 跟 HTTP 那邊的 requireAuthentication 行為一致，這裡不用另外判斷。
  io.use(async (socket, next) => {
    try {
      const user = await sessionUser({ headers: socket.handshake.headers });
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    socket.on('join-day', (date) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(date))) socket.join(dayRoom(date));
    });
    socket.on('leave-day', (date) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(date))) socket.leave(dayRoom(date));
    });
  });

  return io;
}

// 全站聊天沒有房間概念——全診所只有一個對話，直接廣播給所有已連線且通過驗證的 socket。
export function emitChatMessage(message) {
  io?.emit('chat:new', message);
}

// 掛號本身的狀態／欄位有變動時廣播完整文件（完成看診、候診中或已完成修正看診資料
// 都會呼叫）；前端收到後直接用 _id 找到本地那一筆更新欄位，不用整頁重新 fetch——
// 這是醫師頁按下「更新」送出量測／回診資料後，櫃台頁能立刻看到最新內容的機制。
export function emitAppointmentUpdate(appointment, previousDate) {
  const payload = typeof appointment.toObject === 'function' ? appointment.toObject() : appointment;
  io?.to(dayRoom(appointment.date)).emit('appointment:updated', payload);
  if (previousDate && previousDate !== appointment.date) io?.to(dayRoom(previousDate)).emit('appointment:updated', payload);
}

// 貓咪暫存區跟聊天一樣是全站一份，不分房間；payload 是完整清單。
// IDEXX 檢驗結果的待確認清單有變動（收到新結果、有人確認／復原／忽略）；前端重讀工具欄的數字。
//
// 這只是「請重讀」的通知，沒有內容，所以短時間內的多次合併成一次：第一次馬上送，接下來 LAB_RESULTS_EMIT_GAP_MS 內的
// 不管幾次只在結束時補送一次。IDEXX 主機補傳歷史紀錄時會一口氣進來幾百份，每份都廣播的話，
// 每一台開著的瀏覽器都會跟著各打好幾支 API，等於把一次補傳放大成幾千個請求。
export const LAB_RESULTS_EMIT_GAP_MS = 3000;
let labResultsEmitTimer = null;
let labResultsEmitPending = false;

export function emitLabResultsUpdate() {
  if (labResultsEmitTimer) {
    labResultsEmitPending = true;
    return;
  }
  io?.emit('lab-results:updated');
  labResultsEmitTimer = setTimeout(() => {
    labResultsEmitTimer = null;
    if (!labResultsEmitPending) return;
    labResultsEmitPending = false;
    emitLabResultsUpdate();
  }, LAB_RESULTS_EMIT_GAP_MS);
  // 不要因為這個計時器讓測試或關機卡住。
  labResultsEmitTimer.unref?.();
}

export function emitPinnedPetsUpdate(items) {
  io?.emit('pinned-pets:updated', { items });
}

// 院內待辦跟聊天、暫存區一樣是全站一份；payload 是完整清單。
export function emitTodosUpdate(items) {
  io?.emit('todos:updated', { items });
}

export function emitClinicalNoteUpdate(note) {
  const payload = typeof note.toObject === 'function' ? note.toObject() : note;
  io?.emit('clinical-note:updated', payload);
}

// 藥單跨天保留，向所有已登入的工作台推送失效通知，再依各自篩選重新讀取。
export function emitMedicationUpdate(order) {
  io?.emit('medication:updated', { _id: String(order._id), version: order.__v });
}

// 待審初診表有增減（飼主送出、櫃台核准或退回）。只是失效通知，前端自己重讀待審筆數。
export function emitIntakeUpdate() {
  io?.emit('intake:updated');
}

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

// 掛號本身的狀態／欄位有變動時，向「那一天」的房間廣播完整文件；前端收到後直接用 _id 找到本地那一筆取代，
// 不用整頁重新 fetch——診療台存了看診內容，掛號台立刻看得到。改了日期的掛號兩天的房間都要通知（previousDate）。
export function emitAppointmentUpdate(appointment, previousDate) {
  const payload = typeof appointment.toObject === 'function' ? appointment.toObject() : appointment;
  io?.to(dayRoom(appointment.date)).emit('appointment:updated', payload);
  if (previousDate && previousDate !== appointment.date) io?.to(dayRoom(previousDate)).emit('appointment:updated', payload);
  // 看診日誌是由掛號即時組成的：掛號變了，這隻貓的日誌就變了（診療台存紀錄、櫃台勾處理事項、待辦完成寫回時間、
  // 報告填寫頁改體重……）。日誌畫面不一定開著那一天的房間（貓咪詳情頁、病歷速覽），所以另外全站廣播一則
  // 帶 petId 的「這隻貓的日誌請重讀」。放在這裡而不是各路由自己 emit，才不會有路徑漏掉。
  const petId = payload.petId?._id ?? payload.petId;
  if (petId) emitClinicalNoteUpdate({ petId, appointmentId: payload._id });
  // 報告清單的「櫃台處理狀態」也是由掛號推導的：櫃台完成處理、醫師送交或取回時，清單要跟著重讀。
  if (payload.recordId) emitRecordsUpdate();
}

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

// 貓咪暫存區跟聊天一樣是全站一份，不分房間；payload 是完整清單。
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

// 住院單、每天體重、照護紀錄有變動：住院清單、住院專區、貓咪頁的住院頁籤、總覽的「住院中」重讀。
// 只帶 { _id, petId }，各畫面自己判斷要不要重讀。
export function emitHospitalizationUpdate(hospitalization) {
  io?.emit('hospitalization:updated', { _id: String(hospitalization._id), petId: String(hospitalization.petId) });
}

// 藥單跨天保留，向所有已登入的工作台推送失效通知，再依各自篩選重新讀取。
export function emitMedicationUpdate(order) {
  io?.emit('medication:updated', { _id: String(order._id), version: order.__v });
}

// 沒有內容的「請重讀」通知：貓咪／飼主資料、健檢報告（含寄送結果）有變動。
// 合併短時間內的多次，並且延後一小段再發——資料寫在 transaction 裡時，hook 觸發當下還沒 commit，
// 立刻通知的話前端重讀會讀到舊的。
const INVALIDATION_DELAY_MS = 400;
function coalescedEmitter(event) {
  let timer = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      io?.emit(event);
    }, INVALIDATION_DELAY_MS);
    timer.unref?.();
  };
}

// 貓咪或飼主資料變了（建檔、改名、改電話／Email、刪除）：貓咪頁與清單、待辦上附的飼主 Email 都要重讀。
export const emitPatientsUpdate = coalescedEmitter('patients:updated');
// 健檢報告有變動（建立、填寫、結案、PDF 產生、寄送結果、刪除）與寄送流水帳：報告清單、貓咪頁、總覽數字、寄送歷程要重讀。
export const emitRecordsUpdate = coalescedEmitter('records:updated');
// 藥櫃有增刪改：各裝置打藥單時的建議清單要重讀。
export const emitDrugsUpdate = coalescedEmitter('drugs:updated');

// 待審初診表有增減（飼主送出、櫃台核准或退回）。只是失效通知，前端自己重讀待審筆數。
export function emitIntakeUpdate() {
  io?.emit('intake:updated');
}

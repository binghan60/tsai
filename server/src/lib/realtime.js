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
// 這是醫生頁按下「更新」送出量測／回診資料後，櫃台頁能立刻看到最新內容的機制。
export function emitAppointmentUpdate(appointment, previousDate) {
  const payload = typeof appointment.toObject === 'function' ? appointment.toObject() : appointment;
  io?.to(dayRoom(appointment.date)).emit('appointment:updated', payload);
  if (previousDate && previousDate !== appointment.date) io?.to(dayRoom(previousDate)).emit('appointment:updated', payload);
}

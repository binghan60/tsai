import { io } from 'socket.io-client';

// VITE_API_BASE_URL 是 axios 用的、帶 /api 路徑的 base（見 http.js），但 Socket.IO
// 掛在 httpServer 本身、走獨立的 /socket.io 路徑，要先去掉尾巴的 /api 才能當
// io() 的第一個參數（production 時 /api 去掉後變空字串，同源連線，跟現在部署方式一致）。
const socketOrigin = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/api\/?$/, '') || undefined;

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(socketOrigin, { withCredentials: true, autoConnect: false });
  }
  return socket;
}

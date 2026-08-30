import { defineStore } from 'pinia';
import { http } from '../api/http';

export const useAuthStore = defineStore('auth', {
  state: () => ({ ready: false, user: null }),
  getters: {
    isAuthenticated: (state) => Boolean(state.user),
  },
  actions: {
    async initialize({ force = false } = {}) {
      if (this.ready && !force) return;
      try {
        const { data } = await http.get('/auth/me');
        this.user = { username: data.username };
      } catch {
        this.user = null;
      } finally {
        this.ready = true;
      }
    },
    async login(credentials) {
      const { data } = await http.post('/auth/login', credentials);
      this.user = { username: data.username };
      this.ready = true;
    },
    async logout() {
      try {
        await http.post('/auth/logout');
      } finally {
        this.clearSession();
      }
    },
    // cookie 已經失效時（http.js 攔截到 401 後）用來重置本地狀態，不打 API——
    // 都已經是未登入狀態了，再呼叫一次 /auth/logout 沒有意義。
    clearSession() {
      this.user = null;
      this.ready = true;
    },
  },
});

import { defineStore } from 'pinia';
import { http } from '../api/http';

// 全站共用的院內待辦。資料的真相在後端 todos collection，任何異動伺服器都會用
// todos:updated 廣播整份清單（未完成＋最近完成），這裡直接取代，不自己推算差異。
// 每支 action 也直接吃 HTTP 回應裡的同一份清單，發動作的這台不必等廣播。
export const useTodosStore = defineStore('todos', {
  state: () => ({ items: [], loaded: false }),
  getters: {
    openItems: (state) => state.items.filter((item) => item.status === 'open'),
    doneItems: (state) => state.items.filter((item) => item.status === 'done'),
    openCount() {
      return this.openItems.length;
    },
  },
  actions: {
    setItems(items) {
      this.items = items ?? [];
      this.loaded = true;
    },
    async load() {
      try {
        const { data } = await http.get('/todos');
        this.setItems(data.items);
      } catch {
        // 待辦載不到不影響其他功能，下一次廣播或重新整理會補上。
      }
    },
    // mentions 是內文裡 # 標記的 petId 陣列，名字快照由伺服器寫入。
    async add({ content, createdBy, dueDate, mentions }) {
      const { data } = await http.post('/todos', { content, createdBy, dueDate: dueDate || null, mentions: mentions ?? [] });
      this.setItems(data.items);
    },
    async update(id, patch) {
      const { data } = await http.put(`/todos/${id}`, patch);
      this.setItems(data.items);
    },
    async complete(id, doneBy) {
      const { data } = await http.post(`/todos/${id}/complete`, { doneBy });
      this.setItems(data.items);
    },
    async reopen(id) {
      const { data } = await http.post(`/todos/${id}/reopen`);
      this.setItems(data.items);
    },
    async remove(id) {
      const { data } = await http.delete(`/todos/${id}`);
      this.setItems(data.items);
    },
    reset() {
      this.items = [];
      this.loaded = false;
    },
  },
});

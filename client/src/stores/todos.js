import { defineStore } from 'pinia';
import { http } from '../api/http';
import { moveBefore } from '../../../shared/todoOrder.js';

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
    // 拖拉排序：先在本機排好（放開的那一刻畫面就定位），再送給伺服器；beforeId 是排在它下面的那一筆，null＝最後。
    // 失敗（含 409：另一台剛改過清單）時換回伺服器的清單，呼叫端負責提示。
    async move(id, beforeId) {
      const ids = moveBefore(this.openItems.map((item) => item._id), id, beforeId);
      if (ids) {
        const byId = new Map(this.items.map((item) => [String(item._id), item]));
        this.items = [...ids.map((key) => byId.get(key)), ...this.doneItems];
      }
      try {
        const { data } = await http.post(`/todos/${id}/move`, { beforeId });
        this.setItems(data.items);
      } catch (err) {
        if (err?.response?.data?.items) this.setItems(err.response.data.items);
        else await this.load();
        throw err;
      }
    },
    // 搜尋已完成的待辦（全部歷史，不只 store 裡最近 50 筆）。結果不進 store，由面板自己拿著。
    async searchDone(keyword) {
      const { data } = await http.get('/todos/search', { params: { q: keyword } });
      return data.items ?? [];
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

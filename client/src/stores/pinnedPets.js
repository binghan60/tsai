import { defineStore } from 'pinia';
import { http } from '../api/http';

// 全站共用的寵物暫存區（櫃台接電話時丟給醫生看病歷用）。資料的真相在後端
// pinnedPets collection，任何異動伺服器都會用 pinned-pets:updated 廣播整份清單，
// 這裡直接取代，不自己推算差異。quickViewPetId 控制 App.vue 裡唯一一個病歷速覽
// Modal——聊天室標籤、診療台、櫃台、寵物詳情頁都從這裡叫出同一個。
export const usePinnedPetsStore = defineStore('pinnedPets', {
  state: () => ({ items: [], loaded: false, quickViewPetId: '' }),
  getters: {
    isPinned: (state) => (petId) => state.items.some((item) => String(item.petId) === String(petId)),
  },
  actions: {
    setItems(items) {
      this.items = items ?? [];
      this.loaded = true;
    },
    async load() {
      try {
        const { data } = await http.get('/pinned-pets');
        this.setItems(data.items);
      } catch {
        // 暫存區載不到不影響其他功能，下一次廣播或重新整理會補上。
      }
    },
    async pin(petId, pinnedBy) {
      const { data } = await http.post('/pinned-pets', { petId, pinnedBy });
      this.setItems(data.items);
    },
    async unpin(petId) {
      const { data } = await http.delete(`/pinned-pets/${petId}`);
      this.setItems(data.items);
    },
    openQuickView(petId) {
      this.quickViewPetId = String(petId || '');
    },
    closeQuickView() {
      this.quickViewPetId = '';
    },
    reset() {
      this.items = [];
      this.loaded = false;
      this.quickViewPetId = '';
    },
  },
});

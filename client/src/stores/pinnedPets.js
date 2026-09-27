import { defineStore } from 'pinia';
import { http } from '../api/http';
import { useUtilityPanelStore } from './utilityPanel';

// 全站共用的貓咪暫存區（櫃台接電話時丟給醫師看病歷用）。資料的真相在後端
// pinnedPets collection，任何異動伺服器都會用 pinned-pets:updated 廣播整份清單，
// 這裡直接取代，不自己推算差異。病歷速覽開在右側暫存區面板裡推入的一層
// ——聊天室與待辦的 # 標籤、暫存清單都從 openQuickView 叫出同一個。
export const usePinnedPetsStore = defineStore('pinnedPets', {
  state: () => ({ items: [], loaded: false }),
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
      useUtilityPanelStore().openPet(petId);
    },
    reset() {
      this.items = [];
      this.loaded = false;
    },
  },
});

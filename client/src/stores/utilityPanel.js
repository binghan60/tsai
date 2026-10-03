import { defineStore } from 'pinia';

// 右側工具欄開的側滑面板。一次只開一個面板，面板內可以再「推入」一層
// （暫存區點一隻貓推入病歷速覽、藥單推入新增表單），左上角返回就退回上一層。
// 面板不遮擋也不鎖住背後的頁面：櫃台講電話時要一邊看時間軸一邊查病歷。
//
// 面板內容用 KeepAlive 保留，關掉再打開時藥單表單、聊天草稿都還在。
// 每個面板各自記住自己推入到哪一層，切到別的面板再切回來也回到原處。
export const PANEL_KEYS = ['pinned', 'medications', 'todos', 'lab', 'intake', 'chat'];

export const useUtilityPanelStore = defineStore('utilityPanel', {
  state: () => ({
    active: '',
    // { [panelKey]: [{ type, ...params }] }，空陣列＝在面板首頁。
    stacks: {},
  }),
  getters: {
    isOpen: (state) => Boolean(state.active),
    view: (state) => {
      const stack = state.stacks[state.active] || [];
      return stack.at(-1) || null;
    },
    depth: (state) => (state.stacks[state.active] || []).length,
  },
  actions: {
    open(key) {
      if (!PANEL_KEYS.includes(key)) return;
      this.active = key;
    },
    toggle(key) {
      if (this.active === key) this.close();
      else this.open(key);
    },
    close() {
      this.active = '';
    },
    push(view, key = this.active) {
      if (!key) return;
      this.active = key;
      const stack = this.stacks[key] || [];
      // 同一層重複推入（例如連點兩隻貓）就換掉最上層，不要越疊越深。
      const top = stack.at(-1);
      const next = top?.type === view.type ? [...stack.slice(0, -1), view] : [...stack, view];
      this.stacks = { ...this.stacks, [key]: next };
    },
    back() {
      const stack = this.stacks[this.active] || [];
      if (!stack.length) return;
      this.stacks = { ...this.stacks, [this.active]: stack.slice(0, -1) };
    },
    resetStack(key = this.active) {
      this.stacks = { ...this.stacks, [key]: [] };
    },
    // 病歷速覽：從聊天、待辦的 # 標記、暫存區點進來都走這裡，一律在暫存區面板推入。
    openPet(petId) {
      if (!petId) return;
      this.stacks = { ...this.stacks, pinned: [] };
      this.push({ type: 'pet', petId: String(petId) }, 'pinned');
    },
    reset() {
      this.active = '';
      this.stacks = {};
    },
  },
});

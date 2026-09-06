import { ref, watch } from 'vue';

// 全站聊天用的裝置固定身分：同一台電腦（診間、櫃台各自的電腦）第一次用聊天室
// 時選一次身分，之後記在 localStorage，不用每次進聊天室手動選。模組層級單例，
// 寫法比照 useToast 的模組層級 toasts——只需要一份跨元件共用的狀態。
const STORAGE_KEY = 'clinic.staffIdentity';
const identity = ref(localStorage.getItem(STORAGE_KEY) === 'front_desk' ? 'front_desk' : 'vet');
watch(identity, (value) => localStorage.setItem(STORAGE_KEY, value));

export function useStaffIdentity() {
  return {
    identity,
    setIdentity(value) {
      if (value === 'vet' || value === 'front_desk') identity.value = value;
    },
  };
}

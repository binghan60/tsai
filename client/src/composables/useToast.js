import { ref } from 'vue';

const toasts = ref([]);
let count = 0;

export function useToast() {
  // action：{ label, handler }，例如一鍵報到後的「復原」。按下去就收掉這則提示，
  // 避免同一個復原被連點兩次。帶 action 的提示停留久一點，不然來不及反應。
  function addToast({ title = '', message = '', type = 'success', duration, action = null }) {
    const id = ++count;
    const toast = { id, title, message, type, action };
    duration ??= action ? 8000 : 3500;
    toasts.value.push(toast);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
    return id;
  }

  function removeToast(id) {
    const index = toasts.value.findIndex((t) => t.id === id);
    if (index !== -1) {
      toasts.value.splice(index, 1);
    }
  }

  function success(message, title = '操作成功', options = {}) {
    return addToast({ title, message, type: 'success', ...options });
  }

  function error(message, title = '操作失敗') {
    return addToast({ title, message, type: 'error', duration: 4500 });
  }

  function info(message, title = '提示訊息') {
    return addToast({ title, message, type: 'info' });
  }

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    info,
  };
}

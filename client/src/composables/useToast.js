import { ref } from 'vue';

const toasts = ref([]);
let count = 0;

export function useToast() {
  function addToast({ title = '', message = '', type = 'success', duration = 3500 }) {
    const id = ++count;
    const toast = { id, title, message, type };
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

  function success(message, title = '操作成功') {
    return addToast({ title, message, type: 'success' });
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

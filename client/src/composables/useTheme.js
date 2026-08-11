import { ref } from 'vue';

const isDark = ref(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

function applyTheme(dark) {
  isDark.value = dark;
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

function toggleTheme() {
  applyTheme(!isDark.value);
}

export function useTheme() {
  return { isDark, toggleTheme };
}

import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // client 自己有 package-lock.json，Vite 會把它當成 workspace root，預設拒絕存取
    // 專案根目錄下的 shared/（前後端共用的表單預設值邏輯就放在那裡）。
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
})

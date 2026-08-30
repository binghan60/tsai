import { createApp } from 'vue'
import { createPinia } from 'pinia'
// 變數字體，自架不走 CDN——/report/:token 是 Puppeteer 產 PDF 的來源，
// 字體若要連外，離線或連線不穩時報告排版會跟著變。
// 這個包按 unicode-range 切成 105 片，瀏覽器只下載頁面實際用到的區段。
import '@fontsource-variable/noto-sans-tc'
import './style.css'
import App from './App.vue'
import router from './router'

createApp(App).use(createPinia()).use(router).mount('#app')

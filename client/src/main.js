import { createApp } from 'vue'
import { createPinia } from 'pinia'
// 變數字體，自架不走 CDN——/report/:token 是 Puppeteer 產 PDF 的來源，
// 字體若要連外，離線或連線不穩時報告排版會跟著變。
// 這個包按 unicode-range 切成 105 片，瀏覽器只下載頁面實際用到的區段。
import '@fontsource-variable/noto-sans-tc'
// 數字（號碼牌、時間、量測、檢驗值）用等寬字，欄位才對得齊。同樣自架，理由同上。
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './style.css'
import App from './App.vue'
import router from './router'
import { tooltipDirective } from './lib/tooltipDirective'

// v-tip：取代原生 title 的滑過提示，見 lib/tooltipDirective.js。
createApp(App).use(createPinia()).use(router).directive('tip', tooltipDirective).mount('#app')

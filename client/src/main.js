import { createApp } from 'vue'
// 變數字體，自架不走 CDN——/report/:token 是 Puppeteer 產 PDF 的來源，
// 字體若要連外，離線或連線不穩時報告排版會跟著變。
// 這個包按 unicode-range 切成 105 片，瀏覽器只下載頁面實際用到的區段。
import '@fontsource-variable/noto-sans-tc'
import './style.css'
import App from './App.vue'
import router from './router'

const app = createApp(App).use(router)

// 等第一次導覽跑完才掛載。路由守衛要先問伺服器有沒有登入，在那之前 route 還是空的，
// App.vue 會把它當成一般後台頁面，沒登入的人就會先看到側邊欄閃一下才跳到登入頁。
// 導覽失敗（例如頁面的 chunk 載不到）也照樣掛載，否則畫面會永遠空白。
router.isReady().catch(() => {}).then(() => app.mount('#app'))

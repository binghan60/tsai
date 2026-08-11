import { createApp, watch } from 'vue'
import './style.css'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'
import App from './App.vue'
import router from './router'
import { useTheme } from './composables/useTheme'

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: {
      // primary 對齊現有配色：淺色用酒紅 belle-600、深色用科技橘 brand-500，
      // 其餘顏色（error/success...）先沿用 Vuetify 內建值，之後再一起做完整配色整合
      light: { colors: { primary: '#8a3049' } },
      dark: { colors: { primary: '#f97316' } },
    },
  },
  icons: { defaultSet: 'mdi' },
})

// Vuetify 有自己一套明暗主題，跟 useTheme.js 管理的 .dark class 是分開的兩套機制，
// 這裡把兩者同步起來，讓 Vuetify 元件（v-dialog/v-card/v-btn...）跟著切換
const { isDark } = useTheme()
watch(
  isDark,
  (dark) => {
    vuetify.theme.global.name.value = dark ? 'dark' : 'light'
  },
  { immediate: true }
)

createApp(App).use(router).use(vuetify).mount('#app')

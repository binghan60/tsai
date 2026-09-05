<script setup>
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarClock, Cat, ClipboardList, FileText, LayoutDashboard, LogOut, Mail, Menu, Moon, Search, Stethoscope, Sun } from '@lucide/vue';
import { useTheme } from './composables/useTheme';
import { useAuthStore } from './stores/auth';
import { useAppointmentNotificationsStore } from './stores/appointmentNotifications';
import { useGlobalAppointmentNotifications } from './composables/useGlobalAppointmentNotifications';
import { Button } from './components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './components/ui/sheet';
import ToastContainer from './components/ToastContainer.vue';
import GlobalSearchDialog from './components/GlobalSearchDialog.vue';

const route = useRoute();
const router = useRouter();
const { isDark, toggleTheme } = useTheme();
const mobileOpen = ref(false);
const searchOpen = ref(false);
const auth = useAuthStore();
const notifications = useAppointmentNotificationsStore();
useGlobalAppointmentNotifications();

// Vue Router 會重用同一條動態路由的元件實例。以資料識別碼作 key，確保從飼主 A
// 切到飼主 B（或從舊版報告切到新版）時，舊元件與尚未完成的請求不會殘留在畫面上。
// 查詢字串不放進 key，列表搜尋與分頁不會因此整頁重掛。
const ROUTE_IDENTITY_PARAMS = {
  '/pets/:id': 'id',
  '/records/:id/preview': 'id',
  '/report/:token': 'token',
  '/settings/forms/:id': 'id',
};
const routeViewKey = computed(() => {
  const pattern = route.matched.at(-1)?.path ?? route.path;
  const paramName = ROUTE_IDENTITY_PARAMS[pattern];
  return paramName ? `${pattern}:${String(route.params[paramName] ?? '')}` : pattern;
});

// match：除了自己的網址前綴，還有哪些路徑也該算在這一項底下。目前用不到，
// 但 /records 這種「有自己的頂層網址、心理上卻屬於別項」的路由隨時會再出現，
// 沒有這層的話一進那些頁面側邊欄會全暗，等於在系統裡失去座標。
const navItems = [
  { to: '/', label: '儀表板', exact: true, icon: LayoutDashboard },
  { to: '/appointments', label: '看診', exact: false, icon: Stethoscope },
  { to: '/front-desk', label: '櫃台', exact: false, icon: CalendarClock },
  { to: '/pets', label: '寵物', exact: false, icon: Cat },
  { to: '/records', label: '就診紀錄', exact: false, icon: FileText },
  { to: '/records/deliveries', label: '寄送歷程', exact: false, icon: Mail },
  { to: '/settings/forms', label: '表單管理', exact: false, icon: ClipboardList },
  { to: '/settings/text-templates', label: '文字模板', exact: false, icon: FileText },
];

const activeTitle = computed(() => route.meta.title ?? navItems.find(isNavActive)?.label ?? '儀表板');

// 看診／櫃台留言的未讀提示直接標在各自的側邊欄項目上（取代原本獨立的通知鈴鐺），
// 對應規則見 stores/appointmentNotifications.js 的 doctorCount／frontDeskCount。
const NAV_BADGE_COUNTS = {
  '/appointments': () => notifications.doctorCount,
  '/front-desk': () => notifications.frontDeskCount,
};
function navBadgeCount(item) {
  return NAV_BADGE_COUNTS[item.to]?.() ?? 0;
}
function navBadgeLabel(item) {
  const count = navBadgeCount(item);
  return count > 9 ? '9+' : String(count);
}

// router-link 內建的 active-class 是靠比對路由「記錄」（route.matched），不是比對網址字串——
// /settings、/settings/forms、/settings/forms/:id 各自是獨立註冊的路由，不是巢狀父子關係，
// 內建判斷永遠抓不到「現在在設定底下的某一頁」。用網址前綴自己判斷才會準。
function matchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isNavActive(item) {
  // 路由自己指定了歸屬就聽它的——網址前綴猜錯的情況（/pets/:petId/records/new
  // 其實屬於就診紀錄）只有路由自己知道。
  if (route.meta.nav) return route.meta.nav === item.to;
  if (item.exact) return route.path === item.to || (item.match ?? []).some((prefix) => matchesPrefix(route.path, prefix));
  return matchesPrefix(route.path, item.to) || (item.match ?? []).some((prefix) => matchesPrefix(route.path, prefix));
}
const navActiveClass = 'border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--color-brand-400)]';

// 搜尋開的是蓋在當前頁面上的面板，不換路由——詳見 GlobalSearchDialog.vue。
function openGlobalSearch() {
  searchOpen.value = true;
}

async function logout() {
  await auth.logout();
  await router.replace('/login');
}

// http.js 攔截到 401（cookie 過期、或帳號在別處被撤銷 session）時會發這個事件。
// 不用 store 的 watch 是因為問題本身就發生在「畫面以為還登入著」的當下，
// 需要的是主動導轉，不是等某個 state 變化。
function handleUnauthorized() {
  auth.clearSession();
  if (route.path !== '/login') {
    router.replace({ path: '/login', query: { redirect: route.fullPath } });
  }
}
onMounted(() => window.addEventListener('auth:unauthorized', handleUnauthorized));
onUnmounted(() => window.removeEventListener('auth:unauthorized', handleUnauthorized));

provide('openGlobalSearch', openGlobalSearch);

watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false;
  }
);
</script>

<template>
  <div v-if="route.meta.bare">
    <router-view :key="routeViewKey" />
  </div>

  <template v-else>
    <div class="app-shell min-h-screen text-foreground lg:flex">
      <aside class="belle-sidebar hidden min-h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div class="border-b border-sidebar-border p-3">
          <router-link to="/" class="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
            <span class="flex h-12 w-12 shrink-0 items-center justify-center">
              <img src="/chien-hua-logo-mark-v2.png" alt="" aria-hidden="true" class="h-full w-full object-contain" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">謙華動物醫院</span>
              <span class="block truncate text-xs text-sidebar-foreground/70">健檢與報告</span>
            </span>
          </router-link>
        </div>

        <div class="space-y-2 border-b border-sidebar-border p-3">
          <button
            type="button"
            class="flex min-h-10 w-full items-center gap-3 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/45 px-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label="搜尋飼主、寵物或電話"
            title="搜尋飼主、寵物或電話"
            @click="openGlobalSearch"
          >
            <Search class="h-4 w-4 shrink-0" stroke-width="1.9" />
            <span class="truncate">搜尋資料</span>
            <kbd class="ml-auto shrink-0 rounded border border-sidebar-border px-1.5 py-0.5 text-xs text-sidebar-foreground/70">Ctrl K</kbd>
          </button>
        </div>

        <nav class="flex-1 space-y-6 px-3 py-4" aria-label="主要導覽">
          <div>
            <p class="px-2 pb-2 text-xs font-medium text-sidebar-foreground/70">平台</p>
            <router-link
              v-for="item in navItems"
              :key="item.to"
              :to="item.to"
              class="mb-1 flex min-h-10 items-center gap-3 rounded-lg border border-transparent bg-sidebar-accent/30 px-2.5 text-sm font-medium text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              :class="isNavActive(item) ? navActiveClass : ''"
            >
              <component :is="item.icon" class="h-4 w-4" stroke-width="1.9" />
              <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
              <span v-if="navBadgeCount(item)" class="ml-auto shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-xs font-bold text-white">{{ navBadgeLabel(item) }}</span>
            </router-link>
          </div>
        </nav>

        <div class="border-t border-sidebar-border p-3">
          <button
            type="button"
            class="mb-2 flex min-h-10 w-full items-center gap-3 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/45 px-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            @click="logout"
          >
            <LogOut class="h-4 w-4" stroke-width="1.9" />
            登出
          </button>
          <button
            type="button"
            class="flex min-h-10 w-full items-center gap-3 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/45 px-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            @click="toggleTheme"
          >
            <Sun v-if="isDark" class="h-4 w-4" stroke-width="1.9" />
            <Moon v-else class="h-4 w-4" stroke-width="1.9" />
            {{ isDark ? '淺色模式' : '深色模式' }}
          </button>
        </div>
      </aside>

      <div class="min-w-0 flex-1 lg:@container/content">
        <header id="app-header" class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 sm:px-6 lg:hidden">
          <Button
            type="button"
            variant="outline"
            size="icon"
            class="min-w-11 lg:hidden"
            aria-label="開啟導覽選單"
            @click="mobileOpen = true"
          >
            <Menu class="h-4 w-4" />
          </Button>

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-foreground">{{ activeTitle }}</p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            class="min-w-11 md:hidden"
            aria-label="搜尋飼主、寵物或電話"
            @click="openGlobalSearch"
          >
            <Search class="h-4 w-4" stroke-width="1.75" />
          </Button>

          <button type="button" aria-label="搜尋飼主、寵物或電話" class="hidden min-h-11 min-w-72 items-center rounded-lg border border-input bg-field px-3 text-sm text-muted-foreground shadow-sm hover:border-ring hover:text-foreground md:flex" @click="openGlobalSearch">
            <Search class="mr-2 h-4 w-4" stroke-width="1.75" />
            <span class="py-2">搜尋飼主、寵物或電話</span>
          </button>

          <Button
            type="button"
            variant="outline"
            size="icon"
            class="min-w-11 lg:hidden"
            :aria-label="isDark ? '切換淺色模式' : '切換深色模式'"
            @click="toggleTheme"
          >
            <Sun v-if="isDark" class="h-4 w-4" />
            <Moon v-else class="h-4 w-4" />
          </Button>
        </header>

        <Sheet v-model:open="mobileOpen">
          <SheetContent side="left" class="flex w-[min(84vw,320px)] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
            <SheetTitle class="sr-only">導覽選單</SheetTitle>
            <SheetDescription class="sr-only">謙華動物醫院健檢與報告系統的主要導覽選單</SheetDescription>
            <div class="border-b border-sidebar-border p-3">
              <router-link to="/" class="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                <span class="flex h-12 w-12 shrink-0 items-center justify-center">
                  <img src="/chien-hua-logo-mark-v2.png" alt="" aria-hidden="true" class="h-full w-full object-contain" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-semibold">謙華動物醫院</span>
                  <span class="block truncate text-xs text-sidebar-foreground/70">健檢與報告</span>
                </span>
              </router-link>
            </div>
            <nav class="flex-1 space-y-1 px-3 py-4" aria-label="行動版主要導覽">
              <router-link
                v-for="item in navItems"
                :key="item.to"
                :to="item.to"
                class="flex min-h-11 items-center gap-3 rounded-lg border border-transparent bg-sidebar-accent/30 px-2.5 text-sm font-medium text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                :class="isNavActive(item) ? navActiveClass : ''"
              >
                <component :is="item.icon" class="h-4 w-4" stroke-width="1.9" />
                <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                <span v-if="navBadgeCount(item)" class="ml-auto shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-xs font-bold text-white">{{ navBadgeLabel(item) }}</span>
              </router-link>
            </nav>
            <div class="border-t border-sidebar-border p-3">
              <button
                type="button"
                class="flex min-h-11 w-full items-center gap-3 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/45 px-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                @click="toggleTheme"
              >
                <Sun v-if="isDark" class="h-4 w-4" stroke-width="1.9" />
                <Moon v-else class="h-4 w-4" stroke-width="1.9" />
                {{ isDark ? '淺色模式' : '深色模式' }}
              </button>
            </div>
          </SheetContent>
        </Sheet>

        <main class="min-w-0 px-4 py-5 sm:px-6 lg:px-8">
          <router-view :key="routeViewKey" />
        </main>
      </div>
    </div>
    <GlobalSearchDialog v-model:open="searchOpen" />
    <ToastContainer />
  </template>
</template>

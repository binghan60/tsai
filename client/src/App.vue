<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Menu, PawPrint, Search } from '@lucide/vue';
import AppSettingsMenu from './components/AppSettingsMenu.vue';
import NavRail from './components/shell/NavRail.vue';
import UtilityRail from './components/shell/UtilityRail.vue';
import UtilityPanelHost from './components/shell/UtilityPanelHost.vue';
import { NAV_GROUPS, NAV_ITEMS } from './lib/navigation';
import { useAuthStore } from './stores/auth';
import { useGlobalChat } from './composables/useGlobalChat';
import { Button } from './components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './components/ui/sheet';
import ToastContainer from './components/ToastContainer.vue';
import GlobalSearchDialog from './components/GlobalSearchDialog.vue';

const route = useRoute();
const router = useRouter();

const mobileOpen = ref(false);
const searchOpen = ref(false);
const auth = useAuthStore();
useGlobalChat();

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

// router-link 內建的 active 判斷比對的是路由記錄，/settings/forms 與 /settings/forms/:id
// 是各自獨立註冊的路由，抓不到「現在在設定底下的某一頁」，所以用網址前綴自己判斷。
function matchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isNavActive(item) {
  // 路由自己指定了歸屬就聽它的——/pets/:petId/records/new 其實屬於報告，只有路由自己知道。
  if (route.meta.nav) return route.meta.nav === item.to;
  if (item.exact) return route.path === item.to;
  // /records/deliveries 同時符合 /records 的前綴；有更長的導覽項吃得下這個網址時讓給它。
  const longer = NAV_ITEMS.some((other) => other.to.length > item.to.length && matchesPrefix(route.path, other.to));
  return matchesPrefix(route.path, item.to) && !longer;
}

const activeTitle = computed(() => route.meta.title ?? NAV_ITEMS.find(isNavActive)?.label ?? '總覽');

// 搜尋開的是蓋在當前頁面上的面板，不換路由——詳見 GlobalSearchDialog.vue。
function openGlobalSearch() {
  searchOpen.value = true;
}

async function logout() {
  await auth.logout();
  await router.replace('/login');
}

// http.js 攔截到 401（cookie 過期、或帳號在別處被撤銷 session）時會發這個事件。
function handleUnauthorized() {
  auth.clearSession();
  if (route.path !== '/login') {
    router.replace({ path: '/login', query: { redirect: route.fullPath } });
  }
}
onMounted(() => window.addEventListener('auth:unauthorized', handleUnauthorized));
onUnmounted(() => window.removeEventListener('auth:unauthorized', handleUnauthorized));


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
    <!-- 骨架：左側導覽｜工作區｜（工具欄面板）｜右側工具欄。頁面本身仍由視窗捲動，
         返回上一頁時捲動位置才還原得回來；兩條欄與並排的面板用 sticky 釘在畫面上。 -->
    <div class="flex min-h-screen bg-background text-foreground">
      <div class="sticky top-0 hidden h-screen shrink-0 lg:block">
        <NavRail :is-active="isNavActive" @search="openGlobalSearch" @logout="logout" />
      </div>

      <div class="min-w-0 flex-1 @container/content">
        <header id="app-header" class="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card px-4 lg:hidden">
          <Button variant="ghost" size="icon" aria-label="開啟導覽選單" @click="mobileOpen = true"><Menu stroke-width="1.75" /></Button>
          <p class="min-w-0 flex-1 truncate font-semibold">{{ activeTitle }}</p>
          <Button variant="ghost" size="icon" aria-label="搜尋飼主、貓咪或電話" @click="openGlobalSearch"><Search stroke-width="1.75" /></Button>
          <AppSettingsMenu @logout="logout" />
        </header>

        <Sheet v-model:open="mobileOpen">
          <SheetContent side="left" class="flex w-[min(84vw,320px)] flex-col gap-0 border-nav-border bg-nav p-0">
            <SheetTitle class="sr-only">導覽選單</SheetTitle>
            <SheetDescription class="sr-only">謙華動物醫院的主要導覽選單</SheetDescription>
            <div class="flex items-center gap-3 border-b border-nav-border px-4 py-3">
              <span class="flex size-10 items-center justify-center rounded-[10px] bg-logo text-logo-foreground"><PawPrint class="size-5" stroke-width="2" /></span>
              <span class="font-semibold">謙華動物醫院</span>
            </div>
            <nav class="flex-1 overflow-y-auto px-3 py-3" aria-label="行動版主要導覽">
              <template v-for="group in NAV_GROUPS" :key="group.label">
                <p class="spec-label px-2 pt-3 pb-1">{{ group.label }}</p>
                <router-link
                  v-for="item in group.items"
                  :key="item.to"
                  :to="item.to"
                  class="flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium"
                  :class="isNavActive(item) ? 'bg-nav-active text-nav-active-foreground' : 'text-nav-foreground hover:bg-hover'"
                  :aria-current="isNavActive(item) ? 'page' : undefined"
                >
                  <component :is="item.icon" class="size-5" stroke-width="1.75" />{{ item.label }}
                </router-link>
              </template>
            </nav>
          </SheetContent>
        </Sheet>

        <main class="mx-auto w-full min-w-0 px-4 py-5 sm:px-6" :class="route.meta.wide ? '' : 'max-w-360'">
          <router-view :key="routeViewKey" />
        </main>
      </div>

      <div class="min-[1600px]:sticky min-[1600px]:top-0 min-[1600px]:h-screen">
        <UtilityPanelHost />
      </div>
      <div class="sticky top-0 h-screen shrink-0">
        <UtilityRail />
      </div>
    </div>
    <GlobalSearchDialog v-model:open="searchOpen" />
    <!-- 診療台與掛號台的底部是主要動作（送交櫃台、完成處理），提示改放上面、頁首那一列的下方。 -->
    <ToastContainer :placement="route.path.startsWith('/appointments') || route.path.startsWith('/reception') ? 'top' : 'bottom'" />
  </template>
</template>

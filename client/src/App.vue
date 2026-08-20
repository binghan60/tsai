<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Cat, ClipboardList, FileText, LayoutDashboard, Menu, Moon, Search, Sun, Users } from '@lucide/vue';
import { useTheme } from './composables/useTheme';
import { Button } from './components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './components/ui/sheet';
import ToastContainer from './components/ToastContainer.vue';
import GlobalSearchDialog from './components/GlobalSearchDialog.vue';

const route = useRoute();
const { isDark, toggleTheme } = useTheme();
const mobileOpen = ref(false);
const searchOpen = ref(false);

// match：除了自己的網址前綴，還有哪些路徑也該算在這一項底下。目前用不到，
// 但 /records 這種「有自己的頂層網址、心理上卻屬於別項」的路由隨時會再出現，
// 沒有這層的話一進那些頁面側邊欄會全暗，等於在系統裡失去座標。
const navItems = [
  { to: '/', label: '工作台', exact: true, icon: LayoutDashboard },
  { to: '/owners', label: '飼主', exact: false, icon: Users },
  { to: '/pets', label: '寵物', exact: false, icon: Cat },
  { to: '/records', label: '健檢紀錄', exact: false, icon: FileText },
  { to: '/settings', label: '表單管理', exact: false, icon: ClipboardList },
];

const activeTitle = computed(() => route.meta.title ?? navItems.find(isNavActive)?.label ?? '工作台');

// router-link 內建的 active-class 是靠比對路由「記錄」（route.matched），不是比對網址字串——
// /settings、/settings/forms、/settings/forms/:id 各自是獨立註冊的路由，不是巢狀父子關係，
// 內建判斷永遠抓不到「現在在設定底下的某一頁」。用網址前綴自己判斷才會準。
function matchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isNavActive(item) {
  // 路由自己指定了歸屬就聽它的——網址前綴猜錯的情況（/pets/:petId/records/new
  // 其實屬於健檢紀錄）只有路由自己知道。
  if (route.meta.nav) return route.meta.nav === item.to;
  if (item.exact) return route.path === item.to || (item.match ?? []).some((prefix) => matchesPrefix(route.path, prefix));
  return matchesPrefix(route.path, item.to) || (item.match ?? []).some((prefix) => matchesPrefix(route.path, prefix));
}
const navActiveClass = 'border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--color-brand-400)]';

// 搜尋開的是蓋在當前頁面上的面板，不換路由——詳見 GlobalSearchDialog.vue。
function openGlobalSearch() {
  searchOpen.value = true;
}

watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false;
  }
);
</script>

<template>
  <div v-if="route.meta.bare">
    <router-view />
  </div>

  <template v-else>
    <div class="belle-light-shell min-h-screen text-foreground lg:flex">
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

        <div class="border-b border-sidebar-border p-3">
          <button
            type="button"
            class="flex min-h-10 w-full items-center gap-3 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/45 px-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label="搜尋飼主、寵物或病歷"
            @click="openGlobalSearch"
          >
            <Search class="h-4 w-4 shrink-0" stroke-width="1.9" />
            <span class="truncate">搜尋飼主、寵物或病歷</span>
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
              <span>{{ item.label }}</span>
            </router-link>
          </div>
        </nav>

        <div class="border-t border-sidebar-border p-3">
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

          <button type="button" aria-label="搜尋飼主、寵物或病歷" class="hidden min-h-11 min-w-72 items-center rounded-lg border border-input bg-card/70 px-3 text-sm text-muted-foreground shadow-sm hover:border-brand-400 hover:text-primary dark:bg-card/70 dark:hover:border-brand-500/70 dark:hover:text-brand-300 md:flex" @click="openGlobalSearch">
            <Search class="mr-2 h-4 w-4" stroke-width="1.75" />
            <span class="py-2">搜尋飼主、寵物或病歷</span>
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
                {{ item.label }}
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
          <router-view />
        </main>
      </div>
    </div>
    <GlobalSearchDialog v-model:open="searchOpen" />
    <ToastContainer />
  </template>
</template>

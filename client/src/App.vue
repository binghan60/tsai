<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Cat, LayoutDashboard, Menu, Moon, PawPrint, Search, Settings2, Sun, Users } from '@lucide/vue';
import { useTheme } from './composables/useTheme';
import { Button } from './components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './components/ui/sheet';
import ToastContainer from './components/ToastContainer.vue';

const route = useRoute();
const router = useRouter();
const { isDark, toggleTheme } = useTheme();
const mobileOpen = ref(false);

const navItems = [
  { to: '/', label: '工作台', exact: true, icon: LayoutDashboard },
  { to: '/owners', label: '飼主', exact: false, icon: Users },
  { to: '/pets', label: '寵物', exact: false, icon: Cat },
  { to: '/settings', label: '標準值', exact: false, icon: Settings2 },
];

const activeTitle = computed(() => route.meta.title ?? navItems.find((item) => (item.exact ? route.path === item.to : route.path.startsWith(item.to)))?.label ?? '工作台');

async function openGlobalSearch() {
  if (route.path !== '/') await router.push({ path: '/', query: { focus: 'search' } });
  await nextTick();
  window.requestAnimationFrame(() => document.getElementById('global-search')?.focus());
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
          <router-link to="/" class="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-500 text-cream-50 shadow-[0_0_18px_-4px_rgba(173,119,39,0.72)] dark:bg-brand-500 dark:shadow-[0_0_18px_-3px_rgba(201,154,53,0.55)]">
              <PawPrint class="h-4 w-4" stroke-width="1.8" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">寵物健康管理</span>
              <span class="block truncate text-xs text-muted-foreground">健檢與報告</span>
            </span>
          </router-link>
        </div>

        <nav class="flex-1 space-y-6 px-3 py-4" aria-label="主要導覽">
          <div>
            <p class="px-2 pb-2 text-xs font-medium text-muted-foreground">平台</p>
            <router-link
              v-for="item in navItems"
              :key="item.to"
              :to="item.to"
              class="mb-1 flex min-h-10 items-center gap-3 rounded-lg border border-transparent bg-sidebar-accent/30 px-2.5 text-sm font-medium text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              :active-class="item.exact ? '' : 'border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--color-brand-400)]'"
              :exact-active-class="item.exact ? 'border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--color-brand-400)]' : ''"
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
        <header id="app-header" class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 sm:px-6 lg:px-8">
          <Button
            type="button"
            variant="outline"
            size="icon"
            class="min-h-11 min-w-11 lg:hidden"
            aria-label="開啟導覽選單"
            @click="mobileOpen = true"
          >
            <Menu class="h-4 w-4" />
          </Button>

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-foreground">{{ activeTitle }}</p>
          </div>

          <button type="button" aria-label="搜尋飼主、寵物或病歷" class="hidden min-h-11 min-w-72 items-center rounded-md border border-input bg-card/70 px-3 text-sm text-muted-foreground shadow-sm hover:border-brand-400 hover:text-primary dark:bg-card/70 dark:hover:border-brand-500/70 dark:hover:text-brand-300 md:flex" @click="openGlobalSearch">
            <Search class="mr-2 h-4 w-4" stroke-width="1.75" />
            <span class="py-2">搜尋飼主、寵物或病歷</span>
          </button>

          <Button
            type="button"
            variant="outline"
            size="icon"
            class="min-h-11 min-w-11 lg:hidden"
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
            <SheetDescription class="sr-only">寵物健康管理系統的主要導覽選單</SheetDescription>
            <div class="border-b border-sidebar-border p-3">
              <span class="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-500 text-cream-50 shadow-[0_0_18px_-4px_rgba(173,119,39,0.72)] dark:bg-brand-500 dark:shadow-[0_0_18px_-3px_rgba(201,154,53,0.55)]">
                  <PawPrint class="h-4 w-4" stroke-width="1.8" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-semibold">寵物健康管理</span>
                  <span class="block truncate text-xs text-muted-foreground">健檢與報告</span>
                </span>
              </span>
            </div>
            <nav class="flex-1 space-y-1 px-3 py-4" aria-label="行動版主要導覽">
              <router-link
                v-for="item in navItems"
                :key="item.to"
                :to="item.to"
                class="flex min-h-11 items-center gap-3 rounded-lg border border-transparent bg-sidebar-accent/30 px-2.5 text-sm font-medium text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                :active-class="item.exact ? '' : 'border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--color-brand-400)]'"
                :exact-active-class="item.exact ? 'border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--color-brand-400)]' : ''"
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
    <ToastContainer />
  </template>
</template>

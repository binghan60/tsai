<script setup>
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Cat, LayoutGrid, Menu, Moon, PawPrint, SlidersHorizontal, Sun, Users, X } from '@lucide/vue';
import { useTheme } from './composables/useTheme';

const route = useRoute();
const { isDark, toggleTheme } = useTheme();
const mobileOpen = ref(false);

const navItems = [
  { to: '/', label: '健檢工作台', exact: true, icon: LayoutGrid },
  { to: '/owners', label: '飼主', exact: false, icon: Users },
  { to: '/pets', label: '寵物', exact: false, icon: Cat },
  { to: '/settings', label: '標準值設定', exact: false, icon: SlidersHorizontal },
];

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

  <v-app v-else>
    <div class="min-h-screen bg-cream-100 dark:bg-zinc-950 lg:flex">
      <aside class="hidden min-h-screen w-64 shrink-0 flex-col border-r border-cream-300 bg-cream-50 dark:border-zinc-800 dark:bg-zinc-950 lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div class="flex items-center gap-3 border-b border-cream-300 px-5 py-5 dark:border-zinc-800">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-belle-600 text-white dark:bg-brand-500 dark:shadow-[0_0_18px_-2px_rgba(249,115,22,0.5)]">
            <PawPrint class="h-5 w-5" stroke-width="1.75" />
          </div>
          <div>
            <p class="text-sm font-semibold text-ink-900 dark:text-white">寵物健康管理</p>
            <p class="text-xs text-ink-400 dark:text-zinc-400">健檢與報告</p>
          </div>
        </div>

        <nav class="flex-1 space-y-1 px-3 py-4" aria-label="主要導覽">
          <router-link
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-500 transition-colors hover:bg-cream-200/60 hover:text-ink-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
            :active-class="item.exact ? '' : 'bg-belle-50 text-belle-600 hover:bg-belle-50 hover:text-belle-600 dark:bg-brand-500/10 dark:text-brand-400 dark:hover:bg-brand-500/10 dark:hover:text-brand-400'"
            :exact-active-class="item.exact ? 'bg-belle-50 text-belle-600 hover:bg-belle-50 hover:text-belle-600 dark:bg-brand-500/10 dark:text-brand-400 dark:hover:bg-brand-500/10 dark:hover:text-brand-400' : ''"
          >
            <component :is="item.icon" class="h-5 w-5" stroke-width="1.75" />
            {{ item.label }}
          </router-link>
        </nav>

        <div class="border-t border-cream-300 p-3 dark:border-zinc-800">
          <button
            type="button"
            class="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-500 transition-colors hover:bg-cream-200/60 hover:text-ink-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
            @click="toggleTheme"
          >
            <Sun v-if="isDark" class="h-5 w-5" stroke-width="1.75" />
            <Moon v-else class="h-5 w-5" stroke-width="1.75" />
            {{ isDark ? '切換淺色模式' : '切換深色模式' }}
          </button>
        </div>
      </aside>

      <header class="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-cream-300 bg-cream-50/95 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 lg:hidden">
        <router-link to="/" class="flex items-center gap-2.5">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-belle-600 text-white dark:bg-brand-500">
            <PawPrint class="h-5 w-5" stroke-width="1.75" />
          </span>
          <span>
            <span class="block text-sm font-semibold text-ink-900 dark:text-white">寵物健康管理</span>
            <span class="block text-xs text-ink-400 dark:text-zinc-400">健檢與報告</span>
          </span>
        </router-link>
        <button
          type="button"
          class="flex h-11 w-11 items-center justify-center rounded-xl border border-cream-300 text-ink-700 dark:border-zinc-700 dark:text-zinc-200"
          aria-label="開啟導覽選單"
          @click="mobileOpen = true"
        >
          <Menu class="h-5 w-5" />
        </button>
      </header>

      <div v-if="mobileOpen" class="fixed inset-0 z-50 lg:hidden">
        <button class="absolute inset-0 bg-black/55" aria-label="關閉導覽選單" @click="mobileOpen = false"></button>
        <aside class="relative flex h-full w-[min(84vw,320px)] flex-col bg-cream-50 p-4 shadow-2xl dark:bg-zinc-950">
          <div class="mb-4 flex items-center justify-between">
            <span class="text-sm font-semibold text-ink-900 dark:text-white">功能選單</span>
            <button class="flex h-11 w-11 items-center justify-center rounded-xl text-ink-700 dark:text-zinc-200" aria-label="關閉導覽選單" @click="mobileOpen = false">
              <X class="h-5 w-5" />
            </button>
          </div>
          <nav class="flex-1 space-y-1" aria-label="行動版主要導覽">
            <router-link
              v-for="item in navItems"
              :key="item.to"
              :to="item.to"
              class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink-700 hover:bg-cream-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
              active-class="bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400"
            >
              <component :is="item.icon" class="h-5 w-5" stroke-width="1.75" />
              {{ item.label }}
            </router-link>
          </nav>
          <button class="flex min-h-12 items-center gap-3 border-t border-cream-300 px-3 pt-3 text-sm font-medium text-ink-700 dark:border-zinc-800 dark:text-zinc-300" @click="toggleTheme">
            <Sun v-if="isDark" class="h-5 w-5" />
            <Moon v-else class="h-5 w-5" />
            {{ isDark ? '切換淺色模式' : '切換深色模式' }}
          </button>
        </aside>
      </div>

      <main class="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <router-view />
      </main>
    </div>
  </v-app>
</template>

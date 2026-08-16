<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { SETTINGS_GROUPS, SETTINGS_ITEMS } from '../lib/settingsNav';

defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
});

const route = useRoute();
const isActive = (to) => route.path.startsWith(to);
// 只有一組時不顯示分類標題、只有一項時整個子導覽都不顯示，
// 等設定變多再自然浮現。
const showGroupTitles = computed(() => SETTINGS_GROUPS.length > 1);
const showNav = computed(() => SETTINGS_ITEMS.length > 1);
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <!-- 標題只有一層：頁面名稱就是 h1，跟其他頁一致。
         區段名稱由左側子導覽負責，不再另外壓一層標題上去。 -->
    <div class="grid gap-5 lg:items-start" :class="showNav ? 'lg:grid-cols-[220px_1fr]' : ''">
      <!-- 桌機：左側直式子導覽；手機：可橫向捲動的膠囊列（與健檢表單的區段導覽一致） -->
      <nav
        v-if="showNav"
        aria-label="健檢表單管理項目"
        class="flex gap-1 overflow-x-auto rounded-xl border border-cream-300 bg-cream-50 p-1.5 shadow-sm lg:sticky lg:top-16 lg:flex-col lg:gap-0.5 lg:overflow-visible dark:border-zinc-800 dark:bg-zinc-900"
      >
        <template v-for="entry in SETTINGS_GROUPS" :key="entry.group">
          <p v-if="showGroupTitles" class="hidden px-2 pt-2 pb-1 text-xs font-medium text-ink-400 lg:block dark:text-zinc-500">{{ entry.group }}</p>
          <router-link
            v-for="item in entry.items"
            :key="item.to"
            :to="item.to"
            class="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors lg:w-full"
            :class="isActive(item.to)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-transparent text-ink-600 hover:bg-cream-100 dark:text-zinc-300 dark:hover:bg-zinc-800'"
            :aria-current="isActive(item.to) ? 'page' : undefined"
          >
            <component :is="item.icon" class="h-4 w-4 shrink-0" stroke-width="1.75" />
            <span class="truncate">{{ item.label }}</span>
            <span class="hidden text-xs opacity-70 sm:inline lg:hidden">・{{ item.hint }}</span>
          </router-link>
        </template>
      </nav>

      <div class="min-w-0 space-y-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold text-ink-900 dark:text-white">{{ title }}</h1>
            <p v-if="description" class="mt-1 text-sm text-ink-500 dark:text-zinc-400">{{ description }}</p>
          </div>
          <slot name="actions" />
        </div>

        <slot />
      </div>
    </div>
  </section>
</template>

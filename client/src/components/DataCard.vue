<script setup>
// 清單的主卡片，照診療台「今日病患」、掛號台「看診時間軸」那張卡片的樣子：
// 卡片自己的標頭放清單標題＋筆數，右邊是篩選（頁籤、搜尋），下面一列一筆、細線分隔，最底下是分頁。
// 頁首（PageHeader）只留頁面標題與主要動作，篩選不放在頁首。
defineProps({
  title: { type: String, required: true },
  count: { type: [Number, String], default: null },
});
</script>

<template>
  <section class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card" :aria-label="title">
    <header class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-5 py-3">
      <h2 class="text-lg font-semibold">{{ title }}<span v-if="count !== null && count !== undefined" class="num ml-2 text-base font-medium text-subtle-foreground">{{ typeof count === 'number' ? count.toLocaleString('zh-TW') : count }}</span></h2>
      <div v-if="$slots.filters" class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2"><slot name="filters" /></div>
    </header>
    <div v-if="$slots.tabs" class="shrink-0 border-b border-border px-5 py-2.5"><slot name="tabs" /></div>
    <slot />
    <slot name="footer" />
  </section>
</template>

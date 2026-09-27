<script setup>
import { ArrowLeft } from '@lucide/vue';
import { Button } from './ui/button';

// 頁首：（返回）＋ 標題 ＋ 筆數 ＋ 右側動作。清單頁、詳情頁、表單頁共用這一個樣子。
// 說明文字只在真的需要時才給，放在標題下一行；多數頁面靠標題與筆數就夠了。
defineProps({
  title: { type: String, required: true },
  // 標題旁的筆數，例如 count=1284、unit="隻"；null 就不顯示。
  count: { type: [Number, String], default: null },
  unit: { type: String, default: '' },
  description: { type: String, default: '' },
  // 返回鈕要去的地方；不給就不畫。
  backTo: { type: [String, Object], default: null },
  backLabel: { type: String, default: '返回' },
});
</script>

<template>
  <header class="flex flex-wrap items-center gap-x-4 gap-y-3">
    <Button v-if="backTo" variant="secondary" size="icon-sm" class="rounded-full" as-child>
      <router-link :to="backTo" :aria-label="backLabel"><ArrowLeft stroke-width="1.75" /></router-link>
    </Button>
    <div class="min-w-0">
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 class="text-xl leading-tight font-semibold text-foreground">{{ title }}</h1>
        <span v-if="count !== null && count !== undefined" class="text-base text-subtle-foreground"><span class="num">{{ typeof count === 'number' ? count.toLocaleString('zh-TW') : count }}</span> {{ unit }}</span>
        <slot name="meta" />
      </div>
      <p v-if="description" class="mt-1 max-w-3xl text-sm text-muted-foreground">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>

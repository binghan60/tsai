<script setup>
import { ArrowLeft, X } from '@lucide/vue';
import { Button } from '../ui/button';

// 右側工具欄面板的外框：標頭（返回／標題／動作／關閉）＋可捲動的內容＋選配的底部列。
// 推入第二層時標頭左邊出現返回鈕；內容自己決定要不要內距（清單常常要貼齊邊）。
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  canBack: { type: Boolean, default: false },
  backLabel: { type: String, default: '返回' },
  // 內容區預設有 20px 內距；清單要貼齊左右邊時傳 flush。
  flush: { type: Boolean, default: false },
});
const emit = defineEmits(['back', 'close']);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" :aria-label="title">
    <header class="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
      <Button v-if="canBack" variant="secondary" size="icon-sm" class="-ml-1 mt-0.5" :aria-label="backLabel" @click="emit('back')">
        <ArrowLeft stroke-width="1.75" />
      </Button>
      <div class="min-w-0 flex-1 py-1">
        <h2 class="truncate text-lg leading-tight font-semibold">{{ title }}</h2>
        <p v-if="description" class="mt-0.5 truncate text-sm text-muted-foreground">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-1.5 pt-0.5"><slot name="actions" /></div>
      <Button variant="secondary" size="icon-sm" class="-mr-1 mt-0.5" aria-label="關閉面板" @click="emit('close')">
        <X stroke-width="1.75" />
      </Button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto" :class="flush ? '' : 'px-5 py-4'">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
      <slot name="footer" />
    </footer>
  </section>
</template>

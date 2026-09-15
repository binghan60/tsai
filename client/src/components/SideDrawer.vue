<script setup>
import { nextTick, onMounted, ref } from 'vue';
import { X } from '@lucide/vue';
import { Button } from './ui/button';

// 櫃台看板右側的抽屜。刻意不用 ui/sheet：Sheet 是 modal（遮罩、焦點鎖定、點外面就關），
// 而櫃台開著抽屜掛號時，飼主可能正走到櫃台前——看板必須照樣看得到、按得到。
// 所以它是頁面版面裡的一欄，由頁面決定放在哪裡、看板要讓出多少寬度。
const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  closeLabel: { type: String, default: '關閉' },
  closeDisabled: { type: Boolean, default: false },
  // 新增掛號填到一半按 Esc 不該整筆丟掉，由使用端改接 escape 事件（例如收起）。
  closeOnEscape: { type: Boolean, default: true },
});
const emit = defineEmits(['close', 'escape']);

const titleId = `drawer-title-${Math.random().toString(36).slice(2, 8)}`;
const root = ref(null);

function onKeydown(event) {
  if (event.key !== 'Escape' || props.closeDisabled) return;
  event.stopPropagation();
  emit('escape');
  if (props.closeOnEscape) emit('close');
}

onMounted(async () => {
  await nextTick();
  // 頁首的「收起」之類按鈕排在內容前面，不能讓它們搶走第一個焦點。
  const target = root.value?.querySelector('[autofocus]') || root.value?.querySelector('input, textarea');
  target?.focus({ preventScroll: true });
});
</script>

<template>
  <section ref="root" role="region" :aria-labelledby="titleId" class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" @keydown="onKeydown">
    <header class="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
      <div class="min-w-0 flex-1">
        <h2 :id="titleId" class="text-base font-semibold">{{ title }}</h2>
        <p v-if="description" class="mt-0.5 text-xs text-muted-foreground">{{ description }}</p>
      </div>
      <slot name="actions" />
      <Button type="button" variant="secondary" size="icon-sm" data-drawer-close :aria-label="closeLabel" :disabled="closeDisabled" @click="emit('close')">
        <X class="h-4 w-4" stroke-width="1.75" />
      </Button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">
      <slot name="footer" />
    </footer>
  </section>
</template>

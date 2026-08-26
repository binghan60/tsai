<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronRight } from '@lucide/vue';

const props = defineProps({
  items: { type: Array, required: true },
  modelValue: { type: String, default: '' },
  counts: { type: Object, default: () => ({}) },
  ariaLabel: { type: String, required: true },
});

const emit = defineEmits(['update:modelValue']);
const scroller = ref(null);
const hasMoreRight = ref(false);
let resizeObserver;

// 單一扁平膠囊：track 用 bg-muted 墊底，選取態浮一顆白色 chip（跟 Pagination
// 上一頁鈕同一個「raised chip on a muted pill」語彙），不再用主色調底面或色點
// ——頁籤是導覽，不是狀態顯示，色彩份量交給徽章跟 badge 就好。
const selectedClasses = 'bg-card text-primary font-semibold shadow-sm';
const idleClasses = 'bg-field/70 text-muted-foreground font-medium hover:bg-card hover:text-foreground';

function onTabKeydown(event, index, items, emit) {
  let next = null;
  if (event.key === 'ArrowRight') next = (index + 1) % items.length;
  if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = items.length - 1;
  if (next === null) return;
  event.preventDefault();
  emit('update:modelValue', items[next].key);
  const tabs = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]');
  requestAnimationFrame(() => tabs?.[next]?.focus());
}

function updateScrollHint() {
  const element = scroller.value;
  hasMoreRight.value = Boolean(element && element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
}

onMounted(async () => {
  await nextTick();
  updateScrollHint();
  if (typeof ResizeObserver !== 'undefined' && scroller.value) {
    resizeObserver = new ResizeObserver(updateScrollHint);
    resizeObserver.observe(scroller.value);
  }
});
onBeforeUnmount(() => resizeObserver?.disconnect());
watch(() => props.items, async () => {
  await nextTick();
  updateScrollHint();
}, { deep: true });
</script>

<template>
  <div
    ref="scroller"
    class="relative inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-muted p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    role="tablist"
    :aria-label="ariaLabel"
    @scroll="updateScrollHint"
  >
    <button
      v-for="item in items"
      :key="item.key || 'all'"
      type="button"
      role="tab"
      class="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-sm whitespace-nowrap transition-colors duration-200 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      :class="modelValue === item.key ? selectedClasses : idleClasses"
      :aria-selected="modelValue === item.key"
      :aria-current="modelValue === item.key ? 'page' : undefined"
      :tabindex="modelValue === item.key ? 0 : -1"
      @click="emit('update:modelValue', item.key)"
      @keydown="onTabKeydown($event, items.indexOf(item), items, emit)"
    >
      <span>{{ item.label }}</span>
      <span v-if="counts[item.key] !== undefined" class="text-xs tabular-nums opacity-70">{{ counts[item.key] }}</span>
    </button>
    <span v-if="hasMoreRight" class="pointer-events-none absolute inset-y-1.5 right-1.5 flex w-9 items-center justify-end rounded-r-full bg-gradient-to-l from-muted via-muted/90 to-transparent pr-1 text-muted-foreground sm:hidden" aria-hidden="true">
      <ChevronRight class="h-4 w-4" stroke-width="1.75" />
    </span>
  </div>
</template>

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

// 分段切換：下凹軌道＋選取項浮起一塊卡片底（跟 SegmentedControl 同一個外觀）。
// 頁籤是導覽不是狀態，選取態不上主色，只有計數數字轉成主色。
const selectedClasses = 'segment-active font-semibold';
const idleClasses = 'text-muted-foreground font-medium hover:text-foreground';

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
    class="relative inline-flex max-w-full items-center gap-0.5 overflow-x-auto segment-track [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    role="tablist"
    :aria-label="ariaLabel"
    @scroll="updateScrollHint"
  >
    <button
      v-for="item in items"
      :key="item.key || 'all'"
      type="button"
      role="tab"
      class="inline-flex h-[2.125rem] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm leading-none whitespace-nowrap transition-colors duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring"
      :class="modelValue === item.key ? selectedClasses : idleClasses"
      :aria-selected="modelValue === item.key"
      :aria-current="modelValue === item.key ? 'page' : undefined"
      :tabindex="modelValue === item.key ? 0 : -1"
      @click="emit('update:modelValue', item.key)"
      @keydown="onTabKeydown($event, items.indexOf(item), items, emit)"
    >
      <span>{{ item.label }}</span>
      <span v-if="counts[item.key] !== undefined" class="num text-xs" :class="modelValue === item.key ? 'text-primary' : 'text-subtle-foreground'">{{ counts[item.key] }}</span>
    </button>
    <span v-if="hasMoreRight" class="pointer-events-none absolute inset-y-1.5 right-1.5 flex w-9 items-center justify-end rounded-r-lg bg-gradient-to-l from-sunken via-sunken/90 to-transparent pr-1 text-muted-foreground sm:hidden" aria-hidden="true">
      <ChevronRight class="h-4 w-4" stroke-width="1.75" />
    </span>
  </div>
</template>

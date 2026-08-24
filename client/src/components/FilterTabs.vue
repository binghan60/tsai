<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronRight, SlidersHorizontal } from '@lucide/vue';

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

// 篩選頁籤是導覽，不是狀態顯示。之前每個 tone 都會把整顆按鈕染成自己的顏色
// （info 藍、success 綠、danger 紅…），一排篩選籤變成六色彩虹，跟徽章又是
// 另一套色值，畫面上最不重要的控制列反而最搶眼。
//
// 現在選取態一律是主色的淡面，tone 只留給前面那顆小圓點——「這個佇列是關於
// 哪種狀態」的線索還在，但顏色的份量退回它該有的位置。
const selectedClasses = 'bg-accent text-accent-foreground ring-primary/25';
const idleClasses = 'text-muted-foreground hover:bg-card hover:text-foreground';
const selectedBadgeClasses = 'bg-primary/15 text-accent-foreground';
const idleBadgeClasses = 'bg-background text-muted-foreground';

const toneDotClasses = {
  neutral: 'bg-muted-foreground',
  primary: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
};

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
  <nav
    class="relative flex items-stretch gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm dark:shadow-none"
    :aria-label="ariaLabel"
  >
    <div class="hidden shrink-0 items-center gap-2 border-r border-border px-2 pr-4 text-sm font-medium text-muted-foreground sm:flex" aria-hidden="true">
      <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <SlidersHorizontal class="h-4 w-4" stroke-width="1.75" />
      </span>
      <span>篩選</span>
    </div>

    <div ref="scroller" class="min-w-0 flex-1 overflow-x-auto rounded-xl bg-muted/50 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" @scroll="updateScrollHint">
      <div class="flex min-w-max gap-1 sm:min-w-full">
        <button
          v-for="item in items"
          :key="item.key || 'all'"
          type="button"
          role="tab"
          class="group inline-flex min-h-11 min-w-28 flex-1 shrink-0 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium ring-1 ring-transparent transition-[color,background-color,box-shadow] duration-200 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          :class="modelValue === item.key ? [selectedClasses, 'shadow-sm'] : idleClasses"
          :aria-selected="modelValue === item.key"
          :aria-current="modelValue === item.key ? 'page' : undefined"
          :tabindex="modelValue === item.key ? 0 : -1"
          @click="emit('update:modelValue', item.key)"
          @keydown="onTabKeydown($event, items.indexOf(item), items, emit)"
        >
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full transition-opacity"
            :class="[toneDotClasses[item.tone || 'primary'], modelValue === item.key ? 'opacity-100' : 'opacity-45 group-hover:opacity-70']"
            aria-hidden="true"
          />
          <span class="whitespace-nowrap">{{ item.label }}</span>
          <span
            v-if="counts[item.key] !== undefined"
            class="inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums transition-colors"
            :class="modelValue === item.key ? selectedBadgeClasses : idleBadgeClasses"
          >{{ counts[item.key] }}</span>
        </button>
      </div>
    </div>
    <span v-if="hasMoreRight" class="pointer-events-none absolute inset-y-2 right-2 flex w-9 items-center justify-end rounded-r-xl bg-gradient-to-l from-muted via-muted/90 to-transparent pr-1 text-muted-foreground sm:hidden" aria-hidden="true">
      <ChevronRight class="h-4 w-4" stroke-width="1.75" />
    </span>
  </nav>
</template>

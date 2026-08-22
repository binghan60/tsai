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

const toneClasses = {
  neutral: 'bg-background text-foreground ring-border/80',
  primary: 'bg-primary/10 text-primary ring-primary/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  danger: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
};

const toneBadgeClasses = {
  neutral: 'bg-foreground/10 text-foreground',
  primary: 'bg-primary/15 text-primary',
  info: 'bg-sky-200/70 text-sky-800 dark:bg-sky-400/20 dark:text-sky-200',
  success: 'bg-emerald-200/70 text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-200',
  danger: 'bg-red-200/70 text-red-800 dark:bg-red-400/20 dark:text-red-200',
  warning: 'bg-amber-200/80 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200',
};

const toneDotClasses = {
  neutral: 'bg-foreground/45',
  primary: 'bg-primary',
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  danger: 'bg-red-500',
  warning: 'bg-amber-500',
};

const idleClasses = 'text-muted-foreground hover:bg-background/70 hover:text-foreground';

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
    class="relative flex items-stretch gap-2 rounded-2xl border border-border/70 bg-card/90 p-2 shadow-sm dark:shadow-none"
    :aria-label="ariaLabel"
  >
    <div class="hidden shrink-0 items-center gap-2 border-r border-border/70 px-2 pr-4 text-sm font-medium text-muted-foreground sm:flex" aria-hidden="true">
      <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <SlidersHorizontal class="h-4 w-4" stroke-width="1.75" />
      </span>
      <span>篩選</span>
    </div>

    <div ref="scroller" class="min-w-0 flex-1 overflow-x-auto rounded-xl bg-muted/60 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" @scroll="updateScrollHint">
      <div class="flex min-w-max gap-1 sm:min-w-full">
        <button
          v-for="item in items"
          :key="item.key || 'all'"
          type="button"
          role="tab"
          class="group inline-flex min-h-11 min-w-28 flex-1 shrink-0 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium ring-1 ring-transparent transition-[color,background-color,box-shadow] duration-200 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          :class="modelValue === item.key
            ? [toneClasses[item.tone || 'primary'], 'shadow-sm']
            : idleClasses"
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
            :class="modelValue === item.key ? toneBadgeClasses[item.tone || 'primary'] : 'bg-background/80 text-muted-foreground'"
          >{{ counts[item.key] }}</span>
        </button>
      </div>
    </div>
    <span v-if="hasMoreRight" class="pointer-events-none absolute inset-y-2 right-2 flex w-9 items-center justify-end rounded-r-xl bg-gradient-to-l from-muted via-muted/90 to-transparent pr-1 text-muted-foreground sm:hidden" aria-hidden="true">
      <ChevronRight class="h-4 w-4" stroke-width="1.75" />
    </span>
  </nav>
</template>

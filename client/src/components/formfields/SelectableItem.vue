<script setup>
import { computed } from 'vue';
import { X } from '@lucide/vue';
import { useRecordForm } from './context';

// 讓版式元件在「表單設計」的畫布上可以被點選。
//
// 真正填表單時 context 不會提供 selection，此時這個元件會把 slot 原封不動吐出來、
// 完全不產生任何 DOM —— 版面必須跟沒有這層包裝時一模一樣，這是不能妥協的前提。
const props = defineProps({ itemKey: { type: String, required: true } });

const { selection } = useRecordForm();
const active = computed(() => selection?.selectedKey?.value === props.itemKey);
// 停用的項目在畫布上要看得到也點得到，否則使用者沒有地方把它重新啟用。
const muted = computed(() => Boolean(selection?.disabledKeys?.value?.has(props.itemKey)));
const removable = computed(() => Boolean(selection?.remove));
</script>

<template>
  <slot v-if="!selection" />
  <div
    v-else
    class="group/canvas-item relative cursor-pointer rounded-lg outline-2 outline-offset-4 transition-colors"
    :class="[
      active ? 'outline-primary' : 'outline-transparent hover:outline-primary/35',
      muted ? 'opacity-45' : '',
    ]"
    role="button"
    tabindex="0"
    :aria-pressed="active"
    @click.stop="selection.select(itemKey)"
    @keydown.enter.prevent="selection.select(itemKey)"
    @keydown.space.prevent="selection.select(itemKey)"
  >
    <span
      v-if="muted"
      class="absolute -top-2 left-0 z-10 rounded-full bg-foreground px-2 text-xs font-medium text-background"
    >已停用</span>
    <button
      v-if="removable"
      type="button"
      data-canvas-action
      class="absolute -right-3 -top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-destructive/10 text-destructive shadow-sm transition hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
      :class="active
        ? 'opacity-100'
        : 'invisible opacity-0 group-hover/canvas-item:visible group-hover/canvas-item:opacity-100 group-focus-within/canvas-item:visible group-focus-within/canvas-item:opacity-100'"
      aria-label="移除這個項目"
      @click.stop="selection.remove(itemKey)"
    >
      <X class="h-4 w-4" stroke-width="1.75" />
    </button>
    <slot />
  </div>
</template>

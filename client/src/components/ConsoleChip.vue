<script setup>
import { computed } from 'vue';
import { Badge } from './ui/badge';

// 診療台／櫃台頁首用來開面板的 chip。視覺語彙沿用 FilterTabs 的「muted 軌道上浮一顆 chip」，
// 但那支是 role="tablist" 的篩選、這裡是開關面板，語意不同所以分成兩支元件。
//
// 數字只有兩種讀法，不要再加第三種：
//   neutral 灰數字 ＝ 狀態讀數，0 也照顯示（「那裡沒東西，不用點」本身就是資訊）
//   todo    紅徽章 ＝ 要人動手的待辦，0 就整個不畫，不留一顆紅色的零在那裡吵
// 之前這三顆按鈕有三套寫法（裸 span、手寫絕對定位紅點、Badge），紅點那顆還是全站唯一。
//
// 根元素是原生 button 且不關掉 inheritAttrs，所以可以直接當 <PopoverTrigger as-child> 用（櫃台的初診選單）。
const props = defineProps({
  icon: { type: [Object, Function], default: null },
  label: { type: String, required: true },
  count: { type: Number, default: null },
  tone: { type: String, default: 'neutral' },
  active: { type: Boolean, default: false },
});

const todo = computed(() => props.tone === 'todo');
const showTodo = computed(() => todo.value && Number(props.count) > 0);
const showCount = computed(() => !todo.value && props.count !== null);
</script>

<template>
  <button
    type="button"
    :aria-pressed="active"
    :aria-label="count === null ? label : `${label}，${count} 筆`"
    class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm leading-none transition-colors"
    :class="active ? 'bg-card font-semibold text-primary shadow-sm' : 'bg-field font-medium text-muted-foreground hover:bg-card hover:text-foreground'"
  >
    <component :is="icon" v-if="icon" class="h-4 w-4" stroke-width="1.75" aria-hidden="true" />
    {{ label }}
    <Badge v-if="showTodo" variant="status" class="bg-danger-surface text-danger tabular-nums">{{ count > 99 ? '99+' : count }}</Badge>
    <span v-else-if="showCount" class="tabular-nums text-muted-foreground">{{ count }}</span>
    <slot />
  </button>
</template>

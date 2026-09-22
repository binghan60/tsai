<script setup>
import { computed } from 'vue';

// 診療台／櫃台頁首用來開面板的 chip。視覺語彙沿用 FilterTabs 的「muted 軌道上浮一顆 chip」，
// 但那支是 role="tablist" 的篩選、這裡是開關面板，語意不同所以分成兩支元件。
//
// 數字只有兩種讀法，不要再加第三種：
//   neutral 灰數字 ＝ 狀態讀數，跟在文字後面、inline，0 也照顯示（「那裡沒東西，不用點」本身就是資訊）
//   todo    紅徽章 ＝ 要人動手的待辦，疊在按鈕右上角（FB 通知樣式：實心紅底、白字、ring 蓋掉底下的角），
//           0 就整個不畫，不留一顆紅色的零在那裡吵。跟 GlobalChatWidget 未讀泡泡同一套視覺語彙，
//           ring 用 ring-muted 是因為這顆 chip 疊在 ConsoleChipBar 的 muted 軌道上，不是頁面底色。
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
    class="relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm leading-none transition-colors"
    :class="active ? 'bg-card font-semibold text-primary shadow-sm' : 'bg-field font-medium text-muted-foreground hover:bg-card hover:text-foreground'"
  >
    <component :is="icon" v-if="icon" class="h-4 w-4" stroke-width="1.75" aria-hidden="true" />
    {{ label }}
    <span v-if="showCount" class="tabular-nums text-muted-foreground">{{ count }}</span>
    <span
      v-if="showTodo"
      class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold leading-none text-white ring-2 ring-muted tabular-nums"
      aria-hidden="true"
    >{{ count > 99 ? '99+' : count }}</span>
    <slot />
  </button>
</template>

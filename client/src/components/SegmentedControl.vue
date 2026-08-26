<script setup>
// 「同時只能選一個、選項簡短、沒有描述文字」的切換控制。
//
// 這個互動模式全站原本有四種不同畫法：物種／狀態篩選是各自獨立描邊的實心填色鈕、
// 桌機畫布模式是白色浮動晶片、手機面板切換是純色實心、FilterTabs（佇列頁籤）是
// 淡色調底面。同一個「這是選取中的選項」的概念卻有四種顏色語彙，選取態不再是
// 一致的視覺記號。
//
// 這裡採 FilterTabs 已經確立的語言：軌道用 bg-muted，選取項用 bg-accent
// text-accent-foreground（主色淡面——CLAUDE.md 定義的「選取／啟用中狀態」正式用法）。
// 需要計數徽章、色點或橫向捲動時用 FilterTabs，不要在這裡加——那樣兩個元件
// 遲早又會分裂成不同外觀。
const props = defineProps({
  modelValue: { type: [String, null], required: true },
  // [{ value, label, icon? }]
  options: { type: Array, required: true },
  ariaLabel: { type: String, required: true },
  // sm 用於工具列等次要情境（例如表單編輯器的顯示模式切換）。
  size: { type: String, default: 'default' },
  // 手機導覽列那種要撐滿容器、每個選項等寬的情境用這個，
  // 一般篩選鈕（寬度依文字內容）維持預設的 inline-flex。
  fullWidth: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);

function onKeydown(event, index) {
  let next = null;
  if (event.key === 'ArrowRight') next = (index + 1) % props.options.length;
  if (event.key === 'ArrowLeft') next = (index - 1 + props.options.length) % props.options.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = props.options.length - 1;
  if (next === null) return;
  event.preventDefault();
  emit('update:modelValue', props.options[next].value);
  const tabs = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]');
  requestAnimationFrame(() => tabs?.[next]?.focus());
}
</script>

<template>
  <div
    role="tablist"
    :aria-label="ariaLabel"
    class="gap-1 rounded-lg bg-muted p-1"
    :class="fullWidth ? 'grid' : 'inline-flex'"
    :style="fullWidth ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined"
  >
    <button
      v-for="(option, index) in options"
      :key="option.value"
      type="button"
      role="tab"
      class="inline-flex items-center justify-center gap-2 rounded-md px-3 font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:translate-y-px"
      :class="[
        size === 'sm' ? 'min-h-9 text-sm' : 'min-h-11 text-sm',
        modelValue === option.value ? 'bg-accent text-accent-foreground shadow-sm' : 'bg-field/70 text-muted-foreground hover:bg-card hover:text-foreground',
      ]"
      :aria-selected="modelValue === option.value"
      :tabindex="modelValue === option.value ? 0 : -1"
      @click="emit('update:modelValue', option.value)"
      @keydown="onKeydown($event, index)"
    >
      <component v-if="option.icon" :is="option.icon" class="h-4 w-4 shrink-0" stroke-width="1.75" aria-hidden="true" />
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>

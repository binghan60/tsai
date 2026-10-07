<script setup>
import { Check } from '@lucide/vue';

// 「一定要選一個、選了哪個要一眼看得出來」的二選一／三選一，例如保證金的「已收／這次不收」。
// 跟 SegmentedControl 的差別：那個是切換檢視用的，選取項只是浮起一塊卡片底，放在有底色的區塊上很淡；
// 這個是在做決定，選中的那顆整顆主色實心＋打勾，沒選的是卡片底＋細邊。一開始可以都沒選。
defineProps({
  modelValue: { type: String, default: '' },
  // [{ value, label }]
  options: { type: Array, required: true },
  ariaLabel: { type: String, required: true },
});
const emit = defineEmits(['update:modelValue']);
</script>

<template>
  <div role="radiogroup" :aria-label="ariaLabel" class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === option.value"
      class="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring"
      :class="modelValue === option.value
        ? 'bg-primary font-semibold text-primary-foreground'
        : 'border border-border-strong bg-card font-medium text-foreground hover:bg-hover'"
      @click="emit('update:modelValue', option.value)"
    >
      <Check v-if="modelValue === option.value" class="size-[1.125rem] shrink-0" stroke-width="2.25" aria-hidden="true" />
      <span class="truncate">{{ option.label }}</span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Mars, Venus } from '@lucide/vue';
import { isNeutered, sexLabel } from '../lib/petDisplay';

// 性別：♂／♀ 圖示，標頭可以再帶文字與「已結紮」標記。性別未知時什麼都不畫。
const props = defineProps({
  sex: { type: String, default: '' },
  neutered: { type: [String, Boolean], default: '' },
  // 只畫圖示（清單）；標頭用 withLabel 帶出「公／母」文字與結紮標記。
  withLabel: { type: Boolean, default: false },
});

const label = computed(() => sexLabel(props.sex));
const icon = computed(() => (props.sex === 'female' ? Venus : props.sex === 'male' ? Mars : null));
</script>

<template>
  <span v-if="icon" class="inline-flex items-center gap-1.5">
    <component :is="icon" class="size-4 shrink-0 text-subtle-foreground" stroke-width="2" :aria-label="withLabel ? undefined : label" :aria-hidden="withLabel ? 'true' : undefined" />
    <span v-if="withLabel">{{ label }}</span>
    <span
      v-if="withLabel && isNeutered(neutered)"
      class="inline-flex h-6 items-center rounded-sm bg-sunken px-1.5 text-2xs leading-none font-semibold text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]"
    >已結紮</span>
  </span>
</template>

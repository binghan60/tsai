<script setup>
// 理學檢查與檢驗共用的三態切換（未檢查／正常／異常）。
const OPTIONS = [
  { value: 'not_checked', label: '未檢查' },
  { value: 'normal', label: '正常' },
  { value: 'abnormal', label: '異常' },
];

defineProps({
  finding: { type: Object, required: true },
  ariaLabel: { type: String, required: true },
  showAutoBadge: { type: Boolean, default: false },
});
const emit = defineEmits(['select']);
</script>

<template>
  <div class="grid grid-cols-3 gap-1 rounded-xl bg-muted/40 p-1" role="group" :aria-label="ariaLabel">
    <button
      v-for="option in OPTIONS"
      :key="option.value"
      type="button"
      class="relative min-h-10 rounded-lg px-2 text-xs font-medium"
      :class="finding.status === option.value
        ? (option.value === 'abnormal' ? 'bg-red-800 text-white' : option.value === 'normal' ? 'bg-emerald-700 text-white' : 'bg-white text-foreground shadow-sm  ')
        : 'text-muted-foreground hover:bg-white/70  '"
      @click="emit('select', option.value)"
    >
      {{ option.label }}
      <span v-if="showAutoBadge && finding.status === option.value && finding.statusSource === 'auto'" class="ml-1 text-xs opacity-80">自動</span>
    </button>
  </div>
</template>

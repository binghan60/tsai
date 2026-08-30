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
        ? (option.value === 'abnormal' ? 'bg-danger text-card' : option.value === 'normal' ? 'bg-success text-card' : 'bg-field text-foreground shadow-sm')
        : 'bg-field/70 text-muted-foreground hover:bg-field'"
      @click="emit('select', option.value)"
    >
      {{ option.label }}
      <span
        v-if="showAutoBadge && finding.status === option.value && finding.statusSource === 'auto'"
        class="absolute right-1.5 top-1.5 inline-flex opacity-80"
        title="依參考範圍判讀"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9L12 3Z" />
          <path d="m19 16-.8 2.2L16 19l2.2.8L19 22l.8-2.2L22 19l-2.2-.8L19 16Z" />
        </svg>
        <span class="sr-only">依參考範圍判讀</span>
      </span>
    </button>
  </div>
</template>

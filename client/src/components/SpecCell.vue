<script setup>
defineProps({
  label: { type: String, required: true },
  // 數字類的值（電話、體重、時間）用等寬字。
  mono: { type: Boolean, default: false },
});
</script>

<template>
  <div class="flex min-w-0 flex-col gap-0.5">
    <span class="spec-label">{{ label }}</span>
    <span class="inline-flex min-w-0 items-center gap-1.5 text-base leading-snug font-semibold whitespace-nowrap text-foreground" :class="mono ? 'num' : ''">
      <slot />
    </span>
  </div>
</template>

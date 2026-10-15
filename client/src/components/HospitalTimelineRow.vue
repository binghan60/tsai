<script setup>
// 住院照護時間軸的一列：左邊時刻（＋署名）、中間一條軌道與圓點、右邊內容（一筆紀錄、新增／修改表單、「記一筆」鈕）。
// 圓點：記好的紀錄是主色實心；正在填的表單與「記一筆」是空心。
defineProps({
  time: { type: String, default: '' },
  staff: { type: String, default: '' },
  hollow: { type: Boolean, default: false },
});
</script>

<template>
  <div class="grid grid-cols-[3.25rem_1.25rem_minmax(0,1fr)] gap-x-1 @2xl:grid-cols-[4rem_1.75rem_minmax(0,1fr)] @2xl:gap-x-1.5">
    <div class="flex flex-col items-end gap-0.5 pt-3">
      <span class="num text-base font-semibold" :class="hollow ? 'text-primary' : 'text-foreground'">{{ time }}</span>
      <span v-if="staff" class="text-xs text-subtle-foreground">{{ staff }}</span>
    </div>
    <div class="relative flex justify-center" aria-hidden="true">
      <span class="absolute inset-y-0 w-0.5 bg-border" />
      <span
        class="relative mt-4.5 size-3 rounded-full shadow-[0_0_0_3px_var(--background)]"
        :class="hollow ? 'border-2 border-primary bg-card' : 'bg-primary'"
      />
    </div>
    <div class="min-w-0 pb-2.5"><slot /></div>
  </div>
</template>

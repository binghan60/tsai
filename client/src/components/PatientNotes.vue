<script setup>
// 寵物／飼主備註的警示小框，櫃台看板、診療台佇列、櫃台處理視窗共用。
// 「會咬人」「飼主難溝通」要在叫號、面對飼主之前就看到，所以常駐顯示、最多兩行，完整內容放 title。
defineProps({
  // patientNotesFor() 的回傳：[{ key, label, text }]
  notes: { type: Array, default: () => [] },
});
</script>

<template>
  <div v-if="notes.length" class="space-y-1">
    <p
      v-for="note in notes"
      :key="note.key"
      class="line-clamp-2 whitespace-pre-wrap wrap-anywhere rounded-md bg-warning-surface px-2 py-1 text-xs font-medium text-warning"
      :title="note.text"
    >
      <span class="font-semibold">{{ note.label }}備註：</span>{{ note.text }}
    </p>
  </div>
</template>

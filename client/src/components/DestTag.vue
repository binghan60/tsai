<script setup>
import { computed } from 'vue';
import { FileText, History, Lock, Pill } from '@lucide/vue';

// 看診欄位旁的小標記：這一欄寫完會去哪裡。
// journal＝寫進病歷日誌、report＝帶入健檢報告、internal＝只給院內看、medication＝送交櫃台時新增一張藥單。
const DESTINATIONS = {
  journal: { icon: History, label: '日誌', title: '寫進病歷日誌' },
  report: { icon: FileText, label: '報告', title: '帶入健檢報告' },
  internal: { icon: Lock, label: '院內', title: '只給院內看' },
  medication: { icon: Pill, label: '藥單', title: '送交櫃台時新增一張藥單' },
};

const props = defineProps({
  // 陣列或單一字串，例如 ['journal', 'report']。
  to: { type: [Array, String], required: true },
});

const items = computed(() => [].concat(props.to).map((key) => DESTINATIONS[key]).filter(Boolean));
</script>

<template>
  <span class="inline-flex gap-1">
    <span
      v-for="item in items"
      :key="item.label"
      v-tip="item.title"
      class="inline-flex h-[1.375rem] items-center gap-1 rounded-sm bg-sunken px-1.5 text-2xs leading-none font-semibold text-subtle-foreground shadow-[inset_0_0_0_1px_var(--border)]"
    >
      <component :is="item.icon" class="size-3" stroke-width="2" aria-hidden="true" />
      {{ item.label }}
      <span class="sr-only">（{{ item.title }}）</span>
    </span>
  </span>
</template>

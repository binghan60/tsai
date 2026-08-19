<script setup>
import { computed } from 'vue';
import { hasContent, labValueLabel, referenceLabel, statusText } from './reportItem';
import ReportField from './ReportField.vue';
import { sectionRuns } from '../../lib/sectionRuns';

const props = defineProps({ section: { type: Object, required: true } });

// 完全沒檢查、也沒填數值或備註的檢驗項目不列出來；其他型別沒填的也不列。
// 判斷一律走 hasContent()，否則放進這個區塊的 finding 項目（沒有 value 欄位）會被整個漏掉。
const visible = computed(() => (props.section.items ?? []).filter(hasContent));
// 依表單上的順序切段落，換過型別的欄位不會跑到報告最後面。
const runs = computed(() => sectionRuns(visible.value, (item) => item.type === 'lab'));

// 同一段落內再依檢驗分組收攏，沒有分組名稱的集中在一組、標題不顯示。
function groupsOf(run) {
  const map = new Map();
  for (const item of run.items) {
    const group = item.group ?? '';
    if (!map.has(group)) map.set(group, []);
    map.get(group).push(item);
  }
  return [...map.entries()].map(([label, items]) => ({ label, items }));
}
</script>

<template>
  <section v-if="visible.length" class="mt-8 space-y-5">
    <h2 class="text-sm font-semibold text-brand-700">{{ section.title }}</h2>
    <template v-for="run in runs" :key="run.key">
      <div v-if="run.kind === 'primary'" class="space-y-5">
        <div v-for="group in groupsOf(run)" :key="group.label" class="break-inside-avoid">
          <h3 v-if="group.label" class="mb-2 text-xs font-semibold text-stone-500">{{ group.label }}</h3>
          <div class="overflow-hidden rounded-xl border border-stone-200">
            <div
              v-for="finding in group.items"
              :key="finding.key"
              class="grid grid-cols-[1fr_auto] gap-2 border-b border-stone-200 px-4 py-3 text-sm last:border-0 sm:grid-cols-[220px_95px_170px_1fr]"
            >
              <span class="font-medium text-stone-800">{{ finding.label }}</span>
              <span :class="finding.status === 'abnormal' ? 'text-red-700' : finding.status === 'normal' ? 'text-emerald-700' : 'text-stone-500'">
                {{ statusText(finding.status) }}
                <small v-if="finding.statusSource === 'auto'" class="ml-1 text-[10px] text-stone-500">自動</small>
              </span>
              <span class="text-stone-700">
                <strong class="font-medium">{{ labValueLabel(finding) }}</strong>
                <small v-if="referenceLabel(finding)" class="mt-0.5 block text-[11px] text-stone-500">參考 {{ referenceLabel(finding) }}</small>
              </span>
              <span class="col-span-2 whitespace-pre-wrap text-stone-600 sm:col-span-1">{{ finding.note || '' }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="space-y-5">
        <ReportField v-for="item in run.items" :key="item.key" :item="item" />
      </div>
    </template>
  </section>
</template>

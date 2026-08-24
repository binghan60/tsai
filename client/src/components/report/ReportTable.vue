<script setup>
import { computed } from 'vue';
import { hasContent, labValueLabel, previousDateLabel, previousLabValueLabel, referenceLabel, statusText } from './reportItem';
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
          <div class="overflow-x-auto rounded-xl border border-stone-200">
            <div class="grid min-w-[640px] grid-cols-[1fr_2.8rem_0.5fr_0.5fr_2.8fr] border-b border-stone-200 bg-stone-50/80 px-4 py-2 text-xs font-semibold text-stone-500">
              <span>項目名稱</span>
              <span class="border-l border-stone-200 pl-2">結果</span>
              <span class="border-l border-stone-200 pl-2">本次數值</span>
              <span class="border-l border-stone-200 pl-2">上次數值</span>
              <span class="border-l border-stone-200 pl-2">備註</span>
            </div>
            <div
              v-for="finding in group.items"
              :key="finding.key"
              class="grid min-w-[640px] grid-cols-[1fr_2.8rem_0.5fr_0.5fr_2.8fr] gap-x-0 border-b border-stone-200 px-4 py-3 text-sm last:border-0"
            >
              <!-- 1. 項目名稱 -->
              <span class="min-w-0 pr-2 font-medium text-stone-800">{{ finding.label }}</span>
              <!-- 2. 結果（未檢查留空） -->
              <span
                v-if="finding.status === 'abnormal' || finding.status === 'normal'"
                class="min-w-0 border-l border-stone-100 pl-2"
                :class="finding.status === 'abnormal' ? 'text-red-700' : 'text-emerald-700'"
              >
                {{ statusText(finding.status) }}
                <small v-if="finding.statusSource === 'auto'" class="mt-0.5 block text-xs text-stone-500">自動</small>
              </span>
              <span v-else class="min-w-0 border-l border-stone-100 pl-2"></span>
              <!-- 3. 本次數值 -->
              <span class="min-w-0 border-l border-stone-100 pl-2 text-stone-700">
                <strong class="font-medium">{{ labValueLabel(finding) }}</strong>
                <small v-if="referenceLabel(finding)" class="mt-0.5 block text-xs text-stone-500">參考 {{ referenceLabel(finding) }}</small>
              </span>
              <!-- 4. 上次數值（獨立欄位，沒有歷史數值時保持空白） -->
              <span class="min-w-0 border-l border-stone-100 pl-2 text-stone-700">
                <template v-if="previousLabValueLabel(finding)">
                  <span>
                    <small v-if="previousDateLabel(finding)" class="block text-xs text-stone-500">{{ previousDateLabel(finding) }}</small>
                    <strong class="font-medium">{{ previousLabValueLabel(finding) }}</strong>
                  </span>
                </template>
              </span>
              <!-- 5. 備註 -->
              <span class="min-w-0 whitespace-pre-wrap border-l border-stone-100 pl-2 text-stone-600">{{ finding.note || '' }}</span>
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


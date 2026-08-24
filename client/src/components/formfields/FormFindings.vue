<script setup>
import { computed } from 'vue';
import StatusToggle from './StatusToggle.vue';
import FieldControl from './FieldControl.vue';
import { Label } from '../ui/label';
import SelectableItem from './SelectableItem.vue';
import TextTemplateTrigger from './TextTemplateTrigger.vue';
import { useRecordForm } from './context';
import { sectionRuns } from '../../lib/sectionRuns';
import { spanClass } from '../../lib/fieldSpan';

const props = defineProps({ section: { type: Object, required: true } });
const { findingsFor, valueFor, setValue } = useRecordForm();

// 作答列與範本項目是兩份資料，要用 key 對起來才能照範本的順序渲染。
const findings = computed(() => findingsFor(props.section));
const entryByKey = computed(() => new Map(findings.value.map((entry) => [entry.key, entry])));

const runs = computed(() => {
  const list = sectionRuns(props.section.items, (item) => item.type === 'finding');
  // 範本已經刪掉、但報告仍留著紀錄的孤兒項目沒有對應的範本項目，補在最後面。
  const known = new Set((props.section.items ?? []).map((item) => item.key));
  const orphans = findings.value.filter((entry) => !known.has(entry.key));
  if (orphans.length) list.push({ key: 'orphans', kind: 'primary', items: orphans });
  return list;
});

const findingsOf = (run) => run.items.map((item) => entryByKey.value.get(item.key)).filter(Boolean);
</script>

<template>
  <div class="@container space-y-5">
    <template v-for="run in runs" :key="run.key">
      <div v-if="run.kind === 'primary'" class="divide-y divide-border">
        <SelectableItem v-for="finding in findingsOf(run)" :key="finding.key" :item-key="finding.key">
          <div
            :id="`record-exam-row-${finding.key}`"
            class="scroll-mt-40 grid gap-3 py-4 first:pt-0 last:pb-0 @3xl:grid-cols-[190px_280px_1fr] @3xl:items-center"
          >
            <p class="text-sm font-medium text-foreground">{{ finding.label }}</p>
            <StatusToggle :finding="finding" :aria-label="`${finding.label}檢查結果`" @select="finding.status = $event" />
            <div class="space-y-1.5">
              <Label :for="`record-exam-note-${finding.key}`" class="text-xs font-medium text-muted-foreground">
                備註<span v-if="finding.status === 'abnormal'" class="text-danger"> 異常說明 *</span>
              </Label>
              <input
                :id="`record-exam-note-${finding.key}`"
                v-model="finding.note"
                type="text"
                :aria-label="`${finding.label}備註`"
                :aria-invalid="finding.status === 'abnormal' && !finding.note.trim()"
                :required="finding.status === 'abnormal'"
                :placeholder="finding.status === 'abnormal' ? '請描述異常，例如：輕微牙齦紅' : '選填'"
                class="min-h-11 w-full scroll-mt-40 rounded-xl border bg-field px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/35"
                :class="finding.status === 'abnormal' && !finding.note.trim() ? 'border-danger/35' : 'border-border '"
              />
              <TextTemplateTrigger v-model="finding.note" :item-key="finding.key" :label="`${finding.label}備註`" :input-id="`record-exam-note-${finding.key}`" />
            </div>
          </div>
        </SelectableItem>
      </div>
      <div v-else class="grid gap-x-4 gap-y-4 @xl:grid-cols-2">
        <div v-for="item in run.items" :key="item.key" :class="spanClass(item, 'xl')">
          <SelectableItem :item-key="item.key">
            <FieldControl :item="item" :section="section" />
          </SelectableItem>
        </div>
      </div>
    </template>
  </div>
</template>

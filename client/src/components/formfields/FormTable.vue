<script setup>
import { computed } from 'vue';
import StatusToggle from './StatusToggle.vue';
import FieldControl from './FieldControl.vue';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import SelectableItem from './SelectableItem.vue';
import TextTemplateTrigger from './TextTemplateTrigger.vue';
import PreviousValue from './PreviousValue.vue';
import { useRecordForm } from './context';
import { sectionRuns } from '../../lib/sectionRuns';
import { spanClass } from '../../lib/fieldSpan';

const props = defineProps({ section: { type: Object, required: true } });
const {
  valueFor, setValue, labRanges, labRangeLabel,
  labsFor, setLabStatus, autoJudgeLab, markEmptyLabGroupNormal,
} = useRecordForm();

// 作答列與範本項目是兩份資料，要用 key 對起來才能照範本的順序渲染。
const labs = computed(() => labsFor(props.section));
const entryByKey = computed(() => new Map(labs.value.map((entry) => [entry.key, entry])));

const runs = computed(() => {
  const list = sectionRuns(props.section.items, (item) => item.type === 'lab');
  // 範本已經刪掉、但報告仍留著紀錄的孤兒項目沒有對應的範本項目，補在最後面。
  const known = new Set((props.section.items ?? []).map((item) => item.key));
  const orphans = labs.value.filter((entry) => !known.has(entry.key));
  if (orphans.length) list.push({ key: 'orphans', kind: 'primary', items: orphans });
  return list;
});

const labsOf = (run) => run.items.map((item) => entryByKey.value.get(item.key)).filter(Boolean);
// 沒有分組名稱的項目集中在一組，標題不顯示。
const groupsOf = (run) => [...new Set(labsOf(run).map((item) => item.group ?? ''))];
const labsOfGroup = (run, group) => labsOf(run).filter((item) => (item.group ?? '') === group);
</script>

<template>
  <div class="@container space-y-5">
    <template v-for="run in runs" :key="run.key">
      <div v-if="run.kind === 'primary'">
        <div v-for="group in groupsOf(run)" :key="group" class="mb-7 last:mb-0">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 v-if="group" class="text-sm font-semibold text-primary">{{ group }}</h3>
            <span v-else />
            <Button type="button" variant="secondary" size="sm" class="text-xs" @click="markEmptyLabGroupNormal(section, group)">空白項目全部正常</Button>
          </div>
          <div class="divide-y divide-border rounded-xl border border-border">
            <SelectableItem v-for="finding in labsOfGroup(run, group)" :key="finding.key" :item-key="finding.key">
              <div
                :id="`record-lab-row-${finding.key}`"
                class="scroll-mt-40 grid gap-3 p-4 @5xl:grid-cols-[220px_260px_170px_1fr] @5xl:items-start"
              >
                <div class="min-w-0">
                  <p class="text-sm font-medium text-foreground">{{ finding.label }}</p>
                  <p v-if="labRangeLabel(finding)" class="mt-0.5 text-xs text-success">參考 {{ labRangeLabel(finding) }}</p>
                  <PreviousValue :item="finding" type="lab" class="mt-0.5" />
                </div>
                <!-- 三個控制項都有標題列，橫向才對得齊；沒有標題的欄位會比隔壁高出一截。 -->
                <div class="space-y-1.5">
                  <p class="text-xs font-medium text-muted-foreground">檢驗結果</p>
                  <StatusToggle :finding="finding" :aria-label="`${finding.label}檢驗結果`" show-auto-badge @select="setLabStatus(finding, $event)" />
                </div>
                <div class="space-y-1.5">
                  <Label :for="`record-lab-value-${finding.key}`" class="text-xs font-medium text-muted-foreground">{{ finding.numeric === false ? '結果描述' : '檢驗數值' }}</Label>
                  <input
                    :id="`record-lab-value-${finding.key}`"
                    v-model="finding.value"
                    type="text"
                    inputmode="decimal"
                    :aria-label="`${finding.label}數值`"
                    :placeholder="finding.numeric === false ? '選填' : labRanges[finding.key]?.unit ? `輸入數值（${labRanges[finding.key].unit}）` : '選填'"
                    class="min-h-11 w-full scroll-mt-40 rounded-xl border border-border bg-field px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                    @input="finding.numeric !== false && autoJudgeLab(finding, $event.target.value)"
                  />
                  <!-- 數值型欄位打的是數字，不需要文字模板；只有文字結果才掛。
                       key 加上 :value 後綴自成一組，讓結果描述與備註能指定不同模板。 -->
                  <TextTemplateTrigger
                    v-if="finding.numeric === false"
                    v-model="finding.value"
                    :item-key="`${finding.key}:value`"
                    :label="`${finding.label}結果描述`"
                    :input-id="`record-lab-value-${finding.key}`"
                  />
                </div>
                <div class="space-y-1.5">
                  <Label :for="`record-lab-note-${finding.key}`" class="text-xs font-medium text-muted-foreground">
                    備註<span v-if="finding.status === 'abnormal'" class="text-danger"> 異常說明 *</span>
                  </Label>
                  <input
                    :id="`record-lab-note-${finding.key}`"
                    v-model="finding.note"
                    type="text"
                    :aria-label="`${finding.label}備註`"
                    :aria-invalid="finding.status === 'abnormal' && !finding.note.trim()"
                    :required="finding.status === 'abnormal'"
                    :placeholder="finding.status === 'abnormal' ? '請描述異常' : '選填'"
                    class="min-h-11 w-full scroll-mt-40 rounded-xl border bg-field px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                    :class="finding.status === 'abnormal' && !finding.note.trim() ? 'border-danger/35' : 'border-border '"
                  />
                  <TextTemplateTrigger v-model="finding.note" :item-key="finding.key" :label="`${finding.label}備註`" :input-id="`record-lab-note-${finding.key}`" />
                </div>
              </div>
            </SelectableItem>
          </div>
        </div>
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

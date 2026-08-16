<script setup>
import { computed } from 'vue';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import FieldControl from './FieldControl.vue';
import SelectableItem from './SelectableItem.vue';
import QuickPhrases from './QuickPhrases.vue';
import { useRecordForm } from './context';
import { sectionRuns } from '../../lib/sectionRuns';
import { spanClass } from '../../lib/fieldSpan';

const props = defineProps({ section: { type: Object, required: true } });
const { valueFor, setValue, eitherOrPending } = useRecordForm();

const items = computed(() => props.section.items ?? []);
// 長文字一行一個、其餘欄位兩欄一排，但照使用者排定的順序切段落。
const runs = computed(() => sectionRuns(items.value, (item) => item.type === 'textarea'));

// 結論與照護建議是「擇一必填」，兩邊都空的時候各自標示提醒。
const EITHER_OR = { conclusion: 'treatmentPlan', treatmentPlan: 'conclusion' };
function eitherOrHint(item) {
  const counterpartRole = EITHER_OR[item.role];
  if (!counterpartRole || !eitherOrPending()) return '';
  const counterpart = items.value.find((entry) => entry.role === counterpartRole);
  return counterpart ? `*（與${counterpart.label}擇一必填）` : '';
}
</script>

<template>
  <div class="@container space-y-4">
    <template v-for="run in runs" :key="run.key">
      <div v-if="run.kind === 'primary'" class="space-y-4">
        <SelectableItem v-for="item in run.items" :key="item.key" :item-key="item.key">
          <div class="space-y-1.5">
            <Label :for="`record-${item.key}`" class="text-xs font-medium text-ink-500 dark:text-zinc-400">
              {{ item.label }}
              <span v-if="item.required" class="text-red-600 dark:text-red-400" aria-hidden="true">*</span>
              <span v-else-if="eitherOrHint(item)" class="text-red-600 dark:text-red-400"> {{ eitherOrHint(item) }}</span>
            </Label>
            <Textarea
              :id="`record-${item.key}`"
              :model-value="valueFor(item)"
              :rows="item.rows || 4"
              :placeholder="item.placeholder"
              @update:model-value="setValue(item, $event)"
            />
            <QuickPhrases
              :item-key="item.key"
              :label="item.label"
              :model-value="valueFor(item)"
              @update:model-value="setValue(item, $event)"
            />
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
